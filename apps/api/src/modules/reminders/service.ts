/**
 * The three reminder jobs (SPEC.md §10).
 *
 * `reschedule-user` rebuilds one user's next 48 hours from `@beta/core`'s
 * `planReminders` — this layer only fetches rows and writes the result, so the
 * plan the worker stores is the plan the core tests pin.
 *
 * `dispatch-reminders` claims due rows with `SKIP LOCKED`, re-checks each one
 * against the world as it is *now*, and sends. Everything it re-checks changed
 * after planning: the habit may have been logged, deleted, archived or
 * silenced, and the host may have been asleep.
 *
 * `extend-windows` walks users with reminding habits and enqueues a reschedule
 * each, which is what keeps the rolling 48-hour window full.
 *
 * **Delivery is at-most-once** (SPEC.md §10): the claim marks a row `sent`
 * before the push goes out, so a crash in between loses that reminder rather
 * than risking a duplicate.
 */
import {
  DEFAULT_REMINDER_HORIZON_MS,
  localToInstant,
  planReminders,
  todayKey,
  weekStartKey,
  addDays,
  type PlannedReminder,
} from '@beta/core';

import type { Clock } from '../../lib/clock';
import type { PushPayload } from '../../lib/pushSender';
import type { Queues } from '../../jobs/queues';
import { toIsoInstant } from '../../lib/instant';
import { requireUserContext, type UserContextRepository } from '../shared/userContext';
import { toHabitDtos } from '../habits/dto';
import type { HabitRepository } from '../habits/repository';
import { toLogDto } from '../logs/dto';
import type { LogRepository } from '../logs/repository';
import type { SnoozeRepository } from '../snoozes/repository';
import type { PushDelivery } from '../push/delivery';
import type { PushSubscriptionRepository, PushSubscriptionRow } from '../push/repository';
import {
  DISPATCH_BATCH_SIZE,
  EXTEND_BATCH_SIZE,
  pairKey,
  type ReminderRepository,
} from './repository';

/**
 * SPEC.md §10.6: an occurrence claimed more than two hours late is cancelled,
 * not sent. The host was asleep, and a stale notification is noise.
 */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** SPEC.md §10 "Notification payload". */
export const DUE_BODY = 'Due now';
export const SNOOZED_BODY = 'Snoozed reminder';

export type DispatchReport = {
  claimed: number;
  sent: number;
  /** Rows that were claimed but deliberately not sent. */
  cancelled: number;
  /** Subscriptions deleted because the push service said they were gone. */
  removed: number;
};

export type ReminderServiceDeps = {
  reminders: ReminderRepository;
  habits: HabitRepository;
  logs: LogRepository;
  snoozes: SnoozeRepository;
  users: UserContextRepository;
  subscriptions: PushSubscriptionRepository;
  delivery: PushDelivery;
  queues: Queues;
  clock: Clock;
};

export interface ReminderService {
  /** Rebuilds one user's pending occurrences. Returns how many were written. */
  rescheduleUser(userId: string): Promise<{ planned: number }>;
  dispatchDue(limit?: number): Promise<DispatchReport>;
  /** Enqueues a reschedule for every user with reminders on. */
  extendWindows(): Promise<{ users: number }>;
  /** The plan `rescheduleUser` would write, without writing it (for tests). */
  planFor(userId: string): Promise<PlannedReminder[]>;
}

export function createReminderService(deps: ReminderServiceDeps): ReminderService {
  /**
   * Everything `planReminders` reads. The log window covers the horizon plus
   * the week each candidate day falls in, because a `timesPerWeek` target is
   * counted over that day's week.
   */
  async function planFor(userId: string): Promise<PlannedReminder[]> {
    const user = await requireUserContext(deps.users, userId);
    const now = deps.clock.now();

    const today = todayKey(now, user.timeZone);
    const horizonEnd = todayKey(now + DEFAULT_REMINDER_HORIZON_MS, user.timeZone);
    const from = weekStartKey(today, user.weekStart);
    const to = addDays(weekStartKey(horizonEnd, user.weekStart), 6);

    const [habitRows, logRows, snoozeRows] = await Promise.all([
      deps.habits.listLive(userId),
      deps.logs.listRange(userId, { from, to }),
      deps.snoozes.listLive(userId, now),
    ]);

    return planReminders({
      habits: toHabitDtos(habitRows),
      logs: logRows.map(toLogDto),
      snoozes: snoozeRows.map((row) => ({
        habitId: row.habitId,
        dayKey: row.dayKey,
        until: toIsoInstant(row.untilMs),
      })),
      now,
      tz: user.timeZone,
      weekStart: user.weekStart,
    });
  }

  return {
    planFor,

    async rescheduleUser(userId) {
      const planned = await planFor(userId);
      const written = await deps.reminders.replacePending(userId, planned);
      return { planned: written };
    },

    async dispatchDue(limit = DISPATCH_BATCH_SIZE) {
      const now = deps.clock.now();
      const claimed = await deps.reminders.claimDue(now, limit);
      const report: DispatchReport = { claimed: claimed.length, sent: 0, cancelled: 0, removed: 0 };
      if (claimed.length === 0) return report;

      const context = await deps.reminders.contextFor(claimed);
      const subscriptions = await deps.subscriptions.listForUsers([
        ...new Set(claimed.map((row) => row.userId)),
      ]);
      const byUser = new Map<string, PushSubscriptionRow[]>();
      for (const subscription of subscriptions) {
        const list = byUser.get(subscription.userId);
        if (list === undefined) byUser.set(subscription.userId, [subscription]);
        else list.push(subscription);
      }

      const cancelled: string[] = [];
      for (const occurrence of claimed) {
        const habit = context.habits.get(occurrence.habitId);
        const stale = now - occurrence.fireAtMs > STALE_AFTER_MS;
        const logged = context.logged.has(pairKey(occurrence.habitId, occurrence.dayKey));

        // The habit is gone, archived or silenced; the day was already
        // completed or skipped; or the moment has long passed.
        if (habit === undefined || stale || logged) {
          cancelled.push(occurrence.id);
          continue;
        }

        // A snooze is the only thing that moves an occurrence off its due
        // instant, so a later `fireAt` is exactly what "snoozed" means here.
        const due = localToInstant(occurrence.dayKey, habit.time, habit.timeZone);
        const payload: PushPayload = {
          title: habit.name,
          body: occurrence.fireAtMs > due ? SNOOZED_BODY : DUE_BODY,
          url: '/',
          // Replaces a previous notification for the same day instead of stacking.
          tag: `habit:${occurrence.habitId}:${occurrence.dayKey}`,
        };

        const delivered = await deps.delivery.deliver(byUser.get(occurrence.userId) ?? [], payload);
        report.sent += delivered.sent;
        report.removed += delivered.removed;
      }

      await deps.reminders.markCancelled(cancelled);
      report.cancelled = cancelled.length;
      return report;
    },

    async extendWindows() {
      let after: string | null = null;
      let users = 0;
      for (;;) {
        const batch: string[] = await deps.reminders.listUserIdsWithReminders(
          after,
          EXTEND_BATCH_SIZE,
        );
        if (batch.length === 0) return { users };
        for (const userId of batch) await deps.queues.rescheduleUser(userId);
        users += batch.length;
        after = batch.at(-1) ?? null;
        if (batch.length < EXTEND_BATCH_SIZE) return { users };
      }
    },
  };
}
