# M7 — Today & habit form

Commits: `f70f114`, `e04171e`, `23c7d15`, `26daf20`, `bf99cff`, `645da2e`,
`422eb3c`

## What this adds

- The Today read model (`today-model.tsx`): a pure function from one
  `/today` payload plus an instant to the sections the screen draws. Nothing
  re-derives "is it overdue" — `statusOn`, `isAtRisk` and `dueInstant` come
  from `@beta/core`, so the client and the reminder worker agree.
- The Today screen per SPEC.md §4: 56px mono clock, next-up card, overdue,
  snoozed, later today, this week, collapsed done & skipped, and a live
  30-second tick that moves a row from Later to Overdue without a refetch.
- Optimistic complete / skip / clear / snooze with rollback and an error
  toast; undo as the inverse request through the same path.
- Snooze on tap (15 minutes) and a long-press sheet offering 15 / 60 / 180
  with the resulting `until` on each.
- The habit form: create, edit, archive and delete, with zod validation.

## Acceptance criteria (SPEC.md §15)

- [x] Today per §4 with live clock
- [x] Optimistic mutations + rollback, undo, snooze tap and sheet
- [x] Habit create/edit/archive/delete
- [x] Web tests

## Break-checks

The rollback tests were not worth what they claimed, and proving it took
deleting the code they covered:

- **The one rollback test passed with the rollback deleted.** The
  `onSettled` refetch of `/today` restored the row on its own. Removing all
  of `onError` failed only on the missing toast — rollback was never checked.
  Each rollback test now holds every `/today` read after the failed write, so
  only `onError` can restore the row; with the rollback removed, all five
  fail.
- **Skip, clear, snooze and undo had no failure test at all.** They asserted
  the request and stopped. They now each have one.
- The single-flight refresh test was break-checked by making each 401 start
  its own refresh: `expected 2 to be 1`.

## Timezone

Every suite now runs with `TZ=America/Los_Angeles`, set in both Vitest
configs and through `.mocharc.json` for the API. The development machine sits
at UTC+4 — the same offset as the `Asia/Dubai` fixtures — so a test that read
the process zone instead of the user's would have passed. With the process in
Los Angeles, the Today tests still show Dubai time.

## Known limitations

- `/today` carries today plus the rest of the week, so the streak shown on a
  row is the streak visible in that window; `/stats` owns the full history.
