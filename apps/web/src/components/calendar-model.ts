/**
 * The Calendar's arithmetic (SPEC.md §11 "Calendar"): which days a grid shows,
 * which log range it needs, and how full each day is.
 *
 * Every date step goes through `@beta/core` (SPEC.md §7), and whether a habit
 * is due on a day is core's `isScheduledOn` — the same answer the API uses to
 * accept or refuse a backfilled log. Pure, like `today-model.tsx`.
 */
import {
  type DayKey,
  type HabitDTO,
  type LogDTO,
  type LogStatus,
  type WeekStart,
  DAYS_PER_WEEK,
  addDays,
  compareDayKeys,
  daysInMonth,
  isScheduledOn,
  makeDayKey,
  weekStartKey,
  WEEKDAY_LABELS,
} from '@beta/core';

/** SPEC.md §11: the Year view is a 53-week grid. */
export const YEAR_WEEKS = 53;

/** One row of a grid: seven consecutive days starting on the user's week start. */
export type Week = DayKey[];

export type DayRange = { from: DayKey; to: DayKey };

/** How much of a day's work was done, for shading. */
export type DayTally = { due: number; done: number };

/** `none` covers both "nothing due" and "due but nothing done". */
export type DayShade = 'future' | 'none' | 'partial' | 'full';

export type LogIndex = Map<string, LogStatus>;

const logKey = (habitId: string, dayKey: DayKey): string => `${habitId}|${dayKey}`;

export function indexLogs(logs: LogDTO[]): LogIndex {
  const index: LogIndex = new Map();
  for (const log of logs) index.set(logKey(log.habitId, log.dayKey), log.status);
  return index;
}

export function logStatus(index: LogIndex, habitId: string, dayKey: DayKey): LogStatus | undefined {
  return index.get(logKey(habitId, dayKey));
}

function weeksFrom(first: DayKey, count: number): Week[] {
  const weeks: Week[] = [];
  let day = first;
  for (let w = 0; w < count; w += 1) {
    const week: Week = [];
    for (let d = 0; d < DAYS_PER_WEEK; d += 1) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Every full week that touches the month, aligned to `weekStart`. */
export function monthWeeks(year: number, month: number, weekStart: WeekStart): Week[] {
  const first = weekStartKey(makeDayKey(year, month, 1), weekStart);
  const last = makeDayKey(year, month, daysInMonth(year, month));
  const weeks: Week[] = [];
  for (let start = first; compareDayKeys(start, last) <= 0; start = addDays(start, DAYS_PER_WEEK)) {
    weeks.push(...weeksFrom(start, 1));
  }
  return weeks;
}

/**
 * {@link YEAR_WEEKS} weeks ending with the current one, oldest first, each
 * starting on `weekStart`. 371 days — inside the API's 400-day log range.
 */
export function yearWeeks(todayKey: DayKey, weekStart: WeekStart): Week[] {
  const currentWeek = weekStartKey(todayKey, weekStart);
  return weeksFrom(addDays(currentWeek, -(YEAR_WEEKS - 1) * DAYS_PER_WEEK), YEAR_WEEKS);
}

/** The log range a grid needs: its first day to its last. */
export function rangeOf(weeks: Week[]): DayRange {
  const from = weeks[0]?.[0];
  const to = weeks.at(-1)?.at(-1);
  if (from === undefined || to === undefined) throw new RangeError('A grid has at least one week');
  return { from, to };
}

/** 'MON' … 'SUN' for a Monday week, 'SUN' … 'SAT' for a Sunday one. */
export function weekdayHeaders(weekStart: WeekStart): string[] {
  return Array.from(
    { length: DAYS_PER_WEEK },
    (_, i) => WEEKDAY_LABELS[(weekStart + i) % DAYS_PER_WEEK] ?? '',
  );
}

/** The month `delta` months from `(year, month)`. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * Done against due for one day.
 *
 * - `daily` / `weekdays`: due when scheduled; a `skipped` day is left out of
 *   both sides, as accuracy leaves it out (SPEC.md §6 "Accuracy").
 * - `timesPerWeek`: no single day owes anything, so it only counts on a day it
 *   was done — otherwise a three-a-week habit would shade every other day as
 *   a failure.
 */
export function tallyDay(habits: HabitDTO[], index: LogIndex, dayKey: DayKey): DayTally {
  const tally: DayTally = { due: 0, done: 0 };
  for (const habit of habits) {
    if (!isScheduledOn(habit, dayKey)) continue;
    const status = logStatus(index, habit.id, dayKey);
    if (habit.schedule.kind === 'timesPerWeek') {
      if (status === 'done') {
        tally.due += 1;
        tally.done += 1;
      }
      continue;
    }
    if (status === 'skipped') continue;
    tally.due += 1;
    if (status === 'done') tally.done += 1;
  }
  return tally;
}

export function shadeFor(tally: DayTally, dayKey: DayKey, todayKey: DayKey): DayShade {
  if (compareDayKeys(dayKey, todayKey) > 0) return 'future';
  if (tally.due === 0 || tally.done === 0) return 'none';
  return tally.done >= tally.due ? 'full' : 'partial';
}

/** The words behind a cell's colour, for its accessible name. */
export function tallyLabel(tally: DayTally, shade: DayShade): string {
  if (shade === 'future') return 'upcoming';
  if (tally.due === 0) return 'nothing due';
  return `${tally.done} of ${tally.due} done`;
}
