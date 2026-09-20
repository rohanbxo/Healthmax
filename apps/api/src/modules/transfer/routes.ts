/**
 * Export and import routes (SPEC.md §9). Both hang off the `/api` root.
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { EventBus } from '../../events/bus';
import { authenticate } from '../../http/authenticate';
import { validate } from '../../http/validate';
import { createMeRepository } from '../me/repository';
import { createTransferController, transferSchemas } from './controller';
import { createTransferRepository } from './repository';
import { createTransferService } from './service';
import './openapi';

export const EXPORT_PATH = '/export';
export const IMPORT_PATH = '/import';

export type TransferRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  eventBus: EventBus;
};

export function createTransferRouter(deps: TransferRouterDeps): Router {
  const controller = createTransferController({
    service: createTransferService({
      repository: createTransferRepository(deps.prisma),
      users: createMeRepository(deps.prisma),
      clock: deps.clock,
      eventBus: deps.eventBus,
    }),
  });

  const router = Router();
  const requireAuth = authenticate({ config: deps.config, clock: deps.clock });

  router.get(EXPORT_PATH, requireAuth, controller.export);
  router.post(IMPORT_PATH, requireAuth, validate(transferSchemas.import), controller.import);

  return router;
}
