/**
 * The notification permission flow and the Settings section (SPEC.md §10
 * "Web client").
 *
 * The rule under test is *when* the browser is asked: after the first habit is
 * saved with reminders on, from a tap — never on page load.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { type HabitDTO } from '@beta/core';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { type FixedClock, FIXED_TIME_ZONE, installFixedClock } from '@/test/clock';
import {
  installPushEnvironment,
  TEST_ENDPOINT,
  type FakePushEnvironment,
} from '@/test/pushEnvironment';
import {
  makeToday,
  mswState,
  recordedRequests,
  setMswHabits,
  setMswToday,
  signInMswUser,
} from '@/test/msw/handlers';
import { urlBase64ToUint8Array } from './client';

const EXISTING: HabitDTO = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Read',
  schedule: { kind: 'daily' },
  time: '07:30',
  remind: true,
  createdDayKey: '2026-09-01',
  archived: false,
  order: 0,
};

function renderAt(route: string, habits: HabitDTO[] = []): ReturnType<typeof renderWithProviders> {
  signInMswUser({ timeZone: FIXED_TIME_ZONE });
  setMswToday(makeToday({ habits }));
  setMswHabits(habits);
  return renderWithProviders(<AppRoutes />, { route });
}

/** Creates a habit through the real form, which is what triggers the ask. */
async function createHabit(
  user: ReturnType<typeof renderWithProviders>['user'],
  options: { remind?: boolean } = {},
): Promise<void> {
  const sheet = await screen.findByRole('dialog', { name: 'New habit' });
  await user.type(within(sheet).getByLabelText(/name/i), 'Meditate');
  if (options.remind === false) {
    await user.click(within(sheet).getByRole('switch', { name: /remind/i }));
  }
  await user.click(within(sheet).getByRole('button', { name: 'Create habit' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'New habit' })).not.toBeInTheDocument();
  });
}

const promptText =
  'Beta can tell you the moment a habit is due. Turn on notifications to get them.';

describe('reminder permission', () => {
  let clock: FixedClock;
  let push: FakePushEnvironment;

  beforeEach(() => {
    clock = installFixedClock();
    push = installPushEnvironment();
  });

  afterEach(() => {
    push.restore();
    clock.restore();
  });

  it('never asks the browser on page load', async () => {
    renderAt('/', [EXISTING]);
    await screen.findByText('NEXT UP');

    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByText(promptText)).not.toBeInTheDocument();
  });

  it('asks after the first habit is saved with reminders on', async () => {
    const { user } = renderAt('/habits/new');
    await createHabit(user);

    // The prompt is in the shell, so it outlives the sheet that triggered it.
    expect(await screen.findByText(promptText)).toBeInTheDocument();
    // Still nothing from the browser until the user taps.
    expect(push.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => expect(push.requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mswState.pushSubscriptions).toHaveLength(1));
    expect(mswState.pushSubscriptions[0]).toEqual({
      endpoint: TEST_ENDPOINT,
      keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
      userAgent: expect.any(String) as unknown as string,
    });
    // Subscribed with the server's key, as raw bytes.
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    expect(push.applicationServerKey()).toEqual(
      urlBase64ToUint8Array(mswState.vapidPublicKey ?? ''),
    );
    expect(screen.queryByText(promptText)).not.toBeInTheDocument();
  });

  it('stays quiet when reminders were switched off', async () => {
    const { user } = renderAt('/habits/new');
    await createHabit(user, { remind: false });

    expect(screen.queryByText(promptText)).not.toBeInTheDocument();
  });

  it('stays quiet when this is not the first habit', async () => {
    const { user } = renderAt('/habits/new', [EXISTING]);
    await createHabit(user);

    expect(screen.queryByText(promptText)).not.toBeInTheDocument();
  });

  it('stays quiet when the browser has already been asked', async () => {
    push.restore();
    push = installPushEnvironment({ permission: 'denied' });
    const { user } = renderAt('/habits/new');
    await createHabit(user);

    expect(screen.queryByText(promptText)).not.toBeInTheDocument();
  });

  it('can be dismissed without asking anything', async () => {
    const { user } = renderAt('/habits/new');
    await createHabit(user);
    await screen.findByText(promptText);

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.queryByText(promptText)).not.toBeInTheDocument();
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(mswState.pushSubscriptions).toHaveLength(0);
  });

  it('registers nothing when the user says no', async () => {
    push.restore();
    push = installPushEnvironment({ permission: 'default', answer: 'denied' });
    const { user } = renderAt('/habits/new');
    await createHabit(user);

    await user.click(await screen.findByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => expect(push.requestPermission).toHaveBeenCalledTimes(1));
    expect(push.subscribe).not.toHaveBeenCalled();
    expect(mswState.pushSubscriptions).toHaveLength(0);
  });
});

describe('Settings notifications', () => {
  let clock: FixedClock;
  let push: FakePushEnvironment;

  beforeEach(() => {
    clock = installFixedClock();
    push = installPushEnvironment();
  });

  afterEach(() => {
    push.restore();
    clock.restore();
  });

  const section = async (): Promise<HTMLElement> =>
    screen.findByRole('region', { name: 'Notifications' });

  it('turns reminders on from Settings and then sends a test', async () => {
    const { user } = renderAt('/settings');
    const panel = await section();
    expect(within(panel).getByText('Off')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Send test notification' })).toBeDisabled();

    await user.click(within(panel).getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => expect(within(panel).getByText('On')).toBeInTheDocument());
    expect(mswState.pushSubscriptions).toHaveLength(1);

    await user.click(within(panel).getByRole('button', { name: 'Send test notification' }));

    await waitFor(() =>
      expect(recordedRequests()).toContainEqual({ method: 'POST', path: '/push/test', body: null }),
    );
    expect(await screen.findByText('Test sent to 1 device.')).toBeInTheDocument();
  });

  it('turns them off again on this device', async () => {
    push.restore();
    push = installPushEnvironment({ permission: 'granted', existingSubscription: true });
    const { user } = renderAt('/settings');
    const panel = await section();

    await waitFor(() => expect(within(panel).getByText('On')).toBeInTheDocument());
    await user.click(within(panel).getByRole('button', { name: 'Turn off on this device' }));

    await waitFor(() => expect(push.unsubscribe).toHaveBeenCalledTimes(1));
    expect(recordedRequests()).toContainEqual({
      method: 'DELETE',
      path: '/push/subscriptions',
      body: { endpoint: TEST_ENDPOINT },
    });
    // Permission is still granted — only this device's registration is gone,
    // so the offer to turn it back on needs no second browser prompt.
    expect(within(panel).getByText('Allowed, but not registered')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
  });

  it('explains a blocked browser instead of offering a dead button', async () => {
    push.restore();
    push = installPushEnvironment({ permission: 'denied' });
    renderAt('/settings');
    const panel = await section();

    expect(within(panel).getByText('Blocked in your browser')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Turn on reminders' })).toBeDisabled();
  });

  it('says so when the browser cannot do push at all', async () => {
    push.restore();
    push = installPushEnvironment({ supported: false });
    renderAt('/settings');
    const panel = await section();

    expect(within(panel).getByText('Not supported in this browser')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Turn on reminders' })).toBeDisabled();
  });

  it('always names the iPhone requirement', async () => {
    renderAt('/settings');
    const panel = await section();

    expect(
      within(panel).getByText(
        'On iPhone, notifications work only after you add Beta to the Home Screen.',
      ),
    ).toBeInTheDocument();
  });
});
