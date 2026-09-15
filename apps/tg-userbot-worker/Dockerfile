FROM oven/bun:1-alpine AS base
# @mtcute/node (через @psi-opora/tg-userbot) тянет нативные аддоны
# (better-sqlite3), которым в Alpine-образе нужны Python и компилятор.
RUN apk add --no-cache libc6-compat git python3 g++ make
WORKDIR /app

# --- Prepare ---
FROM base AS prepare
COPY . .
RUN bunx turbo prune @psi-opora/tg-userbot-worker --docker

# --- Builder ---
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/tg-userbot-worker...

# --- Runner ---
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 worker
USER worker
COPY --from=builder --chown=worker:nodejs /app .

WORKDIR /app/apps/tg-userbot-worker
CMD ["bun", "run", "start"]
