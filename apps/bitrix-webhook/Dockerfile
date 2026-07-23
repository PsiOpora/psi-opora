FROM oven/bun:1-alpine AS base

# --- Prune: собираем минимальный поддеревь монорепо для bitrix-webhook ---
FROM base AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune @psi-opora/bitrix-webhook --docker

# --- Install & build ---
FROM base AS installer
WORKDIR /app

# @mtcute/node (через @psi-opora/tg-userbot) тянет нативные аддоны
# (better-sqlite3), которым в Alpine-образе нужны Python и компилятор.
RUN apk add --no-cache python3 g++ make

COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/bitrix-webhook...

# --- Runner: только рантайм-артефакты ---
FROM base AS runner
WORKDIR /app
COPY --from=installer /app .

WORKDIR /app/apps/bitrix-webhook
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
