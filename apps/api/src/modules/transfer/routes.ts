/**
 * Export and import routes (SPEC.md §9). All hang off the `/api` root.
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { ObjectStore } from '../../lib/objectStore';
import type { EventBus } from '../../events/bus';
import { authenticate } from '../../http/authenticate';
import { validate } from '../../http/validate';
import { createMeRepository } from '../me/repository';
import { createTransferController, transferSchemas } from './controller';
import { cloudExportRateLimit } from './rateLimits';
import { createTransferRepository } from './repository';
import { createTransferService } from './service';
import './openapi';

export const EXPORT_PATH = '/export';
export const IMPORT_PATH = '/import';
export const EXPORT_CLOUD_PATH = '/export/cloud';

export type TransferRouterDeps = {
  prisma: PrismaClient;
  redis: Redis;
  clock: Clock;
  config: Config;
  eventBus: EventBus;
  /** `undefined` disables cloud export. */
  objectStore: ObjectStore | undefined;
};

export function createTransferRouter(deps: TransferRouterDeps): Router {
  const controller = createTransferController({
    service: createTransferService({
      repository: createTransferRepository(deps.prisma),
      users: createMeRepository(deps.prisma),
      clock: deps.clock,
      eventBus: deps.eventBus,
      objectStore: deps.objectStore,
      exportUrlTtlSeconds: deps.config.EXPORT_URL_TTL_SECONDS,
    }),
  });

  const router = Router();
  const requireAuth = authenticate({ config: deps.config, clock: deps.clock });

  router.get(EXPORT_PATH, requireAuth, controller.export);
  // Authenticated first, so the limiter keys on the user rather than the IP.
  router.post(
    EXPORT_CLOUD_PATH,
    requireAuth,
    cloudExportRateLimit(deps.redis),
    controller.exportToCloud,
  );
  router.post(IMPORT_PATH, requireAuth, validate(transferSchemas.import), controller.import);

  return router;
}
