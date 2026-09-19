/**
 * Stats route (SPEC.md §9 "Read models").
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import { authenticate } from '../../http/authenticate';
import { validate } from '../../http/validate';
import { createUserContextRepository } from '../shared/userContext';
import { createHabitRepository } from '../habits/repository';
import { createLogRepository } from '../logs/repository';
import type { StatsCache } from './cache';
import { createStatsController, statsSchemas } from './controller';
import { createStatsService } from './service';
import './openapi';

/** Mount point within the `/api` router. */
export const STATS_PATH = '/stats';

export type StatsRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  cache: StatsCache;
};

export function createStatsRouter(deps: StatsRouterDeps): Router {
  const controller = createStatsController({
    service: createStatsService({
      habits: createHabitRepository(deps.prisma),
      logs: createLogRepository(deps.prisma),
      users: createUserContextRepository(deps.prisma),
      clock: deps.clock,
      cache: deps.cache,
    }),
  });

  const router = Router();
  router.get(
    '/',
    authenticate({ config: deps.config, clock: deps.clock }),
    validate(statsSchemas.get),
    controller.get,
  );
  return router;
}
