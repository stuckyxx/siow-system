# syntax=docker/dockerfile:1.7
# Build a partir da RAIZ do monorepo:
#   docker build -f apps/worker/Dockerfile -t siow-worker .

# ---------- builder ----------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl python3 make g++
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .swcrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/integrations/package.json packages/integrations/
COPY packages/queue/package.json packages/queue/
COPY packages/storage/package.json packages/storage/
COPY packages/sync-core/package.json packages/sync-core/
COPY packages/db/prisma packages/db/prisma

RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @siow/db exec prisma generate
RUN pnpm --filter @siow/worker build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
