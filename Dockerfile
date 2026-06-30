FROM oven/bun:1-alpine AS builder

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build src/bot.ts --target node --outfile dist/bot.js

FROM oven/bun:1-alpine

WORKDIR /app
COPY --from=builder /app/dist/bot.js .
COPY --from=builder /app/node_modules node_modules

ENV BOT_TOKEN=${BOT_TOKEN}

CMD ["bun", "bot.js"]