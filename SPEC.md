# Beta — Full-Stack Build Spec for Claude Code

> Save this file as `SPEC.md` in the repo root. It is the source of truth.
> If anything is ambiguous or conflicts with the current docs for an installed package, **stop and ask** instead of inventing behavior.

---

## 0. How to work (instructions for Claude Code)

1. Build **one milestone at a time** (Section 15), in order. Do not start the next milestone until the current one's acceptance criteria pass.
2. Work on a branch per milestone named `m<n>-<short-title>`. Commit in small, meaningful steps using Conventional Commits (`feat(api): ...`, `test(web): ...`). At the end of a milestone, write a PR description using `.github/pull_request_template.md` and print it. **The developer opens and reviews the PR; do not merge.**
3. Before declaring a milestone done, run `pnpm check` (typecheck + lint + all tests). It must pass. Never weaken a test, lint rule, or type to make it pass.
4. Do **not** build anything in Out of Scope (Section 16), even as a placeholder.
5. Check the docs for the **installed** version of every library before using its API (Prisma, BullMQ, React Router, shadcn/ui, and Vite change often).
6. `packages/core` is pure TypeScript: no imports from Express, Prisma, Redis, React, or browser/Node-only APIs. It must run in both the API and the browser.
7. When a step needs something only the developer can do (accounts, secrets, dashboard settings), stop and list the exact steps (Section 14).
8. After each milestone, print a short summary: what was built, what was tested, known limitations, and which job-description skills it demonstrates (Section 17).

---

## 1. Product

**Beta** is a reminder-first habit tracker web app (installable as a PWA).

- **Core job:** show *what is due and when*, and complete it in **one tap**.
- **Server is the source of truth.** The UI is optimistic, so taps feel instant.
- **Reminders are real:** a background worker sends Web Push notifications at due times.
- **No timers:** no stopwatch, session timer, or duration tracking.
- **Free to run:** all services must fit free tiers.
- **Dark theme only.**

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces, TypeScript project references |
| Language | TypeScript `strict`, `noUncheckedIndexedAccess` everywhere |
| Web | React 18, Vite, React Router, TanStack Query (React Query), Tailwind CSS, shadcn/ui (Radix), `lucide-react` |
| API | Node.js 22 LTS, Express, TypeScript |
| Validation | `zod` (shared schemas in `packages/core`), OpenAPI generated from zod (`@asteasolutions/zod-to-openapi`), served with Swagger UI at `/api/docs` |
| Database | PostgreSQL 16 with Prisma ORM and Prisma Migrate |
| Cache & queues | Redis 7, `ioredis`, BullMQ, `rate-limit-redis` |
| Auth | Email + password (`argon2` id), short-lived JWT access token + rotating refresh token in an httpOnly cookie |
| Push | Web Push (`web-push`, VAPID) + a minimal service worker |
| Email | Resend (free tier) for password reset, sent through a queue job |
| Logging | `pino` + `pino-http` with request IDs |
| Security middleware | `helmet`, request body size limit, rate limiting |
| Tests — core | Vitest |
| Tests — API | Mocha via `ts-mocha`, `chai`, `supertest`, against real Postgres and Redis |
| Tests — web | Vitest + React Testing Library + `@testing-library/user-event` + MSW |
| Local env | Docker Compose (Postgres, Redis, API, worker, web dev server) |
| CI | GitHub Actions with Postgres and Redis service containers |
| Deploy | One Docker image: API serves the built web app and runs the worker; Neon (Postgres) and Upstash (Redis) free tiers |

---

## 3. Repository layout

```
apps/
  web/                    React 18 app
    src/
      api/                fetch client, query keys, hooks (useToday, useLogMutation, ...)
      auth/               token store, refresh single-flight, AuthProvider, route guard
      components/ui/      shadcn/ui components (owned code)
      components/         HabitRow, HabitForm, SnoozeSheet, UndoToast, MonthGrid, YearGrid, TimeZonePicker
      routes/             login, register, forgot, reset, onboarding, today, calendar, stats, settings
      sw/                 service worker (push + notificationclick only)
      test/               MSW handlers, render helpers, fixed clock
  api/
    prisma/schema.prisma
    src/
      app.ts              createApp(deps) — composition root (dependency injection)
      server.ts           starts HTTP and/or worker based on ROLE
      config.ts           zod-validated environment
      http/               middleware (auth, validate, errors, rateLimit, requestId), openapi
      modules/
        auth/             routes, controller, service, repository
        habits/
        logs/
        today/
        stats/
        push/
        export/
        coach/            optional, M12
      jobs/               queues, workers: reschedule-user, dispatch-reminders, extend-windows, send-email
      events/             EventBus interface + in-process implementation
      lib/                Clock, Mailer, PushSender interfaces and implementations
    test/                 mocha tests, factories, test app builder with fakes
packages/
  core/
    src/
      time.ts  timeSelfCheck.ts  timezones.ts
      types.ts  schemas.ts        (zod schemas shared by web + api)
      rules.ts  metrics.ts  reminderPlan.ts  coachContext.ts
    test/                 vitest
docker-compose.yml
Dockerfile
.github/workflows/ci.yml
.github/pull_request_template.md
.nvmrc                    22
```

