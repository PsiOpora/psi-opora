# tg-vercel-proxy

Reverse-прокси к `api.telegram.org` на Vercel Edge Function (Hono) — на
время переезда с РФ-хостинга, пока прямые запросы к Bot API Telegram с k3s
ненадёжны. Токен бота находится в полном URL запроса и проходит через
Vercel Edge Function; прокси не извлекает и не сохраняет его отдельно,
но Vercel является границей доверия.

Пропускает только пути реального Bot API: `/bot<token>/<method>` и
`/file/bot<token>/<path>` — всё остальное отдаёт 404, чтобы публичный
Vercel-URL не превратился в открытый прокси на произвольные адреса.

Сама функция лежит в `api/[...path].ts` (маршрут Vercel — `/api/*`);
`vercel.json` переписывает любой путь верхнего уровня в `/api/...`, поэтому
клиенту (`TG_API_PROXY_URL`) не нужно самому дописывать `/api`.

Помимо исходящих вызовов Bot API, прокси транслирует и входящие вебхуки:
`POST /webhook` (он же `/api/webhook`) пересылается на реальный apps/tg-bot
в k3s (`https://psi-opora-tg.orixon.ru/api/webhook` по умолчанию,
переопределяется `TG_BOT_ORIGIN_URL`) — Telegram шлёт обновления на этот
Vercel-адрес вместо k3s напрямую, на время переезда с РФ-хостинга.

## Деплой

1. В Vercel: New Project → этот репозиторий → **Root Directory**:
   `apps/tg-vercel-proxy`. Framework Preset — "Other", build/install команды
   не нужны (обычный serverless-проект без сборки).
2. Задайте переменную окружения `PROXY_SECRET` в настройках Vercel-проекта —
   случайная строка (`openssl rand -base64 32`). Без неё прокси примет запрос
   от кого угодно, кто узнает URL. Проверяется только для исходящих вызовов
   Bot API (`/bot<token>/...`), не для входящего `/webhook`.
3. Если реальный tg-bot переедет на другой адрес — задайте `TG_BOT_ORIGIN_URL`
   (по умолчанию `https://psi-opora-tg.orixon.ru`).
4. После деплоя получите домен вида `https://tg-vercel-proxy.vercel.app`.

## Включение в tg-bot

### Исходящие запросы к Bot API

В `.env` (или secret `psi-opora-env` в k3s — см. [k3s/README.md](../../k3s/README.md)):

```bash
TG_API_PROXY_ENABLED=true
TG_API_PROXY_URL=https://tg-vercel-proxy.vercel.app
TG_API_PROXY_SECRET=<то же значение, что PROXY_SECRET на Vercel>
```

Выключается обратно — `TG_API_PROXY_ENABLED=false` (или удалить переменную),
без передеплоя кода бота. Логика подстановки — в
`packages/bot-core/src/utils/telegram-proxy.ts`.

### Входящие вебхуки

Задайте `TG_WEBHOOK_URL=https://tg-vercel-proxy.vercel.app/api/webhook` и
перерегистрируйте вебхук (`bun run --cwd apps/tg-bot set-webhook`) — Telegram
начнёт слать обновления через прокси, который пересылает их на k3s. Чтобы
вернуть вебхук на прямой адрес k3s, поставьте
`TG_WEBHOOK_URL=https://psi-opora-tg.orixon.ru/api/webhook` и запустите
скрипт заново.
