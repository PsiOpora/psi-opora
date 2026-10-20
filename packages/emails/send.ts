import { createHash, createHmac } from "node:crypto";
import {
	getEmailProvider,
	getPostboxSettings,
	getResendSettings,
	getRusenderSettings,
	getSmtpBzSettings,
	getUnisenderSettings,
} from "@psi-opora/db/queries";
import { render } from "@react-email/components";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type { ReactNode } from "react";

import { env } from "./env";

const UNISENDER_API_URL =
	"https://go1.unisender.ru/ru/transactional/api/v1/email/send.json";
const RUSENDER_API_BASE = "https://api.rusender.ru/api/v1";
const SMTP_BZ_API_URL = "https://api.smtp.bz/v1/messages";
const RESEND_API_URL = "https://api.resend.com/emails";
const POSTBOX_HOST = "postbox.cloud.yandex.net";
const POSTBOX_SEND_PATH = "/v2/email/outbound-emails";
const POSTBOX_REGION = "ru-central1";
const POSTBOX_SERVICE = "ses";

export interface EmailAttachment {
	filename: string;
	content: Buffer;
}

export interface Emails {
	react: ReactNode;
	subject: string;
	to: string[];
	from?: string;
	attachments?: EmailAttachment[];
}

export type EmailHtml = {
	html: string;
	subject: string;
	to: string[];
	from?: string;
	attachments?: EmailAttachment[];
};

function parseFrom(from: string): { email: string; name?: string } {
	const match = /^(.*)<(.+)>$/.exec(from);
	if (!match?.[2]) return { email: from.trim() };
	return { email: match[2].trim(), name: match[1]?.trim() || undefined };
}

async function sendViaUnisender(params: {
	to: string[];
	from: string;
	subject: string;
	html: string;
	attachments?: EmailAttachment[];
}) {
	const settings = await getUnisenderSettings().catch(() => null);
	const apiKey = settings?.apiKey ?? env.UNISENDER_API_KEY;
	if (!apiKey) {
		console.log(
			"Unisender is not configured. You need to add a UNISENDER_API_KEY (or set it in /settings/email) for emails to work.",
		);
		return;
	}
	const { email: fromEmail, name: fromName } = parseFrom(params.from);
	const response = await fetch(UNISENDER_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			"X-API-KEY": apiKey,
		},
		body: JSON.stringify({
			message: {
				recipients: params.to.map((email) => ({ email })),
				subject: params.subject,
				from_email: fromEmail,
				from_name: fromName,
				body: { html: params.html },
				attachments: params.attachments?.map((attachment) => ({
					type: "application/octet-stream",
					name: attachment.filename,
					content: attachment.content.toString("base64"),
				})),
			},
		}),
	});
	const result = (await response.json()) as {
		status: "success" | "error";
		message?: string;
	};
	if (!response.ok || result.status === "error") {
		throw new Error(result.message ?? "Unisender request failed");
	}
}

async function sendViaRusender(params: {
	to: string[];
	from: string;
	subject: string;
	html: string;
	attachments?: EmailAttachment[];
}) {
	const settings = await getRusenderSettings().catch(() => null);
	if (!settings?.apiKey || !settings.keyId) {
		throw new Error(
			"Rusender is not configured. Add an API key and key ID in /settings/email for emails to work.",
		);
	}
	const { email: fromEmail, name: fromName } = parseFrom(params.from);
	for (const email of params.to) {
		const response = await fetch(
			`${RUSENDER_API_BASE}/external-mails/send/${settings.keyId}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${settings.apiKey}`,
				},
				body: JSON.stringify({
					idempotencyKey: crypto.randomUUID(),
					mail: {
						to: { email },
						from: { email: fromEmail, name: fromName },
						subject: params.subject,
						html: params.html,
						// У Rusender attachments — массив объектов { имяФайла: base64 },
						// по одному ключу на объект; массив [{name, content}] с
						// фиксированными ключами "name"/"content" Rusender молча
						// превращает в файл с буквальным именем "name" и пустым телом,
						// а единый объединённый объект { f1: b64, f2: b64 } API отклоняет
						// как "must be an array".
						attachments: params.attachments?.length
							? params.attachments.map((attachment) => ({
									[attachment.filename]: attachment.content.toString("base64"),
								}))
							: undefined,
					},
				}),
			},
		);
		const result = (await response.json().catch(() => ({}))) as {
			uuid?: string;
			message?: string;
		};
		if (!response.ok || !result.uuid) {
			throw new Error(result.message ?? "Rusender request failed");
		}
	}
}

