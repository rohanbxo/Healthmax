/**
 * Streaks and accuracy (SPEC.md §6 "Streaks", "Accuracy").
 *
 * Every function indexes the caller's logs by `dayKey` **once** and then walks
 * calendar days, so a 90-day range over many habits stays linear rather than
 * re-scanning the log array for each day. Backwards walks always terminate:
 * at `createdDayKey`, or at {@link MAX_STREAK_LOOKBACK_DAYS} before today,
 * whichever is later.
 *
 * Known limitation (SPEC.md §6): a habit's *current* schedule is applied to all
 * of its history — schedule changes are not versioned.
 */

import type {
  DayKey,
  DayStatus,
  HabitStatsDTO,
  LogDTO,
  LogStatus,
  StatsDTO,
  StatsRange,
  WeekStart,
} from './types';
import { DAYS_PER_WEEK, addDays, compareDayKeys, weekStartKey } from './time';
import { type HabitLike, isScheduledOn, statusOn } from './rules';

/**
 * Hard stop for a backwards walk, in case a habit carries an absurd
 * `createdDayKey`. Ten years is far beyond any streak this app will show.
 */
export const MAX_STREAK_LOOKBACK_DAYS = 3660;

/** One habit's logs, keyed by day. */
type LogIndex = Map<DayKey, LogStatus>;

function indexLogs(logs: LogDTO[], habitId: string): LogIndex {
  const index: LogIndex = new Map();
  for (const log of logs) {
    if (log.habitId === habitId) index.set(log.dayKey, log.status);
  }
  return index;
}

function indexLogsByHabit(logs: LogDTO[]): Map<string, LogIndex> {
  const byHabit = new Map<string, LogIndex>();
  for (const log of logs) {
    let index = byHabit.get(log.habitId);
    if (index === undefined) {
      index = new Map();
      byHabit.set(log.habitId, index);
    }
    index.set(log.dayKey, log.status);
  }
  return byHabit;
}

function laterDayKey(a: DayKey, b: DayKey): DayKey {
  return compareDayKeys(a, b) >= 0 ? a : b;
}

/** The oldest day any walk for this habit may reach. */
function walkFloor(habit: HabitLike, todayKey: DayKey): DayKey {
  return laterDayKey(habit.createdDayKey, addDays(todayKey, -MAX_STREAK_LOOKBACK_DAYS));
}

/** `done` logs in the 7 days starting at `weekStartDay`. */
function doneInWeek(index: LogIndex, weekStartDay: DayKey): number {
  let count = 0;
  let day = weekStartDay;
  for (let i = 0; i < DAYS_PER_WEEK; i += 1) {
    if (index.get(day) === 'done') count += 1;
    day = addDays(day, 1);
  }
  return count;
}

function isTimesPerWeek(habit: HabitLike): habit is HabitLike & {
  schedule: { kind: 'timesPerWeek'; count: number };
} {
  return habit.schedule.kind === 'timesPerWeek';
}

/** The first week a `timesPerWeek` walk may reach: the week containing `walkFloor`. */
function weekFloor(habit: HabitLike, todayKey: DayKey, weekStart: WeekStart): DayKey {
  return weekStartKey(walkFloor(habit, todayKey), weekStart);
}

/**
 * Current streak (SPEC.md §6 "Streaks").
 *
 * - `daily` / `weekdays`: walk back over scheduled days — `done` adds 1,
 *   `skipped` is neutral (the walk continues but the streak does not grow),
 *   an unlogged past day stops the walk, and an unlogged **today** is ignored so
 *   a streak survives until the day is actually missed.
 * - `timesPerWeek`: consecutive weeks reaching `count`. The current week counts
 *   only once it is already satisfied; while it is still in progress it neither
 *   adds to nor breaks the streak.
 *
 * Archived habits are never counted (SPEC.md §6) and always return 0.
 */
export function currentStreak(args: {
  habit: HabitLike;
  logs: LogDTO[];
  todayKey: DayKey;
  weekStart: WeekStart;
}): number {
  const { habit, logs, todayKey, weekStart } = args;
  if (habit.archived) return 0;
  const index = indexLogs(logs, habit.id);

  if (isTimesPerWeek(habit)) {
    const target = habit.schedule.count;
    const currentWeek = weekStartKey(todayKey, weekStart);
    const floor = weekFloor(habit, todayKey, weekStart);
    let streak = 0;
    let week = currentWeek;
    while (compareDayKeys(week, floor) >= 0) {
      if (doneInWeek(index, week) >= target) {
        streak += 1;
      } else if (compareDayKeys(week, currentWeek) !== 0) {
        break; // A finished week that fell short ends the streak.
      }
      week = addDays(week, -DAYS_PER_WEEK);
    }
    return streak;
  }

  const floor = walkFloor(habit, todayKey);
  let streak = 0;
  let day = todayKey;
  while (compareDayKeys(day, floor) >= 0) {
    if (isScheduledOn(habit, day)) {
      const status = index.get(day);
      if (status === 'done') {
        streak += 1;
      } else if (status !== 'skipped' && compareDayKeys(day, todayKey) !== 0) {
        break; // Missed.
      }
    }
    day = addDays(day, -1);
  }
  return streak;
}