### API layering (enforced by convention and review)
`routes` (paths + middleware) → `controller` (parse validated input, call service, shape response) → `service` (business logic, authorization, emits events) → `repository` (Prisma only). Controllers never touch Prisma; repositories never contain business rules.

### Dependency injection
`createApp(deps)` receives `{ prisma, redis, queues, clock, eventBus, mailer, pushSender, config, logger }`. Production wires real implementations in `server.ts`; tests pass fakes (`FixedClock`, `FakeMailer`, `FakePushSender`). No module imports a singleton client directly. No DI framework.

---

## 4. Design tokens and UI direction

**Direction: "cinematic precision."** Pure black, large monospace clock, amber used only for the next-up item and the primary action, red only for overdue and at-risk.

| Token | Value | Use |
|---|---|---|
| `base` | `#000000` | Background |
| `card` | `#1C1C1E` | Cards, rows, sheets |
| `raised` | `#2C2C2E` | Secondary buttons, toasts, progress track |
| `border` | `#3A3A3C` | Control outlines |
| `accent` | `#FFB340` | Next up, primary action, active tab |
| `text` | `#EEE0D3` | Primary text |
| `muted` | `#8E8E93` | Secondary text |
| `success` | `#30D158` | Done state |
| `danger` | `#FF453A` | Overdue, at risk, destructive |

- Fonts: **Geist** (UI) and **Geist Mono** (clock, times, countdowns, streaks, section labels) via Google Fonts, with system fallbacks.
- Section labels: Geist Mono, 12px, uppercase, `letter-spacing: 0.12em`.
- Tap targets ≥ 44×44px. Every icon-only button has an `aria-label`. Visible focus rings.
- Mobile-first layout, max content width 480px centered on desktop, bottom tab bar on mobile and desktop.
- Configure tokens in Tailwind and the shadcn/ui CSS variables. No raw hex values in components.

### Today screen layout (matches the approved mockup)
1. **Header:** date (`THU · 17 SEP`, mono, muted) above a 56px mono clock; top-right 44px round "+" button; below, `City · 3 of 7 done` (mono, muted); below that a segmented progress bar, one 4px segment per habit due today, filled `accent` when done.
2. **Next up card:** `NEXT UP` left and `IN 18 MIN` right (mono, accent); habit name 24px; `07:30 · 12-day streak` (mono, muted); buttons: **Complete** (flex-grow, 48px, accent fill, black text), **Snooze** (48px, `raised`), **Skip** (48px, text only). When nothing is upcoming, show `ALL CAUGHT UP` in `success`.
3. **Overdue:** red label; each row shows name, `06:30 · 42 min late` in red mono, then icon buttons Snooze, Skip, and a round Complete button with a red outline, **on the right edge**.
4. **Snoozed:** name, `until 07:27`, Complete button.
5. **Later today:** one card; each row shows time (mono, muted), name, outline Complete button.
6. **This week:** `timesPerWeek` habits with `1 / 5 this week` and an `AT RISK` badge (red outline) when at risk.
7. **Done & skipped · N:** collapsed toggle row with chevron; expanded rows show a filled green check (tap to clear) or a `SKIPPED` label (tap to clear).
8. **Undo toast:** floating above the tab bar, `raised` background, message plus `UNDO` in accent mono, auto-dismiss after 5 seconds.
9. **Snooze:** tap = 15 minutes. Long-press (or right-click / keyboard menu key) opens a bottom sheet with 15 minutes / 1 hour / 3 hours, each showing its resulting `until HH:MM`; 15 minutes is highlighted.
10. **Empty state:** `NOTHING DUE` (accent mono), headline "Pick one habit and a time.", body "Beta tells you when it's due. One tap marks it done.", primary button "Add your first habit".

---

## 5. Shared types (`packages/core/src/types.ts`)

```ts
export type DayKey = string;        // 'YYYY-MM-DD', a calendar day in the user's timezone
export type WeekStart = 0 | 1;      // 0 = Sunday, 1 = Monday

export type Schedule =
  | { kind: 'daily' }
  | { kind: 'weekdays'; days: number[] }        // 0–6, non-empty, unique, sorted
  | { kind: 'timesPerWeek'; count: number };    // 1–7

export type LogStatus = 'done' | 'skipped';

export type HabitDTO = {
  id: string; name: string; schedule: Schedule; time: string /* 'HH:mm' */;
  remind: boolean; createdDayKey: DayKey; archived: boolean; order: number;
};
export type LogDTO = { habitId: string; dayKey: DayKey; status: LogStatus };
export type SnoozeDTO = { habitId: string; dayKey: DayKey; until: string /* ISO instant */ };
export type MeDTO = { id: string; email: string; name: string; timeZone: string; weekStart: WeekStart; onboarded: boolean };
```

