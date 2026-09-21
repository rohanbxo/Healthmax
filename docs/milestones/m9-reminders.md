# M9 — Reminders

Commits: `91c7e4b`, `23c7052`, `0fec58f`, `8ff092d`, `bf42f79`, `52749aa`,
`5a20509`, `8eb167a`

## What this adds

- Push endpoints: the VAPID public key, subscribe (upsert by endpoint, which
  also moves a shared device to whoever is signed in now), unsubscribe
  (idempotent, silent about endpoints that are not the caller's), and a test
  notification.
- `reschedule-user`: rebuilds a user's next 48 hours from core's
  `planReminders`. Domain events enqueue it keyed by user with a two-second
  delay, so a burst of taps collapses into one run.
- `dispatch-reminders`: every minute, claims due rows with a single
  `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING`, then re-checks each one. A
  habit deleted, archived or silenced since planning, a day logged since
  planning, an occurrence more than two hours late, or a user with no live
  subscription is **cancelled**, not sent.
- `extend-windows`: hourly, walking users with reminding habits in batches of 500.
- Service worker handling `push` and `notificationclick` only — no offline
  caching, which SPEC.md §16 puts out of scope.
- Permission asked after the first habit is saved with reminders on, and only
  from a tap. The prompt lives in the shell because the habit form's sheet
  closes on save.
- Settings notification section: status, turn on/off for this device, test
  send, and the iPhone Home Screen note.

Delivery is **at-most-once** by design (SPEC.md §10): the claim marks a row
sent before the push leaves, so a crash loses a reminder rather than
duplicating it.

## Acceptance criteria (SPEC.md §15)

- [x] Event bus → BullMQ `reschedule-user` (deduped)
- [x] `dispatch-reminders` with `SKIP LOCKED`, `extend-windows`
- [x] Push subscription endpoints, service worker, permission flow,
      Settings notification section
- [x] All reminder tests
- [x] Manually verified in Chrome

## Four bugs found by running it, not by testing it

1. **`pnpm dev` had never worked** (`0fec58f`). Compose built three services
   from a `Dockerfile` that does not exist. Added `Dockerfile.dev`, a
   `core-build` step (core's `dist` is gitignored, and both the API and web
   import it), and `tsc -b --force` — `tsc` trusts a bind-mounted
   `tsconfig.tsbuildinfo` over the files on disk and will emit nothing into a
   missing `dist`.
2. **The web app rendered blank in Chrome** (`0fec58f`). `@beta/core` is
   CommonJS and Vite does not pre-bundle a linked workspace package, so named
   imports failed at runtime. jsdom never caught it because Vitest does its
   own interop.
3. **`/sw.js` was not served in development** (`8ff092d`). It is emitted only
   by the production build, so the dev server answered `index.html` and
   Chrome refused it: _"The script has an unsupported MIME type
   ('text/html')"_. Push could never be enabled in dev. A dev-only Vite plugin
   now serves the transformed worker from the root. The worker also gained
   `skipWaiting` + `clients.claim`, because an updated worker otherwise sat in
   `waiting` until every tab closed.
4. **No reminder could ever be scheduled** (`bf42f79`). Two faults in the M3
   queue, both invisible because the event handler is fire-and-forget:
   - the job id `reschedule:{userId}` contains `:`, which BullMQ refuses
     ("Custom Id cannot contain :"), so every enqueue threw into the log;
   - with that fixed, an hour of completed-job retention on the same id meant
     BullMQ ignored every later change by that user. The debounce key had
     become a one-hour lockout.

## Break-checks

- A non-atomic select-then-update claim sends all five occurrences **twice**.
- Dropping the logged re-check notifies a habit completed since planning.
- Restoring the colon in the job id fails three queue tests with the
  production error verbatim.
- Removing the dev service-worker plugin fails `devServer.test.ts` with
  `expected 'text/html' to match /javascript/`.
- Making every Year cell tabbable, or dropping `ArrowDown`, fails the
  keyboard test.

## Verified in Chrome, against the running stack

- A habit due three minutes out: occurrence written with `fireAt` in the
  user's zone, claimed at `20:56:55Z`, notification **"Push Check / Due now"**
  shown at `20:56:58Z` — 58 seconds after due.
- Completing before the due time withdrew today's occurrence; nothing arrived
  when that time came.
- Snoozing moved `fireAt` from `21:08:00` to `21:20:15`, and a snoozed habit
  delivered **"Snoozed reminder"** at its snooze time.
- A stale endpoint from an unregistered worker was pruned by the 404/410 path
  against the real push service, not a fake.

## Also in these commits

- `52749aa`: CI set `DATABASE_URL` equal to `DATABASE_URL_TEST`, which the
  test-db guard refuses, so `pnpm --filter @beta/api test` could never run
  there.
- `5a20509`: `pnpm check` never ran `format:check`; 44 files had drifted.
  Reformatted, and the check now enforces it.
- `8eb167a`: an occurrence for a user with no live subscription is cancelled
  rather than recorded as sent.

## Known limitations

- BullMQ's own scheduling is not under test; the tests drive the handlers and
  assert the schedulers are registered and ticking.
- No reminder has been delivered to a phone, only to desktop Chrome.
