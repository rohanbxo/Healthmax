# M1 — Time engine

Commit: `8ef4b39`

## What this adds

- `packages/core/src/time.ts`: the one module every date calculation in the
  API and the web app goes through (SPEC.md §7).
  - `DayKey` parsed into integers, never through `new Date(string)`.
  - Day arithmetic via `Date.UTC(y, m - 1, d + n)`, never millisecond addition.
  - Timezone conversion through `Intl.DateTimeFormat.formatToParts` with an
    explicit `timeZone`.
  - DST disambiguation matching Temporal's `'compatible'`: a nonexistent local
    time shifts forward by the gap, an ambiguous one resolves to the earlier
    instant.
- `timeSelfCheck.ts` with known-answer checks, exposed in development at
  `/dev/time-check` so the same assertions can be run in a real browser.
- `timezones.ts`: a static fallback list for browsers without
  `Intl.supportedValuesOf`.
- The **date guard** (`no-restricted-syntax`) banning `new Date(...)` with
  arguments, `Date.parse` and the local getters everywhere except
  `time.ts`, `apps/api/src/lib/instant.ts` and test files.
- `packages/core/test/guard.test.ts`, which runs ESLint programmatically over
  fixtures to prove the guard actually fires.

## Acceptance criteria (SPEC.md §15)

- [x] `time.ts`, `timeSelfCheck.ts`
- [x] Full time tests across the 11 zones in SPEC.md §7
- [x] Date guard + guard test

## How it was verified

Vitest in Node, across `UTC`, `America/New_York`, `America/Los_Angeles`,
`America/St_Johns`, `Europe/London`, `Asia/Dubai`, `Asia/Kolkata`,
`Australia/Sydney`, `Australia/Lord_Howe`, `Pacific/Chatham` and
`Pacific/Kiritimati`.

Later (after M10) the self-check page was finally opened in Chrome:
**21 / 21 passed**, including the spring-forward gaps, the ambiguous
fall-back instants, Lord Howe's 30-minute gap and Chatham's 45-minute offset.

## Known limitations

- Safari and Firefox have never run `/dev/time-check`. Their `Intl` data can
  differ from Chrome's, which is the entire reason that page exists.
- The guard cannot ban bare `new Date()`; that stays a review question, since
  it reads the process clock rather than a passed instant.
