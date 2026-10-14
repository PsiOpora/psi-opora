import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { SerializedEmailEvent } from "@psi-opora/jobs";
import { z } from "zod";

/**
 * Вебхуки статусов писем email-рассылок (доставлено/открыто/клик/bounce/
 * жалоба/отписка) от Rusender и Unisender. Обработчик только проверяет
 * подлинность и разбирает события, а применяет их Hatchet-задача
 * email-events-ingest — ответ провайдеру должен быть быстрым (Unisender
 * считает сбоем всё дольше 3 секунд), а события не должны теряться.
 */

type EmailEventType = SerializedEmailEvent["type"];

/** Внешние зависимости обработчиков — подставляются в server.ts, в тестах фейки. */
export interface EmailEventsWebhookDeps {
	getRusenderWebhookSecret(): Promise<string | null | undefined>;
	getUnisenderApiKey(): Promise<string | null | undefined>;
	enqueue(events: SerializedEmailEvent[]): Promise<unknown>;
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeEmail(email: string | undefined): string | null {
	const value = email?.trim().toLowerCase();
	return value || null;
}

// ── Rusender ────────────────────────────────────────────────────────────

const rusenderWebhookSchema = z.object({
	events: z.array(
		z.object({
			eventId: z.string().min(1),
			trigger: z.string(),
			occurredAt: z.string(),
			payload: z
				.object({
					taskId: z.string().optional(),
					email: z.string().optional(),
					smtpServerResponse: z.string().nullish(),
				})
				.passthrough()
				.nullish(),
		}),
	),
});

/** События писем, отправленных через API (external_mail.*). */
const RUSENDER_TRIGGERS: Record<string, EmailEventType> = {
	"external_mail.delivered": "delivered",
	"external_mail.open": "opened",
	"external_mail.click": "clicked",
	"external_mail.hard_bounced": "bounced",
	"external_mail.soft_bounced": "soft_bounced",
	"external_mail.complaint": "complained",
	"external_mail.unsubscribe": "unsubscribed",
	"external_mail.error": "failed",
};

export function parseRusenderEvents(body: unknown): SerializedEmailEvent[] {
	const parsed = rusenderWebhookSchema.safeParse(body);
	if (!parsed.success) return [];
	const events: SerializedEmailEvent[] = [];
	for (const event of parsed.data.events) {
		const type = RUSENDER_TRIGGERS[event.trigger];
		const taskId = event.payload?.taskId;
		const occurredAt = new Date(event.occurredAt);
		if (!type || !taskId || Number.isNaN(occurredAt.getTime())) continue;
		events.push({
			provider: "rusender",
			externalId: event.eventId,
			type,
			occurredAt: occurredAt.toISOString(),
			email: normalizeEmail(event.payload?.email),
			details: event.payload?.smtpServerResponse ?? null,
			match: { providerMessageId: taskId },
		});
	}
	return events;
}

async function handleRusender(
	deps: EmailEventsWebhookDeps,
	request: Request,
	secret: string,
): Promise<Response> {
	const expected = await deps.getRusenderWebhookSecret().catch(() => null);
	// У вебхуков Rusender нет подписи — подлинность подтверждает только
	// секрет в пути, сгенерированный в /settings/email.
	if (!expected || !safeEqual(secret, expected)) {
		return new Response("Forbidden", { status: 403 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response("Bad Request", { status: 400 });
	}
	const events = parseRusenderEvents(body);
	if (events.length === 0) return new Response("OK"); // тестовое событие и т.п.

	try {
		await deps.enqueue(events);
	} catch (err) {
		console.error(
			`[email-events] не удалось поставить события Rusender в очередь: ${(err as Error).message}`,
		);
		// 5xx — Rusender повторит доставку позже.
		return new Response("Queue unavailable", { status: 503 });
	}
	return new Response("OK");
}

// ── Unisender ───────────────────────────────────────────────────────────

const unisenderEventSchema = z.object({
	event_name: z.string(),
	event_time: z.string(),
	event_data: z
		.object({
			email: z.string().optional(),
			campaign_id: z.union([z.string(), z.number()]).optional(),
			status: z.string().optional(),
		})
		.passthrough(),
});

const unisenderWebhookSchema = z.object({
	auth: z.string(),
	events_by_user: z.array(
		z
			.object({
				// В примерах документации встречаются оба написания.
				events: z.array(unisenderEventSchema).optional(),
				Events: z.array(unisenderEventSchema).optional(),
			})
			.passthrough(),
	),
});

/** Статусы, после которых адрес считается несуществующим (hard bounce). */
const UNISENDER_HARD_BOUNCE = new Set([
	"err_user_unknown",
	"err_user_inactive",
	"err_mailbox_discarded",
	"err_domain_inactive",
	"err_no_dns",
	"err_destination_misconfigured",
	"err_dest_invalid",
]);

export function mapUnisenderStatus(status: string): EmailEventType | null {
	switch (status) {
		case "ok_sent":
			return "sent";
		case "ok_delivered":
			return "delivered";
		case "ok_read":
			return "opened";
		case "ok_link_visited":
			return "clicked";
		case "ok_unsubscribed":
			return "unsubscribed";
		case "ok_spam_folder":
			return "delivered";
		case "ok_fbl":
			return "complained";
		case "err_will_retry":
		case "err_mailbox_full":
		case "err_mailbox_busy":
			return "soft_bounced";
	}
	if (UNISENDER_HARD_BOUNCE.has(status)) return "bounced";
	if (status.startsWith("err_")) return "failed";
	return null;
}

/**
 * Подпись Unisender: MD5 тела, в котором значение auth заменено на API-ключ
 * (см. «Система уведомлений о событиях (Webhooks)» в документации).
 */
export function verifyUnisenderAuth(
	rawBody: string,
	auth: string,
	apiKey: string,
): boolean {
	if (!/^[0-9a-f]{32}$/i.test(auth)) return false;
	const expected = createHash("md5")
		.update(rawBody.replace(auth, apiKey))
		.digest("hex");
	return safeEqual(expected, auth.toLowerCase());
}

/** "YYYY-MM-DD hh:mm:ss" в UTC → Date. */
function parseUnisenderTime(value: string): Date | null {
	const date = new Date(`${value.trim().replace(" ", "T")}Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function parseUnisenderEvents(
	body: z.infer<typeof unisenderWebhookSchema>,
): SerializedEmailEvent[] {
	const events: SerializedEmailEvent[] = [];
	for (const group of body.events_by_user) {
		for (const event of [...(group.events ?? []), ...(group.Events ?? [])]) {
			const data = event.event_data;
			const email = normalizeEmail(data.email);
			const campaignId =
				data.campaign_id === undefined ? "" : String(data.campaign_id);
			const occurredAt = parseUnisenderTime(event.event_time);
			if (!email || !occurredAt) continue;

			let type: EmailEventType | null = null;
			if (event.event_name === "email_status" && data.status) {
				type = mapUnisenderStatus(data.status);
			} else if (event.event_name === "unsubscribe") {
				type = "unsubscribed";
			}
			if (!type) continue;

			// У Unisender нет ID события — строим его из содержимого, чтобы
			// повторная доставка того же уведомления не задвоила счётчики.
			const externalId = createHash("sha256")
				.update(
					[
						event.event_name,
						campaignId,
						email,
						data.status ?? "",
						event.event_time,
					].join("|"),
				)
				.digest("hex");
			events.push({
				provider: "unisender",
				externalId,
				type,
				occurredAt: occurredAt.toISOString(),
				email,
				details: data.status ?? null,
				match: { unisenderCampaignId: campaignId, email },
			});
		}
	}
	return events;
}

async function handleUnisender(
	deps: EmailEventsWebhookDeps,
	request: Request,
): Promise<Response> {
	let rawBody: string;
	try {
		const bytes = Buffer.from(await request.arrayBuffer());
		rawBody =
			request.headers.get("content-encoding") === "gzip"
				? gunzipSync(bytes).toString("utf8")
				: bytes.toString("utf8");
	} catch {
		return new Response("Bad Request", { status: 400 });
	}

	let json: unknown;
	try {
		json = JSON.parse(rawBody);
	} catch {
		return new Response("Bad Request", { status: 400 });
	}
	const parsed = unisenderWebhookSchema.safeParse(json);
	if (!parsed.success) return new Response("Bad Request", { status: 400 });

	const apiKey = await deps.getUnisenderApiKey().catch(() => null);
	if (!apiKey || !verifyUnisenderAuth(rawBody, parsed.data.auth, apiKey)) {
		return new Response("Forbidden", { status: 403 });
	}

	const events = parseUnisenderEvents(parsed.data);
	if (events.length === 0) return new Response("OK");

	try {
		await deps.enqueue(events);
	} catch (err) {
		console.error(
			`[email-events] не удалось поставить события Unisender в очередь: ${(err as Error).message}`,
		);
		return new Response("Queue unavailable", { status: 503 });
	}
	return new Response("OK");
}

export function createEmailEventsHandlers(deps: EmailEventsWebhookDeps) {
	return {
		rusender: (request: Request, secret: string) =>
			handleRusender(deps, request, secret),
		unisender: (request: Request) => handleUnisender(deps, request),
	};
}
