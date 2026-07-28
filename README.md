# Пси-Опора — интеграция мессенджеров с Bitrix24

Монорепозиторий (Turborepo + Bun): боты Telegram и MAX, дашборд аналитики
CRM/маркетинга и интеграция всей переписки с **Открытыми линиями Bitrix24**.

## Структура репозитория

| Путь                          | Что это                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| `apps/tg-bot`                 | Официальный бот Telegram (Bot API, grammy)                              |
| `apps/max-bot`                | Официальный бот MAX (Bot API, Node.js-под в k3s)                         |
| `apps/dashboard`              | Bitrix24-приложение: аналитика, рассылки, настройки интеграций          |
| `apps/bitrix-webhook`         | Приём вебхуков от Bitrix24 (ответы оператора, обновления сделок)         |
| `apps/tg-userbot-worker`      | Always-on процесс для личных номеров Telegram (см. ниже)                |
| `packages/waha`               | REST-клиент WAHA для личных номеров WhatsApp (см. ниже)                 |
| `packages/bot-core`           | Общая логика сценария ботов, CRM-хелперы (webhook-транспорт)             |
| `packages/bitrix-client`      | OAuth-клиент Bitrix24 (`resolveBitrixApi`) для методов, требующих app context |
| `packages/tg-userbot`         | MTProto-клиент (mtcute) для личных номеров Telegram                      |
| `packages/db`                 | Drizzle-схемы и запросы PostgreSQL                                       |
| `packages/api`                | oRPC-роутеры дашборда                                                    |

## Четыре способа завести переписку в Открытую линию Bitrix24

### 1. Официальные боты (Telegram / MAX) — Bot API

Бот отвечает только на входящие (никогда не пишет первым) и дублирует всю
переписку в одну выделенную Открытую линию, чтобы оператор видел диалог и
мог ответить прямо из Bitrix24.

Регистрация коннектора, привязка к линии и вебхук бота настраиваются
**полностью через интерфейс Bitrix24** — никаких `.env`-переменных для
line/connector ID и никакого ручного запуска скриптов из терминала.

**Как это работает:**
- Карточка «Telegram/MAX — официальный бот» в дашборде (`/settings/bot`,
  `bot-connector-card.tsx`) — кнопка «Зарегистрировать канал» вызывает
  `imconnector.register` через `b24.callMethod` прямо из iframe (гарантированный
  OAuth-контекст приложения — то, что требуют методы `imconnector.*`,
  простой входящий вебхук для них не подходит, `WRONG_AUTH_TYPE`).
- Дальше — нативно в Контакт-центре: администратор добавляет канал на нужную
  линию → Bitrix открывает наш `PLACEMENT_HANDLER`
  (`/api/bitrix/bot-connector-widget/{messenger}` → `/widget/bot-connector`) —
  окно без полей ввода, которое само:
  1. активирует линию (`imconnector.activate`, oRPC `botConnector.activate`,
     `packages/api/src/routers/bot-connector`);
  2. сохраняет `connectorId`/`openLineId` в Postgres (`bot_connectors`,
     `packages/db`) — раньше это было в `.env`;
  3. **автоматически настраивает вебхук бота** (`setMessengerWebhook`,
     `packages/jobs/src/messenger.ts`) на `TG_WEBHOOK_URL`/`MAX_WEBHOOK_URL` —
     значение используется как есть, путь `/api/webhook` должен уже быть
     частью самой переменной (см. `.env.example`); заменяет ручной запуск
     `set-webhook.ts`.
- На горячем пути (`sendMessageToOpenLine`, `packages/bot-core/src/utils/bitrix/openline.ts`)
  бот читает `connectorId`/`openLineId` из той же таблицы `bot_connectors`
  (через `@psi-opora/db/queries`, драйвер `node-postgres`), а OAuth-клиент
  для самого вызова `imconnector.send.messages` резолвится при старте бота:
  `apps/tg-bot/src/server.ts` и `apps/max-bot/src/server.ts` вызывают
  `resolveBitrixApi(env.BITRIX_MEMBER_ID)`
  (`packages/bitrix-client`) и передают его в `createBot`/`createMaxBot` как `bitrixApi`.
- Ответ оператора приходит в `apps/bitrix-webhook` вебхуком
  (событие `ONIMCONNECTORMESSAGEADD`) и пересылается обратно клиенту через
  Bot API (`sendMessengerMessage`, `packages/jobs`).

