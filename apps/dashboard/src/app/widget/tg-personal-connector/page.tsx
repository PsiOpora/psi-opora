import { TgPersonalConnectorClient } from "./tg-personal-connector-client";

/**
 * Слайдер настроек коннектора «Telegram (личный номер)», открываемый
 * Bitrix24 из Контакт-центра при подключении канала на линии (placement
 * SETTING_CONNECTOR через /api/bitrix/tg-personal-widget).
 */
export default async function TgPersonalConnectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const lineId = typeof params.line === "string" ? params.line : "";

  return (
    <div className="p-4">
      <TgPersonalConnectorClient lineId={lineId} />
    </div>
  );
}
