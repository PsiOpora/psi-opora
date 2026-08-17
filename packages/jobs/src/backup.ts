import { gzipSync } from "node:zlib";
import type { S3Client } from "@aws-sdk/client-s3";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
  createS3ClientFromCredentials,
  type S3Credentials,
  uploadObject,
} from "@psi-opora/storage";

/** Настройки S3 из таблицы backup_credentials (см. @psi-opora/db).
 * Псевдоним для S3Credentials из @psi-opora/storage — оставлен для обратной совместимости. */
export type BackupS3Credentials = S3Credentials;

/** Извлекает массив элементов из ответа list-метода, если сам ответ — не массив. */
type EntityExtractor = (result: unknown) => unknown[];

interface EntityConfig {
  name: string;
  file: string;
  method: string;
  params?: Record<string, unknown>;
  extractor?: EntityExtractor;
}

export interface BackupEntityResult {
  name: string;
  file: string;
  method: string;
  count: number;
  sizeBytes: number;
  durationMs: number;
  error?: string;
}

export interface CrmBackupResult {
  prefix: string;
  manifestKey: string;
  totalBytes: number;
  entities: Record<string, BackupEntityResult>;
  errors: Array<{ entity: string; error: string }>;
}

/** Сущности CRM, которые выгружаются всегда (файл на сущность). */
const BASE_ENTITIES: EntityConfig[] = [
  {
    name: "leads",
    file: "leads.jsonl.gz",
    method: "crm.lead.list",
    params: { select: ["*", "UF_*"] },
  },
  {
    name: "deals",
    file: "deals.jsonl.gz",
    method: "crm.deal.list",
    params: { select: ["*", "UF_*"] },
  },
  {
    name: "contacts",
    file: "contacts.jsonl.gz",
    method: "crm.contact.list",
    params: { select: ["*", "UF_*"] },
  },
  {
    name: "companies",
    file: "companies.jsonl.gz",
    method: "crm.company.list",
    params: { select: ["*", "UF_*"] },
  },
  {
    name: "activities",
    file: "activities.jsonl.gz",
    method: "crm.activity.list",
    params: { select: ["*", "COMMUNICATIONS"] },
  },
  {
    name: "requisites",
    file: "requisites.jsonl.gz",
    method: "crm.requisite.list",
    params: { select: ["*"] },
  },
  {
    name: "addresses",
    file: "addresses.jsonl.gz",
    method: "crm.address.list",
    params: { select: ["*"] },
  },
  {
    name: "quotes",
    file: "quotes.jsonl.gz",
    method: "crm.quote.list",
    params: { select: ["*"] },
  },
  {
    name: "invoices",
    file: "invoices.jsonl.gz",
    method: "crm.invoice.list",
    params: { select: ["*"] },
  },
  {
    name: "statuses",
    file: "statuses.jsonl.gz",
    method: "crm.status.list",
  },
  {
    name: "dealCategories",
    file: "deal-categories.jsonl.gz",
    method: "crm.dealcategory.list",
  },
  {
    name: "activityTypes",
    file: "activity-types.jsonl.gz",
    method: "crm.activity.type.list",
  },
  {
    name: "users",
    file: "users.jsonl.gz",
    method: "user.get",
  },
  {
    name: "departments",
    file: "departments.jsonl.gz",
    method: "department.get",
  },
  {
    name: "crmTypes",
    file: "crm-types.jsonl.gz",
    method: "crm.type.list",
    extractor: (result) => (result as { types?: unknown[] }).types ?? [],
  },
  {
    name: "catalogs",
    file: "catalogs.jsonl.gz",
    method: "catalog.catalog.list",
    extractor: (result) => (result as { catalogs?: unknown[] }).catalogs ?? [],
  },
];

/** Собирает полный список сущностей: базовые + каталоги + смарт-процессы. */
async function buildEntityConfigs(api: BitrixApi): Promise<EntityConfig[]> {
  const entities: EntityConfig[] = [...BASE_ENTITIES];

  // Товары каждого торгового каталога.
  try {
    const catalogs = await api.list(
      "catalog.catalog.list",
      {},
      (result) => (result as { catalogs?: unknown[] }).catalogs ?? [],
    );
    for (const catalog of catalogs) {
      const c = catalog as {
        id?: number;
        iblockId?: number;
        name?: string;
      };
      const iblockId = c.iblockId ?? c.id;
      if (!iblockId) continue;

      entities.push({
        name: `catalog-${iblockId}-products`,
        file: `catalog-${iblockId}-products.jsonl.gz`,
        method: "catalog.product.list",
        params: {
          select: ["id", "iblockId", "*"],
          filter: { iblockId },
        },
        extractor: (result) =>
          (result as { products?: unknown[] }).products ?? [],
      });
    }
  } catch {
    // Если каталоги недоступны, пропускаем — отразится в manifest.errors.
  }

  // Смарт-процессы: сначала типы, затем поля и элементы каждого типа.
  try {
    const types = await api.list(
      "crm.type.list",
      {},
      (result) => (result as { types?: unknown[] }).types ?? [],
    );

    for (const type of types) {
      const t = type as {
        entityTypeId?: number;
        title?: string;
        code?: string;
      };
      const entityTypeId = t.entityTypeId;
      if (!entityTypeId) continue;

      const baseName = t.title
        ? `${t.title.replace(/\s+/g, "-")}-${entityTypeId}`
        : `type-${entityTypeId}`;

      entities.push({
        name: `smart-process-${baseName}-fields`,
        file: `smart-process-${entityTypeId}-fields.jsonl.gz`,
        method: "crm.item.fields",
        params: { entityTypeId, useOriginalUfNames: "Y" },
        extractor: (result) => [
          {
            entityTypeId,
            title: t.title,
            code: t.code,
            fields: (result as { fields?: unknown }).fields,
          },
        ],
      });

      entities.push({
        name: `smart-process-${baseName}`,
        file: `smart-process-${entityTypeId}.jsonl.gz`,
        method: "crm.item.list",
        params: { entityTypeId, select: ["*", "UF_*"] },
        extractor: (result) => (result as { items?: unknown[] }).items ?? [],
      });
    }
  } catch {
    // Если смарт-процессы недоступны, пропускаем.
  }

  return entities;
}

