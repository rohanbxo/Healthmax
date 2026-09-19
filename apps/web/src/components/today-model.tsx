/**
 * Turns one `GET /today` payload plus the current instant into the sections the
 * Today screen draws (SPEC.md §4.1–§4.7).
 *
 * Nothing here re-derives "is it overdue": every classification comes from
 * `@beta/core` — `statusOn` decides the section, `isAtRisk` decides the badge,
 * `dueInstant` decides the ordering and the countdowns. That is what keeps the
 * client and the reminder worker agreeing about what is due.
 *
 * This module is pure: given the same payload and instant it returns the same
 * model, which is what makes the 30-second tick a re-render and not a refetch.
 */
import {
  type DayKey,
  type DayStatus,
  type HabitDTO,
  type LogDTO,
  type SnoozeDTO,
  type TodayDTO,
  MS_PER_MINUTE,
  currentStreak,
  doneCountInWeek,
  dueInstant,
  formatDateHeader,
  formatTime,
  isAtRisk,
  parseInstant,
  statusOn,
  todayKey,
  weekStartKey,
} from '@beta/core';

/** One habit's standing on Today, with everything the row needs to render. */
export type TodayEntry = {
  habit: HabitDTO;
  status: DayStatus;
  /** Epoch ms the habit is due today, in the user's timezone. */
  due: number;
  /** The due time as 'HH:mm'. */
  timeLabel: string;
  /** Current streak from the logs `/today` carries (see the note on `streak`). */
  streak: number;
  doneThisWeek: number;
  /** `timesPerWeek` target, or `null` for daily and weekday habits. */
  weeklyTarget: number | null;
  atRisk: boolean;
  /** Epoch ms an active snooze runs to, or `null`. */
  snoozeUntil: number | null;
};

export type TodayModel = {
  now: number;
  timeZone: string;
  dayKey: DayKey;
  /** 'THU · 17 SEP'. */
  dateLabel: string;
  /** '07:12' — the 56px clock. */
  clockLabel: string;
  /** 'Dubai · 3 of 7 done'. */
  progressLabel: string;
  dueTotal: number;
  doneTotal: number;
  nextUp: TodayEntry | null;
  overdue: TodayEntry[];
  snoozed: TodayEntry[];
  later: TodayEntry[];
  week: TodayEntry[];
  finished: TodayEntry[];
  /** Nothing is due at all today — the SPEC §4.10 empty state. */
  isEmpty: boolean;
};

const MINUTES_PER_HOUR = 60;

/** Statuses that put a habit on Today at all; the rest are `unscheduled`. */
const DUE_STATUSES: ReadonlySet<DayStatus> = new Set<DayStatus>([
  'done',
  'skipped',
  'snoozed',
  'overdue',
  'upcoming',
]);

function findLog(logs: LogDTO[], habitId: string, dayKey: DayKey): LogDTO | undefined {
  return logs.find((log) => log.habitId === habitId && log.dayKey === dayKey);
}

function findSnooze(snoozes: SnoozeDTO[], habitId: string): SnoozeDTO | undefined {
  return snoozes.find((snooze) => snooze.habitId === habitId);
}

/**
 * 'Asia/Dubai' → 'Dubai' for the header line (SPEC.md §4.1). A zone id is an
 * ASCII path, so this is string work, never a `Date` or `Intl` lookup.
 */
export function cityFromTimeZone(timeZone: string): string {
  const segments = timeZone.split('/');
  const last = segments[segments.length - 1] ?? timeZone;
  return last.replace(/_/g, ' ');
}

/** 'IN 18 MIN' / 'IN 2H 05M' / 'NOW' — the next-up countdown (SPEC.md §4.2). */
export function countdownLabel(due: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((due - now) / MS_PER_MINUTE));
  if (minutes === 0) return 'NOW';
  if (minutes < MINUTES_PER_HOUR) return `IN ${minutes} MIN`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return `IN ${hours}H ${String(rest).padStart(2, '0')}M`;
}

