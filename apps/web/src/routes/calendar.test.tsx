/**
 * Calendar (SPEC.md §11 "Calendar", §6 "Backfill").
 *
 * Fixed clock: Thursday 2026-09-17 07:12 in Asia/Dubai, while the test process
 * runs in America/Los_Angeles — where it is still Wednesday the 16th. Any cell
 * that used the browser's zone would put "today" a day early.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { type HabitDTO, type LogDTO, type WeekStart, weekday } from '@beta/core';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { FIXED_TIME_ZONE, installFixedClock } from '@/test/clock';
import { mswState, setMswHabits, setMswLogs, signInMswUser } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/* ------------------------------------------------------------- fixtures */

function habit(n: number, name: string, extra: Partial<HabitDTO> = {}): HabitDTO {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name,
    schedule: { kind: 'daily' },
    time: '07:30',
    remind: true,
    createdDayKey: '2026-09-01',
    archived: false,
    order: n,
    ...extra,
  };
}

const READ = habit(1, 'Read');
/** Monday, Wednesday, Friday. */
const GYM = habit(2, 'Gym', { schedule: { kind: 'weekdays', days: [1, 3, 5] } });
const WALK = habit(3, 'Walk', { schedule: { kind: 'timesPerWeek', count: 3 } });
const OLD = habit(4, 'Old', { archived: true });

/**
 *   Sun 13  Read unlogged                  → 0 of 1
 *   Mon 14  Read done, Gym done            → 2 of 2
 *   Tue 15  Read skipped, Walk done        → 1 of 1 (the skip is left out)
 *   Wed 16  Read done, Gym unlogged        → 1 of 2
 *   Thu 17  today, Read unlogged           → 0 of 1
 *   Fri 18  future
 */
const LOGS: LogDTO[] = [
  { habitId: READ.id, dayKey: '2026-09-14', status: 'done' },
  { habitId: GYM.id, dayKey: '2026-09-14', status: 'done' },
  { habitId: READ.id, dayKey: '2026-09-15', status: 'skipped' },
  { habitId: WALK.id, dayKey: '2026-09-15', status: 'done' },
  { habitId: READ.id, dayKey: '2026-09-16', status: 'done' },
  // An archived habit is never counted, whatever it logged.
  { habitId: OLD.id, dayKey: '2026-09-13', status: 'done' },
];

function arrange(weekStart: WeekStart = 1) {
  signInMswUser({ timeZone: FIXED_TIME_ZONE, weekStart });
  setMswHabits([READ, GYM, WALK, OLD]);
  setMswLogs(LOGS.map((log) => ({ ...log })));
  return renderWithProviders(<AppRoutes />, { route: '/calendar' });
}

const cell = (name: string): HTMLElement => screen.getByRole('button', { name });

/** The header renders at once; the grid only once habits and logs have loaded. */
async function gridReady(): Promise<void> {
  await screen.findByRole('button', { name: /^MON · 14 SEP:/ });
}

async function openYear(
  user: ReturnType<typeof renderWithProviders>['user'],
): Promise<HTMLElement> {
  await user.click(screen.getByRole('radio', { name: 'Year' }));
  return screen.findByRole('grid', { name: 'Last 53 weeks' });
}

/** The focusable button inside a Year cell: what carries the state and the keys. */
const dayButton = (grid: HTMLElement, name: string): HTMLElement =>
  within(grid).getByRole('button', { name });

const dayOf = (element: HTMLElement | undefined): string =>
  (element?.querySelector('button') ?? element)?.getAttribute('data-day') ?? '';

const isTabbable = (element: HTMLElement): boolean => element.getAttribute('tabindex') === '0';

/** A cell's position among the grid's children, blanks included. */
function column(element: HTMLElement): number {
  return Array.from(element.parentElement?.children ?? []).indexOf(element);
}

/**
 * Fails one log write with a 500 and holds every `/logs` read after it, so the
 * refetch `onSettled` triggers can never land and only the rollback can put
 * the day back.
 */
