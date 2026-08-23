import { env } from "@psi-opora/config";

const TELEGRAM_API_ROOT = "https://api.telegram.org";

/**
 * Корень Bot API Telegram: прямой api.telegram.org или Vercel-прокси
 * (TG_API_PROXY_URL), если включён TG_API_PROXY_ENABLED — см.
 * apps/tg-vercel-proxy и TG_API_PROXY_* в packages/config/src/env.ts.
 * Используется и для вызовов grammy (apiRoot), и для прямых ссылок на файлы
 * (getFile), которые бот строит вручную.
 */
export function resolveTelegramApiRoot(): string {
	return env.TG_API_PROXY_ENABLED && env.TG_API_PROXY_URL
		? env.TG_API_PROXY_URL.replace(/\/$/, "")
		: TELEGRAM_API_ROOT;
}

/**
 * fetch с заголовком общего секрета прокси (TG_API_PROXY_SECRET) — без него
 * apps/tg-vercel-proxy, будучи публичным Vercel-URL, стал бы открытым релеем
 * к Telegram для любого, кто узнает адрес. При выключенном прокси или без
 * заданного секрета возвращает обычный fetch без изменений.
 */
export function createTelegramFetch(): typeof fetch {
	const secret =
		env.TG_API_PROXY_ENABLED && env.TG_API_PROXY_URL
			? env.TG_API_PROXY_SECRET
			: undefined;
	if (!secret) return fetch;
	return ((input, init) => {
		const headers = new Headers(init?.headers);
		headers.set("x-proxy-secret", secret);
		return fetch(input, { ...init, headers });
	}) as typeof fetch;
}
