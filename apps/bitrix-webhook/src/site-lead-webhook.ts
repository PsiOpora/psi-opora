import { timingSafeEqual } from "node:crypto";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { z } from "zod";

/**
 * Приём заявок с формы «Записаться на консультацию» на психологический
 * центр «Опора» psi-opora.ru (WordPress + Elementor Pro, форма шлёт письмо
 * на почту через штатное действие Elementor — CRM отдельно не видит эти
 * заявки). Elementor Pro не имеет встроенной интеграции с Bitrix24: действие
 * "Webhook" в настройках формы указывает на серверный WordPress relay, а этот
 * обработчик создаёт лид через уже установленное OAuth-приложение дашборда
 * (BITRIX_MEMBER_ID).
 *
 * Elementor Pro не позволяет добавить кастомные заголовки к вебхуку, поэтому
 * серверный WordPress relay добавляет `Authorization: Bearer <секрет>` перед
 * отправкой запроса на этот эндпоинт.
 */

const NAME_ALIASES = ["name", "имя", "fullname", "full_name", "фио"];
const PHONE_ALIASES = ["phone", "tel", "телефон", "phonenumber"];
const EMAIL_ALIASES = ["email", "e-mail", "почта", "mail"];

const elementorFieldSchema = z.union([
	z.string(),
	z.number(),
	z.object({ value: z.string() }),
]);
const elementorFieldsSchema = z.record(z.string(), elementorFieldSchema);
const elementorWebhookSchema = z
	.object({
		fields: elementorFieldsSchema.optional(),
		form_fields: elementorFieldsSchema.optional(),
	})
	.catchall(elementorFieldSchema);

function normalizeKey(key: string): string {
	return key.toLowerCase().replace(/[^a-zа-яё]/g, "");
}

/** Сплющивает тело запроса Elementor в плоскую карту "ключ → строка": сам
 * Elementor Pro в разных версиях кладёт поля то на верхний уровень, то во
 * вложенный объект (`fields`/`form_fields`), то как `{ value: ... }`. */
function flattenFields(body: unknown, out: Record<string, string> = {}) {
	if (!body || typeof body !== "object") return out;
	for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
		if (raw && typeof raw === "object") {
			const nested = raw as Record<string, unknown>;
			if (typeof nested.value === "string") {
				out[key] = nested.value;
			} else if (key === "fields" || key === "form_fields") {
				flattenFields(raw, out);
			}
			continue;
		}
		if (typeof raw === "string" || typeof raw === "number") {
			out[key] = String(raw);
		}
	}
	return out;
}

/** Возвращает найденный ключ поля и его значение — ключ нужен, чтобы то же
 * поле повторно не подобралось под паттерн другого поля (см. usedKeys ниже). */
function findField(
	flat: Record<string, string>,
	aliases: string[],
): [key: string, value: string] | null {
	for (const [key, value] of Object.entries(flat)) {
		if (aliases.includes(normalizeKey(key)) && value.trim())
			return [key, value.trim()];
	}
	return null;
}

const PHONE_PATTERN = /^[+\d][\d\s\-().]{6,19}\d$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Elementor не переименовывает ID полей по умолчанию (`field_6f27b23`), так
 * что искать телефон/email по имени ключа не всегда получится — вдобавок
 * ищем по виду самого значения среди ещё не распознанных полей. */
function findByPattern(
	flat: Record<string, string>,
	pattern: RegExp,
	excluded: Set<string>,
): [key: string, value: string] | null {
	for (const [key, value] of Object.entries(flat)) {
		const trimmed = value.trim();
		if (!excluded.has(key) && pattern.test(trimmed)) return [key, trimmed];
	}
	return null;
}

function isAuthorized(request: Request): boolean {
	const secret = env.SITE_LEAD_WEBHOOK_SECRET;
	if (!secret) return false;
	const authorization = request.headers.get("authorization") ?? "";
	const token = /^Bearer[ \t]+(.+)$/i.exec(authorization)?.[1] ?? "";
	const expected = Buffer.from(secret, "utf8");
	const actual = Buffer.from(token, "utf8");
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function parseBody(
	request: Request,
): Promise<Record<string, unknown> | null> {
	const contentType = request.headers.get("content-type") ?? "";
	let rawBody: unknown;
	if (contentType.includes("application/json")) {
		try {
			rawBody = await request.json();
		} catch {
			return null;
		}
	} else {
		const raw = await request.text();
		rawBody = Object.fromEntries(new URLSearchParams(raw));
	}
	const parsed = elementorWebhookSchema.safeParse(rawBody);
	return parsed.success ? parsed.data : null;
}

export async function handleSiteLeadWebhook(
	request: Request,
): Promise<Response> {
	if (!env.SITE_LEAD_WEBHOOK_SECRET) {
		console.error(
			"[site-lead-webhook] SITE_LEAD_WEBHOOK_SECRET не задан — запрос отклонён",
		);
		return new Response("Not configured", { status: 500 });
	}
	if (!isAuthorized(request)) {
		console.warn("[site-lead-webhook] неверный или отсутствующий токен");
		return new Response("Unauthorized", { status: 401 });
	}

	const body = await parseBody(request);
	if (!body) {
		console.warn("[site-lead-webhook] некорректное тело запроса");
		return new Response("Bad Request", { status: 400 });
	}
	const flat = flattenFields(body);
	const usedKeys = new Set<string>();
	const nameMatch = findField(flat, NAME_ALIASES);
	if (nameMatch) usedKeys.add(nameMatch[0]);
	const name = nameMatch?.[1] ?? "";

	// Elementor не всегда переименовывает ID полей формы в понятные "phone"/
	// "email" — если по имени поля не нашли, ищем по виду значения среди
	// оставшихся полей (см. findByPattern).
	const phoneMatch =
		findField(flat, PHONE_ALIASES) ??
		findByPattern(flat, PHONE_PATTERN, usedKeys);
	if (phoneMatch) usedKeys.add(phoneMatch[0]);
	const emailMatch =
		findField(flat, EMAIL_ALIASES) ??
		findByPattern(flat, EMAIL_PATTERN, usedKeys);
	if (emailMatch) usedKeys.add(emailMatch[0]);

	const phone = phoneMatch?.[1] ?? "";
	const email = emailMatch?.[1] ?? "";

	if (!phone && !email) {
		console.warn("[site-lead-webhook] в заявке нет ни телефона, ни email");
		return new Response("Bad Request", { status: 400 });
	}

	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api) {
		console.error("[site-lead-webhook] Bitrix24 не подключён (нет OAuth)");
		return new Response("Bitrix24 not connected", { status: 500 });
	}

	const pageUrl =
		typeof body.page_url === "string"
			? body.page_url
			: (request.headers.get("referer") ?? "psi-opora.ru");

	try {
		const leadId = await api.call<number>("crm.lead.add", {
			fields: {
				TITLE: "Заявка с сайта — запись на консультацию",
				NAME: name || "Без имени",
				...(phone ? { PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }] } : {}),
				...(email ? { EMAIL: [{ VALUE: email, VALUE_TYPE: "WORK" }] } : {}),
				SOURCE_ID: "WEB",
				SOURCE_DESCRIPTION: pageUrl,
				COMMENTS: `Форма «Записаться на консультацию» на psi-opora.ru.\n\nДанные формы:\n${JSON.stringify(body, null, 2)}`,
			},
		});
		console.log(`[site-lead-webhook] leadId=${leadId} status=created`);
		return Response.json({ ok: true, leadId });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[site-lead-webhook] не удалось создать лид: ${message}`);
		return new Response("Internal Server Error", { status: 500 });
	}
}
