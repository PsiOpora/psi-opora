FROM oven/bun:1-alpine

# better-sqlite3 (native-зависимость @mtcute/node) требует Python и компилятор,
# в Alpine-образе их нет по умолчанию.
RUN apk add --no-cache python3 g++ make

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@psi-opora/tg-userbot-worker...

WORKDIR /app/apps/tg-userbot-worker
CMD ["bun", "run", "start"]
