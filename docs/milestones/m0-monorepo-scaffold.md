# M0 — Monorepo scaffold

Commits: `b2a323b`, `d35be3c`

## What this adds

- pnpm workspaces with TypeScript project references: `packages/core`,
  `apps/api`, `apps/web`.
- TypeScript `strict` with `noUncheckedIndexedAccess` everywhere.
- ESLint (flat config) and Prettier.
- Vitest in `packages/core`.
- `docker-compose.yml` with Postgres 16 and Redis 7, health-checked.
- CI skeleton (`.github/workflows/ci.yml`), PR template, `.nvmrc`.
- Host ports moved off the defaults — 5433, 6380, 4000 — so a local Postgres,
  Redis or dev server already running keeps working (`d35be3c`).

## Acceptance criteria (SPEC.md §15)

- [x] pnpm workspaces, TS project refs
- [x] ESLint + Prettier
- [x] Vitest in core
- [x] Docker Compose with Postgres + Redis healthy
- [x] CI skeleton (lint + typecheck) passing
- [x] PR template, `.nvmrc`

## How it was verified, and how that was wrong

Postgres and Redis were confirmed healthy by starting those two services.
The claim was recorded as met. Two parts were not true:

1. **`docker compose up` never ran.** The `api`, `worker` and `web` services
   build from a `Dockerfile` that did not exist — the production one is M11 —
   so `pnpm dev` failed at build. Only the two image-based services were ever
   started. Fixed in M9 (`0fec58f`) with a `Dockerfile.dev`.
2. **CI never ran.** The repository had no remote until after M10, so the
   "passing" CI skeleton had never executed. Its first real run failed three
   times: a pnpm version conflict, and a missing coverage provider that both
   Vitest configs had asked for since this commit.

## Known limitations

- Coverage was configured (`provider: 'v8'`) without the provider package
  installed; that went unnoticed until CI first ran.
