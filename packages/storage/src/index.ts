import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getBackupCredentials } from "@psi-opora/db/queries";

/**
 * Настройки подключения к S3. Совпадает по полям с backup_credentials из БД,
 * чтобы пакет jobs мог передавать их напрямую (без повторного запроса в БД).
 */
export interface S3Credentials {
	s3Endpoint: string | null;
	s3Region: string | null;
	s3Bucket: string | null;
	s3AccessKeyId: string | null;
	s3SecretAccessKey: string | null;
}

function buildClient(creds: S3Credentials): {
	client: S3Client;
	bucket: string;
} {
	if (
		!creds.s3Endpoint ||
		!creds.s3Bucket ||
		!creds.s3AccessKeyId ||
		!creds.s3SecretAccessKey
	) {
		throw new Error(
			"S3-хранилище не настроено — заполните раздел «Бэкап CRM» в настройках",
		);
	}

	// MinIO (локальная разработка) не резолвит поддомены вида bucket.host,
	// поэтому для локальных эндпоинтов используем path-style обращение к бакету.
	const isLocalEndpoint = /localhost|127\.0\.0\.1|minio/i.test(
		creds.s3Endpoint,
	);

	const client = new S3Client({
		endpoint: creds.s3Endpoint,
		region: creds.s3Region ?? "ru-central1",
		credentials: {
			accessKeyId: creds.s3AccessKeyId,
			secretAccessKey: creds.s3SecretAccessKey,
		},
		forcePathStyle: isLocalEndpoint,
	});

	return { client, bucket: creds.s3Bucket };
}

/**
 * Создаёт S3-клиент по явно переданным кредам (используется в jobs/backup,
 * где кредentials уже загружены из БД в рамках задачи).
 */
export function createS3ClientFromCredentials(creds: S3Credentials): {
	client: S3Client;
	bucket: string;
} {
	return buildClient(creds);
}

/**
 * Создаёт S3-клиент, загружая кредентиалы из БД (backup_credentials).
 * Используется в apps и packages, где нет заранее загруженных кредов.
 */
export async function createS3Client(): Promise<{
	client: S3Client;
	bucket: string;
}> {
	const creds = await getBackupCredentials();
	if (!creds) {
		throw new Error(
			"S3-хранилище не настроено — заполните раздел «Бэкап CRM» в настройках",
		);
	}
	return buildClient(creds);
}

/** Загружает объект в S3. */
export async function uploadObject(params: {
	client: S3Client;
	bucket: string;
	key: string;
	body: Uint8Array | Buffer | string;
	contentType: string;
	contentEncoding?: string;
	contentDisposition?: string;
}): Promise<void> {
	await params.client.send(
		new PutObjectCommand({
			Bucket: params.bucket,
			Key: params.key,
			Body: params.body,
			ContentType: params.contentType,
			ContentEncoding: params.contentEncoding,
			ContentDisposition: params.contentDisposition,
		}),
	);
}

/** Возвращает ReadableStream объекта из S3. */
export async function getObjectStream(params: {
	client: S3Client;
	bucket: string;
	key: string;
}): Promise<{
	stream: ReadableStream;
	contentLength?: number;
	contentType?: string;
}> {
	const result = await params.client.send(
		new GetObjectCommand({ Bucket: params.bucket, Key: params.key }),
	);
	if (!result.Body) throw new Error("Пустой ответ S3");
	return {
		stream: result.Body.transformToWebStream(),
		contentLength: result.ContentLength,
		contentType: result.ContentType,
	};
}

/** Удаляет объект из S3; ошибки не пробрасывает. */
export async function deleteObject(params: {
	client: S3Client;
	bucket: string;
	key: string;
}): Promise<void> {
	try {
		await params.client.send(
			new DeleteObjectCommand({ Bucket: params.bucket, Key: params.key }),
		);
	} catch (err) {
		console.error(
			`[storage] не удалось удалить объект ${params.key}: ${(err as Error).message}`,
		);
	}
}
