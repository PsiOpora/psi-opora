import { S3Client } from "@aws-sdk/client-s3";
import { getBackupCredentials } from "@psi-opora/db/queries";

/**
 * Общий S3-клиент для файловых хранилищ дашборда (гайды, аватары) — те же
 * креды, что и бэкап CRM (/settings/backup), отдельная настройка не нужна.
 */
export async function createS3(): Promise<{ client: S3Client; bucket: string }> {
  const creds = await getBackupCredentials();
  if (
    !creds?.s3Endpoint ||
    !creds.s3Bucket ||
    !creds.s3AccessKeyId ||
    !creds.s3SecretAccessKey
  ) {
    throw new Error(
      "S3-хранилище не настроено — заполните раздел «Бэкап CRM» в настройках",
    );
  }

  // MinIO (локальная разработка) не резолвит поддомены вида bucket.host,
  // поэтому для локальных эндпоинтов используем path-style обращение к бакету
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