**Настройка:**
1. Установите приложение дашборда (`apps/dashboard`) на портал Bitrix24 —
   `DASHBOARD_BITRIX_CLIENT_ID`/`DASHBOARD_BITRIX_CLIENT_SECRET`.
2. Откройте дашборд внутри портала — рядом с карточкой «Вкладка Мессенджер»
   (`/settings/bot`) появится `memberId` портала. Впишите его в
   `BITRIX_MEMBER_ID` в `.env`.
3. Задайте `TG_WEBHOOK_URL`/`MAX_WEBHOOK_URL` **с путём `/api/webhook`**
   (например `https://your-tg-app.vercel.app/api/webhook`) — код использует
   значение как есть и путь сам не достраивает; сами токены ботов в `.env`
   не задаются.
4. Задайте `NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL` **с путём `/api/bitrix-webhook`**
   (например `https://your-bitrix-webhook.vercel.app/api/bitrix-webhook`) —
   адрес обработчика `apps/bitrix-webhook`, а не просто домен. Нужен, чтобы
   дашборд сам подписался на события коннектора при регистрации (см. шаг 5)
   — без него придётся настраивать шаг 6 руками. Если указать голый домен
   без пути, `event.bind` всё равно отработает успешно (Bitrix не проверяет
   URL при подписке), но реальные события будут улетать на 404 и до
   `apps/bitrix-webhook` не долетят.
5. В дашборде (`/settings/bot`) нажмите «Зарегистрировать канал» в карточке
   нужного бота — помимо `imconnector.register` дашборд сразу вызовет
   `event.bind` на `OnImConnectorMessageAdd`, `OnImConnectorStatusDelete` и
   `OnImConnectorLineDelete` (см. `apps/dashboard/src/lib/bitrix/connector-events.ts`),
   иначе ответы оператора не долетят обратно, а запись в `bot_connectors` не
   подчистится сама при отключении канала прямо в Bitrix. Если подписка не
   удалась — появится тост с ошибкой; Bitrix пришлёт события с собственным
   `application_token` приложения — возьмите его из первого лога
   `apps/bitrix-webhook` (`неверный токен: получено=...`) и допишите через
   запятую в `BITRIX_WEBHOOK_TOKEN`.
6. В Bitrix24: Контакт-центр → выбранная линия → каналы → добавить
   зарегистрированный коннектор — откроется наше окно активации; если токен
   бота ещё не сохранён в БД, окно попросит его ввести (@BotFather для
   Telegram или платформа MAX). Линия активируется и вебхук настроится
   автоматически (карточка в дашборде покажет статус).
7. Без дашборда (`NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL` не задан) — в
   настройках исходящего вебхука Bitrix24 (Разработчикам → Другое →
   Исходящий вебхук) отметьте события `OnImConnectorMessageAdd`,
   `OnImConnectorStatusDelete` и `OnImConnectorLineDelete` вручную и укажите
   URL `apps/bitrix-webhook` с путём `/api/bitrix-webhook`.

### 2. Личный номер Telegram (MTProto, `packages/tg-userbot`)

Отдельный коннектор Открытых линий: реальный номер телефона (не бот) — можно
писать клиенту первым и работать в групповых чатах. Поддерживает несколько
подключённых номеров одновременно, каждый — на своей линии.

**Как это работает:**
- `packages/tg-userbot` — обёртка над **mtcute** (MTProto-клиент, тот же
  протокол, что у Telegram Desktop/Web). Официального Bot API для этого
  недостаточно — только пользовательский протокол.
- Регистрация коннектора (`imconnector.register`, один раз на портал) —
  кнопка «Зарегистрировать канал» в дашборде (`/settings/bot`, карточка
  «Telegram — личный номер»), вызывается из iframe (`b24.callMethod`),
  поэтому автоматически в OAuth-контексте приложения.
- Подключение конкретного номера к конкретной линии — нативно в Bitrix24:
  Контакт-центр → добавить канал на линии → выбрать «Telegram (личный
  номер)». Bitrix откроет наш `PLACEMENT_HANDLER`
  (`/api/bitrix/tg-personal-widget` → `/widget/tg-personal-connector`) —
  узкое окно (~204px), в нём вводятся `api_id`/`api_hash` приложения
  Telegram (my.telegram.org/apps, ссылка и инструкция — во всплывающей
  подсказке `?`) и номер телефона, затем код из Telegram/SMS и, если
  включена, пароль двухфакторной аутентификации.
