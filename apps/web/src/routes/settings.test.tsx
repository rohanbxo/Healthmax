/**
 * Settings (SPEC.md §11 "Screens", §13 "Web tests").
 *
 * The parts worth pinning are the ones a user can lose data to: auto-save
 * sending one request instead of one per keystroke, and both destructive
 * actions asking first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { type FixedClock, FIXED_TIME_ZONE, installFixedClock } from '@/test/clock';
import { installPushEnvironment, type FakePushEnvironment } from '@/test/pushEnvironment';
import {
  mswState,
  recordedRequests,
  setMswExport,
  setMswHabits,
  signInMswUser,
} from '@/test/msw/handlers';

function renderSettings(): ReturnType<typeof renderWithProviders> {
  signInMswUser({ timeZone: FIXED_TIME_ZONE, name: 'Rider' });
  setMswHabits([]);
  return renderWithProviders(<AppRoutes />, { route: '/settings' });
}

const patchRequests = () => recordedRequests().filter((request) => request.path === '/me');

describe('Settings', () => {
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

  describe('account auto-save', () => {
    it('saves once after typing stops, not once per keystroke', async () => {
      const { user } = renderSettings();
      const name = await screen.findByLabelText('Name');

      await user.clear(name);
      await user.type(name, 'Rohan');

      // Debounced: the burst has not been sent yet.
      expect(patchRequests()).toHaveLength(0);
      expect(await screen.findByText('Saved')).toBeInTheDocument();
      expect(patchRequests()).toEqual([{ method: 'PATCH', path: '/me', body: { name: 'Rohan' } }]);
    });

    it('saves a week-start change', async () => {
      const { user } = renderSettings();
      await screen.findByLabelText('Name');

      await user.click(screen.getByRole('radio', { name: 'Sunday' }));

      await waitFor(() =>
        expect(patchRequests()).toEqual([{ method: 'PATCH', path: '/me', body: { weekStart: 0 } }]),
      );
      expect(await screen.findByText('Saved')).toBeInTheDocument();
    });

    it('says so when a save fails', async () => {
      const { user } = renderSettings();
      mswState.patchMeFails = true;
      const name = await screen.findByLabelText('Name');

      await user.clear(name);
      await user.type(name, 'Nope');

      expect(await screen.findByText('Not saved')).toBeInTheDocument();
      expect(
        screen.getByText('We could not save that. Check your connection.'),
      ).toBeInTheDocument();
    });
  });

  describe('export', () => {
    it('downloads the account as a file', async () => {
      // Only the two methods: replacing the whole `URL` global would take the
      // constructor with it, and the router needs that.
      const createObjectURL = vi.fn(() => 'blob:beta');
      Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
      setMswExport({
        app: 'beta',
        schemaVersion: 1,
        exportedAt: '2026-09-17T03:12:00.000Z',
        me: mswState.session?.me ?? null,
        habits: [],
        logs: [],
      });

      const { user } = renderSettings();
      await user.click(await screen.findByRole('button', { name: 'Export my data' }));

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Export downloaded.')).toBeInTheDocument();
    });
  });

  describe('import', () => {
    const file = (data: unknown): File =>
      new File([JSON.stringify(data)], 'beta-export.json', { type: 'application/json' });

    const validExport = {
      app: 'beta',
      schemaVersion: 1,
      habits: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Read',
          schedule: { kind: 'daily' },
          time: '07:30',
          remind: true,
          createdDayKey: '2026-09-01',
          archived: false,
          order: 0,
        },
      ],
      logs: [
        {
          habitId: '00000000-0000-4000-8000-000000000001',
          dayKey: '2026-09-16',
          status: 'done',
        },
      ],
    };

    it('asks before replacing everything, and says what will go', async () => {
      const { user } = renderSettings();
      await screen.findByRole('button', { name: 'Import from a file' });

      await user.upload(screen.getByLabelText('Import file'), file(validExport));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(/1 habits and 1 logs/)).toBeInTheDocument();
      // Nothing has been sent while the question is open.
      expect(recordedRequests().filter((request) => request.path === '/import')).toHaveLength(0);

      await user.click(within(dialog).getByRole('button', { name: 'Replace everything' }));

      await waitFor(() =>
        expect(recordedRequests()).toContainEqual({
          method: 'POST',
          path: '/import',
          body: validExport,
        }),
      );
      expect(await screen.findByText('Imported 1 habits and 1 logs.')).toBeInTheDocument();
    });

    it('sends nothing when the confirmation is declined', async () => {
      const { user } = renderSettings();
      await screen.findByRole('button', { name: 'Import from a file' });

      await user.upload(screen.getByLabelText('Import file'), file(validExport));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Keep my data' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(recordedRequests().filter((request) => request.path === '/import')).toHaveLength(0);
    });

    it('refuses a file that is not a Beta export', async () => {
      const { user } = renderSettings();
      await screen.findByRole('button', { name: 'Import from a file' });

      await user.upload(screen.getByLabelText('Import file'), file({ app: 'something-else' }));

      expect(await screen.findByText('That file is not a Beta export.')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('delete account', () => {
    it('takes the password and signs out afterwards', async () => {
      const { user } = renderSettings();

      await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
      const dialog = await screen.findByRole('alertdialog');
      // The confirmation is useless without it.
      expect(within(dialog).getByRole('button', { name: 'Delete for ever' })).toBeDisabled();

      await user.type(within(dialog).getByLabelText(/password/i), 'correct-horse-battery');
      await user.click(within(dialog).getByRole('button', { name: 'Delete for ever' }));

      await waitFor(() =>
        expect(recordedRequests()).toContainEqual({
          method: 'DELETE',
          path: '/me',
          body: { password: 'correct-horse-battery' },
        }),
      );
      // Signed out: the login screen is what remains.
      expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
    });

    it('keeps the dialog open and explains a wrong password', async () => {
      const { user } = renderSettings();
      mswState.deleteMeFails = true;

      await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.type(within(dialog).getByLabelText(/password/i), 'wrong-password');
      await user.click(within(dialog).getByRole('button', { name: 'Delete for ever' }));

      expect(await screen.findByText('That password is not right.')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
  });
});
