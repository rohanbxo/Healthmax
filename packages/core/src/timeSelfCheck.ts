/**
 * Known-answer checks for the time engine (SPEC.md §7).
 *
 * Every expected value below was derived from the published IANA rules for the
 * zone, not from this implementation's output. The suite runs in Vitest and is
 * also exposed in development builds at `/dev/time-check`, so the same table can
 * be compared across Safari, Chrome and Firefox — their bundled `Intl` data can
 * differ, and a failing row points straight at the engine.
 *
 * This file is *not* exempt from the ESLint date guard: it only calls `time.ts`.
 */

import {
  MS_PER_MINUTE,
  addDays,
  diffDays,
  formatDayLabel,
  formatTime,
  instantToDayKey,
  instantToLocalParts,
  localToInstant,
  timeZoneOffsetMs,
  todayKey,
  weekStartKey,
} from './time';

export type TimeSelfCheckResult = {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
};

type TimeSelfCheckCase = {
  name: string;
  expected: string;
  run: () => string;
};

/** 'YYYY-MM-DDTHH:mmZ' — the instant itself, independent of any zone. */
function utcStamp(ms: number): string {
  return `${instantToDayKey(ms, 'UTC')}T${formatTime(ms, 'UTC')}Z`;
}

/** 'YYYY-MM-DD HH:mm (YYYY-MM-DDTHH:mmZ)' — local wall clock plus the instant behind it. */
function resolved(ms: number, tz: string): string {
  return `${instantToDayKey(ms, tz)} ${formatTime(ms, tz)} (${utcStamp(ms)})`;
}

function offsetMinutes(dayKey: string, tz: string): number {
  return timeZoneOffsetMs(localToInstant(dayKey, '12:00', tz), tz) / MS_PER_MINUTE;
}

