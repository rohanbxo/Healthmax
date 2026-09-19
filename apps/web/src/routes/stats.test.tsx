/**
 * Stats (SPEC.md §11 "Stats"). The numbers are the server's; these tests pin
 * how the screen lays them out and which range it asks for.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import {
  type DayStatus,
  type HabitDTO,
  type HabitStatsDTO,
  type StatsDTO,
  type StatsRange,
  addDays,
} from '@beta/core';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { FIXED_DAY_KEY, FIXED_TIME_ZONE } from '@/test/clock';
import { mswState, setMswHabits, setMswStats, signInMswUser } from '@/test/msw/handlers';

const READ: HabitDTO = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Read',
  schedule: { kind: 'daily' },
  time: '07:30',
  remind: true,
  createdDayKey: '2026-08-01',
  archived: false,
  order: 0,
};

/** 30 days ending today: 20 done, 3 skipped, 6 missed, today still open. */
function strip(): { dayKey: string; status: DayStatus }[] {
  const statuses: DayStatus[] = [
    ...Array<DayStatus>(20).fill('done'),
    ...Array<DayStatus>(3).fill('skipped'),
    ...Array<DayStatus>(6).fill('missed'),
    'upcoming',
  ];
  return statuses.map((status, i) => ({ dayKey: addDays(FIXED_DAY_KEY, i - 29), status }));
}

function habitStats(overrides: Partial<HabitStatsDTO> = {}): HabitStatsDTO {
  return {
    habitId: READ.id,
    currentStreak: 4,
    bestStreak: 12,
    accuracy30: 0.9,
    last30: strip(),
    ...overrides,
  };
}

function stats(
  range: StatsRange,
  overallAccuracy: number | null,
  habits = [habitStats()],
): StatsDTO {
  return { range, dayKey: FIXED_DAY_KEY, overallAccuracy, habits };
}

function arrange(): ReturnType<typeof renderWithProviders> {
  signInMswUser({ timeZone: FIXED_TIME_ZONE });
  setMswHabits([READ]);
  return renderWithProviders(<AppRoutes />, { route: '/stats' });
}

describe('Stats', () => {
  it('shows 30 days by default, with each habit’s streaks, accuracy and dot strip', async () => {
    setMswStats(stats(30, 0.8333));
    arrange();

    expect(await screen.findByText('83%')).toBeInTheDocument();
    expect(screen.getByText('ACCURACY · LAST 30 DAYS')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveAttribute('data-state', 'on');
    expect(mswState.statsRanges).toEqual([30]);

    const card = screen.getByRole('heading', { name: 'Read' }).closest('div') as HTMLElement;
    expect(within(card).getByText('4')).toBeInTheDocument();
    expect(within(card).getByText('12')).toBeInTheDocument();
    expect(within(card).getByText('90%')).toBeInTheDocument();

    const dots = within(card).getByRole('img', {
      name: 'Last 30 days: 20 done, 3 skipped, 6 missed',
    });
    expect(dots.children).toHaveLength(30);
    expect(dots.lastElementChild).toHaveAttribute('data-status', 'upcoming');
  });

  it('asks for the range the user picks', async () => {
    setMswStats(stats(30, 0.8333));
    setMswStats(stats(7, 1));
    setMswStats(stats(90, 0.5));
    const { user } = arrange();
    await screen.findByText('83%');

    await user.click(screen.getByRole('radio', { name: '7 days' }));
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByText('ACCURACY · LAST 7 DAYS')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '90 days' }));
    expect(await screen.findByText('50%')).toBeInTheDocument();

    await waitFor(() => expect(mswState.statsRanges).toEqual([30, 7, 90]));
  });

  it('shows a dash, never 0%, when nothing was due', async () => {
    setMswStats(
      stats(30, null, [habitStats({ accuracy30: null, currentStreak: 0, bestStreak: 0 })]),
    );
    arrange();

    expect(await screen.findByText('Nothing was due in this window yet.')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('says so when there are no habits yet', async () => {
    setMswStats(stats(30, null, []));
    arrange();

    expect(
      await screen.findByText('Add a habit and its streaks will show up here.'),
    ).toBeInTheDocument();
  });

  it('offers a retry when stats fail to load', async () => {
    // No fixture for the default range: the handler answers 404.
    arrange();

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your stats.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