async function sendViaSmtpBz(params: {
	to: string[];
	from: string;
	subject: string;
	html: string;
	attachments?: EmailAttachment[];
}) {
	const settings = await getSmtpBzSettings().catch(() => null);
	if (!settings?.apiKey) {
		throw new Error(
			"SMTP.BZ is not configured. Add an API key in /settings/email for emails to work.",
		);
	}
	const { email: fromEmail, name: fromName } = parseFrom(params.from);
	const senderEmail = settings.senderEmail ?? fromEmail;
	const senderName = settings.senderName ?? fromName;
	for (const email of params.to) {
		const response = await fetch(SMTP_BZ_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: settings.apiKey,
			},
			body: JSON.stringify({
				from: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
				to: email,
				subject: params.subject,
				html: params.html,
				attachments: params.attachments?.map((attachment) => ({
					filename: attachment.filename,
					content: attachment.content.toString("base64"),
				})),
			}),
		});
		const result = (await response.json().catch(() => ({}))) as {
			id?: string;
			message?: string;
			error?: string;
		};
		if (!response.ok) {
			throw new Error(
				result.message ?? result.error ?? "SMTP.BZ request failed",
			);
		}
	}
}

async function sendViaResend(params: {
	to: string[];
	from: string;
	subject: string;
	html: string;
	attachments?: EmailAttachment[];
}) {
	const settings = await getResendSettings().catch(() => null);
	if (!settings?.apiKey) {
		throw new Error(
			"Resend is not configured. Add an API key in /settings/email for emails to work.",
		);
	}
	const { email: fromEmail, name: fromName } = parseFrom(params.from);
	const senderEmail = settings.senderEmail ?? fromEmail;
	const senderName = settings.senderName ?? fromName;
	const response = await fetch(RESEND_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.apiKey}`,
		},
		body: JSON.stringify({
			from: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
			to: params.to,
			subject: params.subject,
			html: params.html,
			attachments: params.attachments?.map((attachment) => ({
				filename: attachment.filename,
				content: attachment.content.toString("base64"),
			})),
		}),
	});
	const result = (await response.json().catch(() => ({}))) as {
		id?: string;
		message?: string;
		name?: string;
	};
	if (!response.ok || !result.id) {
		throw new Error(result.message ?? "Resend request failed");
	}
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
	return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Подпись AWS Signature V4 для POST-запроса с JSON-телом к Postbox
 * (без query-параметров). Подписываются content-type, host и x-amz-date.
 */
function signPostboxRequest(params: {
	keyId: string;
	secret: string;
	path: string;
	body: string;
	amzDate: string;
}): string {
	const dateStamp = params.amzDate.slice(0, 8);
	const signedHeaders = "content-type;host;x-amz-date";
	const canonicalRequest = [
		"POST",
		params.path,
		"",
		`content-type:application/json\nhost:${POSTBOX_HOST}\nx-amz-date:${params.amzDate}\n`,
		signedHeaders,
		sha256Hex(params.body),
	].join("\n");
	const scope = `${dateStamp}/${POSTBOX_REGION}/${POSTBOX_SERVICE}/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		params.amzDate,
		scope,
		sha256Hex(canonicalRequest),
	].join("\n");
	let key = hmacSha256(`AWS4${params.secret}`, dateStamp);
	for (const part of [POSTBOX_REGION, POSTBOX_SERVICE, "aws4_request"]) {
		key = hmacSha256(key, part);
	}
	const signature = createHmac("sha256", key)
		.update(stringToSign, "utf8")
		.digest("hex");
	return `AWS4-HMAC-SHA256 Credential=${params.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** Имя отправителя с не-ASCII символами кодируем как RFC 2047 encoded-word. */
function formatPostboxFrom(email: string, name?: string): string {
	if (!name) return email;
	const isAscii = [...name].every((char) => char >= " " && char <= "~");
	if (isAscii) return `"${name.replace(/["\\]/g, "\\$&")}" <${email}>`;
	const encoded = Buffer.from(name, "utf8").toString("base64");
	return `=?UTF-8?B?${encoded}?= <${email}>`;
}

/** Ошибка Postbox; `retryable` — временный сбой (429/5xx), повтор допустим. */
class PostboxError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = "PostboxError";
	}
}

/**
 * Отправка одного письма через Yandex Postbox (AWS-совместимый REST API).
 * Возвращает MessageId. Используется и цепочкой фолбэка, и рассылками
 * (поштучно, с сохранением MessageId у получателя).
 */
