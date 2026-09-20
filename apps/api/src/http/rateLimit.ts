/**
 * Redis-backed rate limiting (SPEC.md §9 "Rate limits", §12).
 *
 * The Redis client arrives by injection, so tests share the same instance the
 * rest of the app uses and can flush it between cases. The auth-specific
 * limiters (login/register 5/min, forgot-password 3/hour) are built from
 * `createRateLimiter` in M4.
 */
import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import type { Request, RequestHandler } from 'express';
import { rateLimited } from './errors';

export type RateLimiterOptions = {
  /** Distinguishes one limiter's counters from another's in Redis. */
  prefix: string;
  windowMs: number;
  limit: number;
  /** Defaults to the authenticated user, falling back to the client IP. */
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  message?: string;
};

/** Authenticated user first (SPEC.md §9: "global 300 per minute per user"). */
export function userOrIpKey(req: Request): string {
  if (req.userId) return `u:${req.userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export function createRateLimiter(
  redis: Redis,
  options: RateLimiterOptions,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: options.keyGenerator ?? userOrIpKey,
    ...(options.skip ? { skip: options.skip } : {}),
    // One envelope for every non-2xx response (SPEC.md §9).
    handler: (_req, _res, next) => {
      next(rateLimited(options.message));
    },
    store: new RedisStore({
      prefix: `rl:${options.prefix}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
  });
}

export const GLOBAL_RATE_LIMIT = { windowMs: 60_000, limit: 300 } as const;

/**
 * 300 requests per minute per user (per IP when unauthenticated).
 * `exemptPaths` keeps the public liveness probe out of the counter.
 */
export function globalRateLimit(redis: Redis, exemptPaths: readonly string[] = []): RequestHandler {
  const exempt = new Set(exemptPaths);
  return createRateLimiter(redis, {
    prefix: 'global',
    windowMs: GLOBAL_RATE_LIMIT.windowMs,
    limit: GLOBAL_RATE_LIMIT.limit,
    skip: (req) => exempt.has(req.path),
  });
}
