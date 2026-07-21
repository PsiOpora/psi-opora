FROM oven/bun:1-alpine

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@psi-opora/tg-userbot-worker...

WORKDIR /app/apps/tg-userbot-worker
CMD ["bun", "run", "start"]
