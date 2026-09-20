/**
 * MSW 2 handlers for the endpoints M6 talks to (SPEC.md §9): `/api/auth/*`,
 * `/api/me` and `/api/today`.
 *
 * The handlers model the real token rules closely enough to exercise the
 * client: a protected route only accepts the session's *current* access token,
 * and every refresh rotates it. That is what makes the single-flight test
 * meaningful — a stale token really does produce a 401.
 *
 * `mswState` counts calls and records the last request body; `resetMswState`,
 * `signInMswUser` and `failNextRefresh` are the knobs tests turn.
 */
import { HttpResponse, delay, http } from 'msw';
import type {
  ApiErrorCode,
  HabitDTO,
  LogDTO,
  LogStatus,
  MeDTO,
  StatsDTO,
  TodayDTO,
} from '@beta/core';

export const VALID_PASSWORD = 'correct-horse-battery';
export const USER_ID = '0b6a6d8c-2f1a-4c3e-9b7a-1d2e3f4a5b6c';

export function makeMe(overrides: Partial<MeDTO> = {}): MeDTO {
  return {
    id: USER_ID,
    email: 'rider@example.com',
    name: 'Rider',
    timeZone: 'Asia/Dubai',
    weekStart: 1,
    onboarded: true,
    ...overrides,
  };
}

export function makeToday(overrides: Partial<TodayDTO> = {}): TodayDTO {
  return {
    serverNow: '2026-09-17T03:12:00.000Z',
    dayKey: '2026-09-17',
    timeZone: 'Asia/Dubai',
    weekStart: 1,
    habits: [],
    logs: [],
    snoozes: [],
    ...overrides,
  };
}

export type MswState = {
  /** `null` means "no refresh cookie": refresh answers 401. */
  session: { me: MeDTO; accessToken: string } | null;
  refreshCalls: number;
  meCalls: number;
  todayCalls: number;
  loginCalls: number;
  registerCalls: number;
  logoutCalls: number;
  patchMeCalls: number;
  forgotCalls: number;
  resetCalls: number;
  lastPatchMeBody: unknown;
  /** Force the next refresh (and every one after) to fail. */
  refreshFails: boolean;
  /** Force login to answer 401 whatever the password. */
  loginFails: boolean;
  tokenSeq: number;
  /** M7: what `GET /today` serves. `null` keeps the M6 empty default. */
  today: TodayDTO | null;
  /** M7: what `GET /habits` serves, and what the habit writes mutate. */
  habits: HabitDTO[];
  /** M7: every write the client made, oldest first — the undo assertions read this. */
  requests: RecordedRequest[];
  habitSeq: number;
  /** M8: what `GET /logs` filters by range; the log writes mutate it too. */
  logs: LogDTO[];
  /** M8: what `GET /stats` serves, per range. A missing range answers 404. */
  stats: Partial<Record<number, StatsDTO>>;
  /** M8: every `range` `GET /stats` was asked for, in order. */
  statsRanges: number[];
  /** M9: `null` makes the VAPID key 404, as an unconfigured server does. */
  vapidPublicKey: string | null;
  /** M9: what `POST /push/subscriptions` has registered. */
  pushSubscriptions: PushSubscriptionRecord[];
};

/** A subscription as the client sends it (SPEC.md §9 "Push"). */
export type PushSubscriptionRecord = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

/** One write the client sent, as the tests want to assert on it. */
export type RecordedRequest = {
  method: string;
  /** Path without the `/api` prefix, e.g. '/habits/abc/logs/2026-09-17'. */
  path: string;
  body: unknown;
};

function initialState(): MswState {
  return {
    session: null,
    refreshCalls: 0,
    meCalls: 0,
    todayCalls: 0,
    loginCalls: 0,
    registerCalls: 0,
    logoutCalls: 0,
    patchMeCalls: 0,
    forgotCalls: 0,
    resetCalls: 0,
    lastPatchMeBody: null,
    refreshFails: false,
    loginFails: false,
    tokenSeq: 0,
    today: null,
    habits: [],
    requests: [],
    habitSeq: 0,
    logs: [],
    stats: {},
    statsRanges: [],
    vapidPublicKey: 'BPtestVapidPublicKey_-0123456789',
    pushSubscriptions: [],
  };
}

export const mswState: MswState = initialState();

export function resetMswState(): void {
  Object.assign(mswState, initialState());
}

/** Serve a fixture from `GET /today` (M7). */
export function setMswToday(today: TodayDTO): void {
  mswState.today = today;
}

/** Serve a fixture from `GET /habits` (M7). */
export function setMswHabits(habits: HabitDTO[]): void {
  mswState.habits = habits;
}

/** Serve these logs from `GET /logs` (M8). */
export function setMswLogs(logs: LogDTO[]): void {
  mswState.logs = logs;
}

/** Serve a fixture from `GET /stats?range=` (M8). */
export function setMswStats(stats: StatsDTO): void {
  mswState.stats[stats.range] = stats;
}

