FROM oven/bun:1-alpine AS base
RUN apk add --no-cache libc6-compat git
WORKDIR /app

# --- Prepare ---
FROM base AS prepare
COPY . .
RUN bunx turbo prune @psi-opora/payments --docker

# --- Builder: собираем только зависимости, сам payments Bun запускает из исходников ---
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install
COPY --from=prepare /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/payments^...

# --- Runner ---
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 payments
USER payments
COPY --from=builder --chown=payments:nodejs /app .

WORKDIR /app/apps/payments
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
