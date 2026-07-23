FROM oven/bun:1-alpine

# @mtcute/node (через @psi-opora/tg-userbot) тянет нативные аддоны
# (better-sqlite3), которым в Alpine-образе нужны Python и компилятор.
RUN apk add --no-cache python3 g++ make

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@psi-opora/bitrix-webhook...

WORKDIR /app/apps/bitrix-webhook
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
