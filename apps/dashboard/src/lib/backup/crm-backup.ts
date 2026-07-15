import { gzipSync } from "node:zlib";
import type { BitrixApi } from "@/lib/bitrix/client";
import type { BackupCredentials } from "@psi-opora/db/queries";
import { createBackupS3Client, uploadBackupObject } from "./s3-client";

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

/** Выгружает все сущности CRM Bitrix24 и загружает единым архивом в S3. */
export async function runCrmBackup(
  api: BitrixApi,
  creds: BackupCredentials,
): Promise<CrmBackupResult> {
  const target = createBackupS3Client(creds);

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

  await uploadBackupObject(target, objectKey, gzipped, "application/gzip");

  return { objectKey, sizeBytes: gzipped.byteLength, entities };
}
