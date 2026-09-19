/**
 * The time engine (SPEC.md §7).
 *
 * This is the single place in the codebase where date and time maths happen,
 * and the only source file exempt from the ESLint date guard (SPEC.md §13)
 * besides `apps/api/src/lib/instant.ts`. Everything else — API, worker and web —
 * does its date work through these exports.
 *
 * Ground rules encoded here:
 *  1. Date strings are never handed to `Date`. `DayKey` is parsed into integers.
 *  2. Day arithmetic goes through `Date.UTC(y, m - 1, d + n)` and UTC getters,
 *     never through millisecond addition (a local day is not always 86 400 000 ms).
 *  3. Timezone conversion goes through `Intl.DateTimeFormat(...).formatToParts`
 *     with an explicit `timeZone`. Formatters are cached per zone.
 *  4. DST disambiguation matches Temporal's `'compatible'` mode: a local time in
 *     a spring-forward gap shifts forward by the size of the gap, and an
 *     ambiguous local time in a fall-back overlap resolves to the earlier instant.
 *  5. The process timezone is never consulted. Every function takes an IANA
 *     `tz` or operates on a `DayKey`.
 *  6. Every function is pure: `now` is always passed in.
 */

import type { DayKey, WeekStart } from './types';

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
/** Length of a *UTC* day. Local days can be shorter or longer across a DST transition. */
export const MS_PER_DAY = 86_400_000;
export const DAYS_PER_WEEK = 7;

/** Local wall-clock fields in some timezone, plus the weekday of that local date. */
export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number;
};

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
/** Indexed by {@link weekday}: 0 is Sunday. */
export const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
/** Indexed by month − 1. */
export const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/**
 * `Date.UTC` maps years 0–99 onto 1900–1999. Shifting every year forward by one
 * full Gregorian cycle sidesteps that quirk for the whole supported range
 * (0000–9999) without changing any calendar result: 400 Gregorian years are
 * exactly 146 097 days, which is also a whole number of weeks.
 */
const GREGORIAN_CYCLE_YEARS = 400;
const GREGORIAN_CYCLE_MS = 146_097 * MS_PER_DAY;

const MIN_YEAR = 0;
const MAX_YEAR = 9999;

/** Builds the UTC instant for civil fields, normalising out-of-range values (e.g. `day + n`). */
function utcFromCivil(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  return (
    Date.UTC(year + GREGORIAN_CYCLE_YEARS, month - 1, day, hour, minute, second) -
    GREGORIAN_CYCLE_MS
  );
}

