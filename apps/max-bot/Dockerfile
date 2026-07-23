FROM oven/bun:1-alpine

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

# Продакшен на своём сервере — long polling (нет публичного URL для вебхука,
# см. apps/max-bot/api/webhook.ts, который используется только при деплое на Vercel).
WORKDIR /app/apps/max-bot
CMD ["bun", "run", "src/dev.ts"]
