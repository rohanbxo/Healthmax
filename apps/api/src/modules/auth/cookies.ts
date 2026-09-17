/**
 * The refresh cookie (SPEC.md §9, §12 "Cookies").
 *
 * `beta_rt`, `httpOnly`, `Secure` in production, `SameSite=Strict`, and scoped
 * to `Path=/api/auth` so it is never attached to ordinary API calls — only the
 * four auth endpoints that actually need it ever see it.
 */
import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_TOKEN_TTL_MS } from './tokens';

export const REFRESH_COOKIE_NAME = 'beta_rt';

/** Must match where the auth router is mounted (`/api` + `/auth`). */
export const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * `Secure` would make the cookie invisible over plain `http://localhost`, so it
 * follows `NODE_ENV` exactly as SPEC.md §12 specifies.
 */
export function refreshCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, token: string, isProduction: boolean): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieOptions(isProduction),
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

/** Clearing must repeat the attributes, or the browser keeps the original. */
export function clearRefreshCookie(res: Response, isProduction: boolean): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(isProduction));
}

/** `cookie-parser` hands back `unknown` values; only a string is a token. */
export function readRefreshCookie(req: Request): string | undefined {
  const jar: unknown = req.cookies;
  if (typeof jar !== 'object' || jar === null) return undefined;
  const raw = (jar as Record<string, unknown>)[REFRESH_COOKIE_NAME];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}
