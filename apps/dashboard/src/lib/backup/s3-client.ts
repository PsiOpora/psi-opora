import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { BackupCredentials } from "@psi-opora/db/queries";

export interface S3UploadTarget {
  bucket: string;
  client: S3Client;
}

/** Клиент S3 по настройкам хранилища (совместим с Yandex Object Storage). */
export function createBackupS3Client(
  creds: BackupCredentials,
): S3UploadTarget {
  if (
    !creds.s3Endpoint ||
    !creds.s3Bucket ||
    !creds.s3AccessKeyId ||
    !creds.s3SecretAccessKey
  ) {
    throw new Error("Не заданы настройки S3-хранилища для бэкапа");
  }

  const client = new S3Client({
    endpoint: creds.s3Endpoint,
    region: creds.s3Region || "ru-central1",
    credentials: {
      accessKeyId: creds.s3AccessKeyId,
      secretAccessKey: creds.s3SecretAccessKey,
    },
    forcePathStyle: false,
  });

  return { bucket: creds.s3Bucket, client };
}

export async function uploadBackupObject(
  target: S3UploadTarget,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await target.client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
