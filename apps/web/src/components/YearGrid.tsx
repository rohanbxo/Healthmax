/**
 * The Calendar's Year view (SPEC.md §11): 53 week columns ending with the
 * current week, each column running from the user's week start.
 *
 * Laid out as an ARIA grid: one row per weekday, one cell per week, so the
 * columns on screen are the weeks. Focus follows the roving tabindex pattern —
 * exactly one cell is tabbable, and the arrow keys move focus from there:
 *
 *   ← / →   the same weekday a week back or forward (across a row)
 *   ↑ / ↓   another weekday in the same week (down a column)
 *   Home    the first day of that week, End the last
 *   Enter / Space   opens the day, which the native buttons do on their own
 *
 * A future day keeps its place in that order with `aria-disabled` rather than
 * `disabled`, because a disabled button cannot be focused and skipping cells
 * would break the grid's geometry.
 *
 * Each cell is a `gridcell` wrapping a real `<button>`: putting the role on the
 * button itself would override its own, and nothing would tell a screen reader
 * the day can be opened.
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

/** `weeks` are columns; the grid's rows are the weekdays across them. */
function toRows(weeks: Week[]): DayKey[][] {
  const rowCount = weeks[0]?.length ?? 0;
  return Array.from({ length: rowCount }, (_, row) =>
    weeks.map((week) => week[row]).filter((day): day is DayKey => day !== undefined),
  );
}

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

export function YearGrid({
  weeks,
  weekStart,
  todayKey,
  tallyOf,
  onSelectDay,
}: YearGridProps): React.ReactElement {
  const scroller = React.useRef<HTMLDivElement>(null);
  const grid = React.useRef<HTMLDivElement>(null);
  const rows = React.useMemo(() => toRows(weeks), [weeks]);
  const labels = weekdayHeaders(weekStart);

  // The tabbable cell: today if it is in the grid, otherwise the newest day.
  const lastDay = rows.at(-1)?.at(-1) ?? todayKey;
  const [focusedDay, setFocusedDay] = React.useState<DayKey>(() =>
    rows.some((row) => row.includes(todayKey)) ? todayKey : lastDay,
  );

  // The newest weeks are on the right; start there on a narrow screen.
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, []);

  const moveTo = (dayKey: DayKey | undefined): void => {
    if (dayKey === undefined) return;
    setFocusedDay(dayKey);
    grid.current?.querySelector<HTMLElement>(`[data-day="${dayKey}"]`)?.focus();
  };

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: number,
    column: number,
  ) => {
    const lastRow = rows.length - 1;
    const lastColumn = (rows[row]?.length ?? 1) - 1;

    switch (event.key) {
      case 'ArrowRight':
        moveTo(rows[row]?.[clamp(column + 1, lastColumn)]);
        break;
      case 'ArrowLeft':
        moveTo(rows[row]?.[clamp(column - 1, lastColumn)]);
        break;
      case 'ArrowDown':
        moveTo(rows[clamp(row + 1, lastRow)]?.[column]);
        break;
      case 'ArrowUp':
        moveTo(rows[clamp(row - 1, lastRow)]?.[column]);
        break;
      // A week is a column here, so Home and End run down it.
      case 'Home':
        moveTo(rows[0]?.[column]);
        break;
      case 'End':
        moveTo(rows[lastRow]?.[column]);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col gap-[3px]" aria-hidden="true">
        {labels.map((label) => (
          <span key={label} className="flex h-3 items-center font-mono text-[9px] text-muted">
            {label.slice(0, 1)}
          </span>
        ))}
      </div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div
          ref={grid}
          role="grid"
          aria-label={`Last ${weeks.length} weeks`}
          aria-rowcount={rows.length}
          aria-colcount={weeks.length}
          data-weeks={weeks.length}
          className="flex flex-col gap-[3px]"
        >
          {rows.map((row, rowIndex) => (
            <div
              key={labels[rowIndex] ?? rowIndex}
              role="row"
              aria-rowindex={rowIndex + 1}
              className="flex gap-[3px]"
            >
              {row.map((dayKey, columnIndex) => {
                const tally = tallyOf(dayKey);
                const shade = shadeFor(tally, dayKey, todayKey);
                const future = compareDayKeys(dayKey, todayKey) > 0;
                return (
                  <div key={dayKey} role="gridcell" aria-colindex={columnIndex + 1}>
                    <button
                      type="button"
                      data-day={dayKey}
                      data-shade={shade}
                      tabIndex={dayKey === focusedDay ? 0 : -1}
                      aria-disabled={future || undefined}
                      aria-current={dayKey === todayKey ? 'date' : undefined}
                      aria-label={`${formatDayLabel(dayKey)}: ${tallyLabel(tally, shade)}`}
                      onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)}
                      onFocus={() => setFocusedDay(dayKey)}
                      onClick={() => {
                        if (!future) onSelectDay(dayKey);
                      }}
                      className={cn(
                        'block size-3 rounded-[3px]',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                        SHADE_CLASSES[shade],
                        future && 'border border-border/50',
                      )}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
