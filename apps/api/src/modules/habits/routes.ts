/**
 * Habit routes (SPEC.md §9 "Habits, logs, snoozes"). Paths, middleware, and
 * nothing else. Order per route: `authenticate` → `validate` → controller.
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { EventBus } from '../../events/bus';
import { authenticate } from '../../http/authenticate';
import { validate } from '../../http/validate';
import { createUserContextRepository } from '../shared/userContext';
import { createHabitController, habitSchemas } from './controller';
import { createHabitRepository } from './repository';
import { createHabitService } from './service';
import './openapi';

/** Mount point within the `/api` router. */
export const HABITS_PATH = '/habits';

export type HabitsRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  eventBus: EventBus;
};

export function createHabitsRouter(deps: HabitsRouterDeps): Router {
  const controller = createHabitController({
    service: createHabitService({
      repository: createHabitRepository(deps.prisma),
      users: createUserContextRepository(deps.prisma),
      clock: deps.clock,
      eventBus: deps.eventBus,
    }),
  });

  const router = Router();
  const requireAuth = authenticate({ config: deps.config, clock: deps.clock });

  router.get('/', requireAuth, controller.list);
  router.post('/', requireAuth, validate(habitSchemas.create), controller.create);
  router.patch('/:id', requireAuth, validate(habitSchemas.update), controller.update);
  router.delete('/:id', requireAuth, validate(habitSchemas.byId), controller.remove);

  return router;
}