/** '42 min late' / '2h 05m late' — the overdue row's red meta (SPEC.md §4.3). */
export function lateLabel(due: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - due) / MS_PER_MINUTE));
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min late`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return `${hours}h ${String(rest).padStart(2, '0')}m late`;
}

/** 'until 07:27' for a snoozed row (SPEC.md §4.4). */
export function untilLabel(until: number, timeZone: string): string {
  return `until ${formatTime(until, timeZone)}`;
}

/** '12-day streak', or `null` when there is nothing to boast about yet. */
export function streakLabel(streak: number): string | null {
  return streak > 0 ? `${streak}-day streak` : null;
}

function byDueThenName(a: TodayEntry, b: TodayEntry): number {
  if (a.due !== b.due) return a.due - b.due;
  return a.habit.name.localeCompare(b.habit.name);
}

function byOrderThenName(a: TodayEntry, b: TodayEntry): number {
  if (a.habit.order !== b.habit.order) return a.habit.order - b.habit.order;
  return a.habit.name.localeCompare(b.habit.name);
}

/**
 * Builds one entry per live habit. `statusOn` is handed the log, the snooze and
 * the week's done count, so the section a habit lands in is core's decision.
 */
function buildEntries(today: TodayDTO, now: number, dayKey: DayKey): TodayEntry[] {
  const { timeZone, weekStart, habits, logs, snoozes } = today;
  const weekStartDay = weekStartKey(dayKey, weekStart);

  return habits
    .filter((habit) => !habit.archived)
    .map((habit) => {
      const doneThisWeek = doneCountInWeek(logs, habit.id, weekStartDay);
      const log = findLog(logs, habit.id, dayKey);
      const snooze = findSnooze(snoozes, habit.id);

      const status = statusOn({
        habit,
        dayKey,
        todayKey: dayKey,
        now,
        tz: timeZone,
        weekStart,
        log,
        snooze,
        doneThisWeek,
      });

      const due = dueInstant(habit, dayKey, timeZone);
      const snoozeUntil =
        status === 'snoozed' && snooze !== undefined ? parseInstant(snooze.until) : null;

      return {
        habit,
        status,
        due,
        timeLabel: formatTime(due, timeZone),
        // `/today` carries today plus the rest of this week (SPEC.md §9), so this
        // is the streak visible in that window; `/stats` owns the full history.
        streak: currentStreak({ habit, logs, todayKey: dayKey, weekStart }),
        doneThisWeek,
        weeklyTarget: habit.schedule.kind === 'timesPerWeek' ? habit.schedule.count : null,
        atRisk: isAtRisk({ habit, todayKey: dayKey, weekStart, doneThisWeek }),
        snoozeUntil,
      };
    });
}

export function buildTodayModel(today: TodayDTO, now: number): TodayModel {
  const { timeZone } = today;
  // Recomputed rather than read from the payload, so the screen rolls over at
  // midnight on its own tick instead of waiting for a refetch (SPEC.md §11).
  const dayKey = todayKey(now, timeZone);

  const entries = buildEntries(today, now, dayKey);
  const due = entries.filter((entry) => DUE_STATUSES.has(entry.status));

  const overdue = due.filter((entry) => entry.status === 'overdue').sort(byDueThenName);
  const snoozed = due.filter((entry) => entry.status === 'snoozed').sort(byDueThenName);
  const finished = due
    .filter((entry) => entry.status === 'done' || entry.status === 'skipped')
    .sort(byDueThenName);

  const upcoming = due.filter((entry) => entry.status === 'upcoming');
  // A `timesPerWeek` habit has no per-day obligation, so it never competes for
  // "next up" and never sits in "Later today" — it has its own section (§4.6).
  const week = upcoming.filter((entry) => entry.weeklyTarget !== null).sort(byOrderThenName);
  const timed = upcoming.filter((entry) => entry.weeklyTarget === null).sort(byDueThenName);

  const [nextUp = null, ...later] = timed;

  const doneTotal = due.filter((entry) => entry.status === 'done').length;

  return {
    now,
    timeZone,
    dayKey,
    dateLabel: formatDateHeader(now, timeZone),
    clockLabel: formatTime(now, timeZone),
    progressLabel: `${cityFromTimeZone(timeZone)} · ${doneTotal} of ${due.length} done`,
    dueTotal: due.length,
    doneTotal,
    nextUp,
    overdue,
    snoozed,
    later,
    week,
    finished,
    isEmpty: due.length === 0,
  };
}
