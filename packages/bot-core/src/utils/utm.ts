import { z } from "zod";
import type { BookPreorderIntent } from "../scenario/book-preorder/types";
import { SITE_CODES } from "./site-codes";

export interface UtmParams {
	source?: string;
	campaign?: string;
}

/**
 * Мессенджер отдаёт start-параметр в том виде, в каком он стоял в ссылке —
 * то есть percent-encoded, если метка или кодовое слово не латиницей.
 * Декодируем до любых сравнений: иначе `%D0%A8%D0%9A%D0%9E%D0%9B%D0%90` не
 * совпадёт с кодовым словом «ШКОЛА» в bot_guide_campaigns и переход по
 * ссылке молча уедет в обычный сценарий.
 */
export function decodeStartParam(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		return decodeURIComponent(raw);
	} catch {
		// Некорректный percent-encoding не должен ломать запуск бота:
		// сохраняем исходную метку как раньше.
		return raw;
	}
}

/**
 * ClientID Яндекс.Метрики, который сайт получает через `ym(id,'getClientID')`
 * в момент клика по кнопке «Записаться на консультацию» и приклеивает
 * суффиксом `_ymNNN...` к обычной ссылке-диплинку (SITE_CODE или
 * SCHOOL_VK) — например `search_anorexia_708811857_ym163972457524306386`.
 * Отрезаем суффикс до любого другого разбора параметра, чтобы не ломать
 * ни SITE_CODES, ни keyword_source (splitStartParam/resolveGuideCampaignStart):
 * они видят ту же строку, что и раньше, без ClientID. ClientID у Метрики —
 * число из 18-20 цифр, диапазон 10-25 сделан с запасом на будущее.
 *
 * Аналогично, суффиксом `_ycNNN...` сайт может приклеивать yclid — id клика
 * по объявлению Яндекс.Директа из параметра `?yclid=` в URL страницы. Это
 * запасной идентификатор для офлайн-конверсии (см. yandex-metrika.ts): он
 * работает, даже если ClientID не захватился (блокировщик, cookie-баннер),
 * пока клиент пришёл именно по рекламе Директа. Оба суффикса можно
 * приклеить одновременно, в любом порядке — отрезаем по одному разу каждый.
 */
const YM_CLIENT_ID_SUFFIX_RE = /_ym(\d{10,25})$/;
const YCLID_SUFFIX_RE = /_yc(.+)$/;
const yclidSchema = z.string().regex(/^\d{10,25}$/);

export interface StartParamWithClientId {
	/** Остаток параметра для SITE_CODES/splitStartParam — без суффиксов ClientID/yclid. */
	code: string | undefined;
	ymClientId?: string;
	yclid?: string;
}

export function extractYmClientId(
	startParam: string | undefined,
): StartParamWithClientId {
	if (!startParam) return { code: startParam };

	let code = startParam;
	let ymClientId: string | undefined;
	let yclid: string | undefined;

	// До двух проходов: за один проход снимаем максимум один суффикс каждого
	// вида, порядок в ссылке (ym до yc или наоборот) не имеет значения.
	for (let pass = 0; pass < 2; pass++) {
		const ymMatch = ymClientId ? null : code.match(YM_CLIENT_ID_SUFFIX_RE);
		if (ymMatch) {
			code = code.slice(0, -ymMatch[0].length);
			ymClientId = ymMatch[1];
			continue;
		}
		const ycMatch = yclid ? null : code.match(YCLID_SUFFIX_RE);
		if (ycMatch) {
			const parsedYclid = yclidSchema.safeParse(ycMatch[1]);
			if (parsedYclid.success) {
				code = code.slice(0, -ycMatch[0].length);
				yclid = parsedYclid.data;
				continue;
			}
		}
		break;
	}

	return {
		code,
		...(ymClientId ? { ymClientId } : {}),
		...(yclid ? { yclid } : {}),
	};
}

export function parseUtmParams(startParam: string | undefined): UtmParams {
	if (!startParam) return {};
	const decodedParam = decodeStartParam(startParam) ?? startParam;

	const entry = SITE_CODES[decodedParam];
	if (entry) return { source: entry.source, campaign: entry.campaign };
	// код не зарегистрирован в SITE_CODES — не теряем трафик,
	// трактуем как кампанию по старой схеме, но без источника
	return { campaign: decodedParam };
}

/**
 * Telegram допускает в start-параметре только латиницу, цифры, `_` и `-`
 * (до 64 символов) — кириллическое кодовое слово в ссылке не работает,
 * хотя тем же словом бот отвечает, если написать его текстом в чат.
 * Дашборд опирается на это, чтобы не показывать заказчику битую ссылку.
 */
