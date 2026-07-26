"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
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
export default function TgPersonalConnectorPage() {
  return (
    <Suspense fallback={null}>
      <TgPersonalConnectorPageContent />
    </Suspense>
  );
}

function TgPersonalConnectorPageContent() {
  const searchParams = useSearchParams();
  const lineId = searchParams.get("line") ?? "";
  const connectorId = searchParams.get("connector") ?? "";

  return (
    <div className="p-2">
      <TgPersonalConnectorClient lineId={lineId} connectorId={connectorId} />
    </div>
  );
}