- Сессия MTProto и `api_hash` хранятся в Postgres зашифрованными
  (AES-256-GCM, `packages/tg-userbot/src/crypto.ts`, ключ — `TG_USERBOT_ENCRYPTION_KEY`).
  Промежуточное состояние логина (до подтверждения кода/пароля) — только в
  Redis, с TTL 10 минут.
- **`apps/tg-userbot-worker`** — единственный компонент, которому
  нужно постоянное соединение (как у настоящего Telegram-клиента), поэтому
  он не деплоится как serverless-функция, а работает как отдельный
  always-on процесс: при старте (и каждые 60 сек. после — чтобы подхватывать
  вновь подключённые номера без перезапуска) поднимает MTProto-клиент для
  каждого подключённого номера, пересылает входящие сообщения в Открытую
  линию через `imconnector.send.messages` и раз в 3 секунды вычитывает
  очередь исходящих (Redis, `packages/tg-userbot/src/outbox.ts`) — ответы
  оператора, положенные туда `apps/bitrix-webhook`.

**Настройка:**
1. Задайте `TG_USERBOT_ENCRYPTION_KEY` (32 байта base64: `openssl rand -base64 32`)
   и, при желании, `TG_USERBOT_CONNECTOR_ID` (по умолчанию `psiopora_tg_personal`).
2. `api_id`/`api_hash` **не задаются в `.env`** — их вводит администратор
   отдельно для каждого подключаемого номера прямо в виджете (см. выше).
3. Откройте дашборд внутри портала → `/settings/bot` → нажмите
   «Зарегистрировать канал» в карточке «Telegram — личный номер».
4. В Bitrix24: Контакт-центр → Открытые линии → выбранная линия → каналы →
   добавить «Telegram (личный номер)» → пройти вход (телефон → код → пароль
   при необходимости).
5. Разверните `apps/tg-userbot-worker` — единственный компонент этой
   системы, для которого нужен свой сервер (не Vercel):
   ```bash
   docker compose up -d --build tg-userbot-worker
   ```
   Ему нужны те же переменные, что и остальным приложениям: `POSTGRES_URL`,
   `REDIS_URL`, `DASHBOARD_BITRIX_CLIENT_ID`/`SECRET`,
   `TG_USERBOT_ENCRYPTION_KEY` (все — из общего `.env`).

### 3. Личный номер WhatsApp (WAHA, `packages/waha`)

