# bitrix-webhook-api

Пакет для приёма ответов оператора из **Открытой линии Битрикс24** и пересылки их обратно клиенту в бот.

## Зачем нужен

Когда оператор отвечает клиенту в Открытой линии, Битрикс24 отправляет исходящий вебхук с событием `ONIMCONNECTORMESSAGEADD`. Этот пакет принимает вебхук, валидирует токен, разбирает payload и отдаёт данные для пересылки ответа обратно в Telegram/MAX.

При создании сделки бот резолвит диалог Открытой линии через `imopenlines.dialog.get` по `USER_CODE` (`{connector}|{line}|{chat_id}|{user_id}` — те же значения, что бот передаёт в `imconnector.send.messages`), без промежуточного хранения в Redis — см. `resolveOpenLineDialog` в `packages/bot-core/src/utils/bitrix.ts`. Оттуда берётся настоящий внутренний `CHAT_ID` (для `imopenlines.crm.chat.user.add`) и CRM-сущности, уже созданные трекером линии по чату (`entity_data_2`): если трекер уже завёл контакт/сделку, бот обновляет их собранными данными вместо создания дублей.

## Поток данных

```
Клиент → Бот → Открытая линия Битрикс24
                          │
                          ▼ (оператор отвечает)
              POST /api/bitrix-webhook  (событие ONIMCONNECTORMESSAGEADD)
                          │
                          ▼
           bitrixWebhookHandler() — валидирует токен, парсит payload,
           вызывает onOperatorReply()
                          │
                          ▼
           sendMessengerMessage() — ответ уходит клиенту в Telegram/MAX
```

## API

### `bitrixWebhookHandler(options)`

Фабрика, возвращает `async (req: Request) => Response`. Использует `env` из `@psi-opora/config`.

```ts
import { bitrixWebhookHandler } from "@psi-opora/bitrix-webhook-api";

const handler = bitrixWebhookHandler({
  onOperatorReply: async (reply) => {
    // reply.chatId, reply.connector, reply.lineId, reply.text
  },
});

// Next.js route handler
export async function POST(request: Request) {
  return handler(request);
}
```

Требует переменную окружения `BITRIX_WEBHOOK_TOKEN` — токен для валидации `application_token` в вебхуке (можно переопределить через `token` в опциях).

### `getOperatorReplyMessage(payload)`

Низкоуровневый разбор payload без HTTP-слоя — возвращает `OperatorReplyMessage | null`.

### Интерфейсы

Bitrix шлёт события коннектора (`ONIMCONNECTORMESSAGEADD` и т.д.) как
`application/x-www-form-urlencoded` с PHP-style bracket-нотацией
(`data[MESSAGES][0][im][chat_id]=...`), а не как JSON — `bitrixWebhookHandler`
разбирает оба варианта.

```ts
interface BitrixWebhookPayload {
  event: string;
  auth?: { application_token?: string };
  data?: {
    CONNECTOR?: string;
    LINE?: number;
    MESSAGES?: Array<{
      im?: { chat_id?: number; message_id?: number };
      chat?: { id?: number | string };
      message?: { text?: string; user_id?: number };
    }>;
  };
}

interface OperatorReplyMessage {
  connector?: string;
  lineId?: number;
  chatId: number;
  text: string;
}
```

## Зависимости

- `@psi-opora/config` — env-конфигурация

## Связанные пакеты

- `apps/bitrix-webhook` — Next.js приложение, деплоится отдельно и предоставляет HTTP endpoint для Битрикс24
- `packages/bot-core` — `sendMessageToOpenLine()`/`createBitrixDeal()` (пересылка сообщений в Открытую линию и переиспользование сделки/контакта, созданных трекером линии, через `imopenlines.dialog.get`)