All request and response bodies have zod schemas in `packages/core/src/schemas.ts`. The API validates with them; the web client parses responses with them in development builds.

---

## 6. Behavior rules (`packages/core/src/rules.ts`, `metrics.ts`)

These rules are the contract; encode each in a test.

### Scheduling
- **daily:** every day on or after `createdDayKey`.
- **weekdays:** listed weekdays on or after `createdDayKey`.
- **timesPerWeek:** eligible every day; shown on Today until the week's `done` count reaches `count`. Weeks start on the user's `weekStart`.
- Archived or deleted habits are never scheduled, reminded, or counted.
- **Known limitation (README):** stats use the habit's *current* schedule for all history.

### Status on a day
- `done` / `skipped`: a log exists.
- `snoozed`: no log, active snooze for that day with `until > now`.
- `overdue`: no log, day is today, due instant ≤ now, not snoozed.
- `upcoming`: no log, day is today, due instant in the future.
- `missed`: no log, day before today.
- `timesPerWeek` is never overdue; it is **at risk** when `remainingDaysInWeek (including today) < count − doneThisWeek`.

### Streaks
- **daily / weekdays:** walk back over scheduled days from today; `done` +1, `skipped` neutral, `missed` stops, today unlogged ignored.
- **timesPerWeek:** consecutive weeks with `done ≥ count`; current week counts only if already satisfied.
- **Best streak:** longest run under the same rules.

### Accuracy
- `done / (done + missed)` over scheduled days in range; skipped and pre-creation days excluded; today counts only if logged.
- `timesPerWeek`: per week, completed past week = 1 done, incomplete past week = 1 missed.
- Denominator 0 → `null`.

