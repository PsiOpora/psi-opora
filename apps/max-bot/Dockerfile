FROM oven/bun:1-alpine AS base
# bufferutil (транзитивная зависимость ws) требует node-gyp → Python и компилятор.
RUN apk add --no-cache libc6-compat git python3 g++ make
WORKDIR /app

# --- Prepare: вырезаем из монорепо только то, что нужно для max-bot ---
FROM base AS prepare
COPY . .
RUN bunx turbo prune @psi-opora/max-bot --docker

# --- Builder: сначала зависимости (кешируются отдельным слоем), потом сборка ---
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/max-bot^...

# --- Runner ---
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 bot
USER bot
COPY --from=builder --chown=bot:nodejs /app .

WORKDIR /app/apps/max-bot
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
