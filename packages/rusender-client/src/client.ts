const API_BASE = "https://api.rusender.ru/api/v1";

interface RusenderErrorBody {
	message?: string;
	errorDescription?: string;
	description?: string;
}

/** Ошибка API Rusender с HTTP-статусом — по нему вызывающий решает, повторять ли запрос. */
export class RusenderApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "RusenderApiError";
	}

	/** 429 и 5xx — временные сбои, письмо можно отправить повторно. */
	get retryable(): boolean {
		return this.status === 429 || this.status >= 500;
	}
}

export interface RusenderSendResult {
	uuid: string;
}

export interface RusenderClient {
	/** Отправка письма с готовым HTML — POST /external-mails/send/{keyId}. */
	sendEmail(params: {
		email: string;
		senderName: string;
		senderEmail: string;
		subject: string;
		body: string;
		/**
		 * Ключ идемпотентности Rusender. При повторе запроса с тем же ключом
		 * письмо не уйдёт второй раз — передавайте стабильный ключ, если
		 * повторяете отправку после сетевого сбоя. По умолчанию — случайный.
		 */
		idempotencyKey?: string;
	}): Promise<RusenderSendResult>;
}

/**
 * REST-клиент Rusender API. apiKey/keyId приходят из БД (rusender_settings),
 * не из env. У Rusender нет публичного API для списков/шаблонов/кампаний —
 * только поштучная транзакционная отправка, поэтому клиент даёт лишь sendEmail.
 */
export function createRusenderClient(
	apiKey: string,
	keyId: string,
): RusenderClient {
	async function send(
		path: string,
		mail: Record<string, unknown>,
		idempotencyKey: string = crypto.randomUUID(),
	) {
		const res = await fetch(`${API_BASE}/external-mails/${path}/${keyId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				idempotencyKey,
				mail,
			}),
		});
		const json = (await res.json().catch(() => ({}))) as
			| RusenderSendResult
			| RusenderErrorBody;
		if (!res.ok || !("uuid" in json)) {
			const err = json as RusenderErrorBody;
			throw new RusenderApiError(
				`Rusender [${path}]: ${err.message ?? err.errorDescription ?? err.description ?? `HTTP ${res.status}`}`,
				res.status,
			);
		}
		return json;
	}

	return {
		sendEmail({
			email,
			senderName,
			senderEmail,
			subject,
			body,
			idempotencyKey,
		}) {
			return send(
				"send",
				{
					to: { email },
					from: { email: senderEmail, name: senderName || undefined },
					subject,
					html: body,
				},
				idempotencyKey,
			);
		},
	};
}
