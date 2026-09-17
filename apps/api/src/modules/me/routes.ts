/**
 * Account routes (SPEC.md §9 "Account"). All three sit behind `authenticate`,
 * the middleware every protected route from M5 onwards will reuse.
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { EventBus } from '../../events/bus';
import { authenticate } from '../../http/authenticate';
import { validate } from '../../http/validate';
import { createMeController, meSchemas } from './controller';
import { createMeRepository } from './repository';
import { createMeService } from './service';
import './openapi';

/** Mount point within the `/api` router. */
export const ME_PATH = '/me';

export type MeRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  eventBus: EventBus;
};

export function createMeRouter(deps: MeRouterDeps): Router {
  const controller = createMeController({
    service: createMeService({
      repository: createMeRepository(deps.prisma),
      eventBus: deps.eventBus,
    }),
  });

  const router = Router();
  const requireAuth = authenticate({ config: deps.config, clock: deps.clock });

  router.get('/', requireAuth, controller.get);
  router.patch('/', requireAuth, validate(meSchemas.patch), controller.patch);
  router.delete('/', requireAuth, validate(meSchemas.delete), controller.remove);

  return router;
}