/** Every write the client sent, in order. */
export function recordedRequests(): RecordedRequest[] {
  return mswState.requests;
}

function record(request: Request, body: unknown): void {
  const { pathname } = new URL(request.url);
  mswState.requests.push({
    method: request.method,
    path: pathname.replace(/^\/api/, ''),
    body,
  });
}

/**
 * The log and snooze writes mutate the served `/today` fixture, so the refetch
 * `onSettled` triggers agrees with the optimistic patch instead of undoing it.
 */
function applyLogWrite(habitId: string, dayKey: string, status: LogStatus | null): void {
  mswState.logs = mswState.logs.filter((log) => log.habitId !== habitId || log.dayKey !== dayKey);
  if (status !== null) mswState.logs.push({ habitId, dayKey, status });

  const today = mswState.today;
  if (today === null) return;

  today.logs = today.logs.filter((log) => log.habitId !== habitId || log.dayKey !== dayKey);
  if (status !== null) {
    today.logs.push({ habitId, dayKey, status });
    // SPEC §6: completing or skipping clears that day's snooze.
    today.snoozes = today.snoozes.filter((snooze) => snooze.habitId !== habitId);
  }
}

function applySnoozeWrite(habitId: string, minutes: number | null): void {
  const today = mswState.today;
  if (today === null) return;

  today.snoozes = today.snoozes.filter((snooze) => snooze.habitId !== habitId);
  if (minutes !== null) {
    today.snoozes.push({
      habitId,
      dayKey: today.dayKey,
      until: new Date(Date.now() + minutes * 60_000).toISOString(),
    });
  }
}

async function recordJson(request: Request): Promise<unknown> {
  const body: unknown = await request.json();
  record(request, body);
  return body;
}

/** Give the browser a refresh cookie: refresh and protected routes now work. */
export function signInMswUser(overrides: Partial<MeDTO> = {}): { me: MeDTO; accessToken: string } {
  mswState.tokenSeq += 1;
  const session = { me: makeMe(overrides), accessToken: `access-${mswState.tokenSeq}` };
  mswState.session = session;
  return session;
}

/** Rotate the server-side token so whatever the client holds is now stale. */
export function expireAccessToken(): void {
  if (!mswState.session) return;
  mswState.tokenSeq += 1;
  mswState.session.accessToken = `access-${mswState.tokenSeq}`;
}

export function failRefresh(enabled = true): void {
  mswState.refreshFails = enabled;
}

