import { describe, it, expect } from 'vitest';
import { currentStreak, bestStreak, accuracy, overallAccuracy } from '../src/metrics';
import { habit, weekdaysSchedule, timesPerWeek, log, done, THURSDAY } from './factories';

/**
 * SPEC.md §6 "Streaks" and "Accuracy". Today is Thursday 2026-09-17 throughout;
 * a Monday-start week therefore begins on 2026-09-14.
 */

const MON = 1 as const;
const SUN = 0 as const;

describe('currentStreak — daily and weekday habits', () => {
  const h = habit({ createdDayKey: '2026-09-01' });

  it('counts consecutive done days, ignoring an unlogged today', () => {
    const logs = done(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(3);
  });

  it('keeps today counted once it is logged', () => {
    const logs = done(['2026-09-16', THURSDAY]);
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(2);
  });

  it('treats a skipped day as neutral: the streak survives but does not grow', () => {
    const logs = [log('2026-09-16', 'done'), log('2026-09-15', 'skipped'), log('2026-09-14', 'done')];
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(2);
  });

  it('stops at a missed day', () => {
    // 2026-09-15 has no log at all, so the walk ends there.
    const logs = done(['2026-09-16', '2026-09-14', '2026-09-13']);
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(1);
  });

  it('is 0 with no logs', () => {
    expect(currentStreak({ habit: h, logs: [], todayKey: THURSDAY, weekStart: MON })).toBe(0);
  });

  it('walks only scheduled days for a weekday habit', () => {
    // Mon/Wed/Fri: Thursday is not scheduled, so it cannot break anything.
    const mwf = habit({ schedule: weekdaysSchedule(1, 3, 5), createdDayKey: '2026-09-01' });
    const logs = done(['2026-09-16', '2026-09-14', '2026-09-11']); // Wed, Mon, Fri
    expect(currentStreak({ habit: mwf, logs, todayKey: THURSDAY, weekStart: MON })).toBe(3);
  });

  it('is 0 for an archived habit', () => {
    const archived = habit({ archived: true, createdDayKey: '2026-09-01' });
    const logs = done(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(currentStreak({ habit: archived, logs, todayKey: THURSDAY, weekStart: MON })).toBe(0);
  });
});

describe('currentStreak — timesPerWeek', () => {
  const h = habit({ schedule: timesPerWeek(3), createdDayKey: '2026-08-01' });

  it('counts consecutive weeks that reached the target', () => {
    const logs = done([
      // current week (starts 2026-09-14): satisfied
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      // previous week (2026-09-07): satisfied
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      // week of 2026-08-31: fell short
      '2026-08-31',
      '2026-09-01',
    ]);
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(2);
  });

  it('counts the current week only once it is already satisfied', () => {
    const logs = done([
      '2026-09-14', // current week: only 1 of 3 so far
      '2026-09-07',
      '2026-09-08',
      '2026-09-09', // previous week: satisfied
      '2026-08-31',
      '2026-09-01', // week before: fell short
    ]);
    // The unfinished current week neither adds to the streak nor breaks it.
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(1);
  });

  it('follows the user week start', () => {
    // These three days are one Sunday-start week (2026-09-13) but straddle two
    // Monday-start weeks.
    const logs = done(['2026-09-13', '2026-09-14', '2026-09-15']);
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: SUN })).toBe(1);
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(0);
  });
});

