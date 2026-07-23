FROM oven/bun:1-alpine

# packages/* (@psi-opora/db, @psi-opora/bot-core и т.д.) перед сборкой
# выполняют `git clean -xdf .cache dist` — им нужен git и .git в контексте
# (см. .dockerignore, где .git намеренно не исключён).
RUN apk add --no-cache git

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@psi-opora/tg-bot^...

# Продакшен на своём сервере — long polling (нет публичного URL для вебхука,
# см. apps/tg-bot/api/webhook.ts, который используется только при деплое на Vercel).
WORKDIR /app/apps/tg-bot
CMD ["bun", "run", "src/dev.ts"]