### Actions
- **Complete / Skip:** upsert the log for `(habitId, dayKey)`; clears any snooze for that day.
- **Clear:** delete the log.
- **Snooze:** 15, 60, or 180 minutes from now; replaces an existing snooze; not a log; no stats effect.
- **Undo:** the client restores the previous state with the inverse request.
- **Backfill:** logs allowed for any scheduled day from `createdDayKey` to today (user's timezone). Future days rejected with `422`.

### Timezone change
- Existing logs keep their `dayKey`. "Today", due instants, and reminders immediately follow the new timezone.

---

## 7. Time engine (`packages/core/src/time.ts`)

**Every** date/time calculation in web and API goes through this module.

### Rules
1. Never parse date strings with `Date` (`new Date('2026-03-08')`, `Date.parse`). Parse `DayKey` into integers.
2. No millisecond day arithmetic. Add days via `Date.UTC(y, m - 1, d + n)` and read back UTC components.
3. Timezone conversion via `Intl.DateTimeFormat(...).formatToParts` with explicit `timeZone`.
4. DST disambiguation matches Temporal `'compatible'`: nonexistent local time → shift forward by the gap; ambiguous → earlier instant.
5. The server never uses its own timezone. Every calculation takes the user's IANA `timeZone`.

### API (pure; `now` and `tz` always passed in)
```ts
isValidDayKey, parseDayKey, makeDayKey, addDays, compareDayKeys, diffDays,
weekday, weekStartKey, daysInMonth,
instantToDayKey(ms, tz), instantToLocalParts(ms, tz), localToInstant(dayKey, 'HH:mm', tz),
todayKey(now, tz), isValidTimeZone(tz), formatTime(ms, tz), formatDayLabel(dayKey), formatDateHeader(ms, tz)
```
- `timeSelfCheck.ts`: `runTimeSelfCheck()` returns known-answer checks. Tested in Vitest, exposed on the web at `/dev/time-check` in development builds so it can be run in Safari, Chrome, and Firefox (their `Intl` data can differ).
- `timezones.ts`: static fallback list when `Intl.supportedValuesOf` is unavailable.

### Tests (`packages/core/test/time.test.ts`)
Zones: `UTC`, `America/New_York`, `America/Los_Angeles`, `America/St_Johns`, `Europe/London`, `Asia/Dubai`, `Asia/Kolkata`, `Australia/Sydney`, `Australia/Lord_Howe`, `Pacific/Chatham`, `Pacific/Kiritimati`.
- `addDays` across month/year ends, Feb 29 (2024, 2028) and non-leap 2026, and DST transitions.
- US 2026 (`America/New_York`): 8 Mar spring forward (02:30 → 03:30 EDT), 1 Nov fall back (01:30 → earlier EDT instant).
- EU 2026 (`Europe/London`): 29 Mar / 25 Oct.
- Southern hemisphere 2026 (`Australia/Sydney`, `Australia/Lord_Howe`): DST ends 5 Apr, begins 4 Oct.
- Same instant → different `todayKey` in `Pacific/Kiritimati` vs `America/Los_Angeles`.
- Round trip `localToInstant` ↔ `instantToLocalParts` for every hour of a transition day except the gap.
- `weekStartKey` for both week starts across a year boundary.

---

## 8. Database (`apps/api/prisma/schema.prisma`)

```prisma
enum LogStatus { done skipped }
enum ReminderStatus { pending sent cancelled failed }

model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique            // stored lowercased
  passwordHash String
  name         String   @db.VarChar(60)
  timeZone     String
  weekStart    Int      @default(1)
  onboarded    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  habits       Habit[]
  logs         Log[]
  refreshTokens RefreshToken[]
  pushSubscriptions PushSubscription[]
  reminders    ReminderOccurrence[]
  passwordResets PasswordResetToken[]
}

model RefreshToken {
  id           String    @id @default(uuid()) @db.Uuid
  userId       String    @db.Uuid
  familyId     String    @db.Uuid           // all rotations of one login share a family
  tokenHash    String    @unique            // SHA-256 of the raw token
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?   @db.Uuid
  createdAt    DateTime  @default(now())
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([familyId])
}

model Habit {
  id            String    @id @default(uuid()) @db.Uuid
  userId        String    @db.Uuid
  name          String    @db.VarChar(60)
  schedule      Json                          // validated with zod on every read and write
  time          String    @db.VarChar(5)
  remind        Boolean   @default(true)
  createdDayKey String    @db.VarChar(10)
  archived      Boolean   @default(false)
  order         Int       @default(0)
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  logs          Log[]
  snooze        Snooze?
  reminders     ReminderOccurrence[]
  @@index([userId, deletedAt, archived])
}

model Log {
  habitId   String    @db.Uuid
  userId    String    @db.Uuid               // denormalized for fast range queries
  dayKey    String    @db.VarChar(10)
  status    LogStatus
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  habit     Habit     @relation(fields: [habitId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([habitId, dayKey])
  @@index([userId, dayKey])
}

model Snooze {
  habitId String   @id @db.Uuid
  userId  String   @db.Uuid
  dayKey  String   @db.VarChar(10)
  until   DateTime
  habit   Habit    @relation(fields: [habitId], references: [id], onDelete: Cascade)
}

model PushSubscription {
  id            String    @id @default(uuid()) @db.Uuid
  userId        String    @db.Uuid
  endpoint      String    @unique
  p256dh        String
  auth          String
  userAgent     String?
  failureCount  Int       @default(0)
  lastSuccessAt DateTime?
  createdAt     DateTime  @default(now())
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model ReminderOccurrence {
  id        String         @id @default(uuid()) @db.Uuid
  userId    String         @db.Uuid
  habitId   String         @db.Uuid
  dayKey    String         @db.VarChar(10)
  fireAt    DateTime
  status    ReminderStatus @default(pending)
  sentAt    DateTime?
  createdAt DateTime       @default(now())
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  habit     Habit          @relation(fields: [habitId], references: [id], onDelete: Cascade)
  @@unique([habitId, dayKey])
  @@index([status, fireAt])
  @@index([userId, status])
}

model PasswordResetToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Query rules:
- Every query on user-owned data filters by `userId` in the repository layer. There is no repository method that loads a habit by `id` alone.
- Use `select` to return only needed columns. No N+1 loops: load logs for a date range in one query.
- Range queries on logs are capped at 400 days.

---

## 9. REST API

Base path `/api`. JSON only. Error shape for every non-2xx response:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable", "details": [] } }
```
Codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `NOT_FOUND` 404, `CONFLICT` 409, `UNPROCESSABLE` 422, `RATE_LIMITED` 429, `INTERNAL` 500. Accessing another user's resource returns **404**, never 403. Stack traces never leave the server.

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ email, password (min 10), name, timeZone }` → `{ accessToken, me }` + refresh cookie |
| POST | `/auth/login` | Same response. Generic "Invalid email or password" message |
| POST | `/auth/refresh` | Uses cookie. Rotates token. Returns `{ accessToken, me }` |
| POST | `/auth/logout` | Revokes the current token family, clears cookie. 204 |
| POST | `/auth/forgot-password` | `{ email }` → always 204; enqueues `send-email` job if the user exists |
| POST | `/auth/reset-password` | `{ token, password }` → revokes all refresh tokens for the user |

Token rules:
- Access token: JWT HS256, 15 minutes, payload `{ sub, iat, exp }` only. Sent as `Authorization: Bearer`.
- Refresh token: 256-bit random, 30 days, cookie `beta_rt`, `httpOnly`, `Secure` (in production), `SameSite=Strict`, `Path=/api/auth`. Stored hashed.
- **Rotation with reuse detection:** each refresh revokes the old token and issues a new one in the same family. Presenting an already-revoked token revokes the **entire family** and returns 401.
- `/auth/refresh` and `/auth/logout` also require header `X-Requested-With: beta` (CSRF defense in depth).
- Rate limits (Redis): login and register 5 per minute per IP+email; forgot-password 3 per hour per IP; global 300 per minute per user.

### Account
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | `MeDTO` |
| PATCH | `/me` | `{ name?, timeZone?, weekStart?, onboarded? }`; timezone or weekStart change emits `user.scheduleChanged` |
| DELETE | `/me` | `{ password }` confirmation; cascades; 204 |

### Habits, logs, snoozes
| Method | Path | Notes |
|---|---|---|
| GET | `/habits` | Live habits (including archived, flagged), ordered |
| POST | `/habits` | Create; `createdDayKey` = today in user's timezone (server sets it) |
| PATCH | `/habits/:id` | Partial update, including `archived` and `order` |
| DELETE | `/habits/:id` | Soft delete (`deletedAt`); 204 |
| PUT | `/habits/:id/logs/:dayKey` | `{ status }`; idempotent upsert; validates backfill window and that the day is scheduled; clears snooze for that day |
| DELETE | `/habits/:id/logs/:dayKey` | Idempotent; 204 |
| PUT | `/habits/:id/snooze` | `{ minutes: 15 \| 60 \| 180 }` → `SnoozeDTO` |
| DELETE | `/habits/:id/snooze` | 204 |
| GET | `/logs?from=&to=&habitId=` | Range ≤ 400 days |

Every mutation above emits a domain event (`habit.changed`, `log.changed`, `snooze.changed`).

### Read models
| Method | Path | Notes |
|---|---|---|
| GET | `/today` | `{ serverNow, dayKey, timeZone, weekStart, habits: HabitDTO[], logs: LogDTO[] (today + this week), snoozes: SnoozeDTO[] }`. The client computes sections with `packages/core` so overdue states stay live between fetches |
| GET | `/stats?range=7\|30\|90` | Overall accuracy + per-habit current streak, best streak, 30-day accuracy, last 30 days statuses. **Redis-cached** (see below) |

**Stats cache:** key `stats:v1:{userId}:{dayKey}:{range}`, TTL 1 hour. On `habit.changed` or `log.changed`, delete keys matching `stats:v1:{userId}:*` using a per-user key set (`stats:keys:{userId}`), never `KEYS`. Response header `X-Cache: HIT|MISS`.

### Push, export, health, docs
| Method | Path | Notes |
|---|---|---|
| GET | `/push/vapid-public-key` | Public |
| POST | `/push/subscriptions` | Upsert by endpoint |
| DELETE | `/push/subscriptions` | `{ endpoint }` |
| POST | `/push/test` | Sends a test notification to the caller's subscriptions |
| GET | `/export` | JSON download `{ app, schemaVersion: 1, exportedAt, me, habits, logs }` |
| POST | `/import` | Validate, then **replace** all habits and logs in one transaction |
| GET | `/health` | Checks Postgres and Redis; 200 or 503. Public |
| GET | `/docs` | Swagger UI from the generated OpenAPI document (disabled in production unless `DOCS_ENABLED=true`) |

### Middleware order
`requestId` → `pino-http` → `helmet` → `express.json({ limit: '100kb' })` → `cookieParser` → global rate limit → routes (with `authenticate` and `validate({ body, params, query })` per route) → 404 handler → error handler.

---

## 10. Reminders (event-driven + job queues)

### Data flow
1. A service mutation emits a domain event on the `EventBus` (`habit.changed`, `log.changed`, `snooze.changed`, `user.scheduleChanged`).
2. The event handler enqueues a BullMQ job `reschedule-user` with `jobId = reschedule:{userId}` and a 2-second delay, so bursts of taps collapse into one job.
3. **`reschedule-user` worker:** in one transaction, delete the user's `pending` occurrences, compute the plan with `packages/core/reminderPlan.ts` for the next 48 hours, and insert occurrences. Logged days, past times, met `timesPerWeek` targets, archived/deleted habits, and `remind: false` habits are excluded; an active snooze replaces that day's `fireAt`.
4. **`dispatch-reminders` worker:** a repeatable job every minute. Claims due rows atomically:
   ```sql
   UPDATE "ReminderOccurrence" SET status = 'sent', "sentAt" = now()
   WHERE id IN (
     SELECT id FROM "ReminderOccurrence"
     WHERE status = 'pending' AND "fireAt" <= now()
     ORDER BY "fireAt" LIMIT 200
     FOR UPDATE SKIP LOCKED
   ) RETURNING *;
   ```
   Then re-checks that the habit is still unlogged for that day (skip sending if logged) and sends Web Push to all the user's subscriptions. Push responses `404`/`410` delete the subscription; other failures increment `failureCount`; delete at 5 consecutive failures.
5. **`extend-windows` worker:** repeatable hourly job that enqueues `reschedule-user` for users with reminder-enabled habits, in batches of 500 users.
6. Occurrences with `fireAt` more than 2 hours in the past when claimed are marked `cancelled` instead of sent (the host was asleep; stale reminders are noise).

**Delivery guarantee (document in README):** at-most-once. A crash after claiming but before sending loses that reminder; this is preferred over duplicate notifications.

### Notification payload
`{ title: habit name, body: "Due now" or "Snoozed reminder", url: "/", tag: "habit:{habitId}:{dayKey}" }`. Using `tag` makes a repeat replace rather than stack.

### Web client
- Minimal service worker `apps/web/src/sw/sw.ts`: handles `push` (show notification) and `notificationclick` (focus or open `/`). **No offline caching.**
- Ask for notification permission **after the user saves their first habit with reminders on**, from an in-app prompt, never on page load.
- Settings shows permission status, a "Send test notification" button, and platform notes: on iPhone, Web Push works only after adding Beta to the Home Screen.
- While the tab is open, a 30-second clock tick also shows in-app toasts for newly due items.

### Worker process
`ROLE=api | worker | all`. Docker Compose runs `api` and `worker` separately. The production free-tier deploy runs `all` in one container.

---

## 11. Web client

### Routing
Public: `/login`, `/register`, `/forgot`, `/reset?token=`. Authenticated: `/onboarding`, `/` (Today), `/calendar`, `/stats`, `/settings`, `/habits/new` and `/habits/:id` (modal routes). Unonboarded users are redirected to `/onboarding`.

### Auth handling
- Access token held **in memory only** (never `localStorage`).
- On app load, call `/auth/refresh` once to restore the session.
- API client: on `401`, perform a **single-flight** refresh (concurrent requests wait for the same refresh promise), retry once, and on second failure redirect to `/login`.

### React Query
- Query key factory in `api/keys.ts` (`['today']`, `['stats', range]`, `['logs', from, to, habitId]`, `['habits']`, `['me']`).
- **Log, skip, clear, snooze mutations are optimistic:** `onMutate` cancels `['today']`, snapshots it, applies the change; `onError` restores the snapshot and shows an error toast; `onSettled` invalidates `['today']` and `['stats']`.
- Undo sends the inverse mutation with the previous status, through the same optimistic path.
- `staleTime` 30 seconds for `today`; refetch on window focus.

### Screens
- **Onboarding:** name, timezone (preselected from the browser, searchable picker), week start. Saves via `PATCH /me` with `onboarded: true`.
- **Today:** Section 4 layout. Clock and countdowns tick every 30 seconds using core time functions and the user's timezone.
- **Habit form:** name, schedule (Daily / Weekdays / Times per week), weekday chips or count stepper, time, reminder toggle; zod validation with inline errors. Edit adds Archive and Delete (with confirmation).
- **Calendar:** Day / Month / Year segmented control (default Month), habit filter. Month cells shaded by done/scheduled; tap → Day view with editable statuses (backfill rules). Year view is a 53-week grid aligned to `weekStart`.
- **Stats:** 7/30/90-day overall accuracy; per habit current streak, best streak, 30-day accuracy, 30-day dot strip.
- **Settings (auto-save, debounced 500ms):** name, timezone, week start, notifications (status, enable, test), export, import (confirm replace), sign out, delete account (password confirmation).

---

## 12. Security checklist (each item has a test or a documented check)

- [ ] All input validated with zod at the route boundary (body, params, query); unknown body fields rejected.
- [ ] Authorization: every repository query scoped by `userId`; IDOR tests for each resource type.
- [ ] Passwords hashed with argon2id; login responses don't reveal whether an email exists.
- [ ] Refresh token rotation with reuse detection; reset-password revokes all sessions.
- [ ] Cookies `httpOnly`, `Secure` in production, `SameSite=Strict`, narrow `Path`.
- [ ] Rate limiting on auth routes and globally, backed by Redis.
- [ ] `helmet` enabled with a Content Security Policy compatible with the built web app.
- [ ] Body size limit; generic 500 responses; no stack traces in production.
- [ ] Secrets only from environment, validated at startup; `.env` never committed; `.env.example` provided.
- [ ] Prisma parameterized queries only; the single raw query (reminder claim) uses `$queryRaw` tagged templates.
- [ ] `pnpm audit --prod` runs in CI (report only, non-blocking).

---

## 13. Tooling, tests, and CI

### Scripts (root `package.json`)
```json
{
  "dev": "docker compose up",
  "typecheck": "pnpm -r typecheck",
  "lint": "eslint .",
  "test": "pnpm --filter core test && pnpm --filter web test && pnpm --filter api test",
  "check": "pnpm typecheck && pnpm lint && pnpm test"
}
```
`apps/api` test script: `ts-mocha -p tsconfig.test.json 'test/**/*.test.ts' --timeout 10000 --exit`, run after `prisma migrate reset --force --skip-seed` against `DATABASE_URL_TEST`.

### ESLint guards
- **Date guard** (`no-restricted-syntax`, all files except `packages/core/src/time.ts` and test files): ban `new Date(...)` with arguments, `Date.parse`, and calls to `getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds`, their `set*` equivalents, `toLocaleDateString`, `toLocaleTimeString`, `getTimezoneOffset`. Message: "Use packages/core time.ts — see SPEC.md §7." Escape hatch: `// eslint-disable-next-line no-restricted-syntax -- time-ok: <reason>`. Exception: API code may call `new Date(ms)` only to pass instants to Prisma, via a helper `toDbInstant(ms)` in `apps/api/src/lib/instant.ts` (the helper file is also exempt).
- **Layering guard** (`no-restricted-imports`): files in `controller.ts` may not import `@prisma/client`; `packages/core` may not import from `apps/*`, `express`, `react`, or `@prisma/client`.
- `packages/core/test/guard.test.ts` runs ESLint programmatically on fixtures to prove both guards work.

