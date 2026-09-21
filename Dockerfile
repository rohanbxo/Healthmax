# Production image (SPEC.md §13 "Docker").
#
# One image, one process: `ROLE=all` serves the API under /api, the built web
# app on every other path, and runs the reminder and email workers. Same origin
# means no CORS and first-party cookies — which is what lets the refresh cookie
# stay `SameSite=Strict`.
#
# `Dockerfile.dev` is the separate development image; it carries the toolchain
# and bind-mounts the source. This one carries only what runs.

# ---------------------------------------------------------------- deps
FROM node:22-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# `apps/api`'s postinstall runs `prisma generate`, which needs the schema.
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
COPY . .
# Core first: both the API and the web app compile against it.
RUN pnpm --filter @beta/core build \
  && pnpm --filter @beta/api build \
  && pnpm --filter @beta/web build

# ------------------------------------------------------- runtime deps
# Production dependencies only, so the final image carries no compiler,
# no test runner and no source.
FROM deps AS runtime-deps
WORKDIR /app
RUN pnpm install --frozen-lockfile --prod \
  && pnpm store prune

# --------------------------------------------------------------- final
FROM node:22-slim AS final
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    ROLE=all \
    PORT=3000 \
    WEB_ROOT=/app/apps/web/dist

WORKDIR /app

# node_modules, then the compiled output. Prisma's generated client lives in
# node_modules, so it comes from the same install that generated it.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=runtime-deps /app/packages/core/node_modules ./packages/core/node_modules

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/package.json ./

# `node` (uid 1000) ships with the image; nothing here needs root.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
