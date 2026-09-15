import { createHash } from "node:crypto";

/** Query-параметр с токеном просмотра в ссылке на материал. */
export const GUIDE_VIEW_PARAM = "v";
/** Откуда открыли ссылку — попадает в bot_guide_views.source. */
export const GUIDE_VIEW_SOURCE_PARAM = "vs";

/**
 * Токен персональной ссылки на материал: первые 32 символа sha256 от id
 * выдачи (`messenger:userId:campaignId`, см. bot_guide_deliveries).
 *
 * Почему хеш, а не сам id: ссылку клиент может переслать куда угодно, и
 * подставлять в неё чужой user id (накручивая просмотры или подглядывая,
 * кому что выдавали) не должно быть возможно. Обратное преобразование не
 * нужно — раздача PDF ищет выдачу, сравнивая тот же хеш в SQL
 * (recordBotGuideView в @psi-opora/db/queries). Секрет тут не используется
 * специально: токен считают процессы ботов, а проверяет дашборд — общий
 * ключ пришлось бы синхронизировать между деплоями, и при расхождении
 * метрика молча перестала бы собираться.
 */
export function guideOpenToken(
	messenger: string,
	userId: string | number,
	campaignId: string,
): string {
	return createHash("sha256")
		.update(`${messenger}:${userId}:${campaignId}`)
		.digest("hex")
		.slice(0, 32);
}

export interface GuideTrackingContext {
	messenger: string;
	userId: string | number;
	campaignId: string;
	/** chat — ссылка в сообщении бота (по умолчанию), email — в письме. */
	source?: string;
}

/**
 * Добавляет к ссылке на PDF токен просмотра, чтобы открытие материала
 * зафиксировалось в bot_guide_views. Скачивания самих сервисов (вложение в
 * письмо, файл в MAX, sendDocument в Telegram) ходят по исходному URL без
 * токена и в статистику не попадают — это осознанно.
 *
 * Битый/относительный URL возвращаем как есть: доставка материала важнее
 * трекинга.
 */
export function buildGuideTrackingUrl(
	fileUrl: string,
	ctx: GuideTrackingContext,
): string {
	try {
		const url = new URL(fileUrl);
		url.searchParams.set(
			GUIDE_VIEW_PARAM,
			guideOpenToken(ctx.messenger, ctx.userId, ctx.campaignId),
		);
		if (ctx.source && ctx.source !== "chat") {
			url.searchParams.set(GUIDE_VIEW_SOURCE_PARAM, ctx.source);
		}
		return url.toString();
	} catch {
		return fileUrl;
	}
}