function failLogWriteAndHoldLogs(): void {
  let writeSent = false;
  server.use(
    http.get('/api/logs', async () => {
      if (writeSent) await delay('infinite');
    }),
    http.put('/api/habits/:id/logs/:dayKey', async () => {
      writeSent = true;
      await delay(50);
      return HttpResponse.json(
        { error: { code: 'INTERNAL', message: 'Something went wrong.', details: [] } },
        { status: 500 },
      );
    }),
  );
}

/* ------------------------------------------------------------ the tests */

describe('Calendar', () => {
  it('opens on Month and shades each day by done against due', async () => {
    const clock = installFixedClock();
    try {
      arrange();

      expect(await screen.findByText('SEP 2026')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('data-state', 'on');
      await gridReady();

      expect(cell('MON · 14 SEP: 2 of 2 done')).toHaveAttribute('data-shade', 'full');
      expect(cell('WED · 16 SEP: 1 of 2 done')).toHaveAttribute('data-shade', 'partial');
      expect(cell('TUE · 15 SEP: 1 of 1 done')).toHaveAttribute('data-shade', 'full');
      expect(cell('SUN · 13 SEP: 0 of 1 done')).toHaveAttribute('data-shade', 'none');
      expect(cell('FRI · 18 SEP: upcoming')).toHaveAttribute('data-shade', 'future');
    } finally {
      clock.restore();
    }
  });

  it("marks today in the user's timezone, not the browser's", async () => {
    const clock = installFixedClock();
    try {
      arrange();
      await gridReady();

      expect(cell('THU · 17 SEP: 0 of 1 done')).toHaveAttribute('aria-current', 'date');
      expect(cell('WED · 16 SEP: 1 of 2 done')).not.toHaveAttribute('aria-current');
    } finally {
      clock.restore();
    }
  });

  it('aligns the month to the week start', async () => {
    const clock = installFixedClock();
    try {
      arrange(1);
      await gridReady();
      // 1 Sep 2026 is a Tuesday: second column on a Monday week…
      expect(column(cell('TUE · 01 SEP: 0 of 1 done'))).toBe(1);
    } finally {
      clock.restore();
    }
  });

  it('…and third on a Sunday week', async () => {
    const clock = installFixedClock();
    try {
      arrange(0);
      await gridReady();
      expect(column(cell('TUE · 01 SEP: 0 of 1 done'))).toBe(2);
    } finally {
      clock.restore();
    }
  });

  it('pages between months', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange();
      await gridReady();

      await user.click(screen.getByRole('button', { name: 'Previous month' }));
      expect(await screen.findByText('AUG 2026')).toBeInTheDocument();
      // Before any habit existed. A new month is a new range, so wait for it.
      expect(
        await screen.findByRole('button', { name: 'MON · 31 AUG: nothing due' }),
      ).toHaveAttribute('data-shade', 'none');

      await user.click(screen.getByRole('button', { name: 'Next month' }));
      await user.click(screen.getByRole('button', { name: 'Next month' }));
      expect(await screen.findByText('OCT 2026')).toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('filters the shading to one habit', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange();
      await gridReady();

      const filter = screen.getByRole('combobox', { name: 'HABIT' });
      expect(within(filter).queryByRole('option', { name: 'Old' })).not.toBeInTheDocument();
      await user.selectOptions(filter, 'Gym');

      expect(cell('WED · 16 SEP: 0 of 1 done')).toHaveAttribute('data-shade', 'none');
      expect(cell('TUE · 15 SEP: nothing due')).toBeInTheDocument();
      expect(cell('MON · 14 SEP: 1 of 1 done')).toHaveAttribute('data-shade', 'full');
    } finally {
      clock.restore();
    }
  });

  it('opens a day and backfills it', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange();
      await gridReady();

      await user.click(cell('SUN · 13 SEP: 0 of 1 done'));

      expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('data-state', 'on');
      expect(screen.getByRole('heading', { name: 'SUN · 13 SEP' })).toBeInTheDocument();
      // Only what was scheduled that Sunday: Read and the weekly Walk, not Gym.
      expect(screen.getByRole('button', { name: 'Mark Read done' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark Walk done' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark Gym done' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear Read' })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: 'Mark Read done' }));

      expect(screen.getByRole('button', { name: 'Mark Read done' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await waitFor(() =>
        expect(mswState.requests).toContainEqual({
          method: 'PUT',
          path: `/habits/${READ.id}/logs/2026-09-13`,
          body: { status: 'done' },
        }),
      );

      await user.click(screen.getByRole('radio', { name: 'Month' }));
      expect(
        await screen.findByRole('button', { name: 'SUN · 13 SEP: 1 of 1 done' }),
      ).toHaveAttribute('data-shade', 'full');
    } finally {
      clock.restore();
    }
  });

  it('clears a logged day back to nothing', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange();
      await gridReady();
      await user.click(cell('MON · 14 SEP: 2 of 2 done'));

      await user.click(screen.getByRole('button', { name: 'Clear Gym' }));

      await waitFor(() =>
        expect(mswState.requests).toContainEqual({
          method: 'DELETE',
          path: `/habits/${GYM.id}/logs/2026-09-14`,
          body: null,
        }),
      );
      expect(screen.getByRole('button', { name: 'Clear Gym' })).toBeDisabled();
    } finally {
      clock.restore();
    }
  });

  it('refuses to log a future day, and stops paging at today', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange();
      await gridReady();

      await user.click(cell('THU · 17 SEP: 0 of 1 done'));
      expect(screen.getByRole('button', { name: 'Mark Read done' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

      await user.click(screen.getByRole('radio', { name: 'Month' }));
      await user.click(cell('FRI · 18 SEP: upcoming'));
      expect(screen.getByText('Future days can be logged once they arrive.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark Read done' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Mark Read skipped' })).toBeDisabled();
    } finally {
      clock.restore();
    }
  });

  it('rolls a backfill back and toasts when the server rejects it', async () => {
    const clock = installFixedClock();
    try {
      failLogWriteAndHoldLogs();
      const { user } = arrange();
      await gridReady();
      await user.click(cell('SUN · 13 SEP: 0 of 1 done'));

      await user.click(screen.getByRole('button', { name: 'Mark Read done' }));
      expect(screen.getByRole('button', { name: 'Mark Read done' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      expect(await screen.findByRole('alert')).toHaveTextContent('We could not save that day.');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Mark Read done' })).toHaveAttribute(
          'aria-pressed',
          'false',
        ),
      );
      // No log again, so there is nothing to clear.
      expect(screen.getByRole('button', { name: 'Clear Read' })).toBeDisabled();
    } finally {
      clock.restore();
    }
  });

  it('shows 53 weeks in the Year view, aligned to the week start and ending this week', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange(1);
      await gridReady();

      const grid = await openYear(user);
      // One row per weekday, one cell per week: the columns on screen are weeks.
      const rows = within(grid).getAllByRole('row');
      expect(rows).toHaveLength(7);
      const days = within(grid).getAllByRole('gridcell');
      expect(days).toHaveLength(53 * 7);

      const mondays = within(rows[0] as HTMLElement).getAllByRole('gridcell');
      expect(mondays).toHaveLength(53);
      expect(weekday(dayOf(mondays[0])), 'the first row is Mondays').toBe(1);
      // This week, Mon 14 – Sun 20 Sep, is the last column.
      expect(dayOf(mondays.at(-1))).toBe('2026-09-14');
      const sundays = within(rows.at(-1) as HTMLElement).getAllByRole('gridcell');
      expect(dayOf(sundays.at(-1))).toBe('2026-09-20');

      // A future day keeps its place in the grid, marked rather than removed.
      expect(dayButton(grid, 'FRI · 18 SEP: upcoming')).toHaveAttribute('aria-disabled', 'true');

      await user.click(dayButton(grid, 'MON · 14 SEP: 2 of 2 done'));
      expect(screen.getByRole('heading', { name: 'MON · 14 SEP' })).toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('exposes every Year cell as a gridcell wrapping a button', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange(1);
      await gridReady();
      const grid = await openYear(user);

      const cells = within(grid).getAllByRole('gridcell');
      const buttons = within(grid).getAllByRole('button');
      expect(cells).toHaveLength(53 * 7);
      // The role stays off the button, so a screen reader still hears an action.
      expect(buttons).toHaveLength(53 * 7);

      for (const gridcell of [cells[0], cells.at(-1), cells[200]]) {
        const inner = within(gridcell as HTMLElement).getAllByRole('button');
        expect(inner).toHaveLength(1);
        expect(gridcell).not.toHaveAttribute('tabindex');
      }

      // The day and its status are announced by the button; the cell around it
      // carries only the position.
      const todayButton = dayButton(grid, 'THU · 17 SEP: 0 of 1 done');
      const todayCell = todayButton.closest('[role="gridcell"]');
      expect(todayCell).toBeInTheDocument();
      expect(todayCell).toHaveAttribute('aria-colindex', '53');
      expect(todayButton).toHaveAttribute('tabindex', '0');
      expect(todayButton).toHaveAttribute('aria-current', 'date');
    } finally {
      clock.restore();
    }
  });

  it('moves focus around the Year grid with one tab stop and the arrow keys', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange(1);
      await gridReady();
      const grid = await openYear(user);

      // Only today is tabbable to begin with.
      const today = dayButton(grid, 'THU · 17 SEP: 0 of 1 done');
      expect(today).toHaveAttribute('tabindex', '0');
      expect(dayButton(grid, 'MON · 14 SEP: 2 of 2 done')).toHaveAttribute('tabindex', '-1');
      expect(within(grid).getAllByRole('button').filter(isTabbable)).toHaveLength(1);

      today.focus();
      expect(today).toHaveFocus();

      // Left and right move a week at a time along the same weekday.
      await user.keyboard('{ArrowLeft}');
      expect(dayButton(grid, 'THU · 10 SEP: 0 of 1 done')).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(today).toHaveFocus();

      // Up and down move within the week…
      await user.keyboard('{ArrowUp}');
      expect(dayButton(grid, 'WED · 16 SEP: 1 of 2 done')).toHaveFocus();
      await user.keyboard('{ArrowDown}{ArrowDown}');
      expect(dayButton(grid, 'FRI · 18 SEP: upcoming')).toHaveFocus();

      // …and Home and End jump to its first and last day.
      await user.keyboard('{Home}');
      expect(dayButton(grid, 'MON · 14 SEP: 2 of 2 done')).toHaveFocus();
      await user.keyboard('{End}');
      expect(dayButton(grid, 'SUN · 20 SEP: upcoming')).toHaveFocus();

      // The tab stop follows the focused cell, so leaving and returning resumes there.
      await user.keyboard('{Home}');
      expect(dayButton(grid, 'MON · 14 SEP: 2 of 2 done')).toHaveAttribute('tabindex', '0');
      expect(today).toHaveAttribute('tabindex', '-1');

      // Enter opens the focused day.
      await user.keyboard('{Enter}');
      expect(screen.getByRole('heading', { name: 'MON · 14 SEP' })).toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('does not open a future day from the Year grid', async () => {
    const clock = installFixedClock();
    try {
      const { user } = arrange(1);
      await gridReady();
      const grid = await openYear(user);

      await user.click(dayButton(grid, 'FRI · 18 SEP: upcoming'));

      expect(screen.getByRole('radio', { name: 'Year' })).toHaveAttribute('data-state', 'on');
      expect(screen.queryByRole('heading', { name: 'FRI · 18 SEP' })).not.toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });
});
