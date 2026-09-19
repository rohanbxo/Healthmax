/**
 * The Today header (SPEC.md §4.1): the date over a 56px mono clock, a 44px
 * round "+" to the right, the city and progress line, and a segmented bar with
 * one segment per habit due today.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, ProgressSegments } from '@/components/ui';
import { NEW_HABIT_PATH } from '@/routes/habits/paths';

export type TodayHeaderProps = {
  /** 'THU · 17 SEP'. */
  dateLabel: string;
  /** '07:12'. */
  clockLabel: string;
  /** 'Dubai · 3 of 7 done'. */
  progressLabel: string;
  dueTotal: number;
  doneTotal: number;
};

export function TodayHeader({
  dateLabel,
  clockLabel,
  progressLabel,
  dueTotal,
  doneTotal,
}: TodayHeaderProps): React.ReactElement {
  return (
    <header className="flex flex-col gap-3 pt-4 pb-2">
      {/* The screen's name: the visible header is a date and a clock. */}
      <h1 className="sr-only">Today</h1>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="section-label text-muted">{dateLabel}</p>
          <p
            // The clock is decorative repetition of the date line for screen
            // readers, which already announce the section labels and times.
            aria-hidden="true"
            className="font-mono text-[56px] leading-none font-medium tracking-tight text-text tabular-nums"
          >
            {clockLabel}
          </p>
          <span className="sr-only">{`The time is ${clockLabel}`}</span>
        </div>

        <Button asChild size="icon" variant="secondary" aria-label="Add habit">
          <Link to={NEW_HABIT_PATH}>
            <Plus aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <p className="font-mono text-xs text-muted">{progressLabel}</p>

      {dueTotal > 0 ? (
        <ProgressSegments
          total={dueTotal}
          completed={doneTotal}
          label="Today's progress"
          valueText={progressLabel}
        />
      ) : null}
    </header>
  );
}
