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

Входящих вебхуков прокси больше не транслирует: apps/tg-bot сам забирает
апдейты через long polling (`getUpdates`, см. `apps/tg-bot/src/polling.ts`).

## Деплой

1. В Vercel: New Project → этот репозиторий → **Root Directory**:
   `apps/tg-vercel-proxy`. Framework Preset определится сам как Hono —
   build/install команды не нужны.
2. Задайте переменные окружения в настройках Vercel-проекта:
   - `PROXY_SECRET` — случайная строка (`openssl rand -base64 32`). Без неё
     прокси примет запрос от кого угодно, кто узнает URL. Проверяется для
     исходящих вызовов Bot API (`/bot<token>/...`).
3. После деплоя получите домен вида `https://tg-vercel-proxy.vercel.app`.

## Включение в tg-bot

Исходящие запросы к Bot API (включая `getUpdates`) ходят не через этот Vercel-прокси, а через
HTTP-прокси 3proxy. В корневом `.env` (перечень переменных см. в
[`.env.example`](../../.env.example)):

```bash
TG_3PROXY_ENABLED=true
TG_3PROXY_URL=http://user:pass@proxy.example.com:3128
```

Выключается обратно — `TG_3PROXY_ENABLED=false` (или удалить переменную),
без передеплоя кода бота. Логика — в
`packages/bot-core/src/utils/telegram-proxy.ts`.
