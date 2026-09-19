/**
 * Stats (SPEC.md §11 "Stats"): overall accuracy over 7, 30 or 90 days, then per
 * habit the current streak, best streak, 30-day accuracy and a 30-day dot
 * strip. Every number is the server's (`GET /stats`, computed by
 * `@beta/core`'s `buildStats`); this screen only lays them out.
 */
import * as React from 'react';
import { type DayStatus, type HabitStatsDTO, type StatsRange, formatDayLabel } from '@beta/core';
import { Button, Card, SectionLabel, SegmentedControl, Spinner } from '@/components/ui';
import { useHabits, useStats } from '@/api/hooks';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;

type RangeValue = (typeof RANGE_OPTIONS)[number]['value'];

/** `0.8` → '80%'; `null` (nothing was due) → '—'. */
export function formatAccuracy(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/** Done is filled, missed is outlined, anything still open today is accent. */
const DOT_CLASSES: Record<DayStatus, string> = {
  done: 'bg-success',
  skipped: 'bg-muted',
  missed: 'border border-muted',
  unscheduled: 'bg-raised',
  upcoming: 'border border-accent',
  overdue: 'border border-accent',
  snoozed: 'border border-accent',
};

function stripSummary(entry: HabitStatsDTO): string {
  const count = (status: DayStatus) => entry.last30.filter((day) => day.status === status).length;
  return `Last 30 days: ${count('done')} done, ${count('skipped')} skipped, ${count('missed')} missed`;
}

function DotStrip({ entry }: { entry: HabitStatsDTO }): React.ReactElement {
  return (
    <div role="img" aria-label={stripSummary(entry)} className="flex gap-[3px]">
      {entry.last30.map((day) => (
        <span
          key={day.dayKey}
          title={`${formatDayLabel(day.dayKey)}: ${day.status}`}
          data-status={day.status}
          className={cn('h-4 flex-1 rounded-[2px]', DOT_CLASSES[day.status])}
        />
      ))}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="section-label text-muted">{label}</span>
      <span className="font-mono text-lg tabular-nums">{value}</span>
    </div>
  );
}

export function StatsRoute(): React.ReactElement {
  const [rangeValue, setRangeValue] = React.useState<RangeValue>('30');
  const range = Number(rangeValue) as StatsRange;
  const stats = useStats(range);
  const habits = useHabits();

  const names = React.useMemo(
    () => new Map((habits.data ?? []).map((habit) => [habit.id, habit.name])),
    [habits.data],
  );

  return (
    <div className="flex flex-col gap-5 pt-4 pb-4">
      <header className="flex flex-col gap-3">
        <SectionLabel>STATS</SectionLabel>
        <h1 className="sr-only">Stats</h1>
        <SegmentedControl
          label="Stats range"
          value={rangeValue}
          onValueChange={setRangeValue}
          options={RANGE_OPTIONS}
        />
      </header>

      {stats.isPending || habits.isPending ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner size="lg" label="Loading stats" />
        </div>
      ) : stats.isError || habits.isError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-muted">
            We could not load your stats. Check your connection and try again.
          </p>
          <Button
            variant="outline"
            fullWidth
            onClick={() => {
              void stats.refetch();
              void habits.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-1" aria-label="Overall accuracy">
            <SectionLabel className="text-muted">{`ACCURACY · LAST ${range} DAYS`}</SectionLabel>
            <p className="font-mono text-[56px] leading-none font-medium tracking-tight tabular-nums">
              {formatAccuracy(stats.data.overallAccuracy)}
            </p>
            {stats.data.overallAccuracy === null ? (
              <p className="text-sm text-muted">Nothing was due in this window yet.</p>
            ) : null}
          </section>

          {stats.data.habits.length === 0 ? (
            <p className="text-sm text-muted">Add a habit and its streaks will show up here.</p>
          ) : (
            <section className="flex flex-col gap-2">
              <SectionLabel>HABITS</SectionLabel>
              {stats.data.habits.map((entry) => {
                const name = names.get(entry.habitId) ?? 'Habit';
                return (
                  <Card key={entry.habitId} className="flex flex-col gap-3 p-4">
                    <h2 className="text-[17px] font-medium">{name}</h2>
                    <div className="grid grid-cols-3 gap-2">
                      <Figure label="STREAK" value={String(entry.currentStreak)} />
                      <Figure label="BEST" value={String(entry.bestStreak)} />
                      <Figure label="30-DAY" value={formatAccuracy(entry.accuracy30)} />
                    </div>
                    <DotStrip entry={entry} />
                  </Card>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}
