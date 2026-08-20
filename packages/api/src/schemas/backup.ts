import { z } from "zod";

/** Схема ключей S3-совместимого хранилища для бэкапа CRM. */
export const backupCredentialsSchema = z.object({
	s3Endpoint: z.string().trim().optional(),
	s3Region: z.string().trim().optional(),
	s3Bucket: z.string().trim().optional(),
	s3AccessKeyId: z.string().trim().optional(),
	s3SecretAccessKey: z.string().trim().optional(),
});

export type BackupCredentialsInput = z.infer<typeof backupCredentialsSchema>;
