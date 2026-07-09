# bitrix-webhook-api

Пакет для привязки клиентов из ботов к **Открытой линии Битрикс24**.

## Зачем нужен

Когда клиент пишет в бот (Telegram / MAX), сообщение через коннектор попадает в **Открытую линию Битрикс24**. Битрикс24 отправляет исходящий вебхук с данными чата (`chatId`, `userId`, `sessionId`). Этот пакет принимает вебхук, валидирует токен и сохраняет `chatId` в **Redis (Upstash)**.

Позже, когда бот собирает заявку (имя, телефон) и создаёт сделку в CRM, он забирает `chatId` из Redis и вызывает `imopenlines.crm.chat.user.add` — чат привязывается к созданному контакту. В итоге в карточке CRM видна вся переписка из бота.

## Поток данных

```
Клиент → Бот → Открытая линия Битрикс24
                          │
                          ▼ (исходящий webhook)
              POST /api/bitrix-webhook
                          │
                          ▼
           bitrixWebhookHandler() — валидирует токен,
           парсит payload, сохраняет chatId в Redis
                          │
                          ▼ (позже, когда бот собирает заявку)
           submitConsultationDeal() → createBitrixDeal()
           ├─ crm.contact.add
           ├─ crm.deal.add
           └─ imopenlines.crm.chat.user.add  ← привязка чата
```

## API

### `bitrixWebhookHandler()`

Фабрика, возвращает `async (req: Request) => Response`. Использует `env` из `@psi-opora/config`.

```ts
import { bitrixWebhookHandler } from "@psi-opora/bitrix-webhook-api";

const handler = bitrixWebhookHandler();

// Next.js route handler
export async function POST(request: Request) {
  return handler(request);
}
```

Требует переменные окружения:
- `BITRIX_WEBHOOK_TOKEN` — токен для валидации `application_token` в вебхуке
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — подключение к Upstash Redis

### `handleBitrixWebhook(payload, options)`

Низкоуровневая функция для обработки payload без HTTP-слоя. Полезна, если нужно встроить логику в свой сервер.

```ts
import { handleBitrixWebhook } from "@psi-opora/bitrix-webhook-api";

await handleBitrixWebhook(payload, {
  redisUrl: "...",
  redisToken: "...",
});
```

### Интерфейсы

```ts
interface BitrixWebhookPayload {
  event: string;
  auth?: { application_token?: string };
  data?: {
    CONNECTOR?: string;
    LINE?: number;
    DATA?: Array<{
      connector?: { chat_id?: number; user_id?: number };
      session?: { id?: number };
      chat?: { id?: number };
      user?: { id?: number };
    }>;
  };
}

interface BitrixChatInfo {
  chatId: number;
  operatorId: number;
  sessionId: number;
  ts: number;
}
```

## Ключ в Redis

```
b24:chat:{userId} → { chatId, operatorId, sessionId, ts }
```

Читается в `packages/bot-core/src/storage/upstash.ts` (`getBitrixChatInfo`) и сразу удаляется после чтения (одноразовый lookup).

## Зависимости

- `@psi-opora/config` — env-конфигурация
- `@upstash/redis` — серверless Redis

## Связанные пакеты

- `apps/bitrix-webhook` — Next.js приложение, деплоится отдельно и предоставляет HTTP endpoint для Битрикс24
- `packages/bot-core` — содержит `submitConsultationDeal()` и `createBitrixDeal()`, которые читают `chatId` из Redis и создают сделку с привязкой чата
