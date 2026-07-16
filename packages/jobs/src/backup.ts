import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { BitrixApi } from "@psi-opora/bitrix-client";

/** Настройки S3 из таблицы backup_credentials (см. @psi-opora/db). */
export interface BackupS3Credentials {
  s3Endpoint: string | null;
  s3Region: string | null;
  s3Bucket: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
}

/** Список CRM-сущностей, которые попадают в бэкап, и метод их выборки. */
const CRM_ENTITIES: Record<string, string> = {
  leads: "crm.lead.list",
  deals: "crm.deal.list",
  contacts: "crm.contact.list",
  companies: "crm.company.list",
  activities: "crm.activity.list",
};

export interface CrmBackupResult {
  objectKey: string;
  sizeBytes: number;
  entities: Record<string, number>;
}

/** Клиент S3 по настройкам хранилища (совместим с Yandex Object Storage и MinIO). */
function createS3(creds: BackupS3Credentials): { client: S3Client; bucket: string } {
  if (
    !creds.s3Endpoint ||
    !creds.s3Bucket ||
    !creds.s3AccessKeyId ||
    !creds.s3SecretAccessKey
  ) {
    throw new Error("Не заданы настройки S3-хранилища для бэкапа");
  }

  // MinIO (локальная разработка) не резолвит поддомены вида bucket.host,
  // поэтому для локальных эндпоинтов используем path-style обращение к бакету.
  const isLocalEndpoint = /localhost|127\.0\.0\.1|minio/i.test(
    creds.s3Endpoint,
  );

  const client = new S3Client({
    endpoint: creds.s3Endpoint,
    region: creds.s3Region || "ru-central1",
    credentials: {
      accessKeyId: creds.s3AccessKeyId,
      secretAccessKey: creds.s3SecretAccessKey,
    },
    forcePathStyle: isLocalEndpoint,
  });

  return { client, bucket: creds.s3Bucket };
}

/** Выгружает все сущности CRM Bitrix24 и загружает единым архивом в S3. */
export async function runCrmBackup(
  api: BitrixApi,
  creds: BackupS3Credentials,
): Promise<CrmBackupResult> {
  const { client, bucket } = createS3(creds);

  const entities: Record<string, number> = {};
  const data: Record<string, unknown[]> = {};

  for (const [name, method] of Object.entries(CRM_ENTITIES)) {
    const rows = await api.list(method);
    data[name] = rows;
    entities[name] = rows.length;
  }

  const payload = JSON.stringify({
    createdAt: new Date().toISOString(),
    entities,
    data,
  });
  const gzipped = gzipSync(Buffer.from(payload, "utf-8"));

  const now = new Date();
  const datePrefix = now.toISOString().slice(0, 10);
  const objectKey = `crm-backups/${datePrefix}/backup-${now.getTime()}.json.gz`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: gzipped,
      ContentType: "application/gzip",
    }),
  );

  return { objectKey, sizeBytes: gzipped.byteLength, entities };
}

export interface ExecutedBackup extends CrmBackupResult {
  runId: string;
}

/** Полный цикл бэкапа с записью статуса в backup_runs. */
export async function executeCrmBackup(
  api: BitrixApi,
): Promise<ExecutedBackup> {
  // Ленивый импорт: клиент БД подключается на верхнем уровне модуля
  // (top-level await + проверка POSTGRES_URL), поэтому статический импорт
  // ронял бы индексацию задач при деплое, где БД недоступна.
  const { createBackupRun, finishBackupRun, getBackupCredentials } =
    await import("@psi-opora/db/queries");

  const creds = await getBackupCredentials();
  if (!creds) throw new Error("Не настроено S3-хранилище для бэкапа");

  const runId = crypto.randomUUID();
  await createBackupRun(runId);

  try {
    const result = await runCrmBackup(api, creds);
    await finishBackupRun(runId, {
      status: "success",
      entities: result.entities,
      objectKey: result.objectKey,
      sizeBytes: result.sizeBytes,
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
