# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Пси-Опора** — a Turborepo/Bun monorepo integrating messengers (Telegram, MAX, WhatsApp) with Bitrix24 CRM. It runs official bots, personal-number userbots, a Bitrix24-embedded analytics dashboard, an operator inbox, and background job workers. Full domain documentation (in Russian) is in [README.md](README.md) — read it before making changes to the messenger↔Bitrix24 integration; it explains the four ways a conversation ends up in a Bitrix24 Open Line, the Yandex.Metrika offline-conversion flow, and known protocol limitations. This file only covers commands and cross-cutting architecture.

## Commands

Package manager is **Bun** (`bun@1.4.2`, pinned in `packageManager`). Install with `bun install`.

```bash
bun run dev:tg          # apps/tg-bot (long polling)
bun run dev:max         # apps/max-bot
bun run dev:dashboard   # apps/dashboard (Next.js, Bitrix24 iframe app)
bun run dev:clients     # apps/clients (operator inbox, Next.js)
bun run dev:landing     # apps/landing — script exists but the app directory is currently absent from the repo

bun run build            # turbo run build across all workspaces
bun run typecheck        # turbo typecheck across all workspaces
bun run lint             # biome lint . (--skip-parse-errors)
bun run lint:fix
bun run format            # biome format .
bun run format:fix

bun run migrate          # drizzle migrate, delegates to packages/db
```

Per-package, not exposed at the root:

```bash
cd packages/<pkg> && bun test                 # bun's built-in test runner (bot-core, db, max-userbot, tg-userbot, validators, waha)
cd packages/<pkg> && bun test path/to.test.ts  # single test file
cd packages/db && bun run push                # drizzle-kit push (dev schema sync)
cd packages/db && bun run generate             # drizzle-kit generate (new migration)
cd packages/db && bun run migrate              # drizzle-kit migrate
cd packages/db && bun run studio               # drizzle studio
cd packages/bot-core && bun run setup:bitrix-source -- telegram|max   # create CRM source for a bot
cd packages/bot-core && bun run list:bitrix-sources -- telegram|max
```

There is no root-level `test` script — run `bun test` inside the specific package. Turbo's `typecheck` task depends on `^build`, so building deps (e.g. `packages/db`, `packages/config`) is sometimes required before typecheck on packages that consume their generated output.

Local dev apps load env vars from the repo-root `.env` via `--env-file=../../.env` in each app's `dev` script — there is no per-app `.env`. Copy `.env.example` to `.env` and fill in per the comments there.

