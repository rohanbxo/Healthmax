/**
 * The habit form — `/habits/new` and `/habits/:id` (SPEC.md §11 "Screens",
 * §13 "Web tests").
 *
 * Both routes are sheets over a live Today, so every test mounts the real route
 * table at a fixed instant and drives the form the way a user does. The
 * assertions are about the request that leaves the client: the schedule shape
 * the chips and the stepper produce is the part worth pinning, because it is
 * the one place the UI has to agree with `scheduleSchema` in `@beta/core`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { type HabitDTO } from '@beta/core';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { type FixedClock, FIXED_TIME_ZONE, installFixedClock } from '@/test/clock';
import {
  apiError,
  makeToday,
  recordedRequests,
  setMswHabits,
  setMswToday,
  signInMswUser,
} from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/* ------------------------------------------------------------- fixtures */

const READ: HabitDTO = {
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Read',
  schedule: { kind: 'daily' },
  time: '07:30',
  remind: true,
  createdDayKey: '2026-09-01',
  archived: false,
  order: 0,
};

/** Signs in, serves `habits` from both `/today` and `/habits`, then mounts. */
function renderAt(route: string, habits: HabitDTO[] = []): ReturnType<typeof renderWithProviders> {
  signInMswUser({ timeZone: FIXED_TIME_ZONE });
  setMswToday(makeToday({ habits }));
  setMswHabits(habits);
  return renderWithProviders(<AppRoutes />, { route });
}

function openSheet(name: 'New habit' | 'Edit habit'): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name });
}

/* ------------------------------------------------------------ the tests */

