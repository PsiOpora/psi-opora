/**
 * PLACEMENT_HANDLER коннекторов Открытых линий официальных ботов
 * (см. /api/bitrix/bot-connector-widget) — Bitrix24 требует какой-то URL
 * настроек, но настраивать тут нечего: канал/линия и токен бота заданы
 * через .env и одноразовый скрипт (packages/bitrix-client/scripts/
 * setup-bitrix-connector.ts), не через интерфейс.
 */
export default function BotConnectorInfoPage() {
  return (
    <div className="p-4 text-sm text-muted-foreground">
      Канал уже настроен — управляется конфигурацией сервера, действий здесь
      не требуется.
    </div>
  );
}
