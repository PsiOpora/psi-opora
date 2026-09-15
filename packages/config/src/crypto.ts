import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
	const key = env.TG_USERBOT_ENCRYPTION_KEY;
	if (!key) throw new Error("TG_USERBOT_ENCRYPTION_KEY не задан");
	const buf = Buffer.from(key, "base64");
	if (buf.length !== 32) {
		throw new Error(
			"TG_USERBOT_ENCRYPTION_KEY должен быть 32 байтами в base64 (openssl rand -base64 32)",
		);
	}
	return buf;
}

/**
 * Общее шифрование для секретов, которые храним в БД (MTProto-сессия,
 * api_hash приложения Telegram, токен бота Bot API) — все эквивалентны как
 * минимум частичному доступу к аккаунту/боту. Формат: `iv.authTag.ciphertext`,
 * всё в base64.
 */
export function encryptSecret(plain: string): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, getKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(plain, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	return [iv, authTag, ciphertext]
		.map((buf) => buf.toString("base64"))
		.join(".");
}

export function decryptSecret(encrypted: string): string {
	const [ivB64, authTagB64, ciphertextB64] = encrypted.split(".");
	if (!ivB64 || !authTagB64 || !ciphertextB64) {
		throw new Error("Некорректный формат зашифрованной сессии");
	}
	const decipher = createDecipheriv(
		ALGORITHM,
		getKey(),
		Buffer.from(ivB64, "base64"),
	);
	decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
	const plain = Buffer.concat([
		decipher.update(Buffer.from(ciphertextB64, "base64")),
		decipher.final(),
	]);
	return plain.toString("utf8");
}
