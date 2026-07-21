import { TgPersonalConnectorClient } from "./tg-personal-connector-client";

/**
 * Слайдер настроек коннектора «Telegram (личный номер)», открываемый
 * Bitrix24 из Контакт-центра при подключении канала на линии (placement
 * SETTING_CONNECTOR через /api/bitrix/tg-personal-widget).
 *
 * Bitrix24 даёт этому окну фиксированную небольшую высоту (~204px) — макет
 * здесь намеренно плотный (см. tg-personal-connector-client.tsx), поэтому
 * внешние отступы минимальны.
 */
export default async function TgPersonalConnectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const lineId = typeof params.line === "string" ? params.line : "";

  return (
    <div className="p-2">
      <TgPersonalConnectorClient lineId={lineId} />
    </div>
  );
}
