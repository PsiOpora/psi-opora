import { WaPersonalConnectorClient } from "./wa-personal-connector-client";

/**
 * Слайдер настроек коннектора «WhatsApp (личный номер)», открываемый
 * Bitrix24 из Контакт-центра при подключении канала на линии (placement
 * SETTING_CONNECTOR через /api/bitrix/wa-personal-widget).
 *
 * Bitrix24 даёт этому окну фиксированную небольшую высоту (~204px) — макет
 * здесь намеренно плотный (см. wa-personal-connector-client.tsx), поэтому
 * внешние отступы минимальны.
 */
export default async function WaPersonalConnectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const lineId = typeof params.line === "string" ? params.line : "";

  return (
    <div className="p-2">
      <WaPersonalConnectorClient lineId={lineId} />
    </div>
  );
}
