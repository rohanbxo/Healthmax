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
import type { ApiErrorCode, MeDTO, TodayDTO } from '@beta/core';

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
  };
}

export const mswState: MswState = initialState();

export function resetMswState(): void {
  Object.assign(mswState, initialState());
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
    const timeZone = mswState.session?.me.timeZone;
    return HttpResponse.json(timeZone ? makeToday({ timeZone }) : makeToday());
  }),

  http.get('/api/habits', ({ request }) => {
    const denied = requireBearer(request);
    if (denied) return denied;
    return HttpResponse.json([]);
  }),
];
