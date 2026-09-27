---
name: bitrix-connector-check
description: Diagnose a messenger channel (official Telegram/MAX bot, personal Telegram, personal MAX, personal WhatsApp) that is not delivering messages into a Bitrix24 Open Line, or whose operator replies never reach the client. Use when the user reports "сообщения не доходят в линию", "ответ оператора не уходит", a channel stuck in a bad status, or asks to check a connector's setup.
---

# Bitrix24 connector check

Read-only diagnosis. Do not register connectors, change DB rows, or call write methods on the portal — report findings and the fix, and let the user apply it (most fixes happen in the dashboard UI or Bitrix24 Contact Center, not in code).

The per-channel architecture is in `README.md` → «Четыре способа завести переписку в Открытую линию Bitrix24». Read the section for the channel in question before concluding anything.

## 1. Identify the channel and direction

| Channel | DB table | Connector ID default | Always-on component |
|---|---|---|---|
| Official bot (TG/MAX) | `bot_connectors` (one row per `messenger`) | registered from dashboard | `apps/tg-bot` / `apps/max-bot` |
| Personal Telegram | `telegram_personal_accounts` | `TG_USERBOT_CONNECTOR_ID` or `psiopora_tg_personal` | `apps/tg-userbot-worker` |
| Personal MAX | `max_personal_accounts` | `MAX_USERBOT_CONNECTOR_ID` or `psiopora_max_personal` | `apps/max-userbot-worker` |
| Personal WhatsApp | `whatsapp_personal_accounts` | registered from dashboard | WAHA container |

Direction matters:
- **Inbound broken** (client → Open Line): connector row / line activation / worker or bot process / `imconnector.send.messages` errors.
- **Outbound broken** (operator → client): `event.bind` subscriptions, `NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL`, `BITRIX_WEBHOOK_TOKEN`, `apps/bitrix-webhook` routing by `CONNECTOR`, Redis outbox (personal TG/MAX).

## 2. Check the DB row

Query read-only through the root `pg` dependency. **Never select the encrypted columns** (`bot_token_encrypted`, `session_encrypted`, `api_hash_encrypted`) and never print `.env` values.

```bash
bun --env-file=.env -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.POSTGRES_URL });
await c.connect();
const r = await c.query('SELECT messenger, member_id, open_line_id, connector_id, webhook_configured_at, updated_at FROM bot_connectors');
console.table(r.rows);
await c.end();
"
```

For personal accounts select `id, member_id, open_line_id, connector_id, status, last_error, updated_at` from the matching table. Look for: missing row (channel never activated on a line), `status` ≠ `connected`, a non-null `last_error`, `webhook_configured_at IS NULL` (official bot webhook not set), `member_id` ≠ `BITRIX_MEMBER_ID`.

## 3. Check env shape (presence and format only)

Report whether each var is set and shaped right, without echoing secrets:
- `NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL` must end with `/api/bitrix-webhook` — a bare domain makes `event.bind` succeed but events 404.
- `TG_WEBHOOK_URL` / `MAX_WEBHOOK_URL` must include `/api/webhook`.
- `BITRIX_WEBHOOK_TOKEN` may be a comma-separated list; a missing app `application_token` shows up in `apps/bitrix-webhook` logs as `неверный токен: получено=...`.
- WhatsApp: `WAHA_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_URL` (ends with `/api/waha-webhook`), `WAHA_WEBHOOK_SECRET`.
- Personal TG/MAX: `TG_USERBOT_ENCRYPTION_KEY`, `REDIS_URL`.

## 4. Check the code path

- Event subscriptions: `apps/dashboard/src/lib/bitrix/connector-events.ts` (`OnImConnectorMessageAdd`, `OnImConnectorStatusDelete`, `OnImConnectorLineDelete`).
- Operator reply routing: `apps/bitrix-webhook/src/server.ts`, `packages/bitrix-webhook-api/src/index.ts`, `apps/bitrix-webhook/src/operator-reply-guard.ts`.
- Official bot forwarding and retries: `packages/bot-core/src/utils/bitrix/openline.ts`, `packages/bot-core/src/utils/background-tasks.ts`, Hatchet `bot-openline-retry` in `packages/jobs/src/bot-background.ts`.

When a Bitrix24 method's behavior or error code is in question (`imconnector.*`, `event.bind`, `WRONG_AUTH_TYPE`), look it up with the `bitrix24` MCP docs tools rather than guessing.

## 5. Report

Give: the channel and direction, what was checked, the most likely root cause with evidence (row values, log line, file:line), and the concrete fix — naming where the user applies it (dashboard `/settings/bot`, Contact Center, `.env`, or a code change).
