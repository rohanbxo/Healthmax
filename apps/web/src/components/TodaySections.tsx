/**
 * The Today sections (SPEC.md §4.2–§4.7).
 *
 * Every component here is presentational: it takes a `TodayEntry` that
 * `today-model.tsx` already classified with `@beta/core` and a set of callbacks.
 * No component decides whether something is overdue, at risk or done.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, SkipForward } from 'lucide-react';
import { type SnoozeMinutes } from '@beta/core';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, Row } from '@/components/ui';
import { SnoozeControl } from '@/components/SnoozeSheet';
import { editHabitPath } from '@/routes/habits/paths';
import {
  type TodayEntry,
  countdownLabel,
  lateLabel,
  streakLabel,
  untilLabel,
} from '@/components/today-model';
import { cn } from '@/lib/utils';

/** The action set every section wires to the optimistic mutations. */
export type TodayActions = {
  onComplete: (entry: TodayEntry) => void;
  onSkip: (entry: TodayEntry) => void;
  onSnooze: (entry: TodayEntry, minutes: SnoozeMinutes) => void;
  onClear: (entry: TodayEntry) => void;
};

type WithNow = { now: number; timeZone: string };

/**
 * The habit's name, and the way into its form: tapping it opens
 * `/habits/:id` as a sheet over Today (SPEC.md §11 "Routing"). The label stays
 * the plain name so the sections still read as a list; the `aria-label` is what
 * tells assistive tech the tap edits rather than completes.
 */
function HabitName({
  habitId,
  name,
  className,
}: {
  habitId: string;
  name: string;
  className?: string;
}): React.ReactElement {
  return (
    <Link
      to={editHabitPath(habitId)}
      aria-label={`Edit ${name}`}
      className={cn(
        'block -my-1 truncate py-1 text-[15px] font-medium text-text',
        'transition-colors hover:text-accent',
        className,
      )}
    >
      {name}
    </Link>
  );
}

/* ---------------------------------------------------------- §4.2 next up */

export type NextUpCardProps = WithNow & {
  entry: TodayEntry | null;
  actions: TodayActions;
};

export function NextUpCard({
  entry,
  now,
  timeZone,
  actions,
}: NextUpCardProps): React.ReactElement {
  if (entry === null) {
    return (
      <Card className="px-4 py-6 text-center">
        <p className="section-label text-success">ALL CAUGHT UP</p>
        <p className="pt-2 text-sm text-muted">Nothing is waiting on you right now.</p>
      </Card>
    );
  }

  const streak = streakLabel(entry.streak);

  return (
    <Card>
      <CardHeader>
        <p className="section-label text-accent">NEXT UP</p>
        <p className="section-label text-accent">{countdownLabel(entry.due, now)}</p>
      </CardHeader>

      <CardContent className="pt-0">
        <HabitName
          habitId={entry.habit.id}
          name={entry.habit.name}
          className="text-2xl leading-tight font-semibold tracking-tight"
        />
        <p className="pt-1 font-mono text-sm text-muted">
          {streak === null ? entry.timeLabel : `${entry.timeLabel} · ${streak}`}
        </p>
      </CardContent>

      <CardFooter>
        <Button variant="primary" className="h-12 flex-1" onClick={() => actions.onComplete(entry)}>
          Complete
        </Button>
        <SnoozeControl
          habitName={entry.habit.name}
          now={now}
          timeZone={timeZone}
          onSnooze={(minutes) => actions.onSnooze(entry, minutes)}
        />
        <Button variant="ghost" className="h-12 px-4" onClick={() => actions.onSkip(entry)}>
          Skip
        </Button>
      </CardFooter>
    </Card>
  );
}

/* ---------------------------------------------------------- §4.3 overdue */

export type OverdueRowProps = WithNow & { entry: TodayEntry; actions: TodayActions };