export async function sendPostboxEmail(params: {
	to: string[];
	from: string;
	subject: string;
	html: string;
	attachments?: EmailAttachment[];
}): Promise<{ messageId: string }> {
	const settings = await getPostboxSettings().catch(() => null);
	if (!settings?.apiKey || !settings.keyId) {
		throw new Error(
			"Yandex Postbox is not configured. Add a static access key ID and secret in /settings/email for emails to work.",
		);
	}
	const { email: fromEmail, name: fromName } = parseFrom(params.from);
	const senderEmail = settings.senderEmail ?? fromEmail;
	const senderName = settings.senderName ?? fromName;
	const body = JSON.stringify({
		FromEmailAddress: formatPostboxFrom(senderEmail, senderName),
		Destination: { ToAddresses: params.to },
		Content: {
			Simple: {
				Subject: { Data: params.subject, Charset: "UTF-8" },
				Body: { Html: { Data: params.html, Charset: "UTF-8" } },
				Attachments: params.attachments?.length
					? params.attachments.map((attachment) => ({
							FileName: attachment.filename,
							RawContent: attachment.content.toString("base64"),
						}))
					: undefined,
			},
		},
	});
	const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
	const response = await fetch(`https://${POSTBOX_HOST}${POSTBOX_SEND_PATH}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			"X-Amz-Date": amzDate,
			Authorization: signPostboxRequest({
				keyId: settings.keyId,
				secret: settings.apiKey,
				path: POSTBOX_SEND_PATH,
				body,
				amzDate,
			}),
		},
		body,
	});
	const result = (await response.json().catch(() => ({}))) as {
		MessageId?: string;
		Code?: string;
		message?: string;
	};
	if (!response.ok || !result.MessageId) {
		throw new PostboxError(
			[result.Code, result.message].filter(Boolean).join(": ") ||
				`Yandex Postbox request failed (${response.status})`,
			response.status === 429 || response.status >= 500,
		);
	}
	return { messageId: result.MessageId };
}

async function sendViaPostbox(params: Parameters<typeof sendPostboxEmail>[0]) {
	await sendPostboxEmail(params);
}

/**
 * Основной провайдер выбирается в /settings/email. Если отправка через него
 * не удалась (сбой, письмо не ушло), пробуем по очереди остальные:
 * Postbox основной → Rusender, SMTP.BZ, Resend; Rusender основной → SMTP.BZ,
 * Resend, Postbox. Unisender резервных провайдеров не имеет — как отдельный
 * основной провайдер он не участвует в этой цепочке.
 */
async function sendViaProvider(params: {
	to: string[];
	from: string;
	subject: string;
	html: string;
	attachments?: EmailAttachment[];
}) {
	const provider = await getEmailProvider();
	if (provider === "unisender") return sendViaUnisender(params);

	const chain: Array<{
		name: string;
		send: (p: typeof params) => Promise<void>;
	}> = [
		{ name: "Rusender", send: sendViaRusender },
		{ name: "SMTP.BZ", send: sendViaSmtpBz },
		{ name: "Resend", send: sendViaResend },
	];
	const postbox = { name: "Yandex Postbox", send: sendViaPostbox };
	if (provider === "postbox") chain.unshift(postbox);
	else chain.push(postbox);

	const errors: string[] = [];
	for (const { name, send } of chain) {
		try {
			await send(params);
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${name}: ${message}`);
			console.warn(
				`Email send via ${name} failed, trying next provider. ${message}`,
			);
		}
	}
	throw new Error(`All email providers failed. ${errors.join(" | ")}`);
}

export const sendEmail = async (email: Emails) => {
	const html = await render(email.react);
	if (env.EMAIL_SANDBOX_ENABLED) {
		const mailOptions: Mail.Options = {
			from: email.from ?? env.EMAIL_FROM,
			to: email.to,
			html,
			subject: email.subject,
			attachments: email.attachments,
		};
		const transporter = nodemailer.createTransport({
			host: env.EMAIL_SANDBOX_HOST,
			secure: false,
			port: 2500,
		});
		return transporter.sendMail(mailOptions);
	}
	await sendViaProvider({
		to: email.to,
		from: email.from ?? env.EMAIL_FROM,
		subject: email.subject,
		html,
		attachments: email.attachments,
	});
};

export const sendEmailHtml = async (email: EmailHtml) => {
	await sendViaProvider({
		to: email.to,
		from: email.from ?? env.EMAIL_FROM,
		subject: email.subject,
		html: email.html,
		attachments: email.attachments,
	});
};
