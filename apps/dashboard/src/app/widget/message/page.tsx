"use client";

import { useSearchParams } from "next/navigation";
import { MessageWidget } from "./widget-client";

/**
 * Вкладка «Мессенджер» в карточке сделки/контакта Битрикс24.
 * Открывается внутри iframe портала; entity и id приходят из
 * /api/bitrix/widget (обработчик placement), авторизация — через
 * BitrixFrameProvider в корневом layout.
 */
export default function MessageWidgetPage() {
  const searchParams = useSearchParams();
  const entity = searchParams.get("entity") === "contact" ? "contact" : "deal";
  const id = searchParams.get("id") ?? "";

  return (
    <div className="p-4">
      <MessageWidget entity={entity} entityId={id} />
    </div>
  );
}
