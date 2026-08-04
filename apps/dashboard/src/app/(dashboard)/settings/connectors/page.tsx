import { BotConnectorCard } from "./bot-connector-card";
import { CrmWidgetsCard } from "./crm-widgets-card";
import { TgPersonalConnectorCard } from "./tg-personal-connector-card";
import { MaxPersonalConnectorCard } from "./max-personal-connector-card";
import { WaPersonalConnectorCard } from "./wa-personal-connector-card";

export default function BotConnectorsPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Каналы ботов</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Регистрация коннекторов Открытых линий и вкладки «Мессенджер» в CRM.
          Привязка конкретной линии происходит нативно в Контакт-центре Bitrix24
          — здесь только регистрация канала и статус подключения.
        </p>
      </div>

      <CrmWidgetsCard />

      <BotConnectorCard messenger="telegram" label="Telegram" />
      <BotConnectorCard messenger="max" label="MAX" />

      <TgPersonalConnectorCard />

      <MaxPersonalConnectorCard />

      <WaPersonalConnectorCard />
    </div>
  );
}
