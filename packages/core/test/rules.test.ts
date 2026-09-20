import { describe, it, expect } from 'vitest';
import {
  isScheduledOn,
  dueInstant,
  scheduledDaysBetween,
  doneCountInWeek,
  remainingDaysInWeek,
  isAtRisk,
  canLogOn,
  activeSnoozeUntil,
  statusOn,
} from '../src/rules';
import { weekday, weekStartKey } from '../src/time';
import { habit, weekdaysSchedule, timesPerWeek, log, isoAt, at, THURSDAY } from './factories';

/** Every rule in SPEC.md §6 is encoded below. */

const DUBAI = 'Asia/Dubai'; // UTC+4, no DST — keeps the arithmetic obvious.

describe('the fixture calendar is real', () => {
  it('2026-09-17 is a Thursday', () => {
    expect(weekday(THURSDAY)).toBe(4);
    expect(weekStartKey(THURSDAY, 1)).toBe('2026-09-14');
    expect(weekStartKey(THURSDAY, 0)).toBe('2026-09-13');
  });
});

describe('isScheduledOn — SPEC §6 Scheduling', () => {
  it('daily runs every day on or after createdDayKey', () => {
    const h = habit({ createdDayKey: '2026-09-15' });
    expect(isScheduledOn(h, '2026-09-14')).toBe(false);
    expect(isScheduledOn(h, '2026-09-15')).toBe(true);
    expect(isScheduledOn(h, '2026-09-16')).toBe(true);
    expect(isScheduledOn(h, '2027-01-01')).toBe(true);
  });

  it('weekdays runs only on the listed weekdays', () => {
    // Monday, Wednesday, Friday.
    const h = habit({ schedule: weekdaysSchedule(1, 3, 5), createdDayKey: '2026-09-01' });
    expect(isScheduledOn(h, '2026-09-14')).toBe(true); // Mon
    expect(isScheduledOn(h, '2026-09-15')).toBe(false); // Tue
    expect(isScheduledOn(h, '2026-09-16')).toBe(true); // Wed
    expect(isScheduledOn(h, THURSDAY)).toBe(false); // Thu
    expect(isScheduledOn(h, '2026-09-18')).toBe(true); // Fri
    expect(isScheduledOn(h, '2026-09-19')).toBe(false); // Sat
    expect(isScheduledOn(h, '2026-09-20')).toBe(false); // Sun
  });

  it('weekdays still respects createdDayKey', () => {
    const h = habit({ schedule: weekdaysSchedule(1, 3, 5), createdDayKey: '2026-09-16' });
    expect(isScheduledOn(h, '2026-09-14')).toBe(false); // a Monday, but before creation
    expect(isScheduledOn(h, '2026-09-16')).toBe(true);
  });

  it('timesPerWeek is eligible every day — the weekly target decides visibility, not the calendar', () => {
    const h = habit({ schedule: timesPerWeek(3) });
    for (const day of ['2026-09-14', '2026-09-15', THURSDAY, '2026-09-19', '2026-09-20']) {
      expect(isScheduledOn(h, day)).toBe(true);
    }
  });

  it('archived habits are never scheduled — so never reminded or counted', () => {
    expect(isScheduledOn(habit({ archived: true }), THURSDAY)).toBe(false);
    expect(isScheduledOn(habit({ archived: true, schedule: timesPerWeek(3) }), THURSDAY)).toBe(
      false,
    );
    expect(scheduledDaysBetween(habit({ archived: true }), '2026-09-14', THURSDAY)).toEqual([]);
  });
});

describe('dueInstant', () => {
  it('resolves the habit time in the user timezone', () => {
    const h = habit({ time: '07:30' });
    // 07:30 in Dubai (UTC+4) is 03:30Z.
    expect(dueInstant(h, THURSDAY, DUBAI)).toBe(Date.UTC(2026, 8, 17, 3, 30));
  });

  it('follows the timezone rather than the server — SPEC §7.5', () => {
    const h = habit({ time: '07:30' });
    expect(dueInstant(h, THURSDAY, 'America/New_York')).toBe(Date.UTC(2026, 8, 17, 11, 30));
    expect(dueInstant(h, THURSDAY, DUBAI)).toBe(Date.UTC(2026, 8, 17, 3, 30));
  });
});

