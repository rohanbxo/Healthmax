/**
 * Cloud export rate limit (SPEC.md §9 "Rate limits"). Its own module so both
 * `routes.ts` and `openapi.ts` can read it without importing each other.
 */
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { createRateLimiter } from '../../http/rateLimit';

/**
 * Each cloud export writes an object to the bucket, so it is capped per user
 * far below the global limit.
 */
export const CLOUD_EXPORT_RATE_LIMIT = { windowMs: 60 * 60_000, limit: 5 } as const;
export const CLOUD_EXPORT_RATE_LIMIT_MESSAGE = 'Too many cloud exports. Try again later.';

/** Keyed by user: it runs after `authenticate`, so `userOrIpKey` sees `req.userId`. */
export function cloudExportRateLimit(redis: Redis): RateLimitRequestHandler {
  return createRateLimiter(redis, {
    prefix: 'export-cloud',
    ...CLOUD_EXPORT_RATE_LIMIT,
    message: CLOUD_EXPORT_RATE_LIMIT_MESSAGE,
  });
}
