/**
 * The Settings notification section (SPEC.md §10 "Web client"): permission
 * status, enable, a test send, and the platform note that matters — on iPhone,
 * Web Push only works once Beta is on the Home Screen.
 */
import * as React from 'react';
import { Button, Card, SectionLabel, useToast } from '@/components/ui';
import { useSendTestNotification } from '@/api/hooks';
import { useReminderPermissionPrompt } from '@/push/ReminderPermissionProvider';

/** What the user is told about this browser's permission state. */
export function statusLabel(permission: string, subscribed: boolean): string {
  if (permission === 'unsupported') return 'Not supported in this browser';
  if (permission === 'denied') return 'Blocked in your browser';
  if (permission === 'granted') return subscribed ? 'On' : 'Allowed, but not registered';
  return 'Off';
}

export function NotificationSettings(): React.ReactElement {
  const reminders = useReminderPermissionPrompt();
  const sendTest = useSendTestNotification();
  const { toast } = useToast();

  const status = statusLabel(reminders.permission, reminders.subscribed);
  const canEnable = reminders.supported && reminders.permission !== 'denied';

  function handleTest(): void {
    sendTest.mutate(undefined, {
      onSuccess: (report) => {
        toast({
          title:
            report.sent > 0
              ? `Test sent to ${report.sent} device${report.sent === 1 ? '' : 's'}.`
              : 'No registered devices to send to.',
        });
      },
      onError: () => {
        toast({ title: 'We could not send a test notification.', variant: 'error' });
      },
    });
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Notifications">
      <SectionLabel>NOTIFICATIONS</SectionLabel>
      <Card className="flex flex-col gap-3 p-4">
        <p className="flex items-baseline justify-between gap-3 text-[15px]">
          <span className="text-muted">Status</span>
          <span className="font-mono text-sm">{status}</span>
        </p>

        {reminders.error === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {reminders.error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {reminders.subscribed ? (
            <Button
              variant="outline"
              fullWidth
              loading={reminders.busy}
              onClick={() => void reminders.disable()}
            >
              Turn off on this device
            </Button>
          ) : (
            <Button
              variant="primary"
              fullWidth
              disabled={!canEnable}
              loading={reminders.busy}
              onClick={() => void reminders.enable()}
            >
              Turn on reminders
            </Button>
          )}

          <Button
            variant="secondary"
            fullWidth
            disabled={!reminders.subscribed}
            loading={sendTest.isPending}
            onClick={handleTest}
          >
            Send test notification
          </Button>
        </div>

        <p className="text-sm text-muted">
          On iPhone, notifications work only after you add Beta to the Home Screen.
        </p>
      </Card>
    </section>
  );
}