const CASES: readonly TimeSelfCheckCase[] = [
  {
    // DST starts 02:00 EST on the second Sunday in March; 02:00–03:00 never happens.
    name: 'America/New_York 2026-03-08 02:30 is in the spring-forward gap',
    expected: '2026-03-08 03:30 (2026-03-08T07:30Z)',
    run: () =>
      resolved(localToInstant('2026-03-08', '02:30', 'America/New_York'), 'America/New_York'),
  },
  {
    // DST ends 02:00 EDT on the first Sunday in November; 01:00–02:00 happens twice.
    name: 'America/New_York 2026-11-01 01:30 is ambiguous and resolves to the earlier (EDT) instant',
    expected: '2026-11-01 01:30 (2026-11-01T05:30Z)',
    run: () =>
      resolved(localToInstant('2026-11-01', '01:30', 'America/New_York'), 'America/New_York'),
  },
  {
    // Newfoundland runs the US rules at a half-hour offset: -3:30 becomes -2:30.
    name: 'America/St_Johns 2026-03-08 02:30 is in the spring-forward gap',
    expected: '2026-03-08 03:30 (2026-03-08T06:00Z)',
    run: () =>
      resolved(localToInstant('2026-03-08', '02:30', 'America/St_Johns'), 'America/St_Johns'),
  },
  {
    // BST starts 01:00 UTC on the last Sunday in March.
    name: 'Europe/London 2026-03-29 01:30 is in the spring-forward gap',
    expected: '2026-03-29 02:30 (2026-03-29T01:30Z)',
    run: () => resolved(localToInstant('2026-03-29', '01:30', 'Europe/London'), 'Europe/London'),
  },
  {
    // BST ends 02:00 BST on the last Sunday in October.
    name: 'Europe/London 2026-10-25 01:30 is ambiguous and resolves to the earlier (BST) instant',
    expected: '2026-10-25 01:30 (2026-10-25T00:30Z)',
    run: () => resolved(localToInstant('2026-10-25', '01:30', 'Europe/London'), 'Europe/London'),
  },
  {
    // AEDT ends 03:00 on the first Sunday in April; 02:00–03:00 happens twice.
    name: 'Australia/Sydney 2026-04-05 02:30 is ambiguous and resolves to the earlier (AEDT) instant',
    expected: '2026-04-05 02:30 (2026-04-04T15:30Z)',
    run: () =>
      resolved(localToInstant('2026-04-05', '02:30', 'Australia/Sydney'), 'Australia/Sydney'),
  },
  {
    // AEDT starts 02:00 on the first Sunday in October.
    name: 'Australia/Sydney 2026-10-04 02:30 is in the spring-forward gap',
    expected: '2026-10-04 03:30 (2026-10-03T16:30Z)',
    run: () =>
      resolved(localToInstant('2026-10-04', '02:30', 'Australia/Sydney'), 'Australia/Sydney'),
  },
  {
    // Lord Howe shifts by 30 minutes: 02:00 becomes 02:30, so only 02:00–02:30 is missing.
    name: 'Australia/Lord_Howe 2026-10-04 02:15 is in the 30-minute spring-forward gap',
    expected: '2026-10-04 02:45 (2026-10-03T15:45Z)',
    run: () =>
      resolved(localToInstant('2026-10-04', '02:15', 'Australia/Lord_Howe'), 'Australia/Lord_Howe'),
  },
  {
    // ... and 02:30 is the first instant after the gap, so it exists exactly once.
    name: 'Australia/Lord_Howe 2026-10-04 02:30 is the first instant after the gap',
    expected: '2026-10-04 02:30 (2026-10-03T15:30Z)',
    run: () =>
      resolved(localToInstant('2026-10-04', '02:30', 'Australia/Lord_Howe'), 'Australia/Lord_Howe'),
  },
  {
    // Chatham sits at +12:45/+13:45 and follows the New Zealand rules.
    name: 'Pacific/Chatham 2026-09-27 03:00 is in the spring-forward gap',
    expected: '2026-09-27 04:00 (2026-09-26T14:15Z)',
    run: () =>
      resolved(localToInstant('2026-09-27', '03:00', 'Pacific/Chatham'), 'Pacific/Chatham'),
  },
  {
    name: 'Asia/Kolkata is a fixed +05:30 zone',
    expected: '2026-01-01 09:00 (2026-01-01T03:30Z)',
    run: () => resolved(localToInstant('2026-01-01', '09:00', 'Asia/Kolkata'), 'Asia/Kolkata'),
  },
  {
    name: 'Asia/Dubai is a fixed +04:00 zone with no DST',
    expected: '240 / 240',
    run: () =>
      `${offsetMinutes('2026-01-15', 'Asia/Dubai')} / ${offsetMinutes('2026-07-15', 'Asia/Dubai')}`,
  },
  {
    name: 'America/St_Johns offsets are -03:30 in January and -02:30 in July',
    expected: '-210 / -150',
    run: () =>
      `${offsetMinutes('2026-01-15', 'America/St_Johns')} / ${offsetMinutes('2026-07-15', 'America/St_Johns')}`,
  },
  {
    // +14:00 against -07:00 — the widest gap on the map.
    name: 'One instant falls on different days in Pacific/Kiritimati and America/Los_Angeles',
    expected: '2026-06-16 vs 2026-06-15',
    run: () => {
      const instant = localToInstant('2026-06-15', '10:00', 'UTC');
      return `${todayKey(instant, 'Pacific/Kiritimati')} vs ${todayKey(instant, 'America/Los_Angeles')}`;
    },
  },
  {
    name: 'localToInstant and instantToLocalParts round trip outside a transition',
    expected: '2026-09-17 07:30 weekday 4',
    run: () => {
      const instant = localToInstant('2026-09-17', '07:30', 'Europe/London');
      const parts = instantToLocalParts(instant, 'Europe/London');
      return `${instantToDayKey(instant, 'Europe/London')} ${formatTime(instant, 'Europe/London')} weekday ${parts.weekday}`;
    },
  },
  {
    name: 'addDays crosses 29 February in the leap year 2024',
    expected: '2024-02-29 / 2024-03-01',
    run: () => `${addDays('2024-02-28', 1)} / ${addDays('2024-02-29', 1)}`,
  },
  {
    name: 'addDays skips 29 February in the non-leap year 2026',
    expected: '2026-03-01',
    run: () => addDays('2026-02-28', 1),
  },
  {
    name: 'addDays crosses a year boundary in both directions',
    expected: '2027-01-01 / 2026-12-31',
    run: () => `${addDays('2026-12-31', 1)} / ${addDays('2027-01-01', -1)}`,
  },
  {
    name: 'diffDays spans a year boundary',
    expected: '1 / -365',
    run: () => `${diffDays('2025-12-31', '2026-01-01')} / ${diffDays('2026-01-01', '2025-01-01')}`,
  },
  {
    // 2026-01-01 is a Thursday.
    name: 'weekStartKey walks back into the previous year for both week starts',
    expected: '2025-12-29 / 2025-12-28',
    run: () => `${weekStartKey('2026-01-01', 1)} / ${weekStartKey('2026-01-01', 0)}`,
  },
  {
    name: 'formatDayLabel renders the Today header',
    expected: 'THU · 17 SEP',
    run: () => formatDayLabel('2026-09-17'),
  },
];

/**
 * Runs every known-answer check and returns the table. Returns data; printing
 * or rendering is the caller's job.
 */
export function runTimeSelfCheck(): TimeSelfCheckResult[] {
  return CASES.map((testCase) => {
    let actual: string;
    try {
      actual = testCase.run();
    } catch (error) {
      actual = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    return {
      name: testCase.name,
      expected: testCase.expected,
      actual,
      pass: actual === testCase.expected,
    };
  });
}
