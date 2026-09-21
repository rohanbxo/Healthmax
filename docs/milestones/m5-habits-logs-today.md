# M5 — Habits, logs, snoozes, today

Commit: `1f45935`

## What this adds

- `GET`/`POST /habits`, `PATCH`/`DELETE /habits/:id` (soft delete).
- `PUT`/`DELETE /habits/:id/logs/:dayKey`, idempotent, validating the
  backfill window and that the day is scheduled, and clearing that day's
  snooze on a write.
- `PUT`/`DELETE /habits/:id/snooze` — 15, 60 or 180 minutes from the injected
  clock, in the user's day, never a log.
- `GET /logs?from=&to=&habitId=`, capped at 400 days.
- `GET /today`: the read model — `serverNow`, the caller's `dayKey`,
  timezone, week start, habits, this week's logs and live snoozes. It returns
  facts, not a rendering, so the client can re-derive "overdue" between
  fetches.
- Every mutation emits a domain event (`habit.changed`, `log.changed`,
  `snooze.changed`).

## Acceptance criteria (SPEC.md §15)

- [x] All §9 habit/log/snooze/today/logs routes with layering
- [x] Authorization, validation, domain events
- [x] IDOR tests

## Decisions the spec left open

- A rejected day is `422 UNPROCESSABLE`, never `400`: the request was
  understood, the rules forbid it. The message says which rule — future day,
  before `createdDayKey`, archived, or not scheduled.
- `/today` carries archived habits, flagged, so a habit archived after being
  completed today is still renderable in "Done & skipped"; `isScheduledOn`
  keeps them out of every live section.
- A deleted habit's logs stay in the database for reminder history but are
  filtered out of every read.

## Known limitations

- The 400-day cap is enforced in the log service, so `/stats` (M8) reads
  further back deliberately — see that record.