/**
 * The longest run ever achieved, under the same rules as {@link currentStreak},
 * walked forward from `createdDayKey` (SPEC.md §6 "Best streak").
 */
export function bestStreak(args: {
  habit: HabitLike;
  logs: LogDTO[];
  todayKey: DayKey;
  weekStart: WeekStart;
}): number {
  const { habit, logs, todayKey, weekStart } = args;
  if (habit.archived) return 0;
  if (compareDayKeys(habit.createdDayKey, todayKey) > 0) return 0;
  const index = indexLogs(logs, habit.id);

  let best = 0;
  let run = 0;

  if (isTimesPerWeek(habit)) {
    const target = habit.schedule.count;
    const currentWeek = weekStartKey(todayKey, weekStart);
    let week = weekFloor(habit, todayKey, weekStart);
    while (compareDayKeys(week, currentWeek) <= 0) {
      if (doneInWeek(index, week) >= target) {
        run += 1;
        if (run > best) best = run;
      } else if (compareDayKeys(week, currentWeek) !== 0) {
        run = 0; // An unsatisfied finished week breaks the run.
      }
      week = addDays(week, DAYS_PER_WEEK);
    }
    return best;
  }

  let day = walkFloor(habit, todayKey);
  while (compareDayKeys(day, todayKey) <= 0) {
    if (isScheduledOn(habit, day)) {
      const status = index.get(day);
      if (status === 'done') {
        run += 1;
        if (run > best) best = run;
      } else if (status !== 'skipped' && compareDayKeys(day, todayKey) !== 0) {
        run = 0; // Missed.
      }
    }
    day = addDays(day, 1);
  }
  return best;
}

/** Numerator and denominator of an accuracy ratio, so habits can be pooled. */
type AccuracyCounts = { done: number; missed: number };

function accuracyCounts(
  habit: HabitLike,
  index: LogIndex,
  from: DayKey,
  to: DayKey,
  todayKey: DayKey,
  weekStart: WeekStart,
): AccuracyCounts {
  const counts: AccuracyCounts = { done: 0, missed: 0 };
  if (habit.archived) return counts;

  if (isTimesPerWeek(habit)) {
    // Scored per week: a finished week that reached `count` is one `done`,
    // a finished week that fell short is one `missed`. The current week is still
    // in progress and future weeks have not happened, so neither is scored.
    const target = habit.schedule.count;
    const currentWeek = weekStartKey(todayKey, weekStart);
    const lastWeek = weekStartKey(to, weekStart);
    let week = weekStartKey(from, weekStart);
    while (compareDayKeys(week, lastWeek) <= 0 && compareDayKeys(week, currentWeek) < 0) {
      // Skip weeks that ended before the habit existed.
      if (compareDayKeys(addDays(week, DAYS_PER_WEEK - 1), habit.createdDayKey) >= 0) {
        if (doneInWeek(index, week) >= target) counts.done += 1;
        else counts.missed += 1;
      }
      week = addDays(week, DAYS_PER_WEEK);
    }
    return counts;
  }

  // Pre-creation days are excluded, and today counts only once it is logged.
  let day = compareDayKeys(from, habit.createdDayKey) < 0 ? habit.createdDayKey : from;
  const last = compareDayKeys(to, todayKey) > 0 ? todayKey : to;
  while (compareDayKeys(day, last) <= 0) {
    if (isScheduledOn(habit, day)) {
      const status = index.get(day);
      if (status === 'done') counts.done += 1;
      else if (status === undefined && compareDayKeys(day, todayKey) !== 0) counts.missed += 1;
      // `skipped` is excluded from both sides of the ratio.
    }
    day = addDays(day, 1);
  }
  return counts;
}

function ratio(counts: AccuracyCounts): number | null {
  const denominator = counts.done + counts.missed;
  // Nothing was scheduled (or everything was skipped): there is no ratio to show.
  return denominator === 0 ? null : counts.done / denominator;
}

/**
 * `done / (done + missed)` over the habit's scheduled days in `[from, to]`
 * (SPEC.md §6 "Accuracy"). `skipped` days, days before `createdDayKey` and an
 * unlogged today are excluded. Returns `null` when the denominator is 0 —
 * never `0` and never `NaN`.
 */
export function accuracy(args: {
  habit: HabitLike;
  logs: LogDTO[];
  from: DayKey;
  to: DayKey;
  todayKey: DayKey;
  weekStart: WeekStart;
}): number | null {
  const { habit, logs, from, to, todayKey, weekStart } = args;
  if (compareDayKeys(from, to) > 0) return null;
  const index = indexLogs(logs, habit.id);
  return ratio(accuracyCounts(habit, index, from, to, todayKey, weekStart));
}

