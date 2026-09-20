/**
 * The reminder workers (SPEC.md §10, §13 "Worker process").
 *
 * Three jobs, one service:
 *  - `reschedule-user`, enqueued by the event handler in `app.ts`, deduplicated
 *    by `jobId` and delayed two seconds so a burst of taps collapses into one;
 *  - `dispatch-reminders`, a repeatable job every minute;
 *  - `extend-windows`, repeatable hourly, which keeps the rolling window full.
 *
 * Only the wiring lives here. Every rule is in `modules/reminders/service.ts`,
 * which the tests drive directly rather than through Redis.
 */
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

import type { Clock } from '../lib/clock';
import type { PushSender } from '../lib/pushSender';
import { createUserContextRepository } from '../modules/shared/userContext';
import { createHabitRepository } from '../modules/habits/repository';
import { createLogRepository } from '../modules/logs/repository';
import { createSnoozeRepository } from '../modules/snoozes/repository';
import { createPushDelivery } from '../modules/push/delivery';
import { createPushSubscriptionRepository } from '../modules/push/repository';
import { createReminderRepository } from '../modules/reminders/repository';
import { createReminderService, type ReminderService } from '../modules/reminders/service';
import { QUEUE_NAMES, type Queues, type RescheduleUserJob } from './queues';

/** SPEC.md §10.4: the dispatcher runs every minute. */
export const DISPATCH_INTERVAL_MS = 60_000;
/** SPEC.md §10.5: the window extender runs hourly. */
export const EXTEND_INTERVAL_MS = 60 * 60_000;

export const REMINDER_QUEUE_NAMES = {
  dispatchReminders: 'dispatch-reminders',
  extendWindows: 'extend-windows',
} as const;

export type ReminderServiceDependencies = {
  prisma: PrismaClient;
  clock: Clock;
  pushSender: PushSender;
  queues: Queues;
};

/** Wires every repository the reminder jobs need. Shared with the tests. */
export function buildReminderService(deps: ReminderServiceDependencies): ReminderService {
  const subscriptions = createPushSubscriptionRepository(deps.prisma);
  return createReminderService({
    reminders: createReminderRepository(deps.prisma),
    habits: createHabitRepository(deps.prisma),
    logs: createLogRepository(deps.prisma),
    snoozes: createSnoozeRepository(deps.prisma),
    users: createUserContextRepository(deps.prisma),
    subscriptions,
    delivery: createPushDelivery({
      subscriptions,
      pushSender: deps.pushSender,
      clock: deps.clock,
    }),
    queues: deps.queues,
    clock: deps.clock,
  });
}

export type ReminderWorkers = { close(): Promise<void> };

export async function startReminderWorkers(
  deps: ReminderServiceDependencies & { connection: ConnectionOptions; logger: Logger },
): Promise<ReminderWorkers> {
  const service = buildReminderService(deps);
  const { connection, logger } = deps;

  const dispatchQueue = new Queue(REMINDER_QUEUE_NAMES.dispatchReminders, { connection });
  const extendQueue = new Queue(REMINDER_QUEUE_NAMES.extendWindows, { connection });

  // Upserted on every boot, so a changed interval takes effect on deploy and
  // two API instances cannot install two schedules.
  await dispatchQueue.upsertJobScheduler('dispatch', { every: DISPATCH_INTERVAL_MS });
  await extendQueue.upsertJobScheduler('extend', { every: EXTEND_INTERVAL_MS });

  const workers = [
    new Worker<RescheduleUserJob>(
      QUEUE_NAMES.rescheduleUser,
      async (job) => {
        const { planned } = await service.rescheduleUser(job.data.userId);
        logger.debug({ userId: job.data.userId, planned }, 'Rebuilt a reminder plan');
      },
      { connection },
    ),
    new Worker(
      REMINDER_QUEUE_NAMES.dispatchReminders,
      async () => {
        const report = await service.dispatchDue();
        if (report.claimed > 0) logger.info(report, 'Dispatched reminders');
      },
      { connection },
    ),
    new Worker(
      REMINDER_QUEUE_NAMES.extendWindows,
      async () => {
        const { users } = await service.extendWindows();
        logger.info({ users }, 'Extended reminder windows');
      },
      { connection },
    ),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      logger.error({ err, job: job?.name, id: job?.id }, 'Reminder job failed');
    });
  }

  return {
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([dispatchQueue.close(), extendQueue.close()]);
    },
  };
}