### Core tests (Vitest)
`time`, `rules` (every §6 rule), `metrics` (streaks, best streak, accuracy incl. `null`), `reminderPlan` (48h window, exclusions, snooze replacement, DST due times, timezone change), `coachContext` (M12).

### API tests (ts-mocha + chai + supertest; real Postgres + Redis; `FixedClock`, `FakePushSender`, `FakeMailer`)
- **Auth:** register/login/refresh/logout; wrong password; duplicate email 409; refresh rotation; **reuse of a rotated token revokes the family**; reset-password flow revokes sessions; rate limit returns 429.
- **Authorization:** user B gets 404 on user A's habit, log, snooze, and push subscription routes.
- **Validation:** bad `dayKey`, bad `time`, weekdays empty, unknown fields → 400 with error shape.
- **Logs:** PUT is idempotent; future day 422; unscheduled weekday 422; before `createdDayKey` 422; complete clears snooze.
- **Today:** correct payload for a user in `Pacific/Kiritimati` vs `America/Los_Angeles` at the same fixed instant.
- **Stats cache:** first call `MISS`, second `HIT`, after a log change `MISS` again, values correct.
- **Reminders:** mutation enqueues one deduplicated `reschedule-user` job for a burst of 5 taps; reschedule output matches the core plan; dispatcher sends once for a due row; two dispatchers running concurrently never send the same occurrence twice; logged-after-planning occurrence is not sent; 410 response deletes the subscription; stale occurrence is cancelled.
- **Import/export:** round trip equality; invalid file 400; import is atomic (a failure mid-way leaves data unchanged).

