import { MessageWidget } from "./widget-client";

/**
 * Вкладка «Мессенджер» в карточке сделки/контакта Битрикс24.
 * Открывается внутри iframe портала; entity и id приходят из
 * /api/bitrix/widget (обработчик placement), авторизация — через
 * BitrixFrameProvider в корневом layout.
 */
export default async function MessageWidgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const entity = params.entity === "contact" ? "contact" : "deal";
  const id = typeof params.id === "string" ? params.id : "";

  return (
    <div className="p-4">
      <MessageWidget entity={entity} entityId={id} />
    </div>
  );
}
