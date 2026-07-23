FROM oven/bun:1-alpine AS base
# @mtcute/node (через @psi-opora/tg-userbot, входит в @psi-opora/api) тянет
# нативные аддоны (better-sqlite3), которым в Alpine-образе нужны Python и компилятор.
RUN apk add --no-cache libc6-compat git python3 g++ make
WORKDIR /app

# --- Prepare ---
FROM base AS prepare
COPY . .
RUN bunx turbo prune @psi-opora/clients --docker

# --- Builder ---
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/clients...

# --- Runner ---
# Полный node_modules (не .next/standalone): @mtcute/wasm грузит .wasm через
# `new URL(..., import.meta.url)`, трейсинг файлов Next.js это не видит и
# в standalone-сборке падает "Cannot find module 'mtcute-simd.wasm'"
# (см. serverExternalPackages в apps/clients/next.config.ts).
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs
COPY --from=builder --chown=nextjs:nodejs /app .

WORKDIR /app/apps/clients
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
