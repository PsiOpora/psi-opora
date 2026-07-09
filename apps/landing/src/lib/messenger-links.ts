/**
 * Юзернеймы ботов и коды размещений — коды регистрируются в bot-core
 * (packages/bot-core/src/utils/site-codes.ts), чтобы Bitrix видел
 * UTM_SOURCE/UTM_CAMPAIGN для каждого CTA на лендинге.
 */
export const TG_BOT_USERNAME = "kluvand_bot";
export const MAX_BOT_LINK = "https://max.ru/id525603925717_1_bot";

export const SITE_CODE = {
  hero: "psi_opora_main",
  footer: "psi_opora_footer",
} as const;

export type SiteCodeKey = keyof typeof SITE_CODE;

/**
 * Код для start-параметра бота: если у ссылки на лендинг есть своя метка
 * (?utm_campaign=... или ?ref=...), она приоритетнее дефолтного кода блока —
 * так рекламный трафик не обезличивается дефолтным кодом секции.
 */
export function resolveStartCode(
  defaultCode: SiteCodeKey,
  searchParams: URLSearchParams,
): string {
  const override = searchParams.get("utm_campaign") ?? searchParams.get("ref");
  return override || SITE_CODE[defaultCode];
}

export function buildTelegramLink(code: string): string {
  return `https://t.me/${TG_BOT_USERNAME}?start=${encodeURIComponent(code)}`;
}

export function buildMaxLink(code: string): string {
  return `${MAX_BOT_LINK}?start=${encodeURIComponent(code)}`;
}
