import { describe, it, expect } from 'vitest';
import { planReminders, DEFAULT_REMINDER_HORIZON_MS } from '../src/reminderPlan';
import { MS_PER_HOUR } from '../src/time';
import { habit, timesPerWeek, log, done, isoAt, at, THURSDAY } from './factories';

/** SPEC.md §10.3 — what `reschedule-user` writes into ReminderOccurrence. */

const DUBAI = 'Asia/Dubai';
const NY = 'America/New_York';
const SYDNEY = 'Australia/Sydney';
const MON = 1 as const;

const base = { logs: [], snoozes: [], tz: DUBAI, weekStart: MON };

/** 06:00 Dubai on the Thursday: before the 07:30 habit time. */
const NOW = at(THURSDAY, '06:00', DUBAI);

describe('planReminders — the 48 hour window', () => {
  it('plans each due day inside the horizon and nothing past it', () => {
    const h = habit({ time: '07:30' });
    const plan = planReminders({ ...base, habits: [h], now: NOW });

    expect(plan).toEqual([
      { habitId: h.id, dayKey: THURSDAY, fireAt: at(THURSDAY, '07:30', DUBAI) },
      { habitId: h.id, dayKey: '2026-09-18', fireAt: at('2026-09-18', '07:30', DUBAI) },
    ]);
    // 2026-09-19 07:30 falls 49.5 hours out, past the window.
    expect(plan.every((r) => r.fireAt <= NOW + DEFAULT_REMINDER_HORIZON_MS)).toBe(true);
  });

  it('includes a reminder exactly on the horizon and excludes one a millisecond past it', () => {
    const h = habit({ time: '07:30' });
    const exact = at(THURSDAY, '07:30', DUBAI) - NOW;

    expect(planReminders({ ...base, habits: [h], now: NOW, horizonMs: exact })).toHaveLength(1);
    expect(planReminders({ ...base, habits: [h], now: NOW, horizonMs: exact - 1 })).toEqual([]);
  });

  it('skips a due instant that has already passed — an overdue habit is not re-notified', () => {
    const h = habit({ time: '07:30' });
    const afterDue = at(THURSDAY, '07:31', DUBAI);
    const plan = planReminders({ ...base, habits: [h], now: afterDue });

    expect(plan.map((r) => r.dayKey)).toEqual(['2026-09-18', '2026-09-19']);
  });

  it('sorts by fireAt, then by habitId, and never repeats a habit and day', () => {
    const early = habit({ id: 'b-habit', time: '06:30' });
    const late = habit({ id: 'a-habit', time: '07:30' });
    const sameTime = habit({ id: 'c-habit', time: '07:30' });

    const plan = planReminders({
      ...base,
      habits: [late, early, sameTime],
      now: at(THURSDAY, '05:00', DUBAI),
    });

    const todays = plan.filter((r) => r.dayKey === THURSDAY);
    expect(todays.map((r) => r.habitId)).toEqual(['b-habit', 'a-habit', 'c-habit']);

    const pairs = plan.map((r) => `${r.habitId}|${r.dayKey}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('planReminders — exclusions', () => {
  it('skips a day that already has a log, whether done or skipped', () => {
    const h = habit({ time: '07:30' });
    const plan = planReminders({
      ...base,
      habits: [h],
      logs: [log(THURSDAY, 'done'), log('2026-09-18', 'skipped')],
      now: NOW,
    });
    expect(plan).toEqual([]);
  });

  it('skips habits with reminders switched off', () => {
    expect(planReminders({ ...base, habits: [habit({ remind: false })], now: NOW })).toEqual([]);
  });

  it('skips archived habits', () => {
    expect(planReminders({ ...base, habits: [habit({ archived: true })], now: NOW })).toEqual([]);
  });

  it('skips a timesPerWeek habit once its weekly target is met', () => {
    const h = habit({ schedule: timesPerWeek(2), time: '07:30' });
    const metThisWeek = done(['2026-09-14', '2026-09-15']);

    expect(planReminders({ ...base, habits: [h], logs: metThisWeek, now: NOW })).toEqual([]);
    expect(
      planReminders({ ...base, habits: [h], logs: done(['2026-09-14']), now: NOW }),
    ).toHaveLength(2);
  });

  it('judges the target per the week the day falls in, so next week still gets reminded', () => {
    const h = habit({ schedule: timesPerWeek(2), time: '07:30' });
    // Sunday 2026-09-20 closes the Monday-start week that began on 2026-09-14.
    const sundayMorning = at('2026-09-20', '06:00', DUBAI);
    const plan = planReminders({
      ...base,
      habits: [h],
      logs: done(['2026-09-14', '2026-09-15']),
      now: sundayMorning,
    });

    // 09-20 is suppressed (target met); 09-21 opens a new week and is planned.
    expect(plan).toEqual([
      { habitId: h.id, dayKey: '2026-09-21', fireAt: at('2026-09-21', '07:30', DUBAI) },
    ]);
  });

  it('skips days the habit is not scheduled on, and days before it existed', () => {
    const h = habit({ schedule: { kind: 'weekdays', days: [5] }, time: '07:30' }); // Fridays
    const plan = planReminders({ ...base, habits: [h], now: NOW });
    expect(plan.map((r) => r.dayKey)).toEqual(['2026-09-18']);

    const future = habit({ time: '07:30', createdDayKey: '2026-09-19' });
    expect(planReminders({ ...base, habits: [future], now: NOW })).toEqual([]);
  });
});

describe('planReminders — snoozes', () => {
  it('replaces the due instant for that day with the snooze', () => {
    const h = habit({ time: '07:30' });
    const plan = planReminders({
      ...base,
      habits: [h],
      snoozes: [{ habitId: h.id, dayKey: THURSDAY, until: isoAt(THURSDAY, '08:30', DUBAI) }],
      now: NOW,
    });

    expect(plan[0]).toEqual({
      habitId: h.id,
      dayKey: THURSDAY,
      fireAt: at(THURSDAY, '08:30', DUBAI),
    });
  });

  it('brings back a reminder whose original time has already gone', () => {
    const h = habit({ time: '07:30' });
    const afterDue = at(THURSDAY, '07:45', DUBAI);
    const plan = planReminders({
      ...base,
      habits: [h],
      snoozes: [{ habitId: h.id, dayKey: THURSDAY, until: isoAt(THURSDAY, '08:00', DUBAI) }],
      now: afterDue,
    });

    expect(plan[0]).toEqual({
      habitId: h.id,
      dayKey: THURSDAY,
      fireAt: at(THURSDAY, '08:00', DUBAI),
    });
  });

  it('ignores a snooze that has already elapsed', () => {
    const h = habit({ time: '07:30' });
    const plan = planReminders({
      ...base,
      habits: [h],
      snoozes: [{ habitId: h.id, dayKey: THURSDAY, until: isoAt(THURSDAY, '05:30', DUBAI) }],
      now: NOW,
    });

    // Falls back to the habit's own 07:30.
    expect(plan[0]?.fireAt).toBe(at(THURSDAY, '07:30', DUBAI));
  });
});

describe('planReminders — daylight saving', () => {
  it('fires at 07:30 local on both sides of a spring-forward transition', () => {
    // 2026-03-08: America/New_York loses an hour at 02:00.
    const h = habit({ time: '07:30', createdDayKey: '2026-03-01' });
    const now = at('2026-03-07', '01:00', NY);
    const plan = planReminders({ ...base, habits: [h], tz: NY, now });

    expect(plan).toEqual([
      { habitId: h.id, dayKey: '2026-03-07', fireAt: Date.UTC(2026, 2, 7, 12, 30) }, // EST, UTC-5
      { habitId: h.id, dayKey: '2026-03-08', fireAt: Date.UTC(2026, 2, 8, 11, 30) }, // EDT, UTC-4
    ]);
    // The two reminders sit 23 hours apart, not 24.
    expect((plan[1]?.fireAt ?? 0) - (plan[0]?.fireAt ?? 0)).toBe(23 * MS_PER_HOUR);
  });

  it('fires at 07:30 local across a southern-hemisphere DST end', () => {
    // 2026-04-05: Australia/Sydney gains an hour at 03:00.
    const h = habit({ time: '07:30', createdDayKey: '2026-04-01' });
    const now = at('2026-04-03', '21:00', SYDNEY);
    const plan = planReminders({ ...base, habits: [h], tz: SYDNEY, now });

    expect(plan).toEqual([
      { habitId: h.id, dayKey: '2026-04-04', fireAt: Date.UTC(2026, 3, 3, 20, 30) }, // AEDT, UTC+11
      { habitId: h.id, dayKey: '2026-04-05', fireAt: Date.UTC(2026, 3, 4, 21, 30) }, // AEST, UTC+10
    ]);
    expect((plan[1]?.fireAt ?? 0) - (plan[0]?.fireAt ?? 0)).toBe(25 * MS_PER_HOUR);
  });
});

describe('planReminders — timezone change', () => {
  it('moves every future reminder as soon as the user timezone changes', () => {
    const h = habit({ time: '07:30' });
    const now = at(THURSDAY, '06:00', DUBAI);

    const inDubai = planReminders({ ...base, habits: [h], now });
    const inNewYork = planReminders({ ...base, habits: [h], tz: NY, now });

    expect(inDubai[0]?.fireAt).toBe(Date.UTC(2026, 8, 17, 3, 30));
    // The same wall-clock 07:30 is eight hours later in New York (EDT, UTC-4).
    expect(inNewYork[0]?.fireAt).toBe(Date.UTC(2026, 8, 17, 11, 30));
    expect(inNewYork[0]?.dayKey).toBe(THURSDAY);
  });
});