/** Reads a UTC instant back into civil fields. Inverse of {@link utcFromCivil}. */
function civilFromUtc(ms: number): LocalParts {
  const d = new Date(ms + GREGORIAN_CYCLE_MS);
  return {
    year: d.getUTCFullYear() - GREGORIAN_CYCLE_YEARS,
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ---------------------------------------------------------------------------
// DayKey: calendar days, no timezone involved
// ---------------------------------------------------------------------------

/** Number of days in a month. `month` is 1–12. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`Invalid year: ${String(year)}`);
  }
  const length = MONTH_LENGTHS[month - 1];
  if (length === undefined || !Number.isInteger(month)) {
    throw new RangeError(`Invalid month: ${String(month)}`);
  }
  return month === 2 && isLeapYear(year) ? 29 : length;
}

/** True when `value` is a 'YYYY-MM-DD' string naming a real calendar day. */
export function isValidDayKey(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = DAY_KEY_RE.exec(value);
  if (match === null) return false;
  const [, rawYear, rawMonth, rawDay] = match;
  if (rawYear === undefined || rawMonth === undefined || rawDay === undefined) return false;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function assertDayKey(dayKey: DayKey, label = 'dayKey'): void {
  if (!isValidDayKey(dayKey)) {
    throw new RangeError(`Invalid ${label}: ${String(dayKey)} (expected 'YYYY-MM-DD')`);
  }
}

/** Splits a `DayKey` into integers. `month` is 1–12. Throws on a malformed key. */
export function parseDayKey(dayKey: DayKey): { year: number; month: number; day: number } {
  assertDayKey(dayKey);
  return {
    year: Number(dayKey.slice(0, 4)),
    month: Number(dayKey.slice(5, 7)),
    day: Number(dayKey.slice(8, 10)),
  };
}

/** Builds a `DayKey` from integers. `month` is 1–12. Throws when the day does not exist. */
export function makeDayKey(year: number, month: number, day: number): DayKey {
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid day: ${pad4(year)}-${pad2(month)}-${String(day)}`);
  }
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Adds `n` calendar days (negative to subtract). Never touches milliseconds. */
export function addDays(dayKey: DayKey, n: number): DayKey {
  if (!Number.isInteger(n)) {
    throw new RangeError(`Invalid day offset: ${String(n)}`);
  }
  const { year, month, day } = parseDayKey(dayKey);
  const shifted = civilFromUtc(utcFromCivil(year, month, day + n));
  return makeDayKey(shifted.year, shifted.month, shifted.day);
}

/** -1 when `a` is earlier, 0 when equal, 1 when `a` is later. */
export function compareDayKeys(a: DayKey, b: DayKey): -1 | 0 | 1 {
  assertDayKey(a, 'dayKey a');
  assertDayKey(b, 'dayKey b');
  // 'YYYY-MM-DD' is fixed width and zero padded, so byte order is date order.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: DayKey, to: DayKey): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  const delta = utcFromCivil(b.year, b.month, b.day) - utcFromCivil(a.year, a.month, a.day);
  // Both instants are midnight UTC, so the difference is an exact multiple of a UTC day.
  return delta / MS_PER_DAY;
}

/** Weekday of a calendar day: 0 = Sunday .. 6 = Saturday. */
export function weekday(dayKey: DayKey): number {
  const { year, month, day } = parseDayKey(dayKey);
  return civilFromUtc(utcFromCivil(year, month, day)).weekday;
}

/** First day of the calendar week containing `dayKey`, per the user's `weekStart`. */
export function weekStartKey(dayKey: DayKey, weekStart: WeekStart): DayKey {
  if (weekStart !== 0 && weekStart !== 1) {
    throw new RangeError(`Invalid weekStart: ${String(weekStart)} (expected 0 or 1)`);
  }
  const offset = (weekday(dayKey) - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(dayKey, -offset);
}

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

/** True when `time` is 'HH:mm' between '00:00' and '23:59'. */
export function isValidTime(time: string): boolean {
  return typeof time === 'string' && TIME_RE.test(time);
}

function parseTime(time: string): { hour: number; minute: number } {
  if (!isValidTime(time)) {
    throw new RangeError(`Invalid time: ${String(time)} (expected 'HH:mm')`);
  }
  return { hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) };
}

/** Shifts an instant by whole minutes. Used for snoozes (SPEC.md §6 "Actions"). */
export function addMinutes(ms: number, minutes: number): number {
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid instant: ${String(ms)}`);
  if (!Number.isFinite(minutes)) throw new RangeError(`Invalid minutes: ${String(minutes)}`);
  return ms + minutes * MS_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Timezone conversion
// ---------------------------------------------------------------------------

/**
 * Formatters are expensive to construct and `localToInstant` builds several per
 * call, so they are cached per zone. The cache is capped because `isValidTimeZone`
 * may be called with arbitrary user input.
 */
const FORMATTER_CACHE_LIMIT = 512;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(tz);
  if (cached !== undefined) return cached;
  // Throws a RangeError for an unknown zone, which is how isValidTimeZone detects one.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (formatterCache.size >= FORMATTER_CACHE_LIMIT) formatterCache.clear();
  formatterCache.set(tz, formatter);
  return formatter;
}

/** True when the runtime's `Intl` recognises `tz` as a timezone. */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    getFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) {
    throw new RangeError(`Unknown timezone: ${String(tz)}`);
  }
}

