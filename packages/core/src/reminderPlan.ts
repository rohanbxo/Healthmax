/**
 * The reminder plan the `reschedule-user` worker writes as `ReminderOccurrence`
 * rows (SPEC.md §10.3).
 *
 * Pure: the worker passes `now`, the user's timezone and the user's rows, and
 * gets back the exact set of occurrences for the next 48 hours. The API test
 * "reschedule output matches the core plan" (SPEC.md §13) compares against this.
 */

import type { DayKey, HabitDTO, LogDTO, SnoozeDTO, WeekStart } from './types';
import {
  DAYS_PER_WEEK,
  MS_PER_HOUR,
  addDays,
  compareDayKeys,
  instantToDayKey,
  weekStartKey,
} from './time';
import { activeSnoozeUntil, dueInstant, isScheduledOn } from './rules';

/** One row the worker will insert. `(habitId, dayKey)` is unique (SPEC.md §8). */
export type PlannedReminder = { habitId: string; dayKey: DayKey; fireAt: number };

/** The scheduling window: the next 48 hours (SPEC.md §10.3). */
export const DEFAULT_REMINDER_HORIZON_MS = 48 * MS_PER_HOUR;

/**
 * Plans every reminder that should fire in `(now, now + horizonMs]`.
 *
 * Excluded, per SPEC.md §10.3:
 *  - archived habits (soft-deleted ones never reach core — the repository filters them);
 *  - habits with `remind: false`;
 *  - days that already have a log (`done` **or** `skipped`);
 *  - due instants that have already passed — an overdue habit is not re-notified;
 *  - `timesPerWeek` habits whose weekly target is already met, judged per the week
 *    the candidate day falls in, so a target met this week does not suppress a
 *    reminder that belongs to next week.
 *
 * An **active snooze replaces that day's `fireAt`** with the snooze's `until`.
 *
 * Returns at most one entry per `(habitId, dayKey)`, sorted by `fireAt` and then
 * `habitId` so the output is stable and comparable in tests.
 */
export function planReminders(args: {
  habits: HabitDTO[];
  logs: LogDTO[];
  snoozes: SnoozeDTO[];
  now: number;
  tz: string;
  weekStart: WeekStart;
  horizonMs?: number;
}): PlannedReminder[] {
  const { habits, logs, snoozes, now, tz, weekStart } = args;
  const horizonMs = args.horizonMs ?? DEFAULT_REMINDER_HORIZON_MS;
  const until = now + horizonMs;

  const firstDay = instantToDayKey(now, tz);
  const lastDay = instantToDayKey(until, tz);

  // Logged days, and `done` days per week, indexed once instead of per candidate day.
  const loggedDays = new Map<string, Set<DayKey>>();
  const doneDays = new Map<string, Set<DayKey>>();
  for (const log of logs) {
    let logged = loggedDays.get(log.habitId);
    if (logged === undefined) {
      logged = new Set();
      loggedDays.set(log.habitId, logged);
    }
    logged.add(log.dayKey);
    if (log.status !== 'done') continue;
    let done = doneDays.get(log.habitId);
    if (done === undefined) {
      done = new Set();
      doneDays.set(log.habitId, done);
    }
    done.add(log.dayKey);
  }

  const snoozeByHabit = new Map<string, SnoozeDTO>();
  for (const snooze of snoozes) snoozeByHabit.set(snooze.habitId, snooze);

  const weeklyDone = new Map<string, number>();
  const doneCountForWeek = (habitId: string, weekStartDay: DayKey): number => {
    const cacheKey = `${habitId}|${weekStartDay}`;
    const cached = weeklyDone.get(cacheKey);
    if (cached !== undefined) return cached;
    const days = doneDays.get(habitId);
    let count = 0;
    if (days !== undefined) {
      let day = weekStartDay;
      for (let i = 0; i < DAYS_PER_WEEK; i += 1) {
        if (days.has(day)) count += 1;
        day = addDays(day, 1);
      }
    }
    weeklyDone.set(cacheKey, count);
    return count;
  };

  const plan: PlannedReminder[] = [];

  for (const habit of habits) {
    if (habit.archived) continue;
    if (!habit.remind) continue;
    const logged = loggedDays.get(habit.id);
    const snooze = snoozeByHabit.get(habit.id);

    let dayKey = firstDay;
    while (compareDayKeys(dayKey, lastDay) <= 0) {
      const day = dayKey;
      dayKey = addDays(dayKey, 1);

      if (!isScheduledOn(habit, day)) continue;
      if (logged?.has(day) === true) continue;
      if (
        habit.schedule.kind === 'timesPerWeek' &&
        doneCountForWeek(habit.id, weekStartKey(day, weekStart)) >= habit.schedule.count
      ) {
        continue;
      }

      const snoozedUntil = activeSnoozeUntil(snooze, habit.id, day, now);
      const fireAt = snoozedUntil ?? dueInstant(habit, day, tz);
      if (fireAt <= now) continue; // Already due: the reminder moment has gone.
      if (fireAt > until) continue; // Beyond the 48-hour horizon.

      plan.push({ habitId: habit.id, dayKey: day, fireAt });
    }
  }

  plan.sort((a, b) => {
    if (a.fireAt !== b.fireAt) return a.fireAt - b.fireAt;
    if (a.habitId === b.habitId) return 0;
    return a.habitId < b.habitId ? -1 : 1;
  });
  return plan;
}