export function OverdueRow({
  entry,
  now,
  timeZone,
  actions,
}: OverdueRowProps): React.ReactElement {
  return (
    <Row className="py-3">
      <div className="min-w-0 flex-1">
        <HabitName habitId={entry.habit.id} name={entry.habit.name} />
        <p className="font-mono text-xs text-danger">
          {`${entry.timeLabel} · ${lateLabel(entry.due, now)}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <SnoozeControl
          appearance="icon"
          habitName={entry.habit.name}
          now={now}
          timeZone={timeZone}
          onSnooze={(minutes) => actions.onSnooze(entry, minutes)}
        />
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={`Skip ${entry.habit.name}`}
          onClick={() => actions.onSkip(entry)}
        >
          <SkipForward aria-hidden="true" />
        </Button>
        {/* The round red-outlined Complete sits on the right edge (SPEC §4.3). */}
        <Button
          variant="danger-outline"
          size="icon"
          aria-label={`Complete ${entry.habit.name}`}
          onClick={() => actions.onComplete(entry)}
        >
          <Check aria-hidden="true" />
        </Button>
      </div>
    </Row>
  );
}

/* ---------------------------------------------------------- §4.4 snoozed */

export type SnoozedRowProps = WithNow & { entry: TodayEntry; actions: TodayActions };

export function SnoozedRow({ entry, timeZone, actions }: SnoozedRowProps): React.ReactElement {
  return (
    <Row className="py-3">
      <div className="min-w-0 flex-1">
        <HabitName habitId={entry.habit.id} name={entry.habit.name} />
        <p className="font-mono text-xs text-muted">
          {entry.snoozeUntil === null ? entry.timeLabel : untilLabel(entry.snoozeUntil, timeZone)}
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Complete ${entry.habit.name}`}
        onClick={() => actions.onComplete(entry)}
      >
        Complete
      </Button>
    </Row>
  );
}

/* ------------------------------------------------------ §4.5 later today */

export type LaterRowProps = { entry: TodayEntry; actions: TodayActions };

export function LaterRow({ entry, actions }: LaterRowProps): React.ReactElement {
  return (
    <Row className="py-3">
      <p className="w-14 shrink-0 font-mono text-sm text-muted tabular-nums">{entry.timeLabel}</p>
      <div className="min-w-0 flex-1">
        <HabitName habitId={entry.habit.id} name={entry.habit.name} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Complete ${entry.habit.name}`}
        onClick={() => actions.onComplete(entry)}
      >
        Complete
      </Button>
    </Row>
  );
}

/* -------------------------------------------------------- §4.6 this week */

export type WeekRowProps = { entry: TodayEntry; actions: TodayActions };

export function WeekRow({ entry, actions }: WeekRowProps): React.ReactElement {
  return (
    <Row className="py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <HabitName habitId={entry.habit.id} name={entry.habit.name} />
          {entry.atRisk ? <Badge variant="outline-danger">AT RISK</Badge> : null}
        </div>
        <p className="font-mono text-xs text-muted">
          {`${entry.doneThisWeek} / ${entry.weeklyTarget ?? 0} this week`}
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Complete ${entry.habit.name}`}
        onClick={() => actions.onComplete(entry)}
      >
        Complete
      </Button>
    </Row>
  );
}

/* --------------------------------------------------- §4.7 done & skipped */

export type FinishedSectionProps = { entries: TodayEntry[]; actions: TodayActions };

/**
 * Collapsed by default: a toggle row with a chevron, then one row per finished
 * habit. A done row shows a filled green check and a skipped row a `SKIPPED`
 * label; tapping either clears the log (SPEC §4.7).
 */
export function FinishedSection({ entries, actions }: FinishedSectionProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <Card>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="tap-target flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="section-label text-muted">{`DONE & SKIPPED · ${entries.length}`}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 text-muted transition-transform', expanded && 'rotate-180')}
        />
      </button>

      {expanded ? (
        <div className="flex flex-col pb-2">
          {entries.map((entry) => (
            <Row key={entry.habit.id} className="py-2">
              <div className="min-w-0 flex-1">
                <HabitName
                  habitId={entry.habit.id}
                  name={entry.habit.name}
                  className={cn(entry.status === 'done' && 'text-muted line-through')}
                />
                <p className="font-mono text-xs text-muted">{entry.timeLabel}</p>
              </div>

              {entry.status === 'done' ? (
                <Button
                  size="icon"
                  variant="outline"
                  aria-label={`Clear ${entry.habit.name}`}
                  className="shrink-0 border-success bg-success text-base hover:bg-success/90"
                  onClick={() => actions.onClear(entry)}
                >
                  <Check aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Clear ${entry.habit.name}`}
                  className="shrink-0"
                  onClick={() => actions.onClear(entry)}
                >
                  <Badge variant="muted">SKIPPED</Badge>
                </Button>
              )}
            </Row>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
