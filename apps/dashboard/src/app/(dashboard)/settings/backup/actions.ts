"use server";

import { revalidatePath } from "next/cache";
import { orpc } from "@/lib/orpc-client";
import { runCrmBackup } from "@/lib/backup/crm-backup";
import { getBitrixApi } from "@/lib/bitrix/session";
import {
  createBackupRun,
  finishBackupRun,
  getBackupCredentials,
} from "@psi-opora/db/queries";

export async function saveBackupCredentialsAction(
  formData: FormData,
): Promise<void> {
  const s3Endpoint = String(formData.get("s3Endpoint") ?? "").trim() || undefined;
  const s3Region = String(formData.get("s3Region") ?? "").trim() || undefined;
  const s3Bucket = String(formData.get("s3Bucket") ?? "").trim() || undefined;
  const s3AccessKeyId =
    String(formData.get("s3AccessKeyId") ?? "").trim() || undefined;
  const s3SecretAccessKey =
    String(formData.get("s3SecretAccessKey") ?? "").trim() || undefined;

  await orpc.backup.upsertCredentials({
    s3Endpoint,
    s3Region,
    s3Bucket,
    s3AccessKeyId,
    s3SecretAccessKey,
  });

  revalidatePath("/settings/backup");
}

export async function runBackupNowAction(): Promise<void> {
  const [api, creds] = await Promise.all([
    getBitrixApi(),
    getBackupCredentials(),
  ]);

  if (!api) throw new Error("Bitrix24 не подключён");
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
  } catch (err) {
    await finishBackupRun(runId, {
      status: "error",
      error: (err as Error).message,
    });
  }

  revalidatePath("/settings/backup");
}
