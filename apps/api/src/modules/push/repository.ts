/**
 * Push subscription persistence (SPEC.md §8, §10).
 *
 * `endpoint` is globally unique: it names one browser install, and a browser
 * can only ever hold one subscription for this application server. So a repeat
 * subscribe is an upsert keyed by endpoint, and it re-points the row at
 * whoever is signed in now — the same device may have been someone else's.
 *
 * The dispatcher reaches rows by id or endpoint rather than by user, because a
 * dead endpoint is discovered while sending, not while browsing.
 */
import type { PrismaClient } from '@prisma/client';

import { toDbInstant } from '../../lib/instant';

/** SPEC.md §10.4: five consecutive failures and the subscription is dropped. */
export const MAX_PUSH_FAILURES = 5;

export type PushSubscriptionRow = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount: number;
};

export type PushSubscriptionWrite = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | undefined;
};

const SUBSCRIPTION_SELECT = {
  id: true,
  userId: true,
  endpoint: true,
  p256dh: true,
  auth: true,
  failureCount: true,
} as const;

export interface PushSubscriptionRepository {
  /** Creates the subscription, or takes over an existing endpoint. */
  upsert(userId: string, data: PushSubscriptionWrite): Promise<void>;
  /** Idempotent. `false` when the caller had no such subscription. */
  remove(userId: string, endpoint: string): Promise<boolean>;
  listForUser(userId: string): Promise<PushSubscriptionRow[]>;
  /** Every subscription of every listed user, for one dispatch batch. */
  listForUsers(userIds: string[]): Promise<PushSubscriptionRow[]>;
  /** A `404`/`410` from the push service: the endpoint is gone for good. */
  removeById(id: string): Promise<void>;
  /** Returns the new count, so the caller can drop it at the limit. */
  recordFailure(id: string): Promise<number>;
  recordSuccess(id: string, nowMs: number): Promise<void>;
}

export function createPushSubscriptionRepository(prisma: PrismaClient): PushSubscriptionRepository {
  return {
    async upsert(userId, data) {
      await prisma.pushSubscription.upsert({
        where: { endpoint: data.endpoint },
        create: {
          userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          userAgent: data.userAgent ?? null,
        },
        update: {
          userId,
          p256dh: data.p256dh,
          auth: data.auth,
          userAgent: data.userAgent ?? null,
          // A re-subscribe is a working endpoint by definition.
          failureCount: 0,
        },
      });
    },

    async remove(userId, endpoint) {
      const result = await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
      return result.count > 0;
    },

    async listForUser(userId) {
      return prisma.pushSubscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: SUBSCRIPTION_SELECT,
      });
    },

    async listForUsers(userIds) {
      if (userIds.length === 0) return [];
      return prisma.pushSubscription.findMany({
        where: { userId: { in: userIds } },
        orderBy: { createdAt: 'asc' },
        select: SUBSCRIPTION_SELECT,
      });
    },

    async removeById(id) {
      await prisma.pushSubscription.deleteMany({ where: { id } });
    },

    async recordFailure(id) {
      try {
        const row = await prisma.pushSubscription.update({
          where: { id },
          data: { failureCount: { increment: 1 } },
          select: { failureCount: true },
        });
        return row.failureCount;
      } catch {
        // Another dispatcher deleted it first; there is nothing left to count.
        return 0;
      }
    },

    async recordSuccess(id, nowMs) {
      await prisma.pushSubscription.updateMany({
        where: { id },
        data: { failureCount: 0, lastSuccessAt: toDbInstant(nowMs) },
      });
    },
  };
}