/** Записывает одну сущность в S3 как сжатый JSONL. */
async function backupEntity(
  api: BitrixApi,
  entity: EntityConfig,
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<BackupEntityResult> {
  const startedAt = Date.now();
  try {
    const rows = await api.list<unknown>(
      entity.method,
      entity.params,
      entity.extractor,
    );

    const lines = rows.map((row) => JSON.stringify(row)).join("\n");
    const gzipped = gzipSync(Buffer.from(lines, "utf-8"));

    const key = `${prefix}${entity.file}`;
    await uploadObject({
      client,
      bucket,
      key,
      body: gzipped,
      contentType: "application/json",
      contentEncoding: "gzip",
      contentDisposition: `inline; filename="${entity.file}"`,
    });

    return {
      name: entity.name,
      file: entity.file,
      method: entity.method,
      count: rows.length,
      sizeBytes: gzipped.byteLength,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      name: entity.name,
      file: entity.file,
      method: entity.method,
      count: 0,
      sizeBytes: 0,
      durationMs: Date.now() - startedAt,
      error: (err as Error).message,
    };
  }
}

/** Генерирует префикс S3 для одного запуска бэкапа. */
function backupPrefix(): string {
  const now = new Date();
  const datePrefix = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().replace(/:/g, "-").replace(/\..+/, "");
  return `crm-backups/${datePrefix}/${timestamp}/`;
}

/** Колбэк прогресса: сколько сущностей выгружено из скольких и какая сейчас в работе. */
export type BackupProgressCallback = (
  done: number,
  total: number,
  currentEntity: string,
) => void | Promise<void>;

/** Выгружает все CRM-сущности в отдельные файлы и формирует manifest.json. */
export async function runCrmBackup(
  api: BitrixApi,
  creds: BackupS3Credentials,
  onProgress?: BackupProgressCallback,
): Promise<CrmBackupResult> {
  const { client, bucket } = createS3ClientFromCredentials(creds);
  const prefix = backupPrefix();

  const entities = await buildEntityConfigs(api);
  const results: Record<string, BackupEntityResult> = {};
  const errors: Array<{ entity: string; error: string }> = [];

  // Последовательно, чтобы не упереться в лимиты Bitrix24 REST API.
  for (const [index, entity] of entities.entries()) {
    await onProgress?.(index, entities.length, entity.name);
    const result = await backupEntity(api, entity, client, bucket, prefix);
    results[entity.name] = result;
    if (result.error) {
      errors.push({ entity: entity.name, error: result.error });
    }
  }
  await onProgress?.(entities.length, entities.length, "manifest.json");

  const totalBytes = Object.values(results).reduce(
    (sum, r) => sum + r.sizeBytes,
    0,
  );

  const manifest = {
    version: "2",
    createdAt: new Date().toISOString(),
    prefix,
    source: "bitrix24",
    entities: results,
    totalBytes,
    errors,
  };

  const manifestKey = `${prefix}manifest.json`;
  await uploadObject({
    client,
    bucket,
    key: manifestKey,
    body: JSON.stringify(manifest, null, 2),
    contentType: "application/json",
  });

  return { prefix, manifestKey, totalBytes, entities: results, errors };
}

export interface ExecutedBackup extends CrmBackupResult {
  runId: string;
}

/** Полный цикл бэкапа с записью статуса в backup_runs. */
export async function executeCrmBackup(
  api: BitrixApi,
  /** Если запуск уже создан вызывающей стороной (например, чтобы сразу
   * показать его в истории), передайте его id — новую запись создавать не будем. */
  existingRunId?: string,
): Promise<ExecutedBackup> {
  // Ленивый импорт: клиент БД подключается на верхнем уровне модуля
  // (top-level await + проверка POSTGRES_URL), поэтому статический импорт
  // ронял бы индексацию задач при деплое, где БД недоступна.
  const {
    createBackupRun,
    updateBackupRunProgress,
    finishBackupRun,
    getBackupCredentials,
  } = await import("@psi-opora/db/queries");

  const creds = await getBackupCredentials();
  if (!creds) throw new Error("Не настроено S3-хранилище для бэкапа");

  const runId = existingRunId ?? crypto.randomUUID();
  if (!existingRunId) await createBackupRun(runId);

  try {
    const result = await runCrmBackup(
      api,
      creds,
      (done, total, currentEntity) =>
        updateBackupRunProgress(runId, {
          entitiesDone: done,
          entitiesTotal: total,
          currentEntity,
        }),
    );
    await finishBackupRun(runId, {
      status: "success",
      manifestKey: result.manifestKey,
      prefix: result.prefix,
      entities: result.entities,
      totalBytes: result.totalBytes,
      errors: result.errors,
    });
    return { runId, ...result };
  } catch (err) {
    await finishBackupRun(runId, {
      status: "error",
      error: (err as Error).message,
    });
    throw err;
  }
}
