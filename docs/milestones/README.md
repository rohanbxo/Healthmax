# Milestone records

One file per milestone (SPEC.md §15), written as the PR description that
milestone would carry: what shipped, how it was verified, what was
deliberately broken to prove a test earns its place, and what is still not
true.

The milestone branches were deleted once `main` contained them. These files,
and the commits themselves, are the record.

| #   | Milestone                      | Commits               | Record                                                       |
| --- | ------------------------------ | --------------------- | ------------------------------------------------------------ |
| M0  | Monorepo scaffold              | `b2a323b`, `d35be3c`  | [m0-monorepo-scaffold.md](m0-monorepo-scaffold.md)           |
| M1  | Time engine                    | `8ef4b39`             | [m1-time-engine.md](m1-time-engine.md)                       |
| M2  | Domain logic                   | `3adb0b5`             | [m2-domain-logic.md](m2-domain-logic.md)                     |
| M3  | API foundation                 | `0b7ec4c`             | [m3-api-foundation.md](m3-api-foundation.md)                 |
| M4  | Auth                           | `e4ff463`             | [m4-auth.md](m4-auth.md)                                     |
| M5  | Habits, logs, snoozes, today   | `1f45935`             | [m5-habits-logs-today.md](m5-habits-logs-today.md)           |
| M6  | Web foundation                 | `feab153`, `a8b548c`  | [m6-web-foundation.md](m6-web-foundation.md)                 |
| M7  | Today & habit form             | `f70f114` … `422eb3c` | [m7-today-habit-form.md](m7-today-habit-form.md)             |
| M8  | Calendar & stats               | `60258cd` … `eab5771` | [m8-calendar-stats.md](m8-calendar-stats.md)                 |
| M9  | Reminders                      | `91c7e4b` … `8eb167a` | [m9-reminders.md](m9-reminders.md)                           |
| M10 | Settings, export/import, email | `d423b49`, `cf81787`  | [m10-settings-export-email.md](m10-settings-export-email.md) |

## The bugs that only running it found

Every one of these passed a green test suite first. They are the reason the
later milestones verify in a browser and against the real stack, not only in
jsdom and fakes.

| Bug                                                                                                                             | Shipped in | Found during                      | Why the tests missed it                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@beta/core` is CommonJS; Vite would not give the browser its named exports, so the app rendered a blank page                   | M6         | M9 (`pnpm dev` first ran)         | jsdom only — Vitest does its own CJS interop, so the web suite never exercised the browser's module loader     |
| `/sw.js` was emitted only by the production build, so the dev server answered `index.html` and registration failed on MIME type | M9         | M9 (enabling reminders in Chrome) | The service worker's handlers were unit-tested; nothing asked the dev server for the file the browser asks for |
| BullMQ rejects a job id containing `:`, so every `reschedule-user` enqueue threw into a fire-and-forget handler                 | M3         | M9 (no reminder ever fired)       | `FakeQueues` records a user id and never validates it the way BullMQ does                                      |
| The same job id, plus an hour of completed-job retention, meant only the _first_ change per user per hour rebuilt a plan        | M3         | M9 (second habit got no reminder) | Same: no test ran a job to completion and enqueued again                                                       |
| `@vitest/coverage-v8` was never installed although both configs asked for `provider: 'v8'`                                      | M0         | First real CI run                 | Coverage only runs in CI, and CI had never run                                                                 |
| `pnpm/action-setup` pinned a version that conflicts with `packageManager`                                                       | M0         | First real CI run                 | Same                                                                                                           |
| `DATABASE_URL` equalled `DATABASE_URL_TEST` in CI, which the test-db guard refuses                                              | M3         | M9 audit                          | CI called `test:ci`, which skips the `pretest` hook that runs the guard                                        |

## Still not verified

- `/dev/time-check` has only been run in Chrome (21/21). Safari and Firefox
  are the reason that page exists — their `Intl` data can differ.
- The production build serves `/sw.js` from `vite build`; that path is
  verified by the build output, not by loading a built app from a server.
  M11 owns that.
- No reminder has been delivered to a phone, only to desktop Chrome.
