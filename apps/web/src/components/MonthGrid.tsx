/**
 * The Calendar's Month view (SPEC.md §11): whole weeks aligned to the user's
 * week start, each day of the month shaded by done against due. Tapping a day
 * opens it in the Day view.
 */
import * as React from 'react';
import {
  type DayKey,
  type WeekStart,
  compareDayKeys,
  formatDayLabel,
  parseDayKey,
} from '@beta/core';
import { cn } from '@/lib/utils';
import {
  type DayShade,
  type DayTally,
  type Week,
  shadeFor,
  tallyLabel,
  weekdayHeaders,
} from './calendar-model';

export const SHADE_CLASSES: Record<DayShade, string> = {
  full: 'bg-success text-base',
  partial: 'bg-success/40 text-text',
  none: 'bg-card text-text',
  future: 'bg-transparent text-muted',
};

export type MonthGridProps = {
  year: number;
  month: number;
  weeks: Week[];
  weekStart: WeekStart;
  todayKey: DayKey;
  tallyOf: (dayKey: DayKey) => DayTally;
  onSelectDay: (dayKey: DayKey) => void;
};

export function MonthGrid({
  year,
  month,
  weeks,
  weekStart,
  todayKey,
  tallyOf,
  onSelectDay,
}: MonthGridProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
        {weekdayHeaders(weekStart).map((label) => (
          <span key={label} className="section-label text-center text-muted">
            {label.slice(0, 1)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {weeks.flat().map((dayKey) => {
          const parts = parseDayKey(dayKey);
          if (parts.year !== year || parts.month !== month) {
            // Keeps the columns aligned; the neighbouring month is not shown.
            return <span key={dayKey} aria-hidden="true" />;
          }
          const tally = tallyOf(dayKey);
          const shade = shadeFor(tally, dayKey, todayKey);
          const isToday = compareDayKeys(dayKey, todayKey) === 0;
          return (
            <button
              key={dayKey}
              type="button"
              data-shade={shade}
              aria-label={`${formatDayLabel(dayKey)}: ${tallyLabel(tally, shade)}`}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onSelectDay(dayKey)}
              className={cn(
                'flex aspect-square min-h-11 items-center justify-center rounded-[10px]',
                'font-mono text-sm tabular-nums transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                SHADE_CLASSES[shade],
                isToday && 'ring-1 ring-accent',
              )}
            >
              {parts.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
