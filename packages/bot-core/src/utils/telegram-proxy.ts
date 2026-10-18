import { env } from "@psi-opora/config";

const TELEGRAM_API_ROOT = "https://api.telegram.org";

/**
 * Корень Bot API Telegram. Всегда api.telegram.org: при включённом
 * TG_3PROXY_ENABLED до него ходим через 3proxy (см. createTelegramFetch), а не
 * через подмену хоста. Используется и для вызовов grammy (apiRoot), и для
 * прямых ссылок на файлы (getFile), которые бот строит вручную.
 */
export function resolveTelegramApiRoot(): string {
	return TELEGRAM_API_ROOT;
}

/**
 * fetch, направляющий запросы к Telegram через HTTP-прокси 3proxy
 * (TG_3PROXY_URL, формат http://user:pass@host:port), если включён
 * TG_3PROXY_ENABLED. Опция `proxy` — расширение fetch в Bun. При выключенном
 * прокси или без заданного URL возвращает обычный fetch без изменений.
 */
export function createTelegramFetch(): typeof fetch {
	const proxy = env.TG_3PROXY_ENABLED ? env.TG_3PROXY_URL : undefined;
	if (!proxy) return fetch;
	return ((input, init) =>
		fetch(input, {
			...init,
			proxy: { url: proxy, respectNoProxy: false },
		} as RequestInit)) as typeof fetch;
}
