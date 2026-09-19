/**
 * Today (SPEC.md §13 "Web tests").
 *
 * Everything runs against a fixed clock — 2026-09-17T07:12 in Asia/Dubai — with
 * one habit deliberately placed in every section, so the assertions below are
 * about the section a habit lands in, never about wall-clock luck.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import {
  type HabitDTO,
  type LogDTO,
  type SnoozeDTO,
  MS_PER_MINUTE,
  type TodayDTO,
} from '@beta/core';
import { AppRoutes } from '@/routes';
import { TICK_INTERVAL_MS } from '@/components/useNowTick';
import { renderWithProviders } from '@/test/renderWithProviders';
import { FIXED_DAY_KEY, FIXED_NOW_MS, FIXED_TIME_ZONE, installFixedClock } from '@/test/clock';
import {
  makeToday,
  mswState,
  setMswToday,
  signInMswUser,
} from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/* ------------------------------------------------------------- fixtures */

const CREATED = '2026-09-01';

function habit(id: string, name: string, time: string, extra: Partial<HabitDTO> = {}): HabitDTO {
  return {
    id: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
    name,
    schedule: { kind: 'daily' },
    time,
    remind: true,
    createdDayKey: CREATED,
    archived: false,
    order: 0,
    ...extra,
  };
}

const MEDITATE = habit('1', 'Meditate', '06:30'); // due 06:30 -> overdue at 07:12
const STRETCH = habit('2', 'Stretch', '07:00'); // snoozed to 07:27
const READ = habit('3', 'Read', '07:30'); // the next-up item, 18 minutes away
const WALK = habit('4', 'Walk', '12:00'); // later today
const GYM = habit('5', 'Gym', '18:00', { schedule: { kind: 'timesPerWeek', count: 7 } });
const JOURNAL = habit('6', 'Journal', '21:00'); // logged done
const SHOWER = habit('7', 'Cold shower', '06:00'); // logged skipped

const LOGS: LogDTO[] = [
  { habitId: JOURNAL.id, dayKey: FIXED_DAY_KEY, status: 'done' },
  { habitId: SHOWER.id, dayKey: FIXED_DAY_KEY, status: 'skipped' },
  // Two days of history for Read, inside the week `/today` carries.
  { habitId: READ.id, dayKey: '2026-09-16', status: 'done' },
  { habitId: READ.id, dayKey: '2026-09-15', status: 'done' },
  // One of seven for the week, which leaves Gym unable to catch up: at risk.
  { habitId: GYM.id, dayKey: '2026-09-15', status: 'done' },
];

const SNOOZES: SnoozeDTO[] = [
  { habitId: STRETCH.id, dayKey: FIXED_DAY_KEY, until: '2026-09-17T03:27:00.000Z' },
];

function fullFixture(): TodayDTO {
  return makeToday({
    habits: [MEDITATE, STRETCH, READ, WALK, GYM, JOURNAL, SHOWER],
    logs: LOGS.map((log) => ({ ...log })),
    snoozes: SNOOZES.map((snooze) => ({ ...snooze })),
  });
}

function signIn(today: TodayDTO): void {
  signInMswUser({ timeZone: FIXED_TIME_ZONE });
  setMswToday(today);
}

/** The section card that follows a section label, for scoped queries. */
function sectionFor(label: string): HTMLElement {
  const heading = screen.getByText(label);
  const section = heading.closest('section');
  if (section === null) throw new Error(`No section wraps "${label}"`);
  return section;
}

async function expandFinished(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { expanded: false }));
}

/* ------------------------------------------------------------ the tests */

