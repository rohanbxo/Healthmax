/**
 * Push routes (SPEC.md §9 "Push"). The VAPID public key is the one public
 * route here; everything else is the caller's own devices.
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { PushSender } from '../../lib/pushSender';
import { authenticate } from '../../http/authenticate';
import { validate } from '../../http/validate';
import { createPushController, pushSchemas } from './controller';
import { createPushDelivery } from './delivery';
import { createPushSubscriptionRepository } from './repository';
import { createPushService } from './service';
import './openapi';

/** Mount point within the `/api` router. */
export const PUSH_PATH = '/push';
export const VAPID_KEY_PATH = '/vapid-public-key';
export const SUBSCRIPTIONS_PATH = '/subscriptions';
export const PUSH_TEST_PATH = '/test';

export type PushRouterDeps = {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  pushSender: PushSender;
};

export function createPushRouter(deps: PushRouterDeps): Router {
  const subscriptions = createPushSubscriptionRepository(deps.prisma);
  const controller = createPushController({
    service: createPushService({
      subscriptions,
      delivery: createPushDelivery({
        subscriptions,
        pushSender: deps.pushSender,
        clock: deps.clock,
      }),
      config: deps.config,
    }),
  });

  const router = Router();
  const requireAuth = authenticate({ config: deps.config, clock: deps.clock });

  router.get(VAPID_KEY_PATH, controller.vapidPublicKey);
  router.post(
    SUBSCRIPTIONS_PATH,
    requireAuth,
    validate(pushSchemas.subscribe),
    controller.subscribe,
  );
  router.delete(
    SUBSCRIPTIONS_PATH,
    requireAuth,
    validate(pushSchemas.unsubscribe),
    controller.unsubscribe,
  );
  router.post(PUSH_TEST_PATH, requireAuth, controller.test);

  return router;
}