### Web tests (Vitest + Testing Library + MSW; fixed clock)
- Today renders sections correctly for a fixture at a fixed time.
- **Complete is optimistic:** row moves to Done immediately; with MSW returning 500 it moves back and an error toast appears.
- Undo restores the previous state.
- Snooze tap vs long-press sheet.
- Habit form validation messages and successful submit.
- Auth client: two concurrent 401s trigger exactly one refresh request.
- Onboarding redirect for unonboarded users.

### CI (`.github/workflows/ci.yml`)
On push and pull request:
1. **lint-typecheck:** pnpm install (cached), `pnpm typecheck`, `pnpm lint`.
2. **test-core-web:** Vitest for core and web, upload coverage artifact.
3. **test-api:** service containers `postgres:16` and `redis:7` with health checks, `prisma migrate deploy`, ts-mocha, upload a JUnit report artifact.
4. **docker-build:** build the production image (no push).
5. **audit:** `pnpm audit --prod` (non-blocking).

### Docker
- `docker-compose.yml`: `postgres`, `redis`, `api` (ROLE=api, watch mode), `worker` (ROLE=worker), `web` (Vite dev server proxying `/api` to `api`). Named volume for Postgres. Health checks.
- `Dockerfile`: multi-stage; builds core, web, and api; final image runs `node dist/server.js` with `ROLE=all`, serves `apps/web/dist` as static files with SPA fallback, runs as non-root user.
- Same-origin deployment means no CORS configuration and first-party cookies.

