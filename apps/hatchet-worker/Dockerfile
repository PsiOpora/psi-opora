FROM oven/bun:1-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS prepare
COPY . .
RUN bunx turbo prune @psi-opora/hatchet-worker --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN bunx turbo run build --filter=@psi-opora/hatchet-worker...

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 worker
USER worker
COPY --from=builder --chown=worker:nodejs /app .

WORKDIR /app/apps/hatchet-worker
CMD ["bun", "run", "start"]