Docker (for the always-on / non-serverless components — see README for why these can't be serverless):

```bash
docker compose up -d --build tg-userbot-worker
docker compose up -d --build max-userbot-worker
docker compose up -d waha
```

## Architecture

### Workspace layout

- `apps/*` — deployables. Each has its own `Dockerfile` and is deployed independently (see `.github/workflows/deploy-k3s.yml`, which uses turbo's dependency graph to figure out which app images need rebuilding from a given commit).
  - `tg-bot`, `max-bot` — official Bot API bots (long polling in production; webhook handlers exist for Vercel deploys).
  - `dashboard` — Bitrix24 local app (Next.js, runs inside a Bitrix24 iframe): analytics, broadcasts, integration settings, connector registration widgets.
  - `clients` — operator inbox (Next.js): message history/reply UI outside Bitrix24 itself.
  - `bitrix-webhook` — receives Bitrix24 outgoing webhooks (operator replies, deal updates) and WAHA webhooks; serverless-friendly (no persistent connections).
  - `tg-userbot-worker`, `max-userbot-worker` — always-on processes holding persistent protocol connections (MTProto / reverse-engineered MAX protocol) for personal-number channels. Cannot be serverless functions; deployed as long-running containers.
  - `hatchet-worker` — runs the Hatchet job worker (thin wrapper calling `startHatchetWorker()` from `packages/jobs`).
  - `tg-vercel-proxy` — Hono app on Vercel, reverse-proxying `api.telegram.org` while direct calls from the RU-hosted k3s cluster are unreliable; also relays Telegram webhook traffic. See `apps/tg-vercel-proxy/README.md`.
- `packages/*` — shared libraries, workspace-referenced as `@psi-opora/*`.
  - `bot-core` — shared bot scenario engine and CRM helper logic used by both `tg-bot` and `max-bot`.
  - `bitrix-client` — OAuth client (`resolveBitrixApi`) for Bitrix24 methods that require full app context (as opposed to a simple incoming webhook).
  - `bitrix-webhook-api` — framework-agnostic handler for Bitrix24's `ONIMCONNECTORMESSAGEADD` outgoing webhook (form-urlencoded PHP-bracket payload), consumed by `apps/bitrix-webhook`.
  - `tg-userbot` — MTProto client wrapper (mtcute) for personal Telegram numbers; session/`api_hash` encrypted at rest (AES-256-GCM).
  - `max-userbot` — reverse-engineered MAX/OneMe protocol client (MessagePack + raw LZ4 framing in `src/protocol`); no official docs, breakage risk on upstream changes.
  - `waha` — REST client for the self-hosted WAHA container (personal WhatsApp numbers, Baileys/NOWEB engine).
  - `db` — Drizzle schema (`src/schema/*`, one directory per table/domain) and query modules (`src/queries/*.ts`), Postgres via `node-postgres`.
  - `api` — oRPC routers consumed by the dashboard/clients frontends (`src/routers/*`).
  - `jobs` — scheduled/background job definitions, split between a generic job layer and `src/hatchet/*` (Hatchet workflow registrations run by `apps/hatchet-worker`).
  - `config` — shared env parsing/validation, crypto helpers, logger.
  - `storage` — MinIO/S3-compatible object storage client.
  - `validators` — shared Zod schemas.
  - `emails` — React Email templates.
  - `rusender-client`, `unisender-client` — email/SMS provider REST clients.
- `tooling/*` — shared config packages (`github`, `tailwind`, `typescript`).
- `scripts/*` — one-off/backfill scripts run directly with `bun run scripts/<name>.ts`, not part of any workspace build.

### Data flow for messenger↔CRM integration

All four channel types (official bot, personal Telegram, personal MAX, personal WhatsApp) converge on the same Bitrix24 primitive: an **imconnector** registered against an Open Line. Registration and per-line activation happen through Bitrix24 UI + `PLACEMENT_HANDLER` widgets served by `apps/dashboard` (never via `.env` line/connector IDs). Runtime connector/line IDs live in Postgres (`bot_connectors`, `telegram_personal`, `max_personal`, `whatsapp_personal_*` tables in `packages/db`), not in env vars. Inbound messages go connector → `imconnector.send.messages`; operator replies come back via Bitrix24's outgoing webhook (`ONIMCONNECTORMESSAGEADD`) to `apps/bitrix-webhook`, which forwards to the right channel. See [README.md](README.md) for the full per-channel breakdown — it is the source of truth here and changes to this flow should keep it updated.

### Env vars

No `.env` per app — everything is read from the single repo-root `.env` (see `.env.example` for the full annotated list, and `turbo.json`'s `passThroughEnv` for which vars flow into `build`). Connector IDs, webhook tokens tied to a specific Bitrix24 portal, and per-channel credentials are stored in Postgres and configured through the dashboard UI at runtime, not in env vars — don't add new env vars for anything that's meant to be portal-specific/admin-configurable.

## Code style

- Biome for lint/format (`biome.json`), not ESLint/Prettier. Config is mostly defaults — this is a Biome monorepo, don't add ESLint.
- TypeScript strict mode, `noUncheckedIndexedAccess` and `noImplicitOverride` on; `verbatimModuleSyntax` — use explicit `import type` for type-only imports.
- File names: kebab-case. Functions: camelCase. Components: PascalCase. Constants: UPPER_SNAKE_CASE.
- External inputs (webhook payloads, form data) are validated with Zod (`@psi-opora/validators` / `zod` directly) — no unchecked `as` casts on untrusted data.
