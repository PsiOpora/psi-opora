# @psi-opora/dashboard

Локальное приложение Bitrix24: аналитика CRM для маркетинга — UTM-отчёты,
источники обращений, воронка и список сделок. Next.js 16 (App Router) + shadcn/ui
+ Recharts + TanStack Table.

## Стек

- Next.js (App Router, React Server Components) — сам дашборд и REST-прокси к Bitrix24
- shadcn/ui + Tailwind v4 — интерфейс (sidebar, таблицы, графики на Recharts)
- `@bitrix24/b24jssdk` — встройка приложения во фрейм портала (авторизация, `installFinish`)
- Redis (`@psi-opora/bot-core`) — хранение OAuth-токенов портала

## Как это работает

Bitrix24 открывает приложение во фрейме и передаёт токены авторизации
родительскому окну браузера (см. [упрощённый сценарий OAuth 2.0](https://apidocs.bitrix24.ru/api-reference/oauth/simple-way.html)).
`BitrixFrameProvider` ([src/components/bitrix/frame-provider.tsx](src/components/bitrix/frame-provider.tsx))
получает эти токены через `@bitrix24/b24jssdk`, сохраняет их в Redis
(`/api/bitrix/session`) и привязывает браузер к порталу через cookie
`b24_member_id`. Дальше серверные компоненты дашборда читают эту cookie и
дергают CRM REST API от имени портала, автоматически продлевая access_token
по refresh_token ([src/lib/bitrix/oauth.ts](src/lib/bitrix/oauth.ts)).

## Настройка в Bitrix24

1. В своём портале: **Приложения → Разработчикам → Другое → Локальное приложение**.
2. Укажите:
   - **Путь для первоначальной установки** и **Путь для приложения** — оба на корень задеплоенного приложения, например `https://your-dashboard.vercel.app/`.
   - Права: как минимум `crm`.
3. Bitrix24 выдаст `CLIENT_ID` и `CLIENT_SECRET` — впишите их в `.env` (см. `.env.example` в корне репозитория):
   ```
   DASHBOARD_BITRIX_CLIENT_ID=...
   DASHBOARD_BITRIX_CLIENT_SECRET=...
   ```
4. Откройте приложение из интерфейса Bitrix24 — авторизация пройдёт автоматически.

## Локальная разработка

Внутри фрейма Bitrix24 приложение не откроешь на `localhost`, поэтому для
`bun run dev:dashboard` есть запасной путь: задайте в `.env` входящий вебхук
портала (как для ботов):
```
DASHBOARD_BITRIX_WEBHOOK_URL=https://your-bitrix.bitrix24.ru/rest/1/your_token/
```
Если приложение открыто не во фрейме (`window.parent === window`), оно не
пытается пройти OAuth-хендшейк и серверные компоненты используют этот вебхук
напрямую — это позволяет смотреть реальные данные CRM без установки в портал.

## Команды

```bash
bun run dev:dashboard   # из корня монорепо
bun run build           # turbo build (из корня)
bun run typecheck       # turbo typecheck (из корня)
```
