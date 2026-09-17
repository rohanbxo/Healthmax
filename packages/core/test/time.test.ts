import { describe, expect, it } from 'vitest';

import {
  DAYS_PER_WEEK,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  addDays,
  addMinutes,
  compareDayKeys,
  daysInMonth,
  diffDays,
  formatDateHeader,
  formatDayLabel,
  formatTime,
  instantToDayKey,
  instantToLocalParts,
  isValidDayKey,
  isValidTime,
  isValidTimeZone,
  localToInstant,
  makeDayKey,
  parseDayKey,
  timeZoneOffsetMs,
  todayKey,
  weekStartKey,
  weekday,
} from '../src/time';
import { runTimeSelfCheck } from '../src/timeSelfCheck';
import { FALLBACK_TIME_ZONES, guessTimeZone, listTimeZones } from '../src/timezones';

/** The zone set named in SPEC.md §7 "Tests". */
const ZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'America/St_Johns',
  'Europe/London',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DDTHH:mmZ' for the instant itself, built without parsing any date string. */
const utcStamp = (ms: number): string => `${instantToDayKey(ms, 'UTC')}T${formatTime(ms, 'UTC')}Z`;

/** Local wall clock of an instant in a zone, as 'YYYY-MM-DD HH:mm'. */
const localStamp = (ms: number, tz: string): string =>
  `${instantToDayKey(ms, tz)} ${formatTime(ms, tz)}`;

const offsetMinutes = (ms: number, tz: string): number => timeZoneOffsetMs(ms, tz) / MS_PER_MINUTE;

describe('DayKey validation', () => {
  it('accepts well-formed calendar days', () => {
    for (const key of ['2026-01-01', '2026-09-17', '2024-02-29', '2028-02-29', '2026-12-31']) {
      expect(isValidDayKey(key)).toBe(true);
    }
  });

  it('rejects malformed or impossible days', () => {
    for (const key of [
      '',
      '2026-1-1',
      '26-01-01',
      '2026-13-01',
      '2026-00-10',
      '2026-01-32',
      '2026-02-29', // 2026 is not a leap year
      '2100-02-29', // a century that is not a leap year
      '2026-04-31',
      '2026-09-17T00:00',
      'not-a-day',
    ]) {
      expect(isValidDayKey(key), key).toBe(false);
    }
  });

  it('accepts 29 February only in leap years', () => {
    expect(isValidDayKey('2024-02-29')).toBe(true);
    expect(isValidDayKey('2028-02-29')).toBe(true);
    expect(isValidDayKey('2000-02-29')).toBe(true);
    expect(isValidDayKey('2026-02-29')).toBe(false);
    expect(isValidDayKey('1900-02-29')).toBe(false);
  });

  it('round trips through parseDayKey and makeDayKey', () => {
    for (const key of ['0001-01-01', '2024-02-29', '2026-09-17', '9999-12-31']) {
      const { year, month, day } = parseDayKey(key);
      expect(makeDayKey(year, month, day)).toBe(key);
    }
    expect(parseDayKey('2026-09-17')).toEqual({ year: 2026, month: 9, day: 17 });
  });

  it('throws on invalid input instead of guessing', () => {
    expect(() => parseDayKey('2026-02-29')).toThrow(RangeError);
    expect(() => makeDayKey(2026, 2, 29)).toThrow(RangeError);
    expect(() => makeDayKey(2026, 13, 1)).toThrow(RangeError);
    expect(() => makeDayKey(2026, 4, 31)).toThrow(RangeError);
    expect(() => addDays('2026-02-29', 1)).toThrow(RangeError);
    expect(() => addDays('2026-01-01', 1.5)).toThrow(RangeError);
  });
});

describe('daysInMonth', () => {
  it('knows every month of a non-leap year', () => {
    const expected = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    expected.forEach((length, index) => {
      expect(daysInMonth(2026, index + 1)).toBe(length);
    });
  });

  it('applies the Gregorian leap rule', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('rejects months outside 1-12', () => {
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('crosses month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-05-01', -1)).toBe('2026-04-30');
  });

  it('crosses year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2025-12-31', 2)).toBe('2026-01-02');
    expect(addDays('2026-01-01', -366)).toBe('2024-12-31'); // 2025 has 365 days
  });

  it('handles 29 February in the leap years 2024 and 2028', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2024-02-29', 365)).toBe('2025-02-28');
  });

  it('skips 29 February in the non-leap year 2026', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
    expect(addDays('2024-01-01', 365)).toBe('2024-12-31'); // 2024 has 366 days
  });

  it('is calendar arithmetic, so DST transitions do not shift the result', () => {
    // US spring forward and fall back.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    // EU transitions.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    // Southern hemisphere transitions.
    expect(addDays('2026-04-05', 1)).toBe('2026-04-06');
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
  });

  it('returns the same key for an offset of zero', () => {
    expect(addDays('2026-09-17', 0)).toBe('2026-09-17');
  });

  it('accumulates one day at a time exactly as it does in one jump', () => {
    let key = '2023-12-20';
    for (let i = 0; i < 500; i += 1) key = addDays(key, 1);
    expect(key).toBe(addDays('2023-12-20', 500));
    expect(diffDays('2023-12-20', key)).toBe(500);
  });
});

