FROM oven/bun:1-alpine

# @mtcute/node (через @psi-opora/tg-userbot) тянет нативные аддоны
# (better-sqlite3), которым в Alpine-образе нужны Python и компилятор.
# git — потому что packages/* перед сборкой делают `git clean -xdf .cache dist`
# (см. .dockerignore, где .git намеренно не исключён).
RUN apk add --no-cache python3 g++ make git

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@psi-opora/tg-userbot-worker...

WORKDIR /app/apps/tg-userbot-worker
CMD ["bun", "run", "start"]
