/**
 * Log routes (SPEC.md §9). Two of them hang off a habit and one is a range
 * query, so this router is mounted at the `/api` root and spells out both
 * paths rather than pretending they share a prefix.
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { EventBus } from '../../events/bus';
import { authenticate } from '../../http/authenticate';
import { validate } from '../../http/validate';
import { createUserContextRepository } from '../shared/userContext';
import { createHabitRepository } from '../habits/repository';
import { createLogController, logSchemas } from './controller';
import { createLogRepository } from './repository';
import { createLogService } from './service';
import './openapi';

export const HABIT_LOG_PATH = '/habits/:id/logs/:dayKey';
export const LOGS_PATH = '/logs';

export type LogsRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  eventBus: EventBus;
};

export function createLogsRouter(deps: LogsRouterDeps): Router {
  const controller = createLogController({
    service: createLogService({
      repository: createLogRepository(deps.prisma),
      habits: createHabitRepository(deps.prisma),
      users: createUserContextRepository(deps.prisma),
      clock: deps.clock,
      eventBus: deps.eventBus,
    }),
  });

  const router = Router();
  const requireAuth = authenticate({ config: deps.config, clock: deps.clock });

  router.put(HABIT_LOG_PATH, requireAuth, validate(logSchemas.put), controller.put);
  router.delete(HABIT_LOG_PATH, requireAuth, validate(logSchemas.byDay), controller.remove);
  router.get(LOGS_PATH, requireAuth, validate(logSchemas.list), controller.list);

  return router;
}