describe('compareDayKeys and diffDays', () => {
  it('orders days', () => {
    expect(compareDayKeys('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDayKeys('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDayKeys('2026-01-01', '2026-01-01')).toBe(0);
    expect(compareDayKeys('2025-12-31', '2026-01-01')).toBe(-1);
    expect(compareDayKeys('2026-09-30', '2026-10-01')).toBe(-1);
  });

  it('counts whole days in both directions', () => {
    expect(diffDays('2026-01-01', '2026-01-01')).toBe(0);
    expect(diffDays('2026-01-01', '2026-01-02')).toBe(1);
    expect(diffDays('2026-01-02', '2026-01-01')).toBe(-1);
    expect(diffDays('2025-12-31', '2026-01-01')).toBe(1);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366);
    expect(diffDays('2024-02-28', '2024-03-01')).toBe(2);
    expect(diffDays('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('is unaffected by DST, unlike millisecond arithmetic', () => {
    expect(diffDays('2026-03-08', '2026-03-09')).toBe(1);
    expect(diffDays('2026-11-01', '2026-11-02')).toBe(1);
    // The local days really are 23 and 25 hours long, which is why no code may
    // add MS_PER_DAY to move a day (SPEC.md §7 rule 2).
    const springStart = localToInstant('2026-03-08', '00:00', 'America/New_York');
    const springEnd = localToInstant('2026-03-09', '00:00', 'America/New_York');
    expect(springEnd - springStart).toBe(23 * MS_PER_HOUR);
    const fallStart = localToInstant('2026-11-01', '00:00', 'America/New_York');
    const fallEnd = localToInstant('2026-11-02', '00:00', 'America/New_York');
    expect(fallEnd - fallStart).toBe(25 * MS_PER_HOUR);
  });
});

describe('weekday and weekStartKey', () => {
  it('numbers weekdays 0 = Sunday .. 6 = Saturday', () => {
    expect(weekday('2026-09-17')).toBe(4); // Thursday
    expect(weekday('2026-01-01')).toBe(4); // Thursday
    expect(weekday('2026-03-08')).toBe(0); // Sunday, US spring forward
    expect(weekday('2026-11-01')).toBe(0); // Sunday, US fall back
    expect(weekday('2026-03-29')).toBe(0); // Sunday, EU spring forward
    expect(weekday('2026-10-25')).toBe(0); // Sunday, EU fall back
    expect(weekday('2026-04-05')).toBe(0); // Sunday, AU DST ends
    expect(weekday('2026-10-04')).toBe(0); // Sunday, AU DST begins
    expect(weekday('2024-02-29')).toBe(4); // Thursday
  });

  it('advances one weekday per day', () => {
    let key = '2026-09-17';
    for (let i = 0; i < 40; i += 1) {
      const next = addDays(key, 1);
      expect(weekday(next)).toBe((weekday(key) + 1) % DAYS_PER_WEEK);
      key = next;
    }
  });

  it('walks back into the previous year for both week starts', () => {
    // 2026-01-01 is a Thursday.
    expect(weekStartKey('2026-01-01', 1)).toBe('2025-12-29'); // Monday
    expect(weekStartKey('2026-01-01', 0)).toBe('2025-12-28'); // Sunday
    expect(weekStartKey('2026-01-03', 1)).toBe('2025-12-29'); // Saturday still in that week
    expect(weekStartKey('2026-01-03', 0)).toBe('2025-12-28');
    expect(weekStartKey('2026-01-04', 0)).toBe('2026-01-04'); // Sunday starts a new week
    expect(weekStartKey('2026-01-04', 1)).toBe('2025-12-29'); // ... but not a Monday week
    expect(weekStartKey('2026-01-05', 1)).toBe('2026-01-05'); // Monday
    expect(weekStartKey('2024-12-31', 1)).toBe('2024-12-30');
    expect(weekStartKey('2024-12-31', 0)).toBe('2024-12-29');
  });

  it('is idempotent and lands on the configured weekday', () => {
    let key = '2025-12-20';
    for (let i = 0; i < 400; i += 1) {
      for (const weekStart of [0, 1] as const) {
        const start = weekStartKey(key, weekStart);
        expect(weekday(start)).toBe(weekStart);
        expect(weekStartKey(start, weekStart)).toBe(start);
        const offset = diffDays(start, key);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(DAYS_PER_WEEK);
      }
      key = addDays(key, 1);
    }
  });

  it('rejects a week start other than 0 or 1', () => {
    expect(() => weekStartKey('2026-01-01', 2 as unknown as 0)).toThrow(RangeError);
  });
});

describe('time-of-day and timezone validation', () => {
  it('accepts 00:00 through 23:59 only', () => {
    for (const time of ['00:00', '07:30', '12:00', '23:59']) {
      expect(isValidTime(time)).toBe(true);
    }
    for (const time of ['', '7:30', '24:00', '23:60', '12:0', '12:00:00', '-1:00', 'ab:cd']) {
      expect(isValidTime(time), time).toBe(false);
    }
  });

  it('recognises every zone this app is tested against', () => {
    for (const tz of ZONES) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  it('rejects unknown zones', () => {
    for (const tz of ['', 'Mars/Olympus_Mons', 'Not/A_Zone', 'EST5EDT/nope']) {
      expect(isValidTimeZone(tz), tz).toBe(false);
    }
  });

  it('throws when a conversion is asked for an unknown zone', () => {
    expect(() => todayKey(0, 'Mars/Olympus_Mons')).toThrow(RangeError);
    expect(() => localToInstant('2026-01-01', '00:00', 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('instantToLocalParts', () => {
  it('reads the wall clock in each zone at one fixed instant', () => {
    // 2026-06-15T10:00Z, northern summer.
    const instant = localToInstant('2026-06-15', '10:00', 'UTC');
    expect(utcStamp(instant)).toBe('2026-06-15T10:00Z');
    expect(localStamp(instant, 'UTC')).toBe('2026-06-15 10:00');
    expect(localStamp(instant, 'America/Los_Angeles')).toBe('2026-06-15 03:00'); // PDT -07:00
    expect(localStamp(instant, 'America/New_York')).toBe('2026-06-15 06:00'); // EDT -04:00
    expect(localStamp(instant, 'America/St_Johns')).toBe('2026-06-15 07:30'); // NDT -02:30
    expect(localStamp(instant, 'Europe/London')).toBe('2026-06-15 11:00'); // BST +01:00
    expect(localStamp(instant, 'Asia/Dubai')).toBe('2026-06-15 14:00'); // +04:00
    expect(localStamp(instant, 'Asia/Kolkata')).toBe('2026-06-15 15:30'); // +05:30
    expect(localStamp(instant, 'Australia/Sydney')).toBe('2026-06-15 20:00'); // AEST +10:00
    expect(localStamp(instant, 'Australia/Lord_Howe')).toBe('2026-06-15 20:30'); // +10:30
    expect(localStamp(instant, 'Pacific/Chatham')).toBe('2026-06-15 22:45'); // +12:45
    expect(localStamp(instant, 'Pacific/Kiritimati')).toBe('2026-06-16 00:00'); // +14:00
  });

  it('reports the weekday of the local date, not of the UTC date', () => {
    const instant = localToInstant('2026-06-15', '10:00', 'UTC'); // Monday in UTC
    expect(instantToLocalParts(instant, 'UTC').weekday).toBe(1);
    // Still Monday 10:00 UTC, but already Tuesday in Kiritimati.
    expect(instantToLocalParts(instant, 'Pacific/Kiritimati').weekday).toBe(2);
    expect(weekday(instantToDayKey(instant, 'Pacific/Kiritimati'))).toBe(2);
  });

  it('returns seconds as well as minutes', () => {
    const instant = localToInstant('2026-06-15', '10:00', 'UTC') + 42_000;
    expect(instantToLocalParts(instant, 'Asia/Kolkata')).toEqual({
      year: 2026,
      month: 6,
      day: 15,
      hour: 15,
      minute: 30,
      second: 42,
      weekday: 1,
    });
  });

  it('handles instants before the Unix epoch', () => {
    const instant = localToInstant('1969-07-20', '20:17', 'UTC');
    expect(instant).toBeLessThan(0);
    expect(localStamp(instant, 'UTC')).toBe('1969-07-20 20:17');
    expect(localStamp(instant, 'Asia/Kolkata')).toBe('1969-07-21 01:47');
  });
});

describe('todayKey across the date line', () => {
  it('gives different days in Pacific/Kiritimati (+14) and America/Los_Angeles (-7)', () => {
    const instant = localToInstant('2026-06-15', '10:00', 'UTC');
    expect(todayKey(instant, 'Pacific/Kiritimati')).toBe('2026-06-16');
    expect(todayKey(instant, 'America/Los_Angeles')).toBe('2026-06-15');
    expect(
      diffDays(todayKey(instant, 'America/Los_Angeles'), todayKey(instant, 'Pacific/Kiritimati')),
    ).toBe(1);
  });

  it('can even straddle two calendar days at the year boundary', () => {
    // 2025-12-31T12:00Z: already 2026 in Kiritimati, still 2025 in Los Angeles.
    const instant = localToInstant('2025-12-31', '12:00', 'UTC');
    expect(todayKey(instant, 'Pacific/Kiritimati')).toBe('2026-01-01');
    expect(todayKey(instant, 'America/Los_Angeles')).toBe('2025-12-31');
    expect(todayKey(instant, 'UTC')).toBe('2025-12-31');
  });

  it('agrees with instantToDayKey', () => {
    const instant = localToInstant('2026-09-17', '23:30', 'UTC');
    for (const tz of ZONES) {
      expect(todayKey(instant, tz)).toBe(instantToDayKey(instant, tz));
    }
  });
});

describe('localToInstant: United States 2026 (America/New_York)', () => {
  it('shifts a nonexistent local time forward by the size of the gap on 8 March', () => {
    // DST starts 02:00 EST -> 03:00 EDT, so 02:00-02:59 never happens.
    const instant = localToInstant('2026-03-08', '02:30', 'America/New_York');
    expect(utcStamp(instant)).toBe('2026-03-08T07:30Z');
    expect(localStamp(instant, 'America/New_York')).toBe('2026-03-08 03:30');
    expect(offsetMinutes(instant, 'America/New_York')).toBe(-240); // EDT
    // The whole missing hour maps one hour forward.
    expect(
      localStamp(localToInstant('2026-03-08', '02:00', 'America/New_York'), 'America/New_York'),
    ).toBe('2026-03-08 03:00');
    expect(
      localStamp(localToInstant('2026-03-08', '02:59', 'America/New_York'), 'America/New_York'),
    ).toBe('2026-03-08 03:59');
  });

  it('leaves the hours either side of the 8 March gap alone', () => {
    const before = localToInstant('2026-03-08', '01:30', 'America/New_York');
    expect(utcStamp(before)).toBe('2026-03-08T06:30Z');
    expect(offsetMinutes(before, 'America/New_York')).toBe(-300); // EST
    const after = localToInstant('2026-03-08', '03:30', 'America/New_York');
    expect(utcStamp(after)).toBe('2026-03-08T07:30Z');
    expect(offsetMinutes(after, 'America/New_York')).toBe(-240); // EDT
    // 02:30 collides with 03:30 precisely because 02:30 does not exist.
    expect(localToInstant('2026-03-08', '02:30', 'America/New_York')).toBe(after);
  });

  it('picks the earlier instant for the ambiguous hour on 1 November', () => {
    // DST ends 02:00 EDT -> 01:00 EST, so 01:00-01:59 happens twice.
    const instant = localToInstant('2026-11-01', '01:30', 'America/New_York');
    expect(utcStamp(instant)).toBe('2026-11-01T05:30Z'); // EDT, the earlier of the two
    expect(localStamp(instant, 'America/New_York')).toBe('2026-11-01 01:30');
    expect(offsetMinutes(instant, 'America/New_York')).toBe(-240); // EDT, not EST
    // The later, EST reading of the same wall clock is one hour after the one we chose.
    expect(utcStamp(instant + MS_PER_HOUR)).toBe('2026-11-01T06:30Z');
    expect(localStamp(instant + MS_PER_HOUR, 'America/New_York')).toBe('2026-11-01 01:30');
  });

  it('leaves the hours either side of the 1 November overlap alone', () => {
    expect(utcStamp(localToInstant('2026-11-01', '00:30', 'America/New_York'))).toBe(
      '2026-11-01T04:30Z',
    );
    expect(utcStamp(localToInstant('2026-11-01', '02:30', 'America/New_York'))).toBe(
      '2026-11-01T07:30Z',
    );
  });

  it('applies the same rules at a half-hour offset in America/St_Johns', () => {
    const gap = localToInstant('2026-03-08', '02:30', 'America/St_Johns');
    expect(utcStamp(gap)).toBe('2026-03-08T06:00Z');
    expect(localStamp(gap, 'America/St_Johns')).toBe('2026-03-08 03:30');
    expect(offsetMinutes(gap, 'America/St_Johns')).toBe(-150); // NDT -02:30

    const ambiguous = localToInstant('2026-11-01', '01:30', 'America/St_Johns');
    expect(utcStamp(ambiguous)).toBe('2026-11-01T04:00Z');
    expect(offsetMinutes(ambiguous, 'America/St_Johns')).toBe(-150); // the earlier, NDT instant
    expect(offsetMinutes(ambiguous + MS_PER_HOUR, 'America/St_Johns')).toBe(-210); // NST -03:30
  });

  it('moves America/Los_Angeles between PST and PDT', () => {
    expect(
      offsetMinutes(
        localToInstant('2026-01-15', '12:00', 'America/Los_Angeles'),
        'America/Los_Angeles',
      ),
    ).toBe(-480); // PST
    expect(
      offsetMinutes(
        localToInstant('2026-07-15', '12:00', 'America/Los_Angeles'),
        'America/Los_Angeles',
      ),
    ).toBe(-420); // PDT
  });
});

describe('localToInstant: European Union 2026 (Europe/London)', () => {
  it('shifts the nonexistent hour forward on 29 March', () => {
    // BST starts 01:00 GMT -> 02:00 BST, so 01:00-01:59 never happens.
    const instant = localToInstant('2026-03-29', '01:30', 'Europe/London');
    expect(utcStamp(instant)).toBe('2026-03-29T01:30Z');
    expect(localStamp(instant, 'Europe/London')).toBe('2026-03-29 02:30');
    expect(offsetMinutes(instant, 'Europe/London')).toBe(60); // BST
    expect(utcStamp(localToInstant('2026-03-29', '00:30', 'Europe/London'))).toBe(
      '2026-03-29T00:30Z',
    ); // GMT, unaffected
  });

  it('picks the earlier instant for the ambiguous hour on 25 October', () => {
    // BST ends 02:00 BST -> 01:00 GMT, so 01:00-01:59 happens twice.
    const instant = localToInstant('2026-10-25', '01:30', 'Europe/London');
    expect(utcStamp(instant)).toBe('2026-10-25T00:30Z'); // BST, the earlier of the two
    expect(localStamp(instant, 'Europe/London')).toBe('2026-10-25 01:30');
    expect(offsetMinutes(instant, 'Europe/London')).toBe(60); // BST, not GMT
    expect(localStamp(instant + MS_PER_HOUR, 'Europe/London')).toBe('2026-10-25 01:30'); // the GMT reading
    expect(offsetMinutes(instant + MS_PER_HOUR, 'Europe/London')).toBe(0);
  });

  it('has 23- and 25-hour local days at the transitions', () => {
    const springStart = localToInstant('2026-03-29', '00:00', 'Europe/London');
    const springEnd = localToInstant('2026-03-30', '00:00', 'Europe/London');
    expect(springEnd - springStart).toBe(23 * MS_PER_HOUR);
    const fallStart = localToInstant('2026-10-25', '00:00', 'Europe/London');
    const fallEnd = localToInstant('2026-10-26', '00:00', 'Europe/London');
    expect(fallEnd - fallStart).toBe(25 * MS_PER_HOUR);
  });
});

describe('localToInstant: southern hemisphere 2026', () => {
  it('ends Australia/Sydney DST on 5 April, resolving the overlap to the earlier instant', () => {
    // AEDT ends 03:00 AEDT -> 02:00 AEST, so 02:00-02:59 happens twice.
    const instant = localToInstant('2026-04-05', '02:30', 'Australia/Sydney');
    expect(utcStamp(instant)).toBe('2026-04-04T15:30Z'); // +11:00, the earlier of the two
    expect(localStamp(instant, 'Australia/Sydney')).toBe('2026-04-05 02:30');
    expect(offsetMinutes(instant, 'Australia/Sydney')).toBe(660); // AEDT
    expect(offsetMinutes(instant + MS_PER_HOUR, 'Australia/Sydney')).toBe(600); // AEST
    expect(localStamp(instant + MS_PER_HOUR, 'Australia/Sydney')).toBe('2026-04-05 02:30');
  });

  it('starts Australia/Sydney DST on 4 October, shifting the gap forward', () => {
    // AEST 02:00 -> AEDT 03:00, so 02:00-02:59 never happens.
    const instant = localToInstant('2026-10-04', '02:30', 'Australia/Sydney');
    expect(utcStamp(instant)).toBe('2026-10-03T16:30Z');
    expect(localStamp(instant, 'Australia/Sydney')).toBe('2026-10-04 03:30');
    expect(offsetMinutes(instant, 'Australia/Sydney')).toBe(660); // AEDT
    expect(utcStamp(localToInstant('2026-10-04', '01:30', 'Australia/Sydney'))).toBe(
      '2026-10-03T15:30Z',
    ); // AEST, unaffected
  });

  it('handles the 30-minute Australia/Lord_Howe DST shift on 4 October', () => {
    // +10:30 -> +11:00 at 02:00, so only 02:00-02:29 never happens.
    const inGap = localToInstant('2026-10-04', '02:15', 'Australia/Lord_Howe');
    expect(utcStamp(inGap)).toBe('2026-10-03T15:45Z');
    expect(localStamp(inGap, 'Australia/Lord_Howe')).toBe('2026-10-04 02:45'); // forward by 30 minutes
    expect(offsetMinutes(inGap, 'Australia/Lord_Howe')).toBe(660);
    // 02:30 is the first instant after the gap and exists exactly once.
    const firstAfterGap = localToInstant('2026-10-04', '02:30', 'Australia/Lord_Howe');
    expect(utcStamp(firstAfterGap)).toBe('2026-10-03T15:30Z');
    expect(localStamp(firstAfterGap, 'Australia/Lord_Howe')).toBe('2026-10-04 02:30');
    // 01:59 is still standard time.
    expect(
      offsetMinutes(
        localToInstant('2026-10-04', '01:59', 'Australia/Lord_Howe'),
        'Australia/Lord_Howe',
      ),
    ).toBe(630);
  });

  it('handles the 30-minute Australia/Lord_Howe overlap on 5 April', () => {
    // +11:00 -> +10:30 at 02:00, so 01:30-01:59 happens twice.
    const instant = localToInstant('2026-04-05', '01:45', 'Australia/Lord_Howe');
    expect(utcStamp(instant)).toBe('2026-04-04T14:45Z');
    expect(offsetMinutes(instant, 'Australia/Lord_Howe')).toBe(660); // the earlier, DST instant
    expect(localStamp(instant + 30 * MS_PER_MINUTE, 'Australia/Lord_Howe')).toBe(
      '2026-04-05 01:45',
    );
    expect(offsetMinutes(instant + 30 * MS_PER_MINUTE, 'Australia/Lord_Howe')).toBe(630);
    // 01:00 is before the overlap and unique.
    expect(utcStamp(localToInstant('2026-04-05', '01:00', 'Australia/Lord_Howe'))).toBe(
      '2026-04-04T14:00Z',
    );
  });

  it('handles the 45-minute offsets of Pacific/Chatham', () => {
    expect(
      offsetMinutes(localToInstant('2026-06-15', '12:00', 'Pacific/Chatham'), 'Pacific/Chatham'),
    ).toBe(765); // +12:45
    expect(
      offsetMinutes(localToInstant('2026-01-15', '12:00', 'Pacific/Chatham'), 'Pacific/Chatham'),
    ).toBe(825); // +13:45
    // DST starts on the last Sunday in September at 02:45 -> 03:45.
    const inGap = localToInstant('2026-09-27', '03:00', 'Pacific/Chatham');
    expect(utcStamp(inGap)).toBe('2026-09-26T14:15Z');
    expect(localStamp(inGap, 'Pacific/Chatham')).toBe('2026-09-27 04:00');
    expect(
      localStamp(localToInstant('2026-09-27', '02:00', 'Pacific/Chatham'), 'Pacific/Chatham'),
    ).toBe('2026-09-27 02:00'); // before the gap
    // DST ends on the first Sunday in April at 03:45 -> 02:45.
    const ambiguous = localToInstant('2026-04-05', '03:00', 'Pacific/Chatham');
    expect(utcStamp(ambiguous)).toBe('2026-04-04T13:15Z');
    expect(offsetMinutes(ambiguous, 'Pacific/Chatham')).toBe(825); // the earlier, DST instant
  });
});

describe('localToInstant: fixed-offset zones', () => {
  it('never shifts Asia/Dubai, Asia/Kolkata or Pacific/Kiritimati', () => {
    const fixed: [string, number][] = [
      ['Asia/Dubai', 240],
      ['Asia/Kolkata', 330],
      ['Pacific/Kiritimati', 840],
      ['UTC', 0],
    ];
    for (const [tz, expectedOffset] of fixed) {
      for (const dayKey of ['2026-01-15', '2026-03-08', '2026-07-15', '2026-11-01']) {
        const instant = localToInstant(dayKey, '09:00', tz);
        expect(offsetMinutes(instant, tz), `${tz} ${dayKey}`).toBe(expectedOffset);
        expect(localStamp(instant, tz)).toBe(`${dayKey} 09:00`);
      }
    }
  });

  it('places 2026-01-01 09:00 Asia/Kolkata at 03:30 UTC', () => {
    expect(utcStamp(localToInstant('2026-01-01', '09:00', 'Asia/Kolkata'))).toBe(
      '2026-01-01T03:30Z',
    );
  });

  it('rejects malformed times', () => {
    expect(() => localToInstant('2026-01-01', '24:00', 'UTC')).toThrow(RangeError);
    expect(() => localToInstant('2026-01-01', '7:30', 'UTC')).toThrow(RangeError);
    expect(() => localToInstant('2026-02-29', '07:30', 'UTC')).toThrow(RangeError);
  });
});

describe('localToInstant and instantToLocalParts round trip', () => {
  /**
   * Every hour of a transition day must survive the round trip, except the hours
   * inside a spring-forward gap, which name a local time that does not exist.
   * The ambiguous hours of a fall-back day *do* round trip: both readings share
   * the same wall clock, and 'compatible' consistently returns the earlier one.
   */
  const transitionDays: { tz: string; dayKey: string; gapHours: number[]; note: string }[] = [
    { tz: 'America/New_York', dayKey: '2026-03-08', gapHours: [2], note: 'spring forward' },
    { tz: 'America/New_York', dayKey: '2026-11-01', gapHours: [], note: 'fall back' },
    { tz: 'America/Los_Angeles', dayKey: '2026-03-08', gapHours: [2], note: 'spring forward' },
    { tz: 'America/Los_Angeles', dayKey: '2026-11-01', gapHours: [], note: 'fall back' },
    { tz: 'America/St_Johns', dayKey: '2026-03-08', gapHours: [2], note: 'spring forward' },
    { tz: 'Europe/London', dayKey: '2026-03-29', gapHours: [1], note: 'BST starts' },
    { tz: 'Europe/London', dayKey: '2026-10-25', gapHours: [], note: 'BST ends' },
    { tz: 'Australia/Sydney', dayKey: '2026-10-04', gapHours: [2], note: 'AEDT starts' },
    { tz: 'Australia/Sydney', dayKey: '2026-04-05', gapHours: [], note: 'AEDT ends' },
    { tz: 'Australia/Lord_Howe', dayKey: '2026-10-04', gapHours: [2], note: '+11:00 starts' },
    { tz: 'Australia/Lord_Howe', dayKey: '2026-04-05', gapHours: [], note: '+10:30 returns' },
    { tz: 'Pacific/Chatham', dayKey: '2026-09-27', gapHours: [3], note: '+13:45 starts' },
    { tz: 'Pacific/Chatham', dayKey: '2026-04-05', gapHours: [], note: '+12:45 returns' },
    { tz: 'Asia/Kolkata', dayKey: '2026-03-08', gapHours: [], note: 'no DST' },
    { tz: 'Pacific/Kiritimati', dayKey: '2026-03-08', gapHours: [], note: 'no DST' },
    { tz: 'UTC', dayKey: '2026-03-08', gapHours: [], note: 'no DST' },
  ];

  for (const { tz, dayKey, gapHours, note } of transitionDays) {
    it(`round trips every hour of ${dayKey} in ${tz} (${note})`, () => {
      for (let hour = 0; hour < 24; hour += 1) {
        if (gapHours.includes(hour)) continue;
        const time = `${pad2(hour)}:00`;
        const instant = localToInstant(dayKey, time, tz);
        const parts = instantToLocalParts(instant, tz);
        expect(makeDayKey(parts.year, parts.month, parts.day), `${tz} ${dayKey} ${time}`).toBe(
          dayKey,
        );
        expect(`${pad2(parts.hour)}:${pad2(parts.minute)}`, `${tz} ${dayKey} ${time}`).toBe(time);
        expect(formatTime(instant, tz)).toBe(time);
      }
    });
  }

  it('confirms the skipped hours really are missing from the local timeline', () => {
    for (const { tz, dayKey, gapHours } of transitionDays) {
      for (const hour of gapHours) {
        const time = `${pad2(hour)}:00`;
        const instant = localToInstant(dayKey, time, tz);
        expect(formatTime(instant, tz), `${tz} ${dayKey} ${time}`).not.toBe(time);
        // 'compatible' only ever moves forward, never back.
        expect(instant).toBeGreaterThan(localToInstant(dayKey, `${pad2(hour - 1)}:00`, tz));
      }
    }
  });

  it('round trips instants back to themselves across a spring-forward day', () => {
    // Every wall clock on a spring-forward day names exactly one instant, so the
    // round trip is exact in both directions.
    const start = localToInstant('2026-03-07', '00:00', 'America/New_York');
    for (let step = 0; step < 96; step += 1) {
      const instant = start + step * 30 * MS_PER_MINUTE;
      const parts = instantToLocalParts(instant, 'America/New_York');
      const dayKey = makeDayKey(parts.year, parts.month, parts.day);
      const time = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
      expect(localToInstant(dayKey, time, 'America/New_York'), `${dayKey} ${time}`).toBe(instant);
    }
  });

  it('maps both readings of an ambiguous wall clock to the earlier instant', () => {
    const earlier = localToInstant('2026-11-01', '01:30', 'America/New_York'); // EDT
    const later = earlier + MS_PER_HOUR; // EST, same wall clock
    for (const instant of [earlier, later]) {
      const parts = instantToLocalParts(instant, 'America/New_York');
      const dayKey = makeDayKey(parts.year, parts.month, parts.day);
      const time = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
      expect(`${dayKey} ${time}`).toBe('2026-11-01 01:30');
      expect(localToInstant(dayKey, time, 'America/New_York')).toBe(earlier);
    }
  });
});

describe('addMinutes', () => {
  it('shifts instants by whole minutes', () => {
    const instant = localToInstant('2026-09-17', '07:12', 'Asia/Kolkata');
    expect(formatTime(addMinutes(instant, 15), 'Asia/Kolkata')).toBe('07:27'); // SPEC §4 snooze example
    expect(formatTime(addMinutes(instant, 60), 'Asia/Kolkata')).toBe('08:12');
    expect(formatTime(addMinutes(instant, 180), 'Asia/Kolkata')).toBe('10:12');
    expect(addMinutes(instant, -15)).toBe(instant - 15 * MS_PER_MINUTE);
  });

  it('crosses a DST boundary as real elapsed time, not wall-clock time', () => {
    // 01:30 EST + 60 minutes is 03:30 EDT: the wall clock jumps two hours.
    const instant = localToInstant('2026-03-08', '01:30', 'America/New_York');
    expect(formatTime(addMinutes(instant, 60), 'America/New_York')).toBe('03:30');
    expect(todayKey(addMinutes(instant, 60), 'America/New_York')).toBe('2026-03-08');
  });

  it('rejects non-finite input', () => {
    expect(() => addMinutes(Number.NaN, 15)).toThrow(RangeError);
    expect(() => addMinutes(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('formats times as 24-hour HH:mm', () => {
    const midnight = localToInstant('2026-09-17', '00:00', 'Asia/Dubai');
    expect(formatTime(midnight, 'Asia/Dubai')).toBe('00:00');
    expect(formatTime(localToInstant('2026-09-17', '13:05', 'Asia/Dubai'), 'Asia/Dubai')).toBe(
      '13:05',
    );
    expect(formatTime(localToInstant('2026-09-17', '23:59', 'Asia/Dubai'), 'Asia/Dubai')).toBe(
      '23:59',
    );
    expect(formatTime(midnight, 'UTC')).toBe('20:00'); // the day before in UTC
  });

  it('renders the Today header label', () => {
    expect(formatDayLabel('2026-09-17')).toBe('THU · 17 SEP'); // SPEC §4
    expect(formatDayLabel('2026-01-01')).toBe('THU · 01 JAN');
    expect(formatDayLabel('2024-02-29')).toBe('THU · 29 FEB');
    expect(formatDayLabel('2026-12-25')).toBe('FRI · 25 DEC');
  });

  it('resolves the header in the user timezone, not the process timezone', () => {
    const instant = localToInstant('2026-06-15', '10:00', 'UTC');
    expect(formatDateHeader(instant, 'America/Los_Angeles')).toBe('MON · 15 JUN');
    expect(formatDateHeader(instant, 'Pacific/Kiritimati')).toBe('TUE · 16 JUN');
  });
});

describe('runTimeSelfCheck', () => {
  const results = runTimeSelfCheck();

  it('returns a non-empty table of known-answer checks', () => {
    expect(results.length).toBeGreaterThanOrEqual(15);
    for (const result of results) {
      expect(typeof result.name).toBe('string');
      expect(typeof result.expected).toBe('string');
      expect(typeof result.actual).toBe('string');
      expect(typeof result.pass).toBe('boolean');
    }
  });

  it('passes every check on this runtime', () => {
    const failures = results.filter((result) => !result.pass);
    expect(failures.map((f) => `${f.name}: expected ${f.expected}, got ${f.actual}`)).toEqual([]);
  });
});

describe('timezone list', () => {
  it('includes every zone the app is tested against', () => {
    const zones = listTimeZones();
    for (const tz of ZONES) {
      expect(zones, tz).toContain(tz);
    }
  });

  it('is sorted and free of duplicates', () => {
    const zones = listTimeZones();
    expect(zones.length).toBeGreaterThan(300);
    expect([...new Set(zones)]).toHaveLength(zones.length);
    expect([...zones].sort()).toEqual(zones);
  });

  it('only lists zones Intl accepts', () => {
    for (const tz of FALLBACK_TIME_ZONES) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  it('guesses a usable timezone', () => {
    const guessed = guessTimeZone();
    expect(isValidTimeZone(guessed)).toBe(true);
  });
});

describe('module invariants', () => {
  it('exposes the constants other modules need', () => {
    expect(MS_PER_MINUTE).toBe(60_000);
    expect(MS_PER_HOUR).toBe(3_600_000);
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(DAYS_PER_WEEK).toBe(7);
  });

  it('is pure: the same arguments always give the same answer', () => {
    const first = localToInstant('2026-03-08', '02:30', 'America/New_York');
    const second = localToInstant('2026-03-08', '02:30', 'America/New_York');
    expect(second).toBe(first);
    expect(todayKey(first, 'America/New_York')).toBe(todayKey(second, 'America/New_York'));
  });
});
