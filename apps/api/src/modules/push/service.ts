/**
 * Push subscription rules (SPEC.md §9 "Push", §10).
 *
 * The VAPID public key is public by design — it is what the browser encrypts
 * to. The private key never leaves `config`, and no endpoint can read it.
 */
import type { PushSubscriptionBody } from '@beta/core';

import type { Config } from '../../config';
import { notFound } from '../../http/errors';
import type { PushDelivery, DeliveryReport } from './delivery';
import type { PushSubscriptionRepository } from './repository';

/** The notification `POST /push/test` sends (SPEC.md §10 "Settings"). */
export const TEST_NOTIFICATION = {
  title: 'Beta',
  body: 'Notifications are working.',
  url: '/',
  tag: 'beta:test',
} as const;

export type PushServiceDeps = {
  subscriptions: PushSubscriptionRepository;
  delivery: PushDelivery;
  config: Config;
};

export interface PushService {
  vapidPublicKey(): { publicKey: string };
  subscribe(userId: string, body: PushSubscriptionBody): Promise<void>;
  unsubscribe(userId: string, endpoint: string): Promise<void>;
  sendTest(userId: string): Promise<DeliveryReport>;
}

export function createPushService(deps: PushServiceDeps): PushService {
  return {
    vapidPublicKey() {
      const publicKey = deps.config.VAPID_PUBLIC_KEY;
      // Until the keys are generated (SPEC.md §14) there is nothing to hand
      // out, and the web app treats that as "push unavailable".
      if (publicKey === undefined) throw notFound('Push notifications are not configured.');
      return { publicKey };
    },

    async subscribe(userId, body) {
      await deps.subscriptions.upsert(userId, {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent,
      });
    },

    async unsubscribe(userId, endpoint) {
      // Idempotent: an endpoint the caller does not own is simply not theirs to
      // delete, and saying so would leak that it exists (SPEC.md §9).
      await deps.subscriptions.remove(userId, endpoint);
    },

    async sendTest(userId) {
      return deps.delivery.deliverToUser(userId, { ...TEST_NOTIFICATION });
    },
  };
}
