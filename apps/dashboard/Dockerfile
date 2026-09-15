FROM oven/bun:1-alpine AS base
# @mtcute/node (через @psi-opora/tg-userbot) тянет нативные аддоны
# (better-sqlite3), которым в Alpine-образе нужны Python и компилятор.
RUN apk add --no-cache libc6-compat git python3 g++ make curl
WORKDIR /app

# --- Prepare ---
FROM base AS prepare
COPY . .
RUN bunx turbo prune @psi-opora/dashboard --docker

# --- Builder ---
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
ARG POSTGRES_URL
ENV POSTGRES_URL=$POSTGRES_URL
# NEXT_PUBLIC_* попадают в клиентский бандл только на этапе `next build` —
# в отличие от остальных env, задать их через ConfigMap/переменные рантайма
# в k3s (после сборки) уже бесполезно, значение должно быть здесь.
ARG NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL
ENV NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL=$NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL
ENV NEXT_PUBLIC_APP_URL=https://psi-opora-dashboard.orixon.ru
RUN bunx turbo run build --filter=@psi-opora/dashboard...

# --- Runner ---
# Полный node_modules (не .next/standalone): @mtcute/wasm грузит .wasm через
# `new URL(..., import.meta.url)`, трейсинг файлов Next.js это не видит и
# в standalone-сборке падает "Cannot find module 'mtcute-simd.wasm'"
# (см. serverExternalPackages в apps/dashboard/next.config.ts).
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs
COPY --from=builder --chown=nextjs:nodejs /app .

WORKDIR /app/apps/dashboard
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
