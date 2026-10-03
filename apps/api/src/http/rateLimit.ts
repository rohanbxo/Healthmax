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
import type { Config } from '../config';
import type { Clock } from '../lib/clock';
import { verifyAccessToken } from '../lib/accessToken';
import { bearerToken } from './authenticate';
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

export type GlobalRateLimitDeps = {
  redis: Redis;
  config: Pick<Config, 'JWT_SECRET'>;
  clock: Clock;
  /** Paths left out of the count, e.g. the public liveness probe. */
  exemptPaths?: readonly string[];
};

/**
 * The global limiter runs before any route has authenticated the request, so
 * `req.userId` is never set yet. Verifying the bearer token here (an HMAC, no
 * database) is what makes it "per user" as SPEC.md §9 says, instead of per IP
 * — otherwise everyone behind one NAT or one mis-trusted proxy would share 300
 * requests a minute. A missing, expired or forged token counts against the IP,
 * so a bad token can never buy a fresh bucket.
 */
export function globalRateLimitKey(deps: Pick<GlobalRateLimitDeps, 'config' | 'clock'>) {
  return (req: Request): string => {
    const token = bearerToken(req);
    if (token !== undefined) {
      const result = verifyAccessToken({
        token,
        secret: deps.config.JWT_SECRET,
        nowMs: deps.clock.now(),
      });
      if (result.ok) return `u:${result.claims.sub}`;
    }
    return userOrIpKey(req);
  };
}

/** 300 requests per minute per user, per IP when unauthenticated. */
export function globalRateLimit(deps: GlobalRateLimitDeps): RequestHandler {
  const exempt = new Set(deps.exemptPaths ?? []);
  return createRateLimiter(deps.redis, {
    prefix: 'global',
    windowMs: GLOBAL_RATE_LIMIT.windowMs,
    limit: GLOBAL_RATE_LIMIT.limit,
    keyGenerator: globalRateLimitKey(deps),
    skip: (req) => exempt.has(req.path),
  });
}
