/**
 * Calendar (SPEC.md §11 "Calendar"): Day / Month / Year, defaulting to Month,
 * with a habit filter. Month cells are shaded by done against due; tapping one
 * opens the Day view, where statuses can be edited inside the backfill window.
 *
 * "Today" is the user's day in their timezone, recomputed on the 30-second
 * tick, so the grid rolls over at their midnight (SPEC.md §7).
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type DayKey,
  type HabitDTO,
  type LogStatus,
  MONTH_LABELS,
  addDays,
  compareDayKeys,
  formatDayLabel,
  parseDayKey,
  todayKey as todayKeyFor,
} from '@beta/core';
import { Button, SectionLabel, SegmentedControl, Spinner } from '@/components/ui';
import { useDayLogMutation, useHabits, useLogs } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { useNowTick } from '@/components/useNowTick';
import { MonthGrid } from '@/components/MonthGrid';
import { YearGrid } from '@/components/YearGrid';
import { DayLog } from '@/components/DayLog';
import {
  type DayRange,
  indexLogs,
  monthWeeks,
  rangeOf,
  shiftMonth,
  tallyDay,
  yearWeeks,
} from '@/components/calendar-model';

type CalendarView = 'day' | 'month' | 'year';

const VIEW_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

const ALL_HABITS = 'all';

type MonthRef = { year: number; month: number };

function monthOf(dayKey: DayKey): MonthRef {
  const { year, month } = parseDayKey(dayKey);
  return { year, month };
}

function PagerHeader({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  nextDisabled = false,
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="icon" aria-label={previousLabel} onClick={onPrevious}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <h2 className="font-mono text-sm tracking-[0.12em] uppercase">{label}</h2>
      <Button
        variant="ghost"
        size="icon"
        aria-label={nextLabel}
        onClick={onNext}
        disabled={nextDisabled}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}

export function CalendarRoute(): React.ReactElement {
  const { me } = useAuth();
  const timeZone = me?.timeZone ?? 'UTC';
  const weekStart = me?.weekStart ?? 1;
  const now = useNowTick();
  const today = todayKeyFor(now, timeZone);

  const [view, setView] = React.useState<CalendarView>('month');
  const [selectedDay, setSelectedDay] = React.useState<DayKey>(today);
  const [shownMonth, setShownMonth] = React.useState<MonthRef>(() => monthOf(today));
  const [habitFilter, setHabitFilter] = React.useState<string>(ALL_HABITS);

  const habits = useHabits();
  const dayLog = useDayLogMutation();

  const monthGrid = React.useMemo(
    () => monthWeeks(shownMonth.year, shownMonth.month, weekStart),
    [shownMonth, weekStart],
  );
  const yearGrid = React.useMemo(() => yearWeeks(today, weekStart), [today, weekStart]);

  // Day and Month share the month's range, so moving between them never refetches.
  const range: DayRange = view === 'year' ? rangeOf(yearGrid) : rangeOf(monthGrid);
  const logs = useLogs(range.from, range.to);

  const liveHabits = React.useMemo(
    () => (habits.data ?? []).filter((habit) => !habit.archived),
    [habits.data],
  );
  const shownHabits = React.useMemo(
    () =>
      habitFilter === ALL_HABITS
        ? liveHabits
        : liveHabits.filter((habit) => habit.id === habitFilter),
    [habitFilter, liveHabits],
  );
  const index = React.useMemo(() => indexLogs(logs.data ?? []), [logs.data]);
  const tallyOf = React.useCallback(
    (dayKey: DayKey) => tallyDay(shownHabits, index, dayKey),
    [index, shownHabits],
  );

  const openDay = React.useCallback((dayKey: DayKey) => {
    setSelectedDay(dayKey);
    setShownMonth(monthOf(dayKey));
    setView('day');
  }, []);

  const moveMonth = (delta: number) => {
    setShownMonth((current) => shiftMonth(current.year, current.month, delta));
  };

  const setDayLog = (habit: HabitDTO, status: LogStatus | null) => {
    dayLog.mutate({ habitId: habit.id, dayKey: selectedDay, status });
  };

  const selectId = React.useId();
  const loading = habits.isPending || logs.isPending;
  const failed = habits.isError || logs.isError;

  return (
    <div className="flex flex-col gap-5 pt-4 pb-4">
      <header className="flex flex-col gap-3">
        <SectionLabel>CALENDAR</SectionLabel>
        <h1 className="sr-only">Calendar</h1>
        <SegmentedControl
          label="Calendar view"
          value={view}
          onValueChange={setView}
          options={VIEW_OPTIONS}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={selectId} className="section-label text-muted">
            HABIT
          </label>
          <select
            id={selectId}
            value={habitFilter}
            onChange={(event) => setHabitFilter(event.target.value)}
            className="h-12 w-full rounded-control border border-border bg-card px-3.5 text-[15px] text-text outline-none focus-visible:border-accent"
          >
            <option value={ALL_HABITS}>All habits</option>
            {liveHabits.map((habit) => (
              <option key={habit.id} value={habit.id}>
                {habit.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {view === 'month' ? (
        <PagerHeader
          label={`${MONTH_LABELS[shownMonth.month - 1] ?? ''} ${shownMonth.year}`}
          previousLabel="Previous month"
          nextLabel="Next month"
          onPrevious={() => moveMonth(-1)}
          onNext={() => moveMonth(1)}
        />
      ) : null}
      {view === 'day' ? (
        <PagerHeader
          label={formatDayLabel(selectedDay)}
          previousLabel="Previous day"
          nextLabel="Next day"
          onPrevious={() => openDay(addDays(selectedDay, -1))}
          onNext={() => openDay(addDays(selectedDay, 1))}
          nextDisabled={compareDayKeys(selectedDay, today) >= 0}
        />
      ) : null}
      {view === 'year' ? <SectionLabel className="text-muted">LAST 53 WEEKS</SectionLabel> : null}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner size="lg" label="Loading calendar" />
        </div>
      ) : failed ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-muted">
            We could not load your calendar. Check your connection and try again.
          </p>
          <Button
            variant="outline"
            fullWidth
            onClick={() => {
              void habits.refetch();
              void logs.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : view === 'month' ? (
        <MonthGrid
          year={shownMonth.year}
          month={shownMonth.month}
          weeks={monthGrid}
          weekStart={weekStart}
          todayKey={today}
          tallyOf={tallyOf}
          onSelectDay={openDay}
        />
      ) : view === 'year' ? (
        <YearGrid
          weeks={yearGrid}
          weekStart={weekStart}
          todayKey={today}
          tallyOf={tallyOf}
          onSelectDay={openDay}
        />
      ) : (
        <DayLog
          dayKey={selectedDay}
          todayKey={today}
          habits={shownHabits}
          index={index}
          onSet={setDayLog}
        />
      )}
    </div>
  );
}
