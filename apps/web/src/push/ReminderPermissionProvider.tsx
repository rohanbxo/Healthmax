/**
 * Notification permission state for the whole app (SPEC.md §10 "Web client").
 *
 * The rule the product wants: ask **after the user saves their first habit
 * with reminders on**, from an in-app prompt, never on page load. The habit
 * form reports that moment through `noteHabitSaved`; the prompt itself is
 * rendered by the shell, so it survives the form's sheet closing.
 *
 * Nothing here touches `Notification.requestPermission()` except `enable()`,
 * which is only ever called from a click — the browsers require a user gesture,
 * and an unprompted dialog is exactly what SPEC.md §10 forbids.
 */
import * as React from 'react';
import {
  type PushPermission,
  currentPermission,
  currentSubscription,
  disablePush,
  enablePush,
  isPushSupported,
} from './client';

export type ReminderPermission = {
  supported: boolean;
  permission: PushPermission;
  /** This browser holds a live subscription. */
  subscribed: boolean;
  busy: boolean;
  /** Why the last attempt failed, for the Settings screen. */
  error: string | null;
  /** Whether the in-app prompt should be on screen. */
  visible: boolean;
  /** Enable from the prompt. */
  request: () => void;
  dismiss: () => void;
  /** Called by the habit form right after a successful save. */
  noteHabitSaved: (saved: { remind: boolean; isFirstHabit: boolean }) => void;
  /** Enable from Settings. */
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

const ReminderPermissionContext = React.createContext<ReminderPermission | null>(null);

export function ReminderPermissionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const supported = isPushSupported();
  const [permission, setPermission] = React.useState<PushPermission>(() => currentPermission());
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void currentSubscription().then((subscription) => {
      if (!cancelled) setSubscribed(subscription !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await enablePush();
      setPermission(result);
      setSubscribed(result === 'granted');
      if (result !== 'granted') {
        setError(
          result === 'denied'
            ? 'Notifications are blocked. Allow them in your browser settings to turn reminders on.'
            : 'This browser cannot show notifications.',
        );
      }
    } catch {
      setError('We could not turn reminders on. Try again.');
    } finally {
      setBusy(false);
      setVisible(false);
    }
  }, []);

  const disable = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await disablePush();
      setSubscribed(false);
    } catch {
      setError('We could not turn reminders off. Try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const value = React.useMemo<ReminderPermission>(
    () => ({
      supported,
      permission,
      subscribed,
      busy,
      error,
      visible,
      request: () => void enable(),
      dismiss: () => setVisible(false),
      noteHabitSaved: (saved) => {
        // Only the first habit, only with reminders on, and only while the
        // browser has not already been asked.
        if (saved.remind && saved.isFirstHabit && supported && currentPermission() === 'default') {
          setVisible(true);
        }
      },
      enable,
      disable,
    }),
    [supported, permission, subscribed, busy, error, visible, enable, disable],
  );

  return (
    <ReminderPermissionContext.Provider value={value}>
      {children}
    </ReminderPermissionContext.Provider>
  );
}

/**
 * The shared permission state. Outside the provider — which only the
 * authenticated tree mounts — it degrades to an inert object rather than
 * throwing, so a form rendered in isolation still works.
 */
export function useReminderPermissionPrompt(): ReminderPermission {
  const context = React.useContext(ReminderPermissionContext);
  const inert = React.useMemo<ReminderPermission>(
    () => ({
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      busy: false,
      error: null,
      visible: false,
      request: () => {},
      dismiss: () => {},
      noteHabitSaved: () => {},
      enable: async () => {},
      disable: async () => {},
    }),
    [],
  );
  return context ?? inert;
}