---

## 14. Manual setup (developer does these; Claude Code stops and lists them when reached)

**Before M3:** install Docker Desktop and pnpm; `cp .env.example .env`.
**Before M9:** generate VAPID keys with `npx web-push generate-vapid-keys`; add to `.env`.
**Before M10:** create a free Resend account and API key; verify a sender domain or use Resend's test sender for development.
**Before M11:**
1. Create a free Neon Postgres database; set `DATABASE_URL`.
2. Create a free Upstash Redis database; set `REDIS_URL`. **Check current free-tier command limits**: BullMQ polls Redis continuously and can exhaust a small quota. If it does, run Redis on the same host as the app instead.
3. Pick a free container host that runs a Docker image; check current free-tier terms. Note in the README that a sleeping free instance delays reminders.
4. Set production secrets: `JWT_SECRET` (32+ random bytes), `DATABASE_URL`, `REDIS_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `RESEND_API_KEY`, `APP_URL`.
5. In GitHub, protect `main`: require pull requests and passing CI.
**Before M12 (optional):** create a free Gemini API key and read its free-tier data terms.

---

## 15. Milestones

Each ends with `pnpm check` green, a branch, and a printed PR description.

| # | Title | Acceptance criteria |
|---|---|---|
| M0 | Monorepo scaffold | pnpm workspaces, TS project refs, ESLint + Prettier, Vitest in core, Docker Compose with Postgres + Redis healthy, CI skeleton (lint + typecheck) passing, PR template, `.nvmrc`. |
| M1 | Time engine | `time.ts`, `timeSelfCheck.ts`, full time tests, date guard + guard test. |
| M2 | Domain logic | `types.ts`, `schemas.ts`, `rules.ts`, `metrics.ts`, `reminderPlan.ts` + tests for every §6 rule. |
| M3 | API foundation | `createApp(deps)` DI, zod config, pino with request IDs, error handler + error shape, `/health`, Prisma schema + first migration, OpenAPI + `/docs`, ts-mocha harness with test DB and fakes, CI `test-api` job with service containers. |
| M4 | Auth | All auth + `/me` endpoints, argon2, JWT, refresh rotation + reuse detection, rate limits, full auth tests. |
| M5 | Habits, logs, snoozes, today | All §9 habit/log/snooze/today/logs routes with layering, authorization, validation, domain events, IDOR tests. |
| M6 | Web foundation | Vite + React 18 + Router + React Query + Tailwind + shadcn/ui with tokens and fonts; API client with single-flight refresh; login, register, onboarding; route guards; web tests for auth client and redirect. |
| M7 | Today & habit form | Today per §4 with live clock, optimistic mutations + rollback, undo, snooze tap and sheet, habit create/edit/archive/delete; web tests. |
| M8 | Calendar & stats | Calendar views + backfill; `/stats` with Redis cache + invalidation; Stats screen; API cache tests and web tests. |
| M9 | Reminders | Event bus → BullMQ `reschedule-user` (deduped), `dispatch-reminders` with `SKIP LOCKED`, `extend-windows`; push subscription endpoints; service worker; permission flow; Settings notification section; all reminder tests. Manually verified in Chrome: a reminder arrives within a minute of its time, snooze works, completing before due time prevents it. |
| M10 | Settings, export/import, email | Settings screen with auto-save, export/import (atomic), forgot/reset password via `send-email` queue job, delete account; tests. |
| M11 | Production & docs | Production Dockerfile, `ROLE=all`, same-origin static serving, deploy, CI `docker-build` + `audit` jobs, README with Mermaid architecture diagram, API overview link, local setup in under 5 commands, design decisions (auth, reminders, caching, time engine), known limitations, and the Section 17 skills map. |
| M12 | AI coach (optional) | `POST /api/coach` with Redis rate limit (20/day per user), request validation, context built server-side from an allowlist in `packages/core/coachContext.ts` (no email, name, timezone name, or exact dates), provider adapter behind an interface with `FakeCoachProvider` in tests, canary test that forbidden values never reach the prompt, simple chat screen. |

---

## 16. Out of scope (do not build)

- React Native / Expo mobile app
- Offline-first storage or client-side sync
- MongoDB, GraphQL, AngularJS, Elasticsearch
- Microservices, Kubernetes, message brokers other than Redis/BullMQ
- OAuth / Google sign-in, email verification, 2FA
- Payments, membership tiers
- Workout planner, health dashboard, body profile, achievements
- Stopwatch, session timers, duration tracking
- Playwright or other end-to-end browser tests
- Light theme, i18n, social or sharing features
- Offline caching in the service worker

List these as "Future work" in the README.

---

## 17. Skills map (put this table in the README)

| Job requirement | Where it's demonstrated |
|---|---|
| Full-stack features, React 18 + Node/TypeScript Express | `apps/web`, `apps/api`, shared `packages/core` |
| RESTful API design, consumed with React Query | §9 routes, OpenAPI at `/api/docs`, optimistic mutations in `apps/web/src/api` |
| Postgres + Prisma, efficient queries and data models | `schema.prisma`, composite keys and indexes, range queries, `SKIP LOCKED` claim |
| Redis caching | Stats cache with targeted invalidation and `X-Cache` header |
| Mocha/ts-mocha API tests, Vitest + Testing Library web tests | `apps/api/test`, `apps/web/src/**/*.test.tsx` |
| Code reviews, agile workflow | Milestone branches, PR template, Conventional Commits, GitHub Projects board |
| Dependency injection | `createApp(deps)` composition root with swappable fakes |
| Event-driven patterns, job queues | Domain events → BullMQ reschedule, dispatch, and email workers |
| Secure coding (validation, authN/authZ, OWASP) | §12 checklist, refresh-token reuse detection, IDOR tests, rate limits |
| CI/CD, reading build reports | GitHub Actions with service containers, JUnit and coverage artifacts |
| Docker and cloud service dependencies | Docker Compose (Postgres, Redis), production image, Neon + Upstash |