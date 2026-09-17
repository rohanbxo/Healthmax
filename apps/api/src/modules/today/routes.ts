/**
 * Today route (SPEC.md §9 "Read models").
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import { authenticate } from '../../http/authenticate';
import { createUserContextRepository } from '../shared/userContext';
import { createHabitRepository } from '../habits/repository';
import { createLogRepository } from '../logs/repository';
import { createSnoozeRepository } from '../snoozes/repository';
import { createTodayController } from './controller';
import { createTodayService } from './service';
import './openapi';

/** Mount point within the `/api` router. */
export const TODAY_PATH = '/today';

export type TodayRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
};

export function createTodayRouter(deps: TodayRouterDeps): Router {
  const controller = createTodayController({
    service: createTodayService({
      habits: createHabitRepository(deps.prisma),
      logs: createLogRepository(deps.prisma),
      snoozes: createSnoozeRepository(deps.prisma),
      users: createUserContextRepository(deps.prisma),
      clock: deps.clock,
    }),
  });

  const router = Router();
  router.get('/', authenticate({ config: deps.config, clock: deps.clock }), controller.get);
  return router;
}
