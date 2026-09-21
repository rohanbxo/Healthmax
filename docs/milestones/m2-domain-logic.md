# M2 — Domain logic

Commit: `3adb0b5`

## What this adds

The rules every layer shares, as pure functions in `packages/core`
(SPEC.md §6), so the API, the web client and the reminder worker cannot
disagree about what is due:

- `types.ts` and `schemas.ts`: the DTOs and the zod contract both sides parse.
- `rules.ts`: `isScheduledOn`, `dueInstant`, `statusOn`, `activeSnoozeUntil`,
  `canLogOn`, `isAtRisk`, `doneCountInWeek`, `remainingDaysInWeek`.
- `metrics.ts`: `currentStreak`, `bestStreak`, `accuracy`, `overallAccuracy`.
- `reminderPlan.ts`: `planReminders` over a 48-hour horizon, with the
  exclusions SPEC.md §10.3 lists and a snooze replacing that day's `fireAt`.

## Acceptance criteria (SPEC.md §15)

- [x] `types.ts`, `schemas.ts`, `rules.ts`, `metrics.ts`, `reminderPlan.ts`
- [x] Tests for every §6 rule

## Decisions the spec left open

- A `skipped` day is neutral for a streak: the walk continues, the streak does
  not grow. Accuracy excludes it from both sides of the ratio.
- An unlogged **today** never breaks a streak — a streak survives until the
  day is actually missed.
- `timesPerWeek` is never `overdue`; an unlogged past day is `unscheduled`
  rather than `missed`, because those habits are scored per week.
- Accuracy returns `null`, never `0` and never `NaN`, when nothing was
  scheduled.

## Known limitations

- Stats apply a habit's **current** schedule to all of its history; schedule
  changes are not versioned (SPEC.md §6, to be documented in the README).
- `MAX_STREAK_LOOKBACK_DAYS` caps a backwards walk at ten years.
