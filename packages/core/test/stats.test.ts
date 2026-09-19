import { describe, it, expect } from 'vitest';
import {
  MAX_STREAK_LOOKBACK_DAYS,
  STATS_STRIP_DAYS,
  buildStats,
  statsHistoryFrom,
} from '../src/metrics';
import { addDays } from '../src/time';
import { habit, timesPerWeek, log, done, at, THURSDAY } from './factories';

/**
 * `buildStats` (SPEC.md §9 `/stats`, §11 "Stats"). The numbers below are worked
 * by hand from the fixture, not read back from the functions under test.
 */

const MON = 1 as const;
const TZ = 'Asia/Dubai';
/** 07:12 on Thursday 17 Sep — before the 07:30 due time. */
const BEFORE_DUE = at(THURSDAY, '07:12', TZ);
/** 08:00 — after it. */
const AFTER_DUE = at(THURSDAY, '08:00', TZ);

/**
 * Daily from Thu 10 Sep: done 10, 11; skipped 12; missed 13; done 14, 15, 16;
 * today (17) unlogged.
 */
const DAILY = habit({ id: 'daily', createdDayKey: '2026-09-10' });
const DAILY_LOGS = [
  ...done(['2026-09-10', '2026-09-11'], 'daily'),
  log('2026-09-12', 'skipped', 'daily'),
  ...done(['2026-09-14', '2026-09-15', '2026-09-16'], 'daily'),
];

function stats(overrides: Partial<Parameters<typeof buildStats>[0]> = {}) {
  return buildStats({
    habits: [DAILY],
    logs: DAILY_LOGS,
    todayKey: THURSDAY,
    now: BEFORE_DUE,
    tz: TZ,
    weekStart: MON,
    range: 30,
    ...overrides,
  });
}

function statusOf(result: ReturnType<typeof buildStats>, habitId: string, dayKey: string) {
  const entry = result.habits.find((candidate) => candidate.habitId === habitId);
  return entry?.last30.find((day) => day.dayKey === dayKey)?.status;
}

describe('buildStats — per habit', () => {
  it('computes streaks and 30-day accuracy from the rules in SPEC.md §6', () => {
    const [daily] = stats().habits;
    // Back from today: 16, 15, 14 done, then 13 missed.
    expect(daily?.currentStreak).toBe(3);
    // 10, 11 (12 skipped is neutral) then broken by 13; 14–16 is the longer run.
    expect(daily?.bestStreak).toBe(3);
    // Five done against one missed; the skip and the unlogged today are excluded.
    expect(daily?.accuracy30).toBeCloseTo(5 / 6);
  });

  it('ends the 30-day strip today, oldest first, with every day present', () => {
    const [daily] = stats().habits;
    const days = daily?.last30.map((entry) => entry.dayKey) ?? [];
    expect(days).toHaveLength(STATS_STRIP_DAYS);
    expect(days[0]).toBe(addDays(THURSDAY, -(STATS_STRIP_DAYS - 1)));
    expect(days.at(-1)).toBe(THURSDAY);
  });

  it('gives each day of the strip its status', () => {
    const result = stats();
    expect(statusOf(result, 'daily', '2026-09-09'), 'before creation').toBe('unscheduled');
    expect(statusOf(result, 'daily', '2026-09-10')).toBe('done');
    expect(statusOf(result, 'daily', '2026-09-12')).toBe('skipped');
    expect(statusOf(result, 'daily', '2026-09-13')).toBe('missed');
    expect(statusOf(result, 'daily', THURSDAY), 'unlogged, before 07:30').toBe('upcoming');
    expect(statusOf(stats({ now: AFTER_DUE }), 'daily', THURSDAY), 'after 07:30').toBe('overdue');
  });

  it("uses the week's done count for a timesPerWeek habit's today", () => {
    const weekly = habit({ id: 'weekly', schedule: timesPerWeek(2), createdDayKey: '2026-09-01' });
    const oneDone = stats({ habits: [weekly], logs: done(['2026-09-14'], 'weekly') });
    expect(statusOf(oneDone, 'weekly', THURSDAY), '1 of 2: still to do').toBe('upcoming');
    expect(statusOf(oneDone, 'weekly', '2026-09-14')).toBe('done');
    expect(statusOf(oneDone, 'weekly', '2026-09-15'), 'no per-day obligation').toBe('unscheduled');

    const met = stats({ habits: [weekly], logs: done(['2026-09-14', '2026-09-15'], 'weekly') });
    expect(statusOf(met, 'weekly', THURSDAY), 'target met').toBe('unscheduled');
  });

  it('leaves archived habits out entirely', () => {
    const archived = habit({ id: 'archived', archived: true, createdDayKey: '2026-09-01' });
    const result = stats({
      habits: [DAILY, archived],
      logs: [...DAILY_LOGS, ...done(['2026-09-16'], 'archived')],
    });
    expect(result.habits.map((entry) => entry.habitId)).toEqual(['daily']);
  });
});

describe('buildStats — overall accuracy', () => {
  it('covers exactly the requested range, ending today', () => {
    // 11–17 Sep: done 11, 14, 15, 16; missed 13; skipped 12; today unlogged.
    expect(stats({ range: 7 }).overallAccuracy).toBeCloseTo(4 / 5);
    // 30 and 90 days both reach back past creation: 5 done, 1 missed.
    expect(stats({ range: 30 }).overallAccuracy).toBeCloseTo(5 / 6);
    expect(stats({ range: 90 }).overallAccuracy).toBeCloseTo(5 / 6);
  });

  it('echoes the range and the day it was computed for', () => {
    const result = stats({ range: 90 });
    expect(result.range).toBe(90);
    expect(result.dayKey).toBe(THURSDAY);
  });

  it('is null, not 0, when nothing was scheduled', () => {
    const result = stats({ habits: [], logs: [] });
    expect(result.overallAccuracy).toBeNull();
    expect(result.habits).toEqual([]);
  });
});

describe('statsHistoryFrom', () => {
  it('reaches back to the earliest counted habit', () => {
    const older = habit({ id: 'older', createdDayKey: '2025-03-01' });
    const archivedOlder = habit({ id: 'gone', createdDayKey: '2024-01-01', archived: true });
    expect(statsHistoryFrom([DAILY, older, archivedOlder], THURSDAY)).toBe('2025-03-01');
  });

  it('never reaches further back than the streak lookback', () => {
    const ancient = habit({ createdDayKey: '1990-01-01' });
    expect(statsHistoryFrom([ancient], THURSDAY)).toBe(
      addDays(THURSDAY, -MAX_STREAK_LOOKBACK_DAYS),
    );
  });

  it('is today when there is nothing to count', () => {
    expect(statsHistoryFrom([], THURSDAY)).toBe(THURSDAY);
  });
});
