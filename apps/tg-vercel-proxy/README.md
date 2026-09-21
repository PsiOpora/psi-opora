# tg-vercel-proxy

Reverse-прокси к `api.telegram.org` на Vercel (Hono, [zero-config
deployment](https://vercel.com/docs/frameworks/backend/hono)) — на время
переезда с РФ-хостинга, пока прямые запросы к Bot API Telegram с k3s
ненадёжны. Токен бота находится в полном URL запроса и проходит через
Vercel Function; прокси не извлекает и не сохраняет его отдельно, но Vercel
является границей доверия.

Точка входа — [`server.ts`](./server.ts) в корне пакета с `export default
app`: это соглашение самого Vercel для Hono-проектов, никакого `api/` или
`vercel.json` не нужно — Vercel сам превращает маршруты Hono в Vercel
Functions.

Исходящие вызовы Bot API пропускаются только по путям `/bot<token>/<method>`
и `/file/bot<token>/<path>` — всё остальное отдаёт 404, чтобы публичный
Vercel-URL не превратился в открытый прокси на произвольные адреса.

Входящие вебхуки транслируются отдельным маршрутом: `POST /webhook`
пересылается на реальный apps/tg-bot в k3s
(`https://psi-opora-tg.orixon.ru/api/webhook` по умолчанию, переопределяется
`TG_BOT_ORIGIN_URL`) — Telegram шлёт обновления на этот Vercel-адрес вместо
k3s напрямую, на время переезда с РФ-хостинга.

## Деплой

1. В Vercel: New Project → этот репозиторий → **Root Directory**:
   `apps/tg-vercel-proxy`. Framework Preset определится сам как Hono —
   build/install команды не нужны.
2. Задайте переменные окружения в настройках Vercel-проекта:
   - `PROXY_SECRET` — случайная строка (`openssl rand -base64 32`). Без неё
     прокси примет запрос от кого угодно, кто узнает URL. Проверяется для
     исходящих вызовов Bot API (`/bot<token>/...`).
   - `TG_WEBHOOK_SECRET` — случайная строка для защиты входящего `/webhook`.
     Должна совпадать с `TG_WEBHOOK_SECRET` в основном `.env` — оттуда она
     передаётся в `setWebhook` как `secret_token` (см. ниже).
3. Если реальный tg-bot переедет на другой адрес — задайте `TG_BOT_ORIGIN_URL`
   (по умолчанию `https://psi-opora-tg.orixon.ru`).
4. После деплоя получите домен вида `https://tg-vercel-proxy.vercel.app`.

## Включение в tg-bot

### Исходящие запросы к Bot API

В корневом `.env` (перечень переменных см. в [`.env.example`](../../.env.example)):

```bash
TG_API_PROXY_ENABLED=true
TG_API_PROXY_URL=https://tg-vercel-proxy.vercel.app
TG_API_PROXY_SECRET=<то же значение, что PROXY_SECRET на Vercel>
```

Выключается обратно — `TG_API_PROXY_ENABLED=false` (или удалить переменную),
без передеплоя кода бота. Логика подстановки — в
`packages/bot-core/src/utils/telegram-proxy.ts`.

### Входящие вебхуки

Задайте в `.env`:

```bash
TG_WEBHOOK_URL=https://tg-vercel-proxy.vercel.app/webhook
TG_WEBHOOK_SECRET=<то же значение, что TG_WEBHOOK_SECRET на Vercel>
```

и перерегистрируйте вебхук (`bun run --cwd apps/tg-bot set-webhook`) —
Telegram начнёт слать обновления через прокси с `secret_token`, который
пересылает их на k3s. Чтобы вернуть вебхук на прямой адрес k3s, поставьте
`TG_WEBHOOK_URL=https://psi-opora-tg.orixon.ru/api/webhook` и запустите
скрипт заново.
