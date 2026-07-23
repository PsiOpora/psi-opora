/**
 * ID коннекторов официальных ботов (совпадают с тем, что регистрирует
 * кнопка в дашборде через b24.callMethod — apps/dashboard/.../bot-connector-card.tsx).
 * Раньше это был настраиваемый через env дефолт (`psiopora_${messenger}_bot`
 * в packages/bot-core/src/utils/bitrix/openline.ts) — теперь коннектор один на
 * мессенджер, настраивать нечего, фиксируем константой.
 */
export const CONNECTOR_IDS = {
  telegram: "psiopora_tg_bot",
  max: "psiopora_max_bot",
} as const;

export function connectorId(messenger: "telegram" | "max"): string {
  return CONNECTOR_IDS[messenger];
}
