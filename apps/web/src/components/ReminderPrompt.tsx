/**
 * The in-app notification prompt (SPEC.md §10 "Web client").
 *
 * Shown once, after the first habit is saved with reminders on. "Turn on
 * reminders" is what calls `Notification.requestPermission()`, so the browser's
 * own dialog always follows a deliberate tap.
 */
import * as React from 'react';
import { BellRing } from 'lucide-react';
import { Button, Card, SectionLabel } from '@/components/ui';
import { useReminderPermissionPrompt } from '@/push/ReminderPermissionProvider';

export function ReminderPrompt(): React.ReactElement | null {
  const prompt = useReminderPermissionPrompt();
  if (!prompt.visible) return null;

  return (
    <Card className="flex flex-col gap-3 p-4" role="region" aria-label="Turn on reminders">
      <div className="flex items-center gap-2">
        <BellRing className="size-4 text-accent" aria-hidden="true" />
        <SectionLabel className="text-accent">REMINDERS</SectionLabel>
      </div>
      <p className="text-[15px]">
        Beta can tell you the moment a habit is due. Turn on notifications to get them.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" loading={prompt.busy} onClick={prompt.request}>
          Turn on reminders
        </Button>
        <Button variant="ghost" size="sm" onClick={prompt.dismiss}>
          Not now
        </Button>
      </div>
    </Card>
  );
}
