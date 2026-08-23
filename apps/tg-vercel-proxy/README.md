# tg-vercel-proxy

Reverse-прокси к `api.telegram.org` на Vercel Edge Function — на время
переезда с РФ-хостинга, пока прямые запросы к Bot API Telegram с k3s
ненадёжны. Токен бота находится в полном URL запроса и проходит через
Vercel Edge Function; прокси не извлекает и не сохраняет его отдельно,
но Vercel является границей доверия.

Пропускает только пути реального Bot API: `/bot<token>/<method>` и
`/file/bot<token>/<path>` — всё остальное отдаёт 404, чтобы публичный
Vercel-URL не превратился в открытый прокси на произвольные адреса.

## Деплой

1. В Vercel: New Project → этот репозиторий → **Root Directory**:
   `apps/tg-vercel-proxy`. Framework Preset — "Other", build/install команды
   не нужны (обычный serverless-проект без сборки).
2. Задайте переменную окружения `PROXY_SECRET` в настройках Vercel-проекта —
   случайная строка (`openssl rand -base64 32`). Без неё прокси примет запрос
   от кого угодно, кто узнает URL.
3. После деплоя получите домен вида `https://tg-vercel-proxy.vercel.app`.

## Включение в tg-bot

В `.env` (или secret `psi-opora-env` в k3s — см. [k3s/README.md](../../k3s/README.md)):

```bash
TG_API_PROXY_ENABLED=true
TG_API_PROXY_URL=https://tg-vercel-proxy.vercel.app
TG_API_PROXY_SECRET=<то же значение, что PROXY_SECRET на Vercel>
```

Выключается обратно — `TG_API_PROXY_ENABLED=false` (или удалить переменную),
без передеплоя кода бота. Логика подстановки — в
`packages/bot-core/src/utils/telegram-proxy.ts`.
