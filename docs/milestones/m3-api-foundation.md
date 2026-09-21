# M3 — API foundation

Commit: `0b7ec4c`

## What this adds

- `createApp(deps)` as the composition root: Prisma, Redis, queues, clock,
  event bus, mailer, push sender, config and logger all injected. No module
  imports a singleton client (SPEC.md §3).
- zod-validated config, parsed once at startup, naming every offending
  variable and never printing a value.
- `pino` + `pino-http` with request ids.
- The error contract: one envelope for every non-2xx, the SPEC.md §9 code
  table, and no stack traces leaving the server.
- `GET /health` checking Postgres and Redis.
- Prisma schema and the first migration.
- OpenAPI generated from the zod schemas, served at `/api/docs`.
- The ts-mocha harness: real Postgres and Redis, `FixedClock`, `FakeMailer`,
  `FakePushSender`, `FakeQueues`, and a truncate-between-tests helper.
- The queue seam (`jobs/queues.ts`) the M9 workers later consume.

## Acceptance criteria (SPEC.md §15)

- [x] `createApp(deps)` DI, zod config, pino with request ids
- [x] Error handler + error shape, `/health`
- [x] Prisma schema + first migration
- [x] OpenAPI + `/docs`
- [x] ts-mocha harness with test DB and fakes
- [x] CI `test-api` job with service containers

## Bugs this milestone shipped, found in M9

Both lived in `jobs/queues.ts` and survived six milestones because every test
used `FakeQueues`, which records a user id and validates nothing:

1. **`reschedule:{userId}` as a BullMQ job id.** BullMQ refuses a custom id
   containing `:` ("Custom Id cannot contain :"). Every enqueue threw inside
   a fire-and-forget event handler, so the write succeeded, the error reached
   only the log, and no reminder was ever scheduled. Fixed in `bf42f79`.
2. **An hour of completed-job retention on that same id.** BullMQ ignores
   `add` while a job with the id exists, including a finished one — so after
   the first change, every further change by that user was dropped for an
   hour. Fixed in the same commit.

Also found later: the CI job set `DATABASE_URL` equal to `DATABASE_URL_TEST`,
which `prepare-test-db.mjs` refuses by design, so `pnpm --filter @beta/api
test` could never run in CI (fixed in `52749aa`).

`queues.test.ts` now drives real BullQueues and real workers against Redis and
fails on each of these.

## Known limitations

- The event bus is in-process; it is enough while the API and worker share a
  deployment, and it is the seam a real broker would replace.