Аналог личного Telegram-номера, но постоянное соединение с WhatsApp держит
не наш процесс, а готовый self-hosted контейнер **WAHA**
(https://waha.devlike.pro, движок NOWEB = Baileys). Наш код ходит в него
обычным REST — поэтому и oRPC-роутеры дашборда, и serverless
`apps/bitrix-webhook` работают с номером синхронно, без Redis-очереди.

**Как это работает:**
- Регистрация коннектора (`imconnector.register`, один раз на портал) —
  кнопка «Зарегистрировать канал» в карточке «WhatsApp — личный номер».
- Подключение номера — нативно в Bitrix24: Контакт-центр → добавить канал
  на линии → «WhatsApp (личный номер)» → наш виджет
  (`/widget/wa-personal-connector`): телефон → pairing code, который
  вводится на самом телефоне (WhatsApp → Связанные устройства →
  Привязка по номеру телефона). Кодов из SMS и 2FA-паролей нет.
- Имя WAHA-сессии детерминировано (`waSessionName`), промежуточное
  состояние логина живёт в самой WAHA — Redis не используется. Виджет
  опрашивает `whatsappPersonal.pollStatus`, и при статусе `WORKING`
  аккаунт сохраняется в `whatsapp_personal_accounts` + `imconnector.activate`.
- Входящие: WAHA сама доставляет событие `message` вебхуком (per-session
  конфигурация, HMAC-подпись) на `apps/bitrix-webhook/api/waha-webhook`,
  который пересылает его в линию через `imconnector.send.messages`
  (`user.phone` из jid — чтобы CRM-трекер привязал существующий контакт).
- Ответ оператора: `apps/bitrix-webhook` определяет по `CONNECTOR`, что это
  WhatsApp-линия, и синхронно вызывает `POST /api/sendText` WAHA.

**Настройка:**
1. Поднимите контейнер (тот же сервер, что и `tg-userbot-worker`):
   ```bash
   docker compose up -d waha
   ```
2. Заполните в `.env`: `WAHA_URL` (публичный адрес контейнера),
   `WAHA_API_KEY`, `WAHA_WEBHOOK_URL` (адрес `apps/bitrix-webhook` +
   `/api/waha-webhook`), `WAHA_WEBHOOK_SECRET`.
3. В дашборде → «Каналы ботов» → «WhatsApp — личный номер» → «Зарегистрировать канал».
4. В Bitrix24: Контакт-центр → линия → каналы → «WhatsApp (личный номер)» →
   ввести телефон → ввести pairing code на телефоне.

⚠️ Как и у всех неофициальных интеграций WhatsApp (Baileys/whatsmeow,
Wazzup и т.п.), есть риск блокировки номера со стороны WhatsApp — не
использовать для массовых рассылок, только для диалогов с клиентами.

### 4. Отправка сообщения из карточки CRM

Вкладка «Мессенджер» в карточке сделки/контакта (`placement.bind`,
`CrmWidgetsCard`) — менеджер видит историю переписки и может написать
клиенту первым через официального бота (Telegram/MAX), если клиент уже
писал боту хотя бы раз (ограничение платформ мессенджеров: бот не может
инициировать диалог с пользователем, который никогда с ним не общался).
Канал определяется автоматически по полю «Мессенджер» контакта.

## Быстрый старт

```bash
bun install
cp .env.example .env   # заполнить по комментариям в файле
bun run dev:dashboard   # или dev:tg / dev:max — см. package.json
```

Локальная разработка дашборда вне портала Bitrix24 работает через
`DASHBOARD_BITRIX_WEBHOOK_URL` (входящий вебхук) — часть функций (регистрация
коннекторов, вкладки CRM) при этом недоступна, т.к. требует реального
OAuth-контекста приложения.

## Полезные команды

| Команда                                                        | Что делает                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `bun run dev:tg` / `dev:max` / `dev:dashboard`                 | Локальный запуск соответствующего приложения            |
| `cd packages/bot-core && bun run setup:bitrix-source -- telegram\|max` | Создаёт источник CRM для бота                     |
| `cd packages/bot-core && bun run list:bitrix-sources -- telegram\|max` | Показывает существующие источники CRM             |
| `docker compose up -d --build tg-userbot-worker`               | Запускает воркер личных номеров Telegram                |
| `docker compose up -d waha`                                    | Запускает WAHA (личные номера WhatsApp)                  |
| `bun run build`                                                | Полная сборка всех пакетов/приложений (Turborepo)        |
| `bun run typecheck`                                            | Проверка типов по всему монорепозиторию                  |

## Известные ограничения

- **Писать первым могут только личные номера (Telegram, WhatsApp)**, не
  официальные боты (Bot API принципиально не позволяет инициировать диалог)
  и не MAX — у MAX нет официального API для личных аккаунтов, только
  неофициальный реверс-инжиниринг — сознательно не реализовывали.
  Для WhatsApp отправка «первого» сообщения из карточки CRM пока не
  подключена к вкладке «Мессенджер» (только диалоги, начатые клиентом,
  и ответы оператора в линии) — при необходимости добавляется по аналогии
  с tg-personal в `packages/api/src/routers/widget-message`.
- У каждого официального бота (Telegram/MAX) — ровно один экземпляр
  (один токен), но линию для него можно переназначить в любой момент прямо
  в Контакт-центре — просто добавить канал на другой линии, без правки `.env`.
  Личный номер Telegram, наоборот, поддерживает сколько угодно одновременно
  подключённых номеров — по одному на линию.
- Предположение о формате `PLACEMENT_OPTIONS` для плейсмента настроек
  коннектора (`SETTING_CONNECTOR`) сделано по аналогии с плейсментом вкладок
  CRM — официально не задокументировано, стоит перепроверить на реальном
  портале (см. `TODO` в `apps/dashboard/src/app/api/bitrix/tg-personal-widget/route.ts`
  и `.../bot-connector-widget/[messenger]/route.ts`).
