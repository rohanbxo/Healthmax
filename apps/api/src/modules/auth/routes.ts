/**
 * Auth routes (SPEC.md §9 "Auth"). Paths, middleware and nothing else.
 *
 * Order per route: rate limit → CSRF header (where required) → `validate` →
 * controller. The limiter runs first on purpose, so a flood of malformed bodies
 * is counted too and cannot be used to bypass the limit.
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { Queues } from '../../jobs/queues';
import { validate } from '../../http/validate';
import { requireRequestedWith } from '../../http/requestedWith';
import { authSchemas, createAuthController } from './controller';
import { createAuthRepository } from './repository';
import { createAuthService } from './service';
import { forgotPasswordRateLimit, loginRateLimit, registerRateLimit } from './rateLimits';
import './openapi';

/** Mount point within the `/api` router; must match `REFRESH_COOKIE_PATH`. */
export const AUTH_PATH = '/auth';

export type AuthRouterDeps = {
  prisma: PrismaClient;
  redis: Redis;
  clock: Clock;
  config: Config;
  queues: Queues;
};

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const service = createAuthService({
    repository: createAuthRepository(deps.prisma),
    clock: deps.clock,
    config: deps.config,
    queues: deps.queues,
  });
  const controller = createAuthController({
    service,
    isProduction: deps.config.NODE_ENV === 'production',
  });

  const router = Router();

  router.post(
    '/register',
    registerRateLimit(deps.redis),
    validate(authSchemas.register),
    controller.register,
  );

  router.post('/login', loginRateLimit(deps.redis), validate(authSchemas.login), controller.login);

  // Cookie-driven, so both carry the CSRF header requirement (SPEC.md §9).
  router.post('/refresh', requireRequestedWith(), controller.refresh);
  router.post('/logout', requireRequestedWith(), controller.logout);

  router.post(
    '/forgot-password',
    forgotPasswordRateLimit(deps.redis),
    validate(authSchemas.forgotPassword),
    controller.forgotPassword,
  );

  router.post('/reset-password', validate(authSchemas.resetPassword), controller.resetPassword);

  return router;
}
