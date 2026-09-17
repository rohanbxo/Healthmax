import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { mswState, signInMswUser } from '@/test/msw/handlers';

async function renderOnboarding() {
  signInMswUser({ onboarded: false, name: 'Rider', timeZone: 'Asia/Dubai' });
  const view = renderWithProviders(<AppRoutes />, { route: '/' });
  await screen.findByRole('heading', { name: 'A few details.' });
  return view;
}

describe('onboarding screen', () => {
  it('filters the time zone list and submits the chosen zone', async () => {
    const { user } = await renderOnboarding();

    const picker = screen.getByRole('combobox', { name: /time zone/i });
    await user.click(picker);

    // The unfiltered list is the full IANA set, capped for rendering.
    expect(screen.getAllByRole('option').length).toBeGreaterThan(10);

    await user.clear(picker);
    await user.type(picker, 'Kolkata');

    const matches = screen.getAllByRole('option');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveTextContent('Asia/Kolkata');

    await user.click(matches[0] as HTMLElement);
    expect(picker).toHaveValue('Asia/Kolkata');

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(mswState.patchMeCalls).toBe(1);
    expect(mswState.lastPatchMeBody).toEqual({
      name: 'Rider',
      timeZone: 'Asia/Kolkata',
      weekStart: 1,
      onboarded: true,
    });
  });

  it('keeps a keyboard user on the list', async () => {
    const { user } = await renderOnboarding();

    const picker = screen.getByRole('combobox', { name: /time zone/i });
    await user.click(picker);
    await user.clear(picker);
    await user.type(picker, 'Lord_Howe');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(picker).toHaveValue('Australia/Lord_Howe');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('sends the chosen week start', async () => {
    const { user } = await renderOnboarding();

    const weekStart = screen.getByRole('radiogroup', { name: 'Week starts on' });
    await user.click(within(weekStart).getByRole('radio', { name: 'Sunday' }));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await screen.findByRole('heading', { name: 'Today' });
    expect(mswState.lastPatchMeBody).toMatchObject({ weekStart: 0, onboarded: true });
  });
});
