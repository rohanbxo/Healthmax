/**
 * Snooze routes (SPEC.md §9). Mounted at the `/api` root because they hang off
 * a habit id.
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
import { createSnoozeController, snoozeSchemas } from './controller';
import { createSnoozeRepository } from './repository';
import { createSnoozeService } from './service';
import './openapi';

export const HABIT_SNOOZE_PATH = '/habits/:id/snooze';

export type SnoozesRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  eventBus: EventBus;
};

export function createSnoozesRouter(deps: SnoozesRouterDeps): Router {
  const controller = createSnoozeController({
    service: createSnoozeService({
      repository: createSnoozeRepository(deps.prisma),
      habits: createHabitRepository(deps.prisma),
      users: createUserContextRepository(deps.prisma),
      clock: deps.clock,
      eventBus: deps.eventBus,
    }),
  });

  const router = Router();
  const requireAuth = authenticate({ config: deps.config, clock: deps.clock });

  router.put(HABIT_SNOOZE_PATH, requireAuth, validate(snoozeSchemas.put), controller.put);
  router.delete(HABIT_SNOOZE_PATH, requireAuth, validate(snoozeSchemas.byHabit), controller.remove);

  return router;
}
