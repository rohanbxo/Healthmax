/**
 * Seam for the in-app notification prompt (SPEC.md §10 "Web client").
 *
 * The rule the product wants: ask for notification permission **after the user
 * saves their first habit with reminders on**, from an in-app prompt, never on
 * page load. The habit form already knows when that moment happens, so it
 * reports it here.
 *
 * TODO(M9): implement the actual flow — surface the prompt, call
 * `Notification.requestPermission()` from the user's click, subscribe to push
 * and POST the subscription. **M7 deliberately touches no Notification API**:
 * `visible` stays false and `request` is a no-op, so nothing renders and no
 * browser permission dialog can appear before M9 ships the rest of it.
 */
import * as React from 'react';

export type ReminderPermissionPrompt = {
  /** Whether the in-app prompt should be on screen. Always false until M9. */
  visible: boolean;
  /** M9: asks the browser for permission. A no-op today. */
  request: () => void;
  dismiss: () => void;
  /** Called by the habit form right after a successful save. */
  noteHabitSaved: (saved: { remind: boolean; isFirstHabit: boolean }) => void;
};

export function useReminderPermissionPrompt(): ReminderPermissionPrompt {
  const [visible, setVisible] = React.useState(false);

  const noteHabitSaved = React.useCallback((saved: { remind: boolean; isFirstHabit: boolean }) => {
    // TODO(M9): `setVisible(saved.remind && saved.isFirstHabit && permission === 'default')`.
    void saved;
  }, []);

  const request = React.useCallback(() => {
    // TODO(M9): request permission, then subscribe and POST /push/subscriptions.
    setVisible(false);
  }, []);

  const dismiss = React.useCallback(() => setVisible(false), []);

  return React.useMemo<ReminderPermissionPrompt>(
    () => ({ visible, request, dismiss, noteHabitSaved }),
    [visible, request, dismiss, noteHabitSaved],
  );
}
