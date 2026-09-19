/**
 * The Calendar's Day view (SPEC.md §11): every habit scheduled that day with
 * its status, editable within the backfill window (SPEC.md §6 "Backfill").
 * `canLogOn` is the same check the API applies, so a button is disabled
 * exactly when the server would answer 422.
 */
import * as React from 'react';
import {
  type DayKey,
  type HabitDTO,
  type LogStatus,
  canLogOn,
  compareDayKeys,
  isScheduledOn,
} from '@beta/core';
import { Button, Card, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/utils';
import { type LogIndex, logStatus } from './calendar-model';

export type DayLogProps = {
  dayKey: DayKey;
  todayKey: DayKey;
  habits: HabitDTO[];
  index: LogIndex;
  onSet: (habit: HabitDTO, status: LogStatus | null) => void;
};

function statusLabel(status: LogStatus | undefined, dayKey: DayKey, todayKey: DayKey): string {
  if (status === 'done') return 'DONE';
  if (status === 'skipped') return 'SKIPPED';
  const vsToday = compareDayKeys(dayKey, todayKey);
  if (vsToday > 0) return 'UPCOMING';
  return vsToday === 0 ? 'NOT YET' : 'NOT LOGGED';
}

export function DayLog({
  dayKey,
  todayKey,
  habits,
  index,
  onSet,
}: DayLogProps): React.ReactElement {
  const scheduled = habits.filter((habit) => isScheduledOn(habit, dayKey));
  const future = compareDayKeys(dayKey, todayKey) > 0;

  if (scheduled.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">Nothing was scheduled on this day.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {future ? (
        <p className="text-sm text-muted">Future days can be logged once they arrive.</p>
      ) : null}
      <Card className="divide-y divide-border">
        {scheduled.map((habit) => {
          const status = logStatus(index, habit.id, dayKey);
          const editable = canLogOn(habit, dayKey, todayKey);
          return (
            <div key={habit.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[17px] font-medium">{habit.name}</p>
                <SectionLabel
                  className={cn(
                    status === 'done' && 'text-success',
                    status === undefined && 'text-muted',
                  )}
                >
                  {statusLabel(status, dayKey, todayKey)}
                </SectionLabel>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant={status === 'done' ? 'primary' : 'secondary'}
                  aria-pressed={status === 'done'}
                  aria-label={`Mark ${habit.name} done`}
                  disabled={!editable}
                  onClick={() => onSet(habit, 'done')}
                >
                  Done
                </Button>
                <Button
                  size="sm"
                  variant={status === 'skipped' ? 'primary' : 'secondary'}
                  aria-pressed={status === 'skipped'}
                  aria-label={`Mark ${habit.name} skipped`}
                  disabled={!editable}
                  onClick={() => onSet(habit, 'skipped')}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Clear ${habit.name}`}
                  disabled={!editable || status === undefined}
                  onClick={() => onSet(habit, null)}
                >
                  Clear
                </Button>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
