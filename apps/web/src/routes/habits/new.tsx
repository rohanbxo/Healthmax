/**
 * `/habits/new` — a modal route over Today (SPEC.md §11 "Routing").
 *
 * On save the habit is created and both `['today']` and `['habits']` are
 * invalidated by `useCreateHabit`, then the sheet closes back to Today.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { type CreateHabitBody } from '@beta/core';
import { Sheet, SheetContent } from '@/components/ui';
import { HabitForm } from '@/components/HabitForm';
import { useReminderPermissionPrompt } from '@/push/ReminderPermissionProvider';
import { useCreateHabit, useHabits } from '@/api/hooks';
import { HOME_PATH } from '@/auth/RequireAuth';

export function HabitNewRoute(): React.ReactElement {
  const navigate = useNavigate();
  const createHabit = useCreateHabit();
  const habits = useHabits();
  const reminderPrompt = useReminderPermissionPrompt();
  const [failure, setFailure] = React.useState<string | null>(null);

  function close(): void {
    navigate(HOME_PATH, { replace: true });
  }

  function handleSubmit(body: CreateHabitBody): void {
    setFailure(null);
    const isFirstHabit = (habits.data?.length ?? 0) === 0;

    createHabit.mutate(body, {
      onSuccess: () => {
        // SPEC §10: the permission ask belongs right here, after the first
        // habit with reminders on. The shell renders the prompt.
        reminderPrompt.noteHabitSaved({ remind: body.remind ?? true, isFirstHabit });
        close();
      },
      onError: () => setFailure('We could not create that habit. Try again.'),
    });
  }

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent title="New habit" description="What should Beta remind you about?">
        <HabitForm
          mode="create"
          submitLabel="Create habit"
          pending={createHabit.isPending}
          failure={failure}
          onSubmit={handleSubmit}
        />
      </SheetContent>
    </Sheet>
  );
}
