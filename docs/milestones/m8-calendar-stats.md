# M8 — Calendar & stats

Commits: `60258cd`, `67e5841`, `78a50e0`, `26d60d5`, `2b96050`, `eab5771`

## What this adds

- `buildStats` in `packages/core`: the whole `/stats` payload as one pure
  function — pooled accuracy over the range, and per habit the current and
  best streak, 30-day accuracy and a 30-day status strip ending today.
- `GET /stats?range=7|30|90`, **Redis-cached** under
  `stats:v1:{userId}:{dayKey}:{range}` for an hour, reporting `X-Cache`.
  Invalidated on `habit.changed`, `log.changed` and `user.scheduleChanged`
  through the `stats:keys:{userId}` set — never `KEYS`.
- Calendar: Day / Month / Year, Month by default, with a habit filter. Month
  cells shaded by done against due; the Year view is 53 weeks ending with the
  current one, aligned to the user's week start. Tapping a day opens it for
  editing inside the backfill window, using core's `canLogOn` so a button is
  disabled exactly when the API would answer 422.
- Stats screen: overall accuracy, per-habit streaks, 30-day accuracy and a
  dot strip. A null accuracy reads as a dash, never 0%.

## Acceptance criteria (SPEC.md §15)

- [x] Calendar views + backfill
- [x] `/stats` with Redis cache + invalidation
- [x] Stats screen
- [x] API cache tests and web tests

## The cache race, and why deletion alone was not enough

Deleting keys through the key set takes two round trips (`SMEMBERS`, then
`DEL`), and the domain event fires inside the request that changed the data.
Two races follow:

1. A read arriving between those two calls still gets a `HIT`.
2. A miss computed from old data can finish _after_ the invalidation and
   store a stale value for an hour.

A per-user generation counter closes both: it is bumped first, synchronously,
on the same connection, and every cached value carries the generation it was
computed under. Break-checked — dropping the generation check fails both race
tests; unsubscribing invalidation fails five.

## Break-checks

- Unsubscribing cache invalidation: 5 tests fail.
- Removing the generation check: both race tests fail.
- Removing the backfill rollback: the Calendar rollback test fails (it holds
  every `/logs` read after the failed write, so only the rollback can restore
  the day).
- Making the Calendar use the browser's timezone instead of the user's: 2
  tests fail.

## Accessibility

The Year grid is an ARIA grid with a roving tabindex: one tab stop, arrow
keys across weeks and within a week, Home/End to a week's first and last day,
Enter or Space to open. Each cell is a `gridcell` wrapping a real button —
putting the role on the button itself removed the button role entirely, so
nothing told a screen reader the day could be opened.

Verified against the accessibility tree over all 371 cells: DOM order matches
visual order, and every cell's reported `(row, column)` matches the date shown
there.

## Known limitations

- `/stats` reads log history back to the oldest habit (bounded by
  `MAX_STREAK_LOOKBACK_DAYS`), beyond the 400-day cap `/logs` enforces. That
  cap bounds what a _client_ may ask for; this query is the server's own and
  runs once per user, day and range before the cache answers.
- Today's dot in the strip ignores snoozes, so a snoozed habit reads as
  `overdue` or `upcoming` there. It keeps the payload independent of snoozes,
  which do not affect stats and so do not invalidate the cache.
- The Year grid is a transposed heatmap: a linear screen-reader read gives 53
  Mondays, then 53 Tuesdays, so it is never chronological. Each cell names its
  own date, so it is odd rather than ambiguous. Chronological order would
  require a week-per-row layout — a different visual.
- The Year grid has no row or column headers: the weekday strip sits outside
  the grid and is `aria-hidden`, so a row is never announced as "Wednesday".
- Year cells are 12px; the 44px minimum applies to primary actions elsewhere.
