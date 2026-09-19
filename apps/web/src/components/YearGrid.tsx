/**
 * The Calendar's Year view (SPEC.md §11): 53 week columns ending with the
 * current week, each column running from the user's week start. Future days in
 * the current week are shown but cannot be opened.
 */
import * as React from 'react';
import { type DayKey, type WeekStart, compareDayKeys, formatDayLabel } from '@beta/core';
import { cn } from '@/lib/utils';
import { type DayTally, type Week, shadeFor, tallyLabel, weekdayHeaders } from './calendar-model';
import { SHADE_CLASSES } from './MonthGrid';

export type YearGridProps = {
  weeks: Week[];
  weekStart: WeekStart;
  todayKey: DayKey;
  tallyOf: (dayKey: DayKey) => DayTally;
  onSelectDay: (dayKey: DayKey) => void;
};

export function YearGrid({
  weeks,
  weekStart,
  todayKey,
  tallyOf,
  onSelectDay,
}: YearGridProps): React.ReactElement {
  const scroller = React.useRef<HTMLDivElement>(null);

  // The newest weeks are on the right; start there on a narrow screen.
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, []);

  return (
    <div className="flex gap-1.5">
      <div className="grid grid-rows-7 gap-[3px]" aria-hidden="true">
        {weekdayHeaders(weekStart).map((label) => (
          <span key={label} className="flex h-3 items-center font-mono text-[9px] text-muted">
            {label.slice(0, 1)}
          </span>
        ))}
      </div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div
          role="group"
          aria-label={`${weeks.length} weeks`}
          data-weeks={weeks.length}
          className="grid grid-flow-col grid-rows-7 gap-[3px]"
        >
          {weeks.flat().map((dayKey) => {
            const tally = tallyOf(dayKey);
            const shade = shadeFor(tally, dayKey, todayKey);
            const future = compareDayKeys(dayKey, todayKey) > 0;
            return (
              <button
                key={dayKey}
                type="button"
                data-day={dayKey}
                data-shade={shade}
                disabled={future}
                aria-label={`${formatDayLabel(dayKey)}: ${tallyLabel(tally, shade)}`}
                onClick={() => onSelectDay(dayKey)}
                className={cn(
                  'size-3 rounded-[3px]',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                  SHADE_CLASSES[shade],
                  future && 'border border-border/50',
                )}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
