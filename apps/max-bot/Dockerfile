FROM oven/bun:1-alpine AS base

# --- Prune: собираем минимальный поддеревь монорепо для max-bot ---
FROM base AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune @psi-opora/max-bot --docker

# --- Install & build: устанавливаем зависимости только для max-bot, собираем workspace-пакеты ---
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/max-bot^...

# --- Runner: только рантайм-артефакты, без dev-зависимостей и лишних пакетов ---
FROM base AS runner
WORKDIR /app
COPY --from=installer /app .

# Продакшен на своём сервере — long polling (нет публичного URL для вебхука,
# см. apps/max-bot/api/webhook.ts, который используется только при деплое на Vercel).
WORKDIR /app/apps/max-bot
CMD ["bun", "run", "src/dev.ts"]
