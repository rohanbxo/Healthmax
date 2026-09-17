/**
 * Scheduling, day status and action rules (SPEC.md §6).
 *
 * Pure TypeScript shared by the API, the reminder worker and the web client, so
 * that "what is due, and when" has exactly one implementation (SPEC.md §0.6).
 * Every date calculation goes through `time.ts` (SPEC.md §7); nothing here
 * touches `Date` directly.
 */

import type {
  DayKey,
  DayStatus,
  HabitDTO,
  Instant,
  LogDTO,
  LogStatus,
  SnoozeDTO,
  WeekStart,
} from './types';
import {
  DAYS_PER_WEEK,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  addDays,
  compareDayKeys,
  diffDays,
  isValidDayKey,
  localToInstant,
  weekStartKey,
  weekday,
} from './time';

/**
 * The habit fields every rule in this module needs. Callers may pass a whole
 * `HabitDTO`; repositories may pass a narrower `select`.
 *
 * Soft-deleted habits (`deletedAt`, SPEC.md §8) never reach `packages/core`:
 * the repository layer filters them out, exactly as it does for other users'
 * rows. `archived` is the only "never scheduled" flag visible here.
 */
export type HabitLike = Pick<HabitDTO, 'id' | 'schedule' | 'time' | 'createdDayKey' | 'archived'>;

/** The anchor `diffDays` is measured from when converting an ISO instant to epoch ms. */
const EPOCH_DAY_KEY: DayKey = '1970-01-01';

const MINUTES_PER_HOUR = 60;

/**
 * 'YYYY-MM-DDTHH:mm[:ss[.sss]](Z|±HH:mm)' — the shape `instantSchema` accepts
 * (SPEC.md §5). Captured as integers rather than handed to `Date` (SPEC.md §7.1).
 */
const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:[Zz]|([+-])(\d{2}):?(\d{2}))$/;

/**
 * Epoch milliseconds for an ISO-8601 instant such as a `SnoozeDTO.until`.
 *
 * `Date.parse` and `new Date(string)` are banned (SPEC.md §7.1), so the string is
 * split into integers and rebuilt from the calendar-day offset `diffDays` gives.
 * Throws a `RangeError` on anything malformed rather than returning `NaN`.
 */
export function parseInstant(iso: Instant): number {
  if (typeof iso !== 'string') {
    throw new RangeError(`Invalid instant: ${String(iso)}`);
  }
  const match = ISO_INSTANT_RE.exec(iso);
  if (match === null) {
    throw new RangeError(`Invalid instant: ${iso} (expected ISO-8601 with an offset)`);
  }
  const [, year, month, day, rawHour, rawMinute, rawSecond, fraction, sign, offHour, offMinute] =
    match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    rawHour === undefined ||
    rawMinute === undefined
  ) {
    throw new RangeError(`Invalid instant: ${iso}`);
  }
  const dayKey = `${year}-${month}-${day}`;
  if (!isValidDayKey(dayKey)) {
    throw new RangeError(`Invalid instant: ${iso} (no such calendar day)`);
  }
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = rawSecond === undefined ? 0 : Number(rawSecond);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new RangeError(`Invalid instant: ${iso} (time out of range)`);
  }
  // Truncate (never round) to millisecond precision: '.9999' is 999 ms, not 1 s.
  const millis = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3));

  const utc =
    diffDays(EPOCH_DAY_KEY, dayKey) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    millis;

  if (sign === undefined || offHour === undefined || offMinute === undefined) return utc;
  const offsetMs = (Number(offHour) * MINUTES_PER_HOUR + Number(offMinute)) * MS_PER_MINUTE;
  return sign === '-' ? utc + offsetMs : utc - offsetMs;
}

/**
 * Whether the habit is due on `dayKey` by the calendar alone (SPEC.md §6 "Scheduling").
 *
 * - `daily`: every day on or after `createdDayKey`.
 * - `weekdays`: the listed weekdays on or after `createdDayKey`.
 * - `timesPerWeek`: eligible **every** day — the weekly target decides whether it
 *   still shows on Today, which is {@link statusOn}'s job, not this one's.
 *
 * Archived habits are never scheduled (SPEC.md §6), so they are never reminded
 * or counted either: every rule here funnels through this function.
 */
export function isScheduledOn(habit: HabitLike, dayKey: DayKey): boolean {
  if (habit.archived) return false;
  if (compareDayKeys(dayKey, habit.createdDayKey) < 0) return false;
  switch (habit.schedule.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return habit.schedule.days.includes(weekday(dayKey));
    case 'timesPerWeek':
      return true;
    default:
      return false;
  }
}

/** The instant the habit is due on `dayKey`, resolved in the user's timezone. */
export function dueInstant(habit: HabitLike, dayKey: DayKey, tz: string): number {
  return localToInstant(dayKey, habit.time, tz);
}

