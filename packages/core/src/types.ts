/**
 * Shared domain types (SPEC.md §5).
 *
 * These cross the wire between the API and the web client, so they stay free of
 * Prisma, Express and React types.
 */

/** A calendar day in the user's timezone, formatted 'YYYY-MM-DD'. */
export type DayKey = string;

/** 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;

/** 'HH:mm' in the user's timezone. */
export type TimeOfDay = string;

/** An ISO-8601 instant, e.g. '2026-09-17T06:30:00.000Z'. */
export type Instant = string;

export type Schedule =
  | { kind: 'daily' }
  /** `days` holds weekday numbers 0–6, non-empty, unique and sorted. */
  | { kind: 'weekdays'; days: number[] }
  /** `count` is 1–7 completions per week. */
  | { kind: 'timesPerWeek'; count: number };

export type ScheduleKind = Schedule['kind'];

export type LogStatus = 'done' | 'skipped';

/**
 * How a habit stands on one day (SPEC.md §6 "Status on a day").
 * `unscheduled` means the habit is not due that day at all.
 */
export type DayStatus =
  'done' | 'skipped' | 'snoozed' | 'overdue' | 'upcoming' | 'missed' | 'unscheduled';

export type HabitDTO = {
  id: string;
  name: string;
  schedule: Schedule;
  time: TimeOfDay;
  remind: boolean;
  createdDayKey: DayKey;
  archived: boolean;
  order: number;
};

export type LogDTO = { habitId: string; dayKey: DayKey; status: LogStatus };

export type SnoozeDTO = { habitId: string; dayKey: DayKey; until: Instant };

export type MeDTO = {
  id: string;
  email: string;
  name: string;
  timeZone: string;
  weekStart: WeekStart;
  onboarded: boolean;
};

export type AuthDTO = { accessToken: string; me: MeDTO };

/**
 * `GET /api/today` (SPEC.md §9). `logs` covers today plus the rest of the
 * current week so the client can compute `timesPerWeek` progress locally.
 */
export type TodayDTO = {
  serverNow: Instant;
  dayKey: DayKey;
  timeZone: string;
  weekStart: WeekStart;
  habits: HabitDTO[];
  logs: LogDTO[];
  snoozes: SnoozeDTO[];
};

export type StatsRange = 7 | 30 | 90;

export type HabitStatsDTO = {
  habitId: string;
  currentStreak: number;
  bestStreak: number;
  /** `null` when nothing was scheduled in the window (SPEC.md §6 "Accuracy"). */
  accuracy30: number | null;
  /** Oldest first, exactly 30 entries ending today. */
  last30: { dayKey: DayKey; status: DayStatus }[];
};

export type StatsDTO = {
  range: StatsRange;
  dayKey: DayKey;
  overallAccuracy: number | null;
  habits: HabitStatsDTO[];
};

export type ExportDTO = {
  app: 'beta';
  schemaVersion: 1;
  exportedAt: Instant;
  me: MeDTO;
  habits: HabitDTO[];
  logs: LogDTO[];
};

export type PushSubscriptionDTO = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Minutes a snooze can run for (SPEC.md §6 "Actions"). */
export type SnoozeMinutes = 15 | 60 | 180;

/** Error envelope shared by every non-2xx response (SPEC.md §9). */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; details?: unknown[] };
};
