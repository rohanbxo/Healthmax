/**
 * Sending one notification to every device a user has (SPEC.md §10.4).
 *
 * Shared by the reminder dispatcher and `POST /push/test`, because the rules
 * for a dead endpoint are the same either way:
 *
 *  - `404`/`410` — the browser threw the subscription away; delete the row.
 *  - any other failure — count it, and delete at {@link MAX_PUSH_FAILURES}
 *    consecutive failures.
 *  - success — clear the count and stamp `lastSuccessAt`.
 */
import type { Clock } from '../../lib/clock';
import type { PushPayload, PushSender } from '../../lib/pushSender';
import {
  MAX_PUSH_FAILURES,
  type PushSubscriptionRepository,
  type PushSubscriptionRow,
} from './repository';

export type DeliveryReport = { sent: number; removed: number; failed: number };

export type PushDeliveryDeps = {
  subscriptions: PushSubscriptionRepository;
  pushSender: PushSender;
  clock: Clock;
};

export interface PushDelivery {
  /** Sends to the subscriptions given, and prunes the dead ones. */
  deliver(targets: PushSubscriptionRow[], payload: PushPayload): Promise<DeliveryReport>;
  /** Sends to everything this user has registered. */
  deliverToUser(userId: string, payload: PushPayload): Promise<DeliveryReport>;
}

export function createPushDelivery(deps: PushDeliveryDeps): PushDelivery {
  async function deliver(
    targets: PushSubscriptionRow[],
    payload: PushPayload,
  ): Promise<DeliveryReport> {
    const report: DeliveryReport = { sent: 0, removed: 0, failed: 0 };

    for (const target of targets) {
      const result = await deps.pushSender.send(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
      );

      if (result.status === 'ok') {
        report.sent += 1;
        await deps.subscriptions.recordSuccess(target.id, deps.clock.now());
        continue;
      }

      if (result.status === 'gone') {
        report.removed += 1;
        await deps.subscriptions.removeById(target.id);
        continue;
      }

      report.failed += 1;
      const failures = await deps.subscriptions.recordFailure(target.id);
      if (failures >= MAX_PUSH_FAILURES) {
        report.removed += 1;
        await deps.subscriptions.removeById(target.id);
      }
    }

    return report;
  }

  return {
    deliver,
    async deliverToUser(userId, payload) {
      return deliver(await deps.subscriptions.listForUser(userId), payload);
    },
  };
}