describe('Habit form', () => {
  let clock: FixedClock;

  beforeEach(() => {
    clock = installFixedClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('creates a daily habit and closes back to Today', async () => {
    const { user } = renderAt('/habits/new');
    const sheet = await openSheet('New habit');

    await user.type(within(sheet).getByLabelText(/name/i), 'Meditate');
    await user.click(within(sheet).getByRole('button', { name: 'Create habit' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New habit' })).not.toBeInTheDocument();
    });

    expect(recordedRequests()).toEqual([
      {
        method: 'POST',
        path: '/habits',
        body: { name: 'Meditate', schedule: { kind: 'daily' }, time: '07:30', remind: true },
      },
    ]);
  });

  it('keeps the sheet open and sends nothing when the name is empty', async () => {
    const { user } = renderAt('/habits/new');
    const sheet = await openSheet('New habit');

    await user.click(within(sheet).getByRole('button', { name: 'Create habit' }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Name is required');
    expect(recordedRequests()).toEqual([]);
    expect(screen.getByRole('dialog', { name: 'New habit' })).toBeInTheDocument();
  });

  it('sends a sorted, de-duplicated weekday schedule from the chips', async () => {
    const { user } = renderAt('/habits/new');
    const sheet = await openSheet('New habit');

    await user.type(within(sheet).getByLabelText(/name/i), 'Gym');
    await user.click(within(sheet).getByRole('radio', { name: 'Weekdays' }));

    // The chips start on Mon–Fri; adding Sunday and dropping Wednesday leaves
    // [0, 1, 2, 4, 5] — and Sunday must sort to the front, not append.
    const days = within(sheet).getByRole('group', { name: 'Days of the week' });
    await user.click(within(days).getByRole('button', { name: 'Sunday' }));
    await user.click(within(days).getByRole('button', { name: 'Wednesday' }));

    expect(within(days).getByRole('button', { name: 'Sunday' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(days).getByRole('button', { name: 'Wednesday' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(within(sheet).getByRole('button', { name: 'Create habit' }));

    await waitFor(() => expect(recordedRequests()).toHaveLength(1));
    expect(recordedRequests()[0]?.body).toEqual({
      name: 'Gym',
      schedule: { kind: 'weekdays', days: [0, 1, 2, 4, 5] },
      time: '07:30',
      remind: true,
    });
  });

  it('steps the times-per-week count and stops at seven', async () => {
    const { user } = renderAt('/habits/new');
    const sheet = await openSheet('New habit');

    await user.type(within(sheet).getByLabelText(/name/i), 'Run');
    await user.click(within(sheet).getByRole('radio', { name: 'Times' }));

    const more = within(sheet).getByRole('button', { name: 'More times per week' });
    const fewer = within(sheet).getByRole('button', { name: 'Fewer times per week' });

    // Starts at 3. Eight taps would reach 11 if the stepper did not clamp.
    for (let i = 0; i < 8; i += 1) await user.click(more);
    expect(more).toBeDisabled();
    expect(fewer).toBeEnabled();

    await user.click(fewer);
    await user.click(within(sheet).getByRole('button', { name: 'Create habit' }));

    await waitFor(() => expect(recordedRequests()).toHaveLength(1));
    expect(recordedRequests()[0]?.body).toEqual({
      name: 'Run',
      schedule: { kind: 'timesPerWeek', count: 6 },
      time: '07:30',
      remind: true,
    });
  });

  it('reports a rejected create without closing the sheet', async () => {
    server.use(http.post('/api/habits', () => apiError('INTERNAL', 'Nope')));

    const { user } = renderAt('/habits/new');
    const sheet = await openSheet('New habit');

    await user.type(within(sheet).getByLabelText(/name/i), 'Meditate');
    await user.click(within(sheet).getByRole('button', { name: 'Create habit' }));

    expect(await within(sheet).findByText(/could not create that habit/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New habit' })).toBeInTheDocument();
  });

  it('opens the edit sheet from the habit name on Today', async () => {
    const { user } = renderAt('/', [READ]);

    await user.click(await screen.findByRole('link', { name: 'Edit Read' }));

    expect(await openSheet('Edit habit')).toBeInTheDocument();
  });

  it('prefills the form from the habit and patches what changed', async () => {
    const { user } = renderAt(`/habits/${READ.id}`, [READ]);
    const sheet = await openSheet('Edit habit');

    // The form only appears once `['habits']` has resolved, prefilled from it.
    const name = await within(sheet).findByLabelText(/name/i);
    expect(name).toHaveValue('Read');
    expect(within(sheet).getByRole('radio', { name: 'Daily' })).toBeChecked();
    expect(within(sheet).getByRole('switch', { name: 'Reminder' })).toBeChecked();

    await user.clear(name);
    await user.type(name, 'Read a chapter');
    await user.click(within(sheet).getByRole('switch', { name: 'Reminder' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit habit' })).not.toBeInTheDocument();
    });

    expect(recordedRequests()).toEqual([
      {
        method: 'PATCH',
        path: `/habits/${READ.id}`,
        body: {
          name: 'Read a chapter',
          schedule: { kind: 'daily' },
          time: '07:30',
          remind: false,
        },
      },
    ]);
  });

  it('archives a habit without touching the rest of it', async () => {
    const { user } = renderAt(`/habits/${READ.id}`, [READ]);
    const sheet = await openSheet('Edit habit');

    await user.click(await within(sheet).findByRole('button', { name: 'Archive habit' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit habit' })).not.toBeInTheDocument();
    });

    expect(recordedRequests()).toEqual([
      { method: 'PATCH', path: `/habits/${READ.id}`, body: { archived: true } },
    ]);
  });

  it('deletes a habit only after the confirmation is accepted', async () => {
    const { user } = renderAt(`/habits/${READ.id}`, [READ]);
    const sheet = await openSheet('Edit habit');

    await user.click(await within(sheet).findByRole('button', { name: 'Delete habit' }));

    const confirm = await screen.findByRole('alertdialog', { name: `Delete ${READ.name}?` });

    // Backing out leaves the habit alone.
    await user.click(within(confirm).getByRole('button', { name: 'Keep habit' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(recordedRequests()).toEqual([]);

    await user.click(within(sheet).getByRole('button', { name: 'Delete habit' }));
    const again = await screen.findByRole('alertdialog', { name: `Delete ${READ.name}?` });
    await user.click(within(again).getByRole('button', { name: 'Delete habit' }));

    await waitFor(() => {
      expect(recordedRequests()).toEqual([
        { method: 'DELETE', path: `/habits/${READ.id}`, body: null },
      ]);
    });
  });

  it('explains itself when the habit is not in the list', async () => {
    renderAt('/habits/00000000-0000-4000-8000-000000000999', [READ]);
    const sheet = await openSheet('Edit habit');

    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/could not find that habit/i);
  });
});