describe('bestStreak', () => {
  it('finds the longest run in the habit history, not the current one', () => {
    const h = habit({ createdDayKey: '2026-09-01' });
    const logs = done([
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06', // a run of 5
      '2026-09-16', // then a miss on 09-07, and a single recent day
    ]);
    expect(bestStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(5);
    expect(currentStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(1);
  });

  it('lets skipped days bridge a run, exactly as the current streak does', () => {
    const h = habit({ createdDayKey: '2026-09-14' });
    const logs = [
      log('2026-09-14', 'done'),
      log('2026-09-15', 'skipped'),
      log('2026-09-16', 'done'),
    ];
    expect(bestStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(2);
  });

  it('is 0 for a habit created in the future and for an archived habit', () => {
    expect(
      bestStreak({
        habit: habit({ createdDayKey: '2026-09-20' }),
        logs: [],
        todayKey: THURSDAY,
        weekStart: MON,
      }),
    ).toBe(0);
    expect(
      bestStreak({
        habit: habit({ archived: true }),
        logs: done(['2026-09-15', '2026-09-16']),
        todayKey: THURSDAY,
        weekStart: MON,
      }),
    ).toBe(0);
  });

  it('counts weeks for a timesPerWeek habit', () => {
    const h = habit({ schedule: timesPerWeek(2), createdDayKey: '2026-08-24' });
    const logs = done([
      '2026-08-24',
      '2026-08-25', // week of 08-24: satisfied
      '2026-08-31',
      '2026-09-01', // week of 08-31: satisfied
      '2026-09-07', // week of 09-07: fell short
    ]);
    expect(bestStreak({ habit: h, logs, todayKey: THURSDAY, weekStart: MON })).toBe(2);
  });
});

describe('accuracy — done / (done + missed)', () => {
  const h = habit({ createdDayKey: '2026-09-01' });
  const range = { from: '2026-09-10', to: THURSDAY };

  it('excludes skipped days from both sides of the ratio', () => {
    const logs = [
      log('2026-09-10', 'done'),
      log('2026-09-11', 'done'),
      log('2026-09-12', 'done'),
      log('2026-09-13', 'skipped'),
      // 09-14, 09-15, 09-16 unlogged: three misses
    ];
    // 3 done / (3 done + 3 missed)
    expect(accuracy({ habit: h, logs, ...range, todayKey: THURSDAY, weekStart: MON })).toBe(0.5);
  });

  it('counts today only once it is logged', () => {
    const logs = [
      log('2026-09-10', 'done'),
      log('2026-09-11', 'done'),
      log('2026-09-12', 'done'),
      log('2026-09-13', 'skipped'),
      log(THURSDAY, 'done'),
    ];
    expect(accuracy({ habit: h, logs, ...range, todayKey: THURSDAY, weekStart: MON })).toBeCloseTo(
      4 / 7,
      10,
    );
  });

  it('excludes days before the habit existed', () => {
    const late = habit({ createdDayKey: '2026-09-14' });
    const logs = done(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(accuracy({ habit: late, logs, ...range, todayKey: THURSDAY, weekStart: MON })).toBe(1);
  });

  it('returns null — not 0, not NaN — when the denominator is 0', () => {
    const allSkipped = [
      log('2026-09-15', 'skipped'),
      log('2026-09-16', 'skipped'),
      log('2026-09-14', 'skipped'),
    ];
    const window = { from: '2026-09-14', to: '2026-09-16' };
    expect(
      accuracy({ habit: h, logs: allSkipped, ...window, todayKey: THURSDAY, weekStart: MON }),
    ).toBeNull();

    // Nothing scheduled at all: the habit did not exist yet.
    const unborn = habit({ createdDayKey: '2026-10-01' });
    expect(
      accuracy({ habit: unborn, logs: [], ...range, todayKey: THURSDAY, weekStart: MON }),
    ).toBeNull();

    // A backwards range has nothing to measure.
    expect(
      accuracy({
        habit: h,
        logs: [],
        from: THURSDAY,
        to: '2026-09-10',
        todayKey: THURSDAY,
        weekStart: MON,
      }),
    ).toBeNull();
  });

  it('scores a timesPerWeek habit per week, and leaves the current week out', () => {
    const weekly = habit({ schedule: timesPerWeek(3), createdDayKey: '2026-08-31' });
    const logs = done([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02', // week of 08-31: reached 3 -> one done
      '2026-09-07',
      '2026-09-08', // week of 09-07: only 2 -> one missed
    ]);
    const window = { from: '2026-08-31', to: THURSDAY };
    expect(
      accuracy({ habit: weekly, logs, ...window, todayKey: THURSDAY, weekStart: MON }),
    ).toBe(0.5);

    // Finishing the current week does not change a past-weeks ratio.
    const withCurrentWeek = [...logs, ...done(['2026-09-14', '2026-09-15', '2026-09-16'])];
    expect(
      accuracy({
        habit: weekly,
        logs: withCurrentWeek,
        ...window,
        todayKey: THURSDAY,
        weekStart: MON,
      }),
    ).toBe(0.5);
  });
});

describe('overallAccuracy', () => {
  it('pools the numerators and denominators rather than averaging per habit', () => {
    const a = habit({ id: 'a', createdDayKey: '2026-09-01' });
    const b = habit({ id: 'b', schedule: weekdaysSchedule(1), createdDayKey: '2026-09-01' });
    const logs = [
      ...done(['2026-09-15', '2026-09-16'], 'a'), // 09-14 unlogged -> 1 miss for a
      // b runs on Mondays only: 2026-09-14 is its single scheduled day, unlogged.
    ];
    const window = { from: '2026-09-14', to: '2026-09-16' };
    // a: 2 done, 1 missed. b: 0 done, 1 missed. Pooled: 2 / 4.
    expect(
      overallAccuracy({ habits: [a, b], logs, ...window, todayKey: THURSDAY, weekStart: MON }),
    ).toBe(0.5);
  });

  it('returns null when no habit had anything scheduled', () => {
    expect(
      overallAccuracy({
        habits: [habit({ createdDayKey: '2026-10-01' })],
        logs: [],
        from: '2026-09-14',
        to: '2026-09-16',
        todayKey: THURSDAY,
        weekStart: MON,
      }),
    ).toBeNull();
  });
});