describe('Today', () => {
  it('renders every section from a fixture at a fixed instant', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      renderWithProviders(<AppRoutes />);

      // 1. Header: date, 56px clock, city and progress.
      expect(await screen.findByText('THU · 17 SEP')).toBeInTheDocument();
      expect(screen.getByText('07:12')).toBeInTheDocument();
      expect(screen.getByText('Dubai · 1 of 7 done')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: "Today's progress" })).toHaveAttribute(
        'aria-valuemax',
        '7',
      );
      expect(screen.getByRole('link', { name: 'Add habit' })).toHaveAttribute(
        'href',
        '/habits/new',
      );

      // 2. Next up: the earliest upcoming timed habit.
      expect(screen.getByText('NEXT UP')).toBeInTheDocument();
      expect(screen.getByText('IN 18 MIN')).toBeInTheDocument();
      expect(screen.getByText('Read')).toBeInTheDocument();
      expect(screen.getByText('07:30 · 2-day streak')).toBeInTheDocument();

      // 3. Overdue, with how late it is.
      const overdue = sectionFor('OVERDUE');
      expect(within(overdue).getByText('Meditate')).toBeInTheDocument();
      expect(within(overdue).getByText('06:30 · 42 min late')).toBeInTheDocument();
      expect(within(overdue).getByRole('button', { name: 'Complete Meditate' })).toBeInTheDocument();

      // 4. Snoozed.
      const snoozed = sectionFor('SNOOZED');
      expect(within(snoozed).getByText('Stretch')).toBeInTheDocument();
      expect(within(snoozed).getByText('until 07:27')).toBeInTheDocument();

      // 5. Later today.
      const later = sectionFor('LATER TODAY');
      expect(within(later).getByText('Walk')).toBeInTheDocument();
      expect(within(later).getByText('12:00')).toBeInTheDocument();

      // 6. This week, with the at-risk badge.
      const week = sectionFor('THIS WEEK');
      expect(within(week).getByText('Gym')).toBeInTheDocument();
      expect(within(week).getByText('1 / 7 this week')).toBeInTheDocument();
      expect(within(week).getByText('AT RISK')).toBeInTheDocument();

      // 7. Done & skipped, collapsed.
      expect(screen.getByText('DONE & SKIPPED · 2')).toBeInTheDocument();
      expect(screen.queryByText('Journal')).not.toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('expands done & skipped to show a clearable check and a SKIPPED label', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      const { user } = renderWithProviders(<AppRoutes />);
      await screen.findByText('DONE & SKIPPED · 2');

      await expandFinished(user);

      expect(screen.getByText('Journal')).toBeInTheDocument();
      expect(screen.getByText('SKIPPED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear Journal' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear Cold shower' })).toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('completes optimistically: the row moves to Done before the server answers', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      const { user } = renderWithProviders(<AppRoutes />);
      await screen.findByText('NEXT UP');

      await user.click(screen.getByRole('button', { name: 'Complete' }));

      // No awaiting the network: the cache patch has already moved Read across.
      expect(screen.getByText('DONE & SKIPPED · 3')).toBeInTheDocument();
      expect(screen.getByText('Dubai · 2 of 7 done')).toBeInTheDocument();
      // Next up is now Walk, the following timed habit.
      expect(within(sectionFor('OVERDUE')).queryByText('Read')).not.toBeInTheDocument();

      await waitFor(() =>
        expect(mswState.requests).toContainEqual({
          method: 'PUT',
          path: `/habits/${READ.id}/logs/${FIXED_DAY_KEY}`,
          body: { status: 'done' },
        }),
      );

      // And it stays there once the refetch that `onSettled` triggers lands.
      await waitFor(() => expect(screen.getByText('DONE & SKIPPED · 3')).toBeInTheDocument());
    } finally {
      clock.restore();
    }
  });

  it('rolls the row back and toasts when the server rejects the log', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      server.use(
        // The delay keeps the optimistic state observable before the rollback.
        http.put('/api/habits/:id/logs/:dayKey', async () => {
          await delay(50);
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'Something went wrong.', details: [] } },
            { status: 500 },
          );
        }),
      );

      const { user } = renderWithProviders(<AppRoutes />);
      await screen.findByText('NEXT UP');

      await user.click(screen.getByRole('button', { name: 'Complete' }));
      expect(screen.getByText('DONE & SKIPPED · 3')).toBeInTheDocument();

      expect(await screen.findByRole('alert')).toHaveTextContent('We could not save that.');
      await waitFor(() => expect(screen.getByText('DONE & SKIPPED · 2')).toBeInTheDocument());
      expect(screen.getByText('Read')).toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('undoes a completion with the inverse request', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      const { user } = renderWithProviders(<AppRoutes />);
      await screen.findByText('NEXT UP');

      await user.click(screen.getByRole('button', { name: 'Complete' }));

      const undo = await screen.findByRole('button', { name: 'UNDO' });
      await user.click(undo);

      // The inverse of "log done over nothing" is deleting the log.
      await waitFor(() =>
        expect(mswState.requests).toContainEqual({
          method: 'DELETE',
          path: `/habits/${READ.id}/logs/${FIXED_DAY_KEY}`,
          body: null,
        }),
      );
      await waitFor(() => expect(screen.getByText('DONE & SKIPPED · 2')).toBeInTheDocument());
      expect(screen.getByText('IN 18 MIN')).toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('undoes a cleared skip by writing the previous status back', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      const { user } = renderWithProviders(<AppRoutes />);
      await screen.findByText('DONE & SKIPPED · 2');
      await expandFinished(user);

      await user.click(screen.getByRole('button', { name: 'Clear Cold shower' }));
      await user.click(await screen.findByRole('button', { name: 'UNDO' }));

      await waitFor(() =>
        expect(mswState.requests).toContainEqual({
          method: 'PUT',
          path: `/habits/${SHOWER.id}/logs/${FIXED_DAY_KEY}`,
          body: { status: 'skipped' },
        }),
      );
    } finally {
      clock.restore();
    }
  });

  it('snoozes for 15 minutes on a tap', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      const { user } = renderWithProviders(<AppRoutes />);
      await screen.findByText('NEXT UP');

      await user.click(screen.getByRole('button', { name: 'Snooze Meditate' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(mswState.requests).toContainEqual({
          method: 'PUT',
          path: `/habits/${MEDITATE.id}/snooze`,
          body: { minutes: 15 },
        }),
      );
    } finally {
      clock.restore();
    }
  });

  it('opens the snooze sheet on a long press and sends the chosen duration', async () => {
    const clock = installFixedClock();
    try {
      signIn(fullFixture());
      const { user } = renderWithProviders(<AppRoutes />);
      await screen.findByText('NEXT UP');

      const trigger = screen.getByRole('button', { name: 'Snooze Meditate' });
      await user.pointer({ keys: '[MouseLeft>]', target: trigger });

      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).getByText('until 07:27')).toBeInTheDocument();
      expect(within(sheet).getByText('until 08:12')).toBeInTheDocument();
      expect(within(sheet).getByText('until 10:12')).toBeInTheDocument();

      // Radix makes everything outside the sheet inert, so release inside it.
      await user.pointer({ keys: '[/MouseLeft]', target: sheet });
      await user.click(within(sheet).getByRole('button', { name: /1 hour/ }));

      await waitFor(() =>
        expect(mswState.requests).toContainEqual({
          method: 'PUT',
          path: `/habits/${MEDITATE.id}/snooze`,
          body: { minutes: 60 },
        }),
      );
      // The long press must not also fire the 15-minute default.
      expect(
        mswState.requests.filter((request) => request.path.endsWith('/snooze')),
      ).toHaveLength(1);
    } finally {
      clock.restore();
    }
  });

  it('shows the empty state when nothing is due', async () => {
    const clock = installFixedClock();
    try {
      signIn(makeToday({ timeZone: FIXED_TIME_ZONE }));
      renderWithProviders(<AppRoutes />);

      expect(await screen.findByText('NOTHING DUE')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Pick one habit and a time.' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Beta tells you when it's due. One tap marks it done."),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Add your first habit' })).toHaveAttribute(
        'href',
        '/habits/new',
      );
    } finally {
      clock.restore();
    }
  });

  it('moves a row from Later today to Overdue as the clock ticks, with no refetch', async () => {
    const clock = installFixedClock();
    vi.useFakeTimers({
      // `Date` stays real so the fixed-clock spy above still owns `Date.now`.
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      shouldAdvanceTime: true,
    });

    try {
      signIn(
        makeToday({
          timeZone: FIXED_TIME_ZONE,
          habits: [READ, habit('8', 'Water plants', '07:40')],
        }),
      );
      renderWithProviders(<AppRoutes />);

      await screen.findByText('LATER TODAY');
      expect(screen.queryByText('OVERDUE')).not.toBeInTheDocument();
      const todayCallsBefore = mswState.todayCalls;

      // 07:47 — both habits are now past their due instants.
      clock.set(FIXED_NOW_MS + 35 * MS_PER_MINUTE);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TICK_INTERVAL_MS);
      });

      const overdue = sectionFor('OVERDUE');
      expect(within(overdue).getByText('Water plants')).toBeInTheDocument();
      expect(within(overdue).getByText('07:40 · 7 min late')).toBeInTheDocument();
      expect(screen.queryByText('LATER TODAY')).not.toBeInTheDocument();
      expect(mswState.todayCalls).toBe(todayCallsBefore);
    } finally {
      vi.useRealTimers();
      clock.restore();
    }
  });
});
