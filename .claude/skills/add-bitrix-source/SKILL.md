---
name: add-bitrix-source
description: Create the CRM lead/deal source (crm.status, ENTITY_ID=SOURCE) for the official Telegram or MAX bot in Bitrix24, after checking it doesn't already exist.
argument-hint: telegram | max
disable-model-invocation: true
---

# Add Bitrix24 CRM source for a bot

Target messenger: `$ARGUMENTS` (must be `telegram` or `max`; if empty or anything else, ask which one and stop).

This writes to the live Bitrix24 portal via `crm.status.add`. It creates the **CRM source** that deals from the bot are tagged with — it does not register an Open Line connector (that is done from the dashboard, see `README.md`).

## 1. Check prerequisites without printing secrets

`packages/bot-core/src/utils/bitrix/client.ts` `getEnv()` reads `TG_<KEY>` / `MAX_<KEY>` first and falls back to the unprefixed `<KEY>`. Check that these resolve in the repo-root `.env` (report set / not set only — never echo values):

- `BITRIX_WEBHOOK_URL` (or `TG_`/`MAX_` prefixed)
- `BITRIX_SOURCE_ID` (or prefixed) — required, the script throws without it
- `BITRIX_SOURCE_NAME` (optional; default `Telegram-бот` / `MAX-бот`)

If a required var is missing, stop and tell the user which one to add.

## 2. List existing sources first

```bash
cd packages/bot-core && bun run list:bitrix-sources -- $ARGUMENTS
```

If a row with the configured `BITRIX_SOURCE_ID` already exists, report it and stop — nothing to do.

## 3. Create the source

```bash
cd packages/bot-core && bun run setup:bitrix-source -- $ARGUMENTS
```

The script treats a `Duplicate` error as success.

## 4. Verify

Run the list command from step 2 again and confirm the new `STATUS_ID` / `NAME` appears. Report the result in one or two sentences.
