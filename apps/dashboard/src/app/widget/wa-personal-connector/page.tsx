"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
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
export default function WaPersonalConnectorPage() {
  return (
    <Suspense fallback={null}>
      <WaPersonalConnectorPageContent />
    </Suspense>
  );
}

function WaPersonalConnectorPageContent() {
  const searchParams = useSearchParams();
  const lineId = searchParams.get("line") ?? "";

  return (
    <div className="p-2">
      <WaPersonalConnectorClient lineId={lineId} />
    </div>
  );
}