export function failLogin(enabled = true): void {
  mswState.loginFails = enabled;
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** The SPEC §9 error envelope, so the client parses a real error shape. */
export function apiError(code: ApiErrorCode, message: string, details: unknown[] = []) {
  return HttpResponse.json({ error: { code, message, details } }, { status: STATUS_BY_CODE[code] });
}

function requireBearer(request: Request): Response | null {
  const session = mswState.session;
  const header = request.headers.get('authorization');
  if (!session || header !== `Bearer ${session.accessToken}`) {
    return apiError('UNAUTHENTICATED', 'Missing or expired access token');
  }
  return null;
}

function requireCsrf(request: Request): Response | null {
  if (request.headers.get('x-requested-with') !== 'beta') {
    return apiError('VALIDATION_ERROR', 'Missing X-Requested-With header');
  }
  return null;
}

export const handlers = [
  http.post('/api/auth/refresh', async ({ request }) => {
    mswState.refreshCalls += 1;

    const csrf = requireCsrf(request);
    if (csrf) return csrf;

    // A real refresh round trip is not instant; the delay makes concurrent
    // callers genuinely overlap.
    await delay(10);

    if (mswState.refreshFails || !mswState.session) {
      return apiError('UNAUTHENTICATED', 'Session expired');
    }

    mswState.tokenSeq += 1;
    mswState.session.accessToken = `access-${mswState.tokenSeq}`;
    return HttpResponse.json({
      accessToken: mswState.session.accessToken,
      me: mswState.session.me,
    });
  }),

  http.post('/api/auth/login', async ({ request }) => {
    mswState.loginCalls += 1;
    const body = (await request.json()) as { email: string; password: string };

    if (mswState.loginFails || body.password !== VALID_PASSWORD) {
      return apiError('UNAUTHENTICATED', 'Invalid email or password');
    }

    const session = signInMswUser({ email: body.email });
    return HttpResponse.json({ accessToken: session.accessToken, me: session.me });
  }),

  http.post('/api/auth/register', async ({ request }) => {
    mswState.registerCalls += 1;
    const body = (await request.json()) as { email: string; name: string; timeZone: string };

    const session = signInMswUser({
      email: body.email,
      name: body.name,
      timeZone: body.timeZone,
      onboarded: false,
    });
    return HttpResponse.json({ accessToken: session.accessToken, me: session.me }, { status: 201 });
  }),

  http.post('/api/auth/logout', ({ request }) => {
    mswState.logoutCalls += 1;
    const csrf = requireCsrf(request);
    if (csrf) return csrf;

    mswState.session = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/auth/forgot-password', () => {
    mswState.forgotCalls += 1;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/auth/reset-password', () => {
    mswState.resetCalls += 1;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/me', ({ request }) => {
    mswState.meCalls += 1;
    const denied = requireBearer(request);
    if (denied) return denied;
    return HttpResponse.json(mswState.session?.me);
  }),

  http.patch('/api/me', async ({ request }) => {
    mswState.patchMeCalls += 1;
    const denied = requireBearer(request);
    if (denied) return denied;

    const body = (await request.json()) as Partial<MeDTO>;
    mswState.lastPatchMeBody = body;

    const session = mswState.session;
    if (!session) return apiError('UNAUTHENTICATED', 'Session expired');

    session.me = { ...session.me, ...body };
    return HttpResponse.json(session.me);
  }),

  http.get('/api/today', ({ request }) => {
    mswState.todayCalls += 1;
    const denied = requireBearer(request);
    if (denied) return denied;
    if (mswState.today !== null) return HttpResponse.json(mswState.today);
    const timeZone = mswState.session?.me.timeZone;
    return HttpResponse.json(timeZone ? makeToday({ timeZone }) : makeToday());
  }),

  /* ------------------------------------------------- M7: habits and logs */

  http.get('/api/habits', ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;
    return HttpResponse.json(mswState.habits);
  }),

  http.post('/api/habits', async ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    const body = (await recordJson(request)) as Partial<HabitDTO>;
    mswState.habitSeq += 1;

    const habit: HabitDTO = {
      id: `00000000-0000-4000-8000-${String(mswState.habitSeq).padStart(12, '0')}`,
      name: body.name ?? 'Untitled',
      schedule: body.schedule ?? { kind: 'daily' },
      time: body.time ?? '07:30',
      remind: body.remind ?? true,
      createdDayKey: mswState.today?.dayKey ?? '2026-09-17',
      archived: false,
      order: mswState.habits.length,
    };
    mswState.habits.push(habit);
    return HttpResponse.json(habit, { status: 201 });
  }),

  http.patch('/api/habits/:id', async ({ request, params }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    const body = (await recordJson(request)) as Partial<HabitDTO>;
    const habit = mswState.habits.find((candidate) => candidate.id === params.id);
    if (!habit) return apiError('NOT_FOUND', 'Unknown habit');

    Object.assign(habit, body);
    return HttpResponse.json(habit);
  }),

  http.delete('/api/habits/:id', ({ request, params }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    record(request, null);
    mswState.habits = mswState.habits.filter((candidate) => candidate.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.put('/api/habits/:id/logs/:dayKey', async ({ request, params }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    const body = (await recordJson(request)) as { status: LogStatus };
    applyLogWrite(String(params.id), String(params.dayKey), body.status);
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('/api/habits/:id/logs/:dayKey', ({ request, params }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    record(request, null);
    applyLogWrite(String(params.id), String(params.dayKey), null);
    return new HttpResponse(null, { status: 204 });
  }),

  http.put('/api/habits/:id/snooze', async ({ request, params }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    const body = (await recordJson(request)) as { minutes: number };
    applySnoozeWrite(String(params.id), body.minutes);
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('/api/habits/:id/snooze', ({ request, params }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    record(request, null);
    applySnoozeWrite(String(params.id), null);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ------------------------------------------------ M8: calendar and stats */

  http.get('/api/logs', ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    // 'YYYY-MM-DD' compares as a calendar day.
    return HttpResponse.json(mswState.logs.filter((log) => log.dayKey >= from && log.dayKey <= to));
  }),

  /* --------------------------------------------------------- M9: push */

  http.get('/api/push/vapid-public-key', () => {
    if (mswState.vapidPublicKey === null) {
      return apiError('NOT_FOUND', 'Push notifications are not configured.');
    }
    return HttpResponse.json({ publicKey: mswState.vapidPublicKey });
  }),

  http.post('/api/push/subscriptions', async ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    mswState.pushSubscriptions.push((await recordJson(request)) as PushSubscriptionRecord);
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('/api/push/subscriptions', async ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    const body = (await recordJson(request)) as { endpoint: string };
    mswState.pushSubscriptions = mswState.pushSubscriptions.filter(
      (subscription) => subscription.endpoint !== body.endpoint,
    );
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/push/test', ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    record(request, null);
    return HttpResponse.json({
      sent: mswState.pushSubscriptions.length,
      removed: 0,
      failed: 0,
    });
  }),

  http.get('/api/stats', ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;

    const range = Number(new URL(request.url).searchParams.get('range') ?? '30');
    mswState.statsRanges.push(range);
    const stats = mswState.stats[range];
    if (stats === undefined) return apiError('NOT_FOUND', `No stats fixture for range ${range}`);
    return HttpResponse.json(stats);
  }),
];