const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidStartParam(code: string): boolean {
	return START_PARAM_RE.test(code);
}

/**
 * Кодовое слово кампании гайда — та же латиница/цифры/`-`, что и в
 * isValidStartParam, но без `_`: подчёркивание зарезервировано под источник
 * рекламы в ссылке (см. splitStartParam) и однозначно отделяет слово от
 * метки, только если само слово его не содержит.
 */
const CAMPAIGN_KEYWORD_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isValidCampaignKeyword(keyword: string): boolean {
	return CAMPAIGN_KEYWORD_RE.test(keyword);
}

/**
 * Ссылка «кодовое слово + источник рекламы» вида `SCHOOL_VK`,
 * `SCHOOL_INSTAGRAM` — чтобы отличать, из какой рекламы пришёл клиент,
 * не заводя для каждого источника отдельную кампанию. Делим по первому `_`:
 * при соблюдении isValidCampaignKeyword (слово без `_`) это однозначно.
 * source не валидируется списком — рекламных площадок слишком много и
 * список быстро устареет, поэтому источник — любая строка в рамках
 * isValidStartParam, которую задаёт администратор в дашборде.
 */
export function splitStartParam(raw: string): {
	keyword: string;
	source?: string;
} {
	const index = raw.indexOf("_");
	if (index === -1) return { keyword: raw };
	const keyword = raw.slice(0, index);
	const source = raw.slice(index + 1);
	if (!keyword || !source) return { keyword: raw };
	return { keyword, source };
}

export function buildStartLink(botUsername: string, code: string): string {
	return `https://t.me/${stripAt(botUsername)}?start=${code}`;
}

/**
 * Диплинк для MAX. Формат ссылки повторяет телеграмный (`?start=`), и бот
 * получает значение в `startPayload` события bot_started — см.
 * handleStart в apps/max-bot/src/bot.ts.
 */
export function buildMaxStartLink(botUsername: string, code: string): string {
	return `https://max.ru/${stripAt(botUsername)}?start=${code}`;
}

/** Заказчик почти всегда вводит username с «@» — принимаем оба варианта. */
function stripAt(botUsername: string): string {
	return botUsername.trim().replace(/^@/, "");
}

/**
 * Кодовые слова входа в сценарий предзаказа книги «Тело берёт своё»
 * (psi-opora.ru/telo-beret-svoe/) — в отличие от bot_guide_campaigns это
 * не настраиваемая через дашборд кампания, поэтому сверяем с константами, а
 * не ходим в БД. Источник рекламы — как у гайд-кампаний, через `_` (см.
 * splitStartParam), напр. `TELOPAY_VK`.
 *
 * На лендинге две кнопки, каждая ведёт на свой keyword и сразу выбирает ветку
 * сценария (см. BookPreorderIntent в scenario/book-preorder/types.ts) —
 * человек не видит повторного выбора внутри диалога:
 *   - «Оформить предзаказ» → TELOPAY  → оплата сразу (email → ссылка Prodamus)
 *   - «Забронировать»      → TELOBOOK → бесплатная бронь (оплата потом, Б1–Б6)
 * Голый TELO без интента оставлен для тестов/старых ссылок — показывает
 * обычный выбор двух кнопок внутри диалога (см. bpAboutBookQuestion).
 */
const BOOK_PREORDER_KEYWORD_INTENTS: Record<
	string,
	BookPreorderIntent | undefined
> = {
	TELO: undefined,
	TELOPAY: "pay",
	TELOBOOK: "reserve",
};

/** Тот же формат, что и isValidStartParam выше — до 64 латинских
 * букв/цифр/`_`/`-`, как реально приходит в start-параметре мессенджера. */
const startParamSchema = z.string().regex(START_PARAM_RE);

export function matchesBookPreorderStartParam(
	startParam: string | undefined,
): { source?: string; intent?: BookPreorderIntent } | null {
	if (!startParam) return null;
	const parsed = startParamSchema.safeParse(startParam);
	if (!parsed.success) return null;
	const { keyword, source } = splitStartParam(parsed.data);
	const normalized = keyword.toUpperCase();
	if (!(normalized in BOOK_PREORDER_KEYWORD_INTENTS)) return null;
	return { source, intent: BOOK_PREORDER_KEYWORD_INTENTS[normalized] };
}

export function formatUtmLog(params: UtmParams): string {
	const parts = [
		params.source && `source=${params.source}`,
		params.campaign && `campaign=${params.campaign}`,
	].filter(Boolean);
	return parts.length ? parts.join(" ") : "без метки";
}