/**
 * Accuracy across every habit, pooled (one shared numerator and denominator)
 * rather than averaged per habit, so a habit scheduled 7 times a week weighs
 * more than one scheduled once. `null` when nothing was scheduled at all.
 */
export function overallAccuracy(args: {
  habits: HabitLike[];
  logs: LogDTO[];
  from: DayKey;
  to: DayKey;
  todayKey: DayKey;
  weekStart: WeekStart;
}): number | null {
  const { habits, logs, from, to, todayKey, weekStart } = args;
  if (compareDayKeys(from, to) > 0) return null;
  const byHabit = indexLogsByHabit(logs);
  const total: AccuracyCounts = { done: 0, missed: 0 };
  const empty: LogIndex = new Map();
  for (const habit of habits) {
    const index = byHabit.get(habit.id) ?? empty;
    const counts = accuracyCounts(habit, index, from, to, todayKey, weekStart);
    total.done += counts.done;
    total.missed += counts.missed;
  }
  return ratio(total);
}

/* ------------------------------------------------------------ stats payload */

/** The per-habit accuracy window and dot strip length (SPEC.md §9 `/stats`). */
export const STATS_STRIP_DAYS = 30;

/**
 * The oldest day whose logs {@link buildStats} can read: the earliest
 * `createdDayKey` among the counted habits, but never further back than
 * {@link MAX_STREAK_LOOKBACK_DAYS}. Loading `[statsHistoryFrom, todayKey]` gives
 * the streak walks everything they can reach, and nothing they cannot.
 */
export function statsHistoryFrom(habits: HabitLike[], todayKey: DayKey): DayKey {
  let earliest = todayKey;
  for (const habit of habits) {
    if (habit.archived) continue;
    const floor = walkFloor(habit, todayKey);
    if (compareDayKeys(floor, earliest) < 0) earliest = floor;
  }
  return earliest;
}

/**
 * `GET /stats` in one pure function (SPEC.md §9, §11 "Stats").
 *
 * - `overallAccuracy` pools every counted habit over the last `range` days.
 * - Each habit gets its current and best streak, its 30-day accuracy, and the
 *   last 30 days' statuses, oldest first, ending today.
 *
 * Archived habits are left out entirely: SPEC.md §6 says they are never
 * counted. `logs` must cover `[statsHistoryFrom(habits, todayKey), todayKey]`.
 *
 * Today's dot is computed without the snooze, so a snoozed habit reads as
 * `overdue` or `upcoming` here. That keeps the payload independent of snoozes,
 * which do not affect stats (SPEC.md §6) and so do not invalidate its cache.
 */
export function buildStats(args: {
  habits: (HabitLike & { id: string })[];
  logs: LogDTO[];
  todayKey: DayKey;
  now: number;
  tz: string;
  weekStart: WeekStart;
  range: StatsRange;
}): StatsDTO {
  const { logs, todayKey, now, tz, weekStart, range } = args;
  const habits = args.habits.filter((habit) => !habit.archived);
  const byHabit = indexLogsByHabit(logs);
  const empty: LogIndex = new Map();
  const stripFrom = addDays(todayKey, -(STATS_STRIP_DAYS - 1));
  const currentWeek = weekStartKey(todayKey, weekStart);

  const perHabit: HabitStatsDTO[] = habits.map((habit) => {
    const index = byHabit.get(habit.id) ?? empty;
    // Only today's `timesPerWeek` status reads the week's count; every other
    // day resolves before `statusOn` looks at it.
    const doneThisWeek = doneInWeek(index, currentWeek);

    const last30: { dayKey: DayKey; status: DayStatus }[] = [];
    for (let day = stripFrom; compareDayKeys(day, todayKey) <= 0; day = addDays(day, 1)) {
      const status = index.get(day);
      last30.push({
        dayKey: day,
        status: statusOn({
          habit,
          dayKey: day,
          todayKey,
          now,
          tz,
          weekStart,
          log: status === undefined ? undefined : { habitId: habit.id, dayKey: day, status },
          doneThisWeek,
        }),
      });
    }

    return {
      habitId: habit.id,
      currentStreak: currentStreak({ habit, logs, todayKey, weekStart }),
      bestStreak: bestStreak({ habit, logs, todayKey, weekStart }),
      accuracy30: ratio(accuracyCounts(habit, index, stripFrom, todayKey, todayKey, weekStart)),
      last30,
    };
  });

  return {
    range,
    dayKey: todayKey,
    overallAccuracy: overallAccuracy({
      habits,
      logs,
      from: addDays(todayKey, -(range - 1)),
      to: todayKey,
      todayKey,
      weekStart,
    }),
    habits: perHabit,
  };
}
