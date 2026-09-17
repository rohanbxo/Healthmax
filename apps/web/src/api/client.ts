/**
 * The one way the web client talks to the Beta API (SPEC.md §9, §11).
 *
 * Responsibilities, in order:
 *  - attach the in-memory bearer token and the CSRF header the cookie routes
 *    require, and send same-origin credentials so the refresh cookie travels;
 *  - turn the `{ error: { code, message, details } }` envelope into a typed
 *    `ApiError`;
 *  - on `401`, run a **single-flight** refresh (concurrent requests await the
 *    same promise), retry once, and on a second failure end the session;
 *  - in development, parse successful bodies with the shared zod contract and
 *    complain loudly when the API drifts.
 */
import { type ApiErrorCode, type AuthDTO, apiErrorSchema, authDtoSchema } from '@beta/core';
import { clearAccessToken, getAccessToken, setAccessToken } from '@/auth/tokenStore';

/** Every path below is relative to this prefix; Vite proxies it in dev. */
const API_PREFIX = '/api';
/** Only used when there is no `location` (non-browser tooling). */
const FALLBACK_ORIGIN = 'http://localhost';

const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'beta';

export const REFRESH_PATH = '/auth/refresh';
export const LOGOUT_PATH = '/auth/logout';
export const LOGIN_ROUTE = '/login';

/** Cookie-authenticated routes also require the CSRF header (SPEC.md §9). */
const CSRF_PATHS: ReadonlySet<string> = new Set([REFRESH_PATH, LOGOUT_PATH]);

const STATUS_CODES: ReadonlyMap<number, ApiErrorCode> = new Map([
  [400, 'VALIDATION_ERROR'],
  [401, 'UNAUTHENTICATED'],
  [404, 'NOT_FOUND'],
  [409, 'CONFLICT'],
  [422, 'UNPROCESSABLE'],
  [429, 'RATE_LIMITED'],
] as const);

/**
 * A non-2xx response, already unpacked from the SPEC §9 envelope. Screens
 * branch on `code`, never on the message, which is written for humans.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: readonly unknown[];

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details: readonly unknown[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * How the client tells the `AuthProvider` that the session changed underneath
 * it. The provider flips its status and the route guard performs the actual
 * redirect, so navigation stays inside the router.
 */
export type SessionEvents = {
  onRefreshed: (auth: AuthDTO) => void;
  onSignedOut: () => void;
};

let sessionEvents: SessionEvents | null = null;

export function setSessionEvents(events: SessionEvents | null): void {
  sessionEvents = events;
}

/** A dev-only structural view of a zod schema — enough for the drift check. */
export type ResponseSchema = {
  safeParse: (value: unknown) => { success: boolean; error?: unknown };
};

export type ApiQuery = Record<string, string | number | boolean | undefined>;

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: ApiQuery;
  /** Checked against the response in development builds only. */
  schema?: ResponseSchema;
  signal?: AbortSignal;
  /** Auth plumbing opts out so a failing refresh cannot recurse. */
  skipRefresh?: boolean;
};

function currentOrigin(): string {
  return typeof globalThis.location === 'undefined' ? FALLBACK_ORIGIN : globalThis.location.origin;
}

function buildUrl(path: string, query?: ApiQuery): string {
  const url = new URL(`${API_PREFIX}${path}`, currentOrigin());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function warnDrift(path: string, error: unknown): void {
  console.error(
    `[api] ${path} does not match the @beta/core contract - the API has drifted (SPEC.md §5).`,
    error,
  );
}

async function sendRequest(path: string, options: ApiRequestOptions): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });

  const token = getAccessToken();
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  if (CSRF_PATHS.has(path)) headers.set(CSRF_HEADER, CSRF_VALUE);

  const hasBody = options.body !== undefined;
  if (hasBody) headers.set('Content-Type', 'application/json');

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    // The refresh cookie is httpOnly and same-origin; without this it is not sent.
    credentials: 'same-origin',
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
}

async function toApiError(response: Response): Promise<ApiError> {
  let code: ApiErrorCode = STATUS_CODES.get(response.status) ?? 'INTERNAL';
  let message = response.statusText || 'The request failed.';
  let details: readonly unknown[] = [];

  try {
    const payload: unknown = await response.json();
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
      details = parsed.data.error.details ?? [];
    }
  } catch {
    // A non-JSON body (a proxy error page, say) keeps the status-derived code.
  }

  return new ApiError(code, message, response.status, details);
}

async function readBody<TResult>(
  path: string,
  response: Response,
  schema: ResponseSchema | undefined,
): Promise<TResult> {
  if (response.status === 204) return undefined as TResult;

  const text = await response.text();
  if (text.length === 0) return undefined as TResult;

  const payload: unknown = JSON.parse(text);

  if (import.meta.env.DEV && schema) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) warnDrift(path, parsed.error);
  }

  return payload as TResult;
}

/* ---------------------------------------------------- single-flight refresh */

let refreshPromise: Promise<boolean> | null = null;

async function requestRefresh(): Promise<boolean> {
  const response = await sendRequest(REFRESH_PATH, { method: 'POST', skipRefresh: true });
  if (!response.ok) return false;

  const payload: unknown = await response.json();
  const parsed = authDtoSchema.safeParse(payload);
  if (import.meta.env.DEV && !parsed.success) warnDrift(REFRESH_PATH, parsed.error);

  const auth = payload as AuthDTO;
  setAccessToken(auth.accessToken);
  sessionEvents?.onRefreshed(auth);
  return true;
}

/**
 * Restores the session from the refresh cookie. Callers that arrive while a
 * refresh is in flight await the *same* promise, so a burst of 401s produces
 * exactly one `POST /auth/refresh` (SPEC.md §11).
 */
export function refreshSession(): Promise<boolean> {
  if (refreshPromise === null) {
    refreshPromise = requestRefresh()
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Drops the local session. The provider's guard sends the user to /login. */
export function endSession(): void {
  clearAccessToken();
  refreshPromise = null;

  const events = sessionEvents;
  if (events) {
    events.onSignedOut();
    return;
  }

  // No provider mounted (a stray call before hydration): fall back to a hard
  // navigation so the user never sits on a screen that cannot load.
  if (typeof globalThis.location !== 'undefined' && globalThis.location.pathname !== LOGIN_ROUTE) {
    globalThis.location.assign(LOGIN_ROUTE);
  }
}

/** Test seam: forget the token, the in-flight refresh and the listener. */
export function resetSessionState(): void {
  clearAccessToken();
  refreshPromise = null;
  sessionEvents = null;
}

/* -------------------------------------------------------------- the client */

export async function apiFetch<TResult>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResult> {
  let response = await sendRequest(path, options);

  if (response.status === 401 && options.skipRefresh !== true) {
    const refreshed = await refreshSession();

    if (!refreshed) {
      endSession();
      throw await toApiError(response);
    }

    // One retry with the fresh token; a second 401 means the session is gone.
    response = await sendRequest(path, options);
    if (response.status === 401) {
      endSession();
      throw await toApiError(response);
    }
  }

  if (!response.ok) throw await toApiError(response);

  return readBody<TResult>(path, response, options.schema);
}
