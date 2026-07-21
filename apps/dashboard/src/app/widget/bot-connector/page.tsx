import { BotConnectorWidgetClient } from "./bot-connector-widget-client";

/**
 * Слайдер настроек коннектора официального бота, открываемый Bitrix24 из
 * Контакт-центра при подключении канала на линии (placement SETTING_CONNECTOR
 * через /api/bitrix/bot-connector-widget/[messenger]). В отличие от личного
 * номера — вводить нечего, окно само активирует линию и настраивает вебхук.
 */
export default async function BotConnectorWidgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const messenger = params.messenger === "max" ? "max" : "telegram";
  const lineId = typeof params.line === "string" ? params.line : "";

  return (
    <div className="p-2">
      <BotConnectorWidgetClient messenger={messenger} lineId={lineId} />
    </div>
  );
}