function assertInstant(ms: number): void {
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Invalid instant: ${String(ms)}`);
  }
}

/** Wall-clock fields of `ms` in `tz`, read out of `Intl` rather than computed. */
export function instantToLocalParts(ms: number, tz: string): LocalParts {
  assertInstant(ms);
  assertTimeZone(tz);
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  let hour: number | undefined;
  let minute: number | undefined;
  let second: number | undefined;
  for (const part of getFormatter(tz).formatToParts(new Date(ms))) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value);
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      default:
        break;
    }
  }
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new Error(`Intl returned incomplete parts for timezone ${tz}`);
  }
  // Some engines render midnight as hour 24 under an h24 cycle.
  if (hour === 24) hour = 0;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: civilFromUtc(utcFromCivil(year, month, day)).weekday,
  };
}

/**
 * The zone's UTC offset in milliseconds at `ms` (positive east of Greenwich).
 * Derived by reading the local wall clock and measuring it against UTC.
 */
export function timeZoneOffsetMs(ms: number, tz: string): number {
  const p = instantToLocalParts(ms, tz);
  const asIfUtc = utcFromCivil(p.year, p.month, p.day, p.hour, p.minute, p.second);
  // Offsets are whole seconds, so compare against the whole second containing `ms`.
  return asIfUtc - Math.floor(ms / MS_PER_SECOND) * MS_PER_SECOND;
}

/** The calendar day `ms` falls on in `tz`. */
export function instantToDayKey(ms: number, tz: string): DayKey {
  const { year, month, day } = instantToLocalParts(ms, tz);
  return makeDayKey(year, month, day);
}

/** Today's `DayKey` in `tz`. `now` is always supplied by the caller. */
export function todayKey(now: number, tz: string): DayKey {
  return instantToDayKey(now, tz);
}

/**
 * The instant at which the wall clock in `tz` reads `dayKey` at `time`.
 *
 * Two-pass offset guess, then explicit Temporal `'compatible'` disambiguation:
 * the offsets one UTC day either side of the target bracket any transition, so
 * they yield the only two candidate instants. Both valid means the local time is
 * ambiguous (fall back) and the earlier instant wins; neither valid means the
 * local time does not exist (spring forward) and the pre-transition offset is
 * used, which lands exactly one gap-width later.
 */
export function localToInstant(dayKey: DayKey, time: string, tz: string): number {
  const { year, month, day } = parseDayKey(dayKey);
  const { hour, minute } = parseTime(time);
  assertTimeZone(tz);

  const wall = utcFromCivil(year, month, day, hour, minute, 0);
  const offsetBefore = timeZoneOffsetMs(wall - MS_PER_DAY, tz);
  const offsetAfter = timeZoneOffsetMs(wall + MS_PER_DAY, tz);

  const candidateBefore = wall - offsetBefore;
  const candidateAfter = wall - offsetAfter;
  const beforeIsValid = timeZoneOffsetMs(candidateBefore, tz) === offsetBefore;
  const afterIsValid = timeZoneOffsetMs(candidateAfter, tz) === offsetAfter;

  if (beforeIsValid && afterIsValid) {
    // Unique when the offsets agree; otherwise ambiguous, and 'compatible' takes the earlier.
    return Math.min(candidateBefore, candidateAfter);
  }
  if (beforeIsValid) return candidateBefore;
  if (afterIsValid) return candidateAfter;
  // Nonexistent local time: 'compatible' shifts forward by the size of the gap.
  return candidateBefore;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 'HH:mm', 24-hour, in `tz`. */
export function formatTime(ms: number, tz: string): string {
  const { hour, minute } = instantToLocalParts(ms, tz);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** The Today header label, e.g. 'THU · 17 SEP' (SPEC.md §4). */
export function formatDayLabel(dayKey: DayKey): string {
  const { month, day } = parseDayKey(dayKey);
  const weekdayLabel = WEEKDAY_LABELS[weekday(dayKey)];
  const monthLabel = MONTH_LABELS[month - 1];
  if (weekdayLabel === undefined || monthLabel === undefined) {
    throw new RangeError(`Invalid dayKey: ${String(dayKey)}`);
  }
  return `${weekdayLabel} · ${pad2(day)} ${monthLabel}`;
}

/** The Today header label for an instant, resolved in `tz`. */
export function formatDateHeader(ms: number, tz: string): string {
  return formatDayLabel(instantToDayKey(ms, tz));
}
