import { normalizeTouchPayload, touchPayloadSchema } from "@psi-opora/bot-core";
import { insertAdTouch, type NewAdTouch } from "@psi-opora/db/queries";

/**
 * Публичный приёмник касаний с рекламой: сайт (вне этого репозитория) шлёт
 * сюда параметры рекламной ссылки + ClientID Метрики при заходе, а бот при
 * создании сделки по тому же ClientID достаёт всю цепочку (см.
 * packages/bot-core/src/utils/attribution). Эндпоинт открыт всему интернету,
 * поэтому: проверка Origin (для браузеров), лимит размера и частоты,
 * строгая валидация, ответ без деталей.
 */

const MAX_BODY_BYTES = 4096;
const RATE_LIMIT_PER_MINUTE = 60;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_TRACKED_IPS = 10_000;
const DEFAULT_ALLOWED_ORIGINS = "https://psi-opora.ru,https://www.psi-opora.ru";

export interface TrackTouchDeps {
	saveTouch: (touch: NewAdTouch) => Promise<unknown>;
	/** Разрешённые Origin сайтов; запросы без Origin (curl, серверные) не отсекаются. */
	allowedOrigins: string[];
	now?: () => number;
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
	return (raw ?? DEFAULT_ALLOWED_ORIGINS)
		.split(",")
		.map((origin) => origin.trim().replace(/\/+$/, ""))
		.filter(Boolean);
}

function clientIp(req: Request): string {
	const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return forwarded || req.headers.get("x-real-ip") || "unknown";
}

/** Скользящее окно в памяти процесса: грубая защита от флуда, не точная квота. */
function createRateLimiter(now: () => number) {
	const hits = new Map<string, { count: number; resetAt: number }>();
	return (key: string): boolean => {
		const time = now();
		if (hits.size > RATE_MAX_TRACKED_IPS) {
			for (const [ip, entry] of hits) {
				if (entry.resetAt <= time) hits.delete(ip);
			}
			if (hits.size > RATE_MAX_TRACKED_IPS) hits.clear();
		}
		const entry = hits.get(key);
		if (!entry || entry.resetAt <= time) {
			hits.set(key, { count: 1, resetAt: time + RATE_WINDOW_MS });
			return true;
		}
		entry.count += 1;
		return entry.count <= RATE_LIMIT_PER_MINUTE;
	};
}

export function createTrackTouchHandler(deps: TrackTouchDeps) {
	const now = deps.now ?? Date.now;
	const allow = createRateLimiter(now);

	function corsHeaders(origin: string | null): Record<string, string> {
		if (!origin || !deps.allowedOrigins.includes(origin)) return {};
		return {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Access-Control-Max-Age": "86400",
			Vary: "Origin",
		};
	}

	function respond(req: Request, status: number): Response {
		return new Response(null, {
			status,
			headers: corsHeaders(req.headers.get("origin")),
		});
	}

	return async function handleTrackTouch(req: Request): Promise<Response> {
		const origin = req.headers.get("origin");
		if (origin && !deps.allowedOrigins.includes(origin)) {
			return new Response(null, { status: 403 });
		}
		if (req.method === "OPTIONS") return respond(req, 204);
		if (!allow(clientIp(req))) return respond(req, 429);

		// Сайт шлёт sendBeacon с text/plain (без CORS-preflight), поэтому тело
		// читаем текстом и парсим сами, не полагаясь на Content-Type.
		const text = await req.text();
		if (text.length > MAX_BODY_BYTES) return respond(req, 413);

		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			return respond(req, 400);
		}
		const parsed = touchPayloadSchema.safeParse(json);
		if (!parsed.success) return respond(req, 400);

		const touch = normalizeTouchPayload(parsed.data, new Date(now()));
		if (!touch) return respond(req, 204);

		try {
			await deps.saveTouch(touch);
		} catch (err) {
			console.error(
				`[track-touch] не удалось сохранить касание: ${(err as Error).message}`,
			);
			return respond(req, 500);
		}
		return respond(req, 204);
	};
}

export const handleTrackTouch = createTrackTouchHandler({
	saveTouch: insertAdTouch,
	allowedOrigins: parseAllowedOrigins(process.env.TRACKING_ALLOWED_ORIGINS),
});
