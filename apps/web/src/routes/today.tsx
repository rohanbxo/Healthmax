/**
 * `/` — Today (SPEC.md §4, §11 "Screens").
 *
 * The screen reads `GET /today` once and then derives everything from a single
 * ticking instant: `useNowTick` re-renders every 30 seconds and
 * `buildTodayModel` re-runs `statusOn` from `@beta/core`, so a habit moves from
 * "Later today" into "Overdue" and the countdowns shrink without a refetch.
 *
 * Every tap goes through an optimistic mutation in `api/hooks.ts`, so the row
 * moves immediately; a failure rolls the cache back and toasts. Completing,
 * skipping and clearing also raise an undo toast whose `UNDO` action replays the
 * *inverse* mutation with the status the habit had before the tap (SPEC §4.8).
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { type DayStatus, type SnoozeMinutes } from '@beta/core';
import { Button, Card, SectionLabel, Spinner, useToast } from '@/components/ui';
import { TodayHeader } from '@/components/TodayHeader';
import {
  FinishedSection,
  LaterRow,
  NextUpCard,
  OverdueRow,
  SnoozedRow,
  type TodayActions,
  WeekRow,
} from '@/components/TodaySections';
import { type TodayEntry, buildTodayModel } from '@/components/today-model';
import { useNowTick } from '@/components/useNowTick';
import { useClearLog, useLogMutation, useSnoozeMutation, useToday } from '@/api/hooks';
import { NEW_HABIT_PATH } from './habits/paths';

/** SPEC §4.8: the undo toast lives for five seconds. */
const UNDO_DURATION_MS = 5000;

function EmptyState(): React.ReactElement {
  return (
    <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <p className="section-label text-accent">NOTHING DUE</p>
      <h2 className="text-xl font-semibold tracking-tight">Pick one habit and a time.</h2>
      <p className="max-w-[280px] text-sm text-muted">
        Beta tells you when it&apos;s due. One tap marks it done.
      </p>
      <Button asChild variant="primary" className="mt-2">
        <Link to={NEW_HABIT_PATH}>Add your first habit</Link>
      </Button>
    </Card>
  );
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: 'muted' | 'danger';
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel tone={tone}>{label}</SectionLabel>
      <Card className="divide-y divide-border">{children}</Card>
    </section>
  );
}

export function TodayRoute(): React.ReactElement {
  const now = useNowTick();
  const today = useToday();
  const { toast } = useToast();

  const logMutation = useLogMutation();
  const clearLog = useClearLog();
  const snoozeMutation = useSnoozeMutation();

  const model = React.useMemo(
    () => (today.data === undefined ? null : buildTodayModel(today.data, now)),
    [today.data, now],
  );

  const dayKey = model?.dayKey ?? '';

  /**
   * Replays the inverse of whatever the user just did. An unlogged status
   * (upcoming, overdue, snoozed) inverts to deleting the log; a logged one
   * inverts to writing that status back. Either way it travels the same
   * optimistic path as the original tap (SPEC §11).
   */
  const undo = React.useCallback(
    (entry: TodayEntry, previous: DayStatus) => {
      const target = { habitId: entry.habit.id, dayKey };
      if (previous === 'done' || previous === 'skipped') {
        logMutation.mutate({ ...target, status: previous });
      } else {
        clearLog.mutate(target);
      }
    },
    [clearLog, dayKey, logMutation],
  );

  const offerUndo = React.useCallback(
    (entry: TodayEntry, previous: DayStatus, message: string) => {
      toast({
        title: message,
        duration: UNDO_DURATION_MS,
        action: { label: 'UNDO', onClick: () => undo(entry, previous) },
      });
    },
    [toast, undo],
  );

  const actions = React.useMemo<TodayActions>(
    () => ({
      onComplete: (entry) => {
        const previous = entry.status;
        logMutation.mutate({ habitId: entry.habit.id, dayKey, status: 'done' });
        offerUndo(entry, previous, `${entry.habit.name} done`);
      },
      onSkip: (entry) => {
        const previous = entry.status;
        logMutation.mutate({ habitId: entry.habit.id, dayKey, status: 'skipped' });
        offerUndo(entry, previous, `${entry.habit.name} skipped`);
      },
      onSnooze: (entry, minutes: SnoozeMinutes) => {
        snoozeMutation.mutate({ habitId: entry.habit.id, dayKey, minutes });
      },
      onClear: (entry) => {
        const previous = entry.status;
        clearLog.mutate({ habitId: entry.habit.id, dayKey });
        offerUndo(entry, previous, `${entry.habit.name} cleared`);
      },
    }),
    [clearLog, dayKey, logMutation, offerUndo, snoozeMutation],
  );

  if (today.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" label="Loading today" />
      </div>
    );
  }

  if (model === null) {
    return (
      <div className="flex flex-col gap-3 pt-10">
        <SectionLabel tone="danger">TODAY UNAVAILABLE</SectionLabel>
        <p role="alert" className="text-sm text-muted">
          We could not load what is due. Check your connection and try again.
        </p>
        <Button variant="outline" fullWidth onClick={() => void today.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const withNow = { now: model.now, timeZone: model.timeZone };

  return (
    <div className="flex flex-col gap-5 pb-4">
      <TodayHeader
        dateLabel={model.dateLabel}
        clockLabel={model.clockLabel}
        progressLabel={model.progressLabel}
        dueTotal={model.dueTotal}
        doneTotal={model.doneTotal}
      />

      {model.isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <NextUpCard entry={model.nextUp} actions={actions} {...withNow} />

          {model.overdue.length > 0 ? (
            <Section label="OVERDUE" tone="danger">
              {model.overdue.map((entry) => (
                <OverdueRow key={entry.habit.id} entry={entry} actions={actions} {...withNow} />
              ))}
            </Section>
          ) : null}

          {model.snoozed.length > 0 ? (
            <Section label="SNOOZED">
              {model.snoozed.map((entry) => (
                <SnoozedRow key={entry.habit.id} entry={entry} actions={actions} {...withNow} />
              ))}
            </Section>
          ) : null}

          {model.later.length > 0 ? (
            <Section label="LATER TODAY">
              {model.later.map((entry) => (
                <LaterRow key={entry.habit.id} entry={entry} actions={actions} />
              ))}
            </Section>
          ) : null}

          {model.week.length > 0 ? (
            <Section label="THIS WEEK">
              {model.week.map((entry) => (
                <WeekRow key={entry.habit.id} entry={entry} actions={actions} />
              ))}
            </Section>
          ) : null}

          {model.finished.length > 0 ? (
            <FinishedSection entries={model.finished} actions={actions} />
          ) : null}
        </>
      )}
    </div>
  );
}