describe('scheduledDaysBetween', () => {
  it('lists only scheduled days, oldest first', () => {
    const h = habit({ schedule: weekdaysSchedule(1, 3, 5), createdDayKey: '2026-09-01' });
    expect(scheduledDaysBetween(h, '2026-09-14', '2026-09-20')).toEqual([
      '2026-09-14',
      '2026-09-16',
      '2026-09-18',
    ]);
  });

  it('never reaches back before createdDayKey', () => {
    const h = habit({ createdDayKey: '2026-09-16' });
    expect(scheduledDaysBetween(h, '2026-09-10', '2026-09-18')).toEqual([
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
  });

  it('is empty when the range runs backwards', () => {
    expect(scheduledDaysBetween(habit(), '2026-09-18', '2026-09-14')).toEqual([]);
  });
});

describe('doneCountInWeek', () => {
  it('counts done logs inside the seven days from the week start, and nothing else', () => {
    const logs = [
      log('2026-09-13', 'done'), // the day before a Monday week starts
      log('2026-09-14', 'done'),
      log('2026-09-15', 'skipped'), // skipped is not done
      log('2026-09-16', 'done'),
      log('2026-09-21', 'done'), // the following week
      log('2026-09-15', 'done', 'other-habit'), // another habit
    ];
    expect(doneCountInWeek(logs, 'habit-1', '2026-09-14')).toBe(2);
  });
});

describe('remainingDaysInWeek', () => {
  it('counts today itself: 7 on the first day of the week, 1 on the last', () => {
    expect(remainingDaysInWeek('2026-09-14', 1)).toBe(7); // Monday, Monday-start week
    expect(remainingDaysInWeek('2026-09-20', 1)).toBe(1); // Sunday, Monday-start week
    expect(remainingDaysInWeek('2026-09-13', 0)).toBe(7); // Sunday, Sunday-start week
    expect(remainingDaysInWeek('2026-09-19', 0)).toBe(1); // Saturday, Sunday-start week
  });

  it('depends on the user week start', () => {
    expect(remainingDaysInWeek(THURSDAY, 1)).toBe(4); // Mon-start: Thu, Fri, Sat, Sun
    expect(remainingDaysInWeek(THURSDAY, 0)).toBe(3); // Sun-start: Thu, Fri, Sat
  });
});

describe('isAtRisk — SPEC §6: remainingDaysInWeek < count − doneThisWeek', () => {
  const h = habit({ schedule: timesPerWeek(5) });

  it('is false exactly at the boundary and true one step past it', () => {
    // Monday-start week, Thursday: 4 days remain, including today.
    expect(isAtRisk({ habit: h, todayKey: THURSDAY, weekStart: 1, doneThisWeek: 1 })).toBe(false); // 4 < 4 is false
    expect(isAtRisk({ habit: h, todayKey: THURSDAY, weekStart: 1, doneThisWeek: 0 })).toBe(true); // 4 < 5 is true
  });

  it('moves with the user week start', () => {
    // The same Thursday leaves only 3 days in a Sunday-start week.
    expect(isAtRisk({ habit: h, todayKey: THURSDAY, weekStart: 0, doneThisWeek: 1 })).toBe(true); // 3 < 4
    expect(isAtRisk({ habit: h, todayKey: THURSDAY, weekStart: 0, doneThisWeek: 2 })).toBe(false); // 3 < 3 is false
  });

  it('never applies to daily or weekday habits', () => {
    expect(isAtRisk({ habit: habit(), todayKey: THURSDAY, weekStart: 1, doneThisWeek: 0 })).toBe(
      false,
    );
    expect(
      isAtRisk({
        habit: habit({ schedule: weekdaysSchedule(1, 2, 3, 4, 5) }),
        todayKey: THURSDAY,
        weekStart: 1,
        doneThisWeek: 0,
      }),
    ).toBe(false);
  });

  it('is false once the target is already met', () => {
    expect(isAtRisk({ habit: h, todayKey: '2026-09-20', weekStart: 1, doneThisWeek: 5 })).toBe(
      false,
    );
  });
});

describe('canLogOn — the backfill window, SPEC §6 Actions', () => {
  const h = habit({ schedule: weekdaysSchedule(1, 3, 5), createdDayKey: '2026-09-14' });

  it('allows any scheduled day from createdDayKey through today', () => {
    expect(canLogOn(h, '2026-09-14', THURSDAY)).toBe(true);
    expect(canLogOn(h, '2026-09-16', THURSDAY)).toBe(true);
  });

  it('rejects future days — the API answers 422', () => {
    expect(canLogOn(habit(), '2026-09-18', THURSDAY)).toBe(false);
  });

  it('rejects days before the habit existed', () => {
    expect(canLogOn(h, '2026-09-11', THURSDAY)).toBe(false); // a Friday, but pre-creation
  });

  it('rejects a day the habit is not scheduled on', () => {
    expect(canLogOn(h, '2026-09-15', THURSDAY)).toBe(false); // Tuesday
  });
});

describe('activeSnoozeUntil', () => {
  const now = at(THURSDAY, '08:00', DUBAI);

  it('returns the instant while the snooze is still running', () => {
    const s = { habitId: 'habit-1', dayKey: THURSDAY, until: isoAt(THURSDAY, '08:15', DUBAI) };
    expect(activeSnoozeUntil(s, 'habit-1', THURSDAY, now)).toBe(at(THURSDAY, '08:15', DUBAI));
  });

  it('returns null once it has elapsed, and for another habit or another day', () => {
    const elapsed = {
      habitId: 'habit-1',
      dayKey: THURSDAY,
      until: isoAt(THURSDAY, '07:45', DUBAI),
    };
    expect(activeSnoozeUntil(elapsed, 'habit-1', THURSDAY, now)).toBeNull();

    const live = { habitId: 'habit-1', dayKey: THURSDAY, until: isoAt(THURSDAY, '08:15', DUBAI) };
    expect(activeSnoozeUntil(live, 'other', THURSDAY, now)).toBeNull();
    expect(activeSnoozeUntil(live, 'habit-1', '2026-09-16', now)).toBeNull();
    expect(activeSnoozeUntil(undefined, 'habit-1', THURSDAY, now)).toBeNull();
  });
});

describe('statusOn — SPEC §6 Status on a day', () => {
  const base = { todayKey: THURSDAY, tz: DUBAI, weekStart: 1 as const };

  it('reports done or skipped whenever a log exists', () => {
    const h = habit();
    expect(
      statusOn({
        ...base,
        habit: h,
        dayKey: THURSDAY,
        now: at(THURSDAY, '06:00', DUBAI),
        log: log(THURSDAY, 'done'),
      }),
    ).toBe('done');
    expect(
      statusOn({
        ...base,
        habit: h,
        dayKey: THURSDAY,
        now: at(THURSDAY, '06:00', DUBAI),
        log: log(THURSDAY, 'skipped'),
      }),
    ).toBe('skipped');
  });

  it('keeps showing a past log even after the schedule changed underneath it', () => {
    // Logged on a Tuesday, then the habit became Mon/Wed/Fri only.
    const h = habit({ schedule: weekdaysSchedule(1, 3, 5) });
    expect(
      statusOn({
        ...base,
        habit: h,
        dayKey: '2026-09-15',
        now: at(THURSDAY, '06:00', DUBAI),
        log: log('2026-09-15', 'done'),
      }),
    ).toBe('done');
  });

  it('is unscheduled on a day the habit does not run', () => {
    const h = habit({ schedule: weekdaysSchedule(1, 3, 5) });
    expect(
      statusOn({ ...base, habit: h, dayKey: THURSDAY, now: at(THURSDAY, '09:00', DUBAI) }),
    ).toBe('unscheduled');
  });

  it('is overdue when today is unlogged and the due instant has passed', () => {
    expect(
      statusOn({ ...base, habit: habit(), dayKey: THURSDAY, now: at(THURSDAY, '07:31', DUBAI) }),
    ).toBe('overdue');
  });

  it('is upcoming when today is unlogged and the due instant is still ahead', () => {
    expect(
      statusOn({ ...base, habit: habit(), dayKey: THURSDAY, now: at(THURSDAY, '07:29', DUBAI) }),
    ).toBe('upcoming');
  });

  it('is exactly overdue at the due instant itself', () => {
    expect(
      statusOn({ ...base, habit: habit(), dayKey: THURSDAY, now: at(THURSDAY, '07:30', DUBAI) }),
    ).toBe('overdue');
  });

  it('is snoozed while a snooze for that day is still running, then overdue again', () => {
    const h = habit();
    const s = { habitId: 'habit-1', dayKey: THURSDAY, until: isoAt(THURSDAY, '07:45', DUBAI) };
    expect(
      statusOn({
        ...base,
        habit: h,
        dayKey: THURSDAY,
        now: at(THURSDAY, '07:35', DUBAI),
        snooze: s,
      }),
    ).toBe('snoozed');
    expect(
      statusOn({
        ...base,
        habit: h,
        dayKey: THURSDAY,
        now: at(THURSDAY, '07:46', DUBAI),
        snooze: s,
      }),
    ).toBe('overdue');
  });

  it('is missed on an unlogged day before today, and upcoming on a future day', () => {
    const h = habit();
    const now = at(THURSDAY, '09:00', DUBAI);
    expect(statusOn({ ...base, habit: h, dayKey: '2026-09-16', now })).toBe('missed');
    expect(statusOn({ ...base, habit: h, dayKey: '2026-09-18', now })).toBe('upcoming');
  });

  describe('timesPerWeek', () => {
    const h = habit({ schedule: timesPerWeek(3) });
    const now = at(THURSDAY, '23:00', DUBAI); // long past the 07:30 time

    it('is never overdue, however late in the day it is', () => {
      const status = statusOn({ ...base, habit: h, dayKey: THURSDAY, now, doneThisWeek: 1 });
      expect(status).toBe('upcoming');
      expect(status).not.toBe('overdue');
    });

    it('drops off Today once the weekly target is reached', () => {
      expect(statusOn({ ...base, habit: h, dayKey: THURSDAY, now, doneThisWeek: 3 })).toBe(
        'unscheduled',
      );
    });

    it('does not mark unlogged past days as missed — it is scored by week', () => {
      expect(statusOn({ ...base, habit: h, dayKey: '2026-09-15', now, doneThisWeek: 1 })).toBe(
        'unscheduled',
      );
    });
  });

  it('follows the timezone immediately while logs keep their dayKey — SPEC §6 Timezone change', () => {
    const h = habit({ time: '07:30' });
    // One instant: 07:45 in Dubai, which is 23:45 the previous day in Los Angeles.
    const now = at(THURSDAY, '07:45', DUBAI);

    expect(statusOn({ ...base, habit: h, dayKey: THURSDAY, now, tz: DUBAI })).toBe('overdue');

    // Moving the user to Los Angeles rewinds the wall clock: the same instant is
    // still Wednesday there, so Thursday has not started and is not yet due.
    expect(
      statusOn({
        ...base,
        habit: h,
        dayKey: THURSDAY,
        todayKey: '2026-09-16',
        now,
        tz: 'America/Los_Angeles',
      }),
    ).toBe('upcoming');

    // The log written in Dubai keeps its dayKey and still reads as done.
    expect(
      statusOn({
        ...base,
        habit: h,
        dayKey: THURSDAY,
        todayKey: '2026-09-16',
        now,
        tz: 'America/Los_Angeles',
        log: log(THURSDAY, 'done'),
      }),
    ).toBe('done');
  });

  it('reports archived habits as unscheduled', () => {
    expect(
      statusOn({
        ...base,
        habit: habit({ archived: true }),
        dayKey: THURSDAY,
        now: at(THURSDAY, '09:00', DUBAI),
      }),
    ).toBe('unscheduled');
  });
});