/** Every scheduled day in `[from, to]`, oldest first. Empty when `to` is before `from`. */
export function scheduledDaysBetween(habit: HabitLike, from: DayKey, to: DayKey): DayKey[] {
  const days: DayKey[] = [];
  if (habit.archived) return days;
  // Nothing before creation is ever scheduled, so start the walk there.
  let day = compareDayKeys(from, habit.createdDayKey) < 0 ? habit.createdDayKey : from;
  while (compareDayKeys(day, to) <= 0) {
    if (isScheduledOn(habit, day)) days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

/** `done` logs for one habit in the 7 days starting at `weekStart` (a `DayKey`). */
export function doneCountInWeek(logs: LogDTO[], habitId: string, weekStart: DayKey): number {
  const end = addDays(weekStart, DAYS_PER_WEEK - 1);
  let count = 0;
  for (const log of logs) {
    if (log.habitId !== habitId) continue;
    if (log.status !== 'done') continue;
    if (compareDayKeys(log.dayKey, weekStart) < 0) continue;
    if (compareDayKeys(log.dayKey, end) > 0) continue;
    count += 1;
  }
  return count;
}

/** Days left in the current week counting today itself: 7 on the first day, 1 on the last. */
export function remainingDaysInWeek(todayKey: DayKey, weekStart: WeekStart): number {
  return DAYS_PER_WEEK - diffDays(weekStartKey(todayKey, weekStart), todayKey);
}

/**
 * A `timesPerWeek` habit is **at risk** when it can no longer reach its target:
 * `remainingDaysInWeek (including today) < count − doneThisWeek` (SPEC.md §6).
 * Always `false` for other schedules and for archived habits.
 */
export function isAtRisk(args: {
  habit: HabitLike;
  todayKey: DayKey;
  weekStart: WeekStart;
  doneThisWeek: number;
}): boolean {
  const { habit, todayKey, weekStart, doneThisWeek } = args;
  if (habit.archived) return false;
  if (habit.schedule.kind !== 'timesPerWeek') return false;
  return remainingDaysInWeek(todayKey, weekStart) < habit.schedule.count - doneThisWeek;
}

/**
 * Backfill window (SPEC.md §6 "Actions"): a log may be written for any scheduled
 * day from `createdDayKey` through today in the user's timezone. Future days are
 * rejected — the API turns a `false` here into a 422.
 */
export function canLogOn(habit: HabitLike, dayKey: DayKey, todayKey: DayKey): boolean {
  if (compareDayKeys(dayKey, todayKey) > 0) return false;
  return isScheduledOn(habit, dayKey);
}

/**
 * The snooze's `until` in epoch ms when it is active for `(habitId, dayKey)` at
 * `now`, otherwise `null`. A snooze is one row per habit (SPEC.md §8), so it only
 * counts for the day it was taken on.
 */
export function activeSnoozeUntil(
  snooze: SnoozeDTO | undefined,
  habitId: string,
  dayKey: DayKey,
  now: number,
): number | null {
  if (snooze === undefined) return null;
  if (snooze.habitId !== habitId) return null;
  if (snooze.dayKey !== dayKey) return null;
  const until = parseInstant(snooze.until);
  return until > now ? until : null;
}

function logStatusFor(
  log: LogDTO | undefined,
  habitId: string,
  dayKey: DayKey,
): LogStatus | undefined {
  if (log === undefined) return undefined;
  if (log.habitId !== habitId || log.dayKey !== dayKey) return undefined;
  return log.status;
}

/**
 * How one habit stands on one day (SPEC.md §6 "Status on a day").
 *
 * Resolution order, and the readings chosen where §6 is silent:
 *  1. **A log wins.** `done` / `skipped` is reported even if the habit is no
 *     longer scheduled that day (schedules change; history should still show
 *     what happened).
 *  2. Not scheduled → `unscheduled`.
 *  3. An active snooze on today or a past day → `snoozed`.
 *  4. `timesPerWeek` is **never `overdue`**: there is no per-day obligation.
 *     Today (or a future day) is `upcoming` while the weekly target is unmet and
 *     `unscheduled` once it is met — that is the "shown on Today until the week's
 *     done count reaches count" rule. An unlogged **past** day is `unscheduled`
 *     rather than `missed` for the same reason; these habits are scored per week
 *     in `metrics.ts`.
 *  5. Today, due instant ≤ now → `overdue`; due instant in the future → `upcoming`.
 *  6. A past day with no log → `missed`; a future day → `upcoming`.
 */
export function statusOn(args: {
  habit: HabitLike;
  dayKey: DayKey;
  todayKey: DayKey;
  now: number;
  tz: string;
  weekStart: WeekStart;
  log?: LogDTO | undefined;
  snooze?: SnoozeDTO | undefined;
  doneThisWeek?: number;
}): DayStatus {
  const { habit, dayKey, todayKey, now, tz, log, snooze, doneThisWeek = 0 } = args;

  const logged = logStatusFor(log, habit.id, dayKey);
  if (logged !== undefined) return logged;

  if (!isScheduledOn(habit, dayKey)) return 'unscheduled';

  const dayVsToday = compareDayKeys(dayKey, todayKey);

  if (dayVsToday <= 0 && activeSnoozeUntil(snooze, habit.id, dayKey, now) !== null) {
    return 'snoozed';
  }

  if (habit.schedule.kind === 'timesPerWeek') {
    if (dayVsToday < 0) return 'unscheduled';
    return doneThisWeek >= habit.schedule.count ? 'unscheduled' : 'upcoming';
  }

  if (dayVsToday < 0) return 'missed';
  if (dayVsToday > 0) return 'upcoming';
  return dueInstant(habit, dayKey, tz) <= now ? 'overdue' : 'upcoming';
}
