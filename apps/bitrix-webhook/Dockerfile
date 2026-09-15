FROM oven/bun:1-alpine AS base
# @mtcute/node (через @psi-opora/tg-userbot) тянет нативные аддоны
# (better-sqlite3), которым в Alpine-образе нужны Python и компилятор.
RUN apk add --no-cache libc6-compat git python3 g++ make
WORKDIR /app

# --- Prepare ---
FROM base AS prepare
COPY . .
RUN bunx turbo prune @psi-opora/bitrix-webhook --docker

# --- Builder: собираем только зависимости, сам bitrix-webhook Bun запускает из исходников ---
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install
COPY --from=prepare /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/bitrix-webhook^...

# --- Runner ---
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 bitrix-webhook
USER bitrix-webhook
COPY --from=builder --chown=bitrix-webhook:nodejs /app .

WORKDIR /app/apps/bitrix-webhook
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
