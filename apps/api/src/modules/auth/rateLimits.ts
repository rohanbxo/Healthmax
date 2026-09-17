/**
 * Auth rate limits (SPEC.md §9 "Rate limits", §12).
 *
 * Counters live in Redis, so they hold across processes and survive a restart.
 * Each limiter gets its own `prefix`, which `createRateLimiter` turns into a
 * `rl:<prefix>:` Redis key namespace — login, register, forgot-password and the
 * global limiter can never share a counter. The test harness additionally runs
 * against its own Redis logical database and flushes it between cases
 * (`test/helpers/db.ts`), so keys cannot leak from one test into the next.
 */
import { ipKeyGenerator } from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { createRateLimiter } from '../../http/rateLimit';

/** SPEC.md §9: "login and register 5 per minute per IP+email". */
export const AUTH_ATTEMPT_RATE_LIMIT = { windowMs: 60_000, limit: 5 } as const;

/** SPEC.md §9: "forgot-password 3 per hour per IP". */
export const FORGOT_PASSWORD_RATE_LIMIT = { windowMs: 60 * 60_000, limit: 3 } as const;

/**
 * The email as the client sent it, normalised. Read from the raw body because
 * the limiter runs before `validate()` — an invalid body must still be counted,
 * otherwise the limit is trivially bypassed by sending junk.
 */
function emailKeyPart(req: Request): string {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return '-';
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== 'string') return '-';
  const normalised = email.trim().toLowerCase();
  return normalised === '' ? '-' : normalised.slice(0, 254);
}

/**
 * `ip:<normalised ip>|<email>` — one counter per credential pair, so a shared
 * NAT cannot lock out every user behind it, and spraying one address from one
 * host is still capped. `ipKeyGenerator` collapses an IPv6 address to its /64.
 */
export function ipAndEmailKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? '')}|${emailKeyPart(req)}`;
}

/** `ip:<normalised ip>` — forgot-password takes no credential to key on. */
export function ipOnlyKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again in a minute.';

export function loginRateLimit(redis: Redis): RateLimitRequestHandler {
  return createRateLimiter(redis, {
    prefix: 'auth-login',
    ...AUTH_ATTEMPT_RATE_LIMIT,
    keyGenerator: ipAndEmailKey,
    message: TOO_MANY_ATTEMPTS,
  });
}

export function registerRateLimit(redis: Redis): RateLimitRequestHandler {
  return createRateLimiter(redis, {
    prefix: 'auth-register',
    ...AUTH_ATTEMPT_RATE_LIMIT,
    keyGenerator: ipAndEmailKey,
    message: TOO_MANY_ATTEMPTS,
  });
}

export function forgotPasswordRateLimit(redis: Redis): RateLimitRequestHandler {
  return createRateLimiter(redis, {
    prefix: 'auth-forgot',
    ...FORGOT_PASSWORD_RATE_LIMIT,
    keyGenerator: ipOnlyKey,
    message: 'Too many password reset requests. Try again later.',
  });
}
