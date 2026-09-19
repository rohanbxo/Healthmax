/**
 * `/habits/:id` — a modal route over Today (SPEC.md §11 "Routing").
 *
 * The same form as `/habits/new`, plus **Archive** (an archived habit is never
 * scheduled, reminded or counted — SPEC §6) and **Delete** behind an
 * `AlertDialog` confirmation.
 */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { type CreateHabitBody } from '@beta/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTrigger,
  Button,
  Sheet,
  SheetContent,
  Spinner,
} from '@/components/ui';
import { HabitForm } from '@/components/HabitForm';
import { useDeleteHabit, useHabits, useUpdateHabit } from '@/api/hooks';
import { HOME_PATH } from '@/auth/RequireAuth';

export function HabitEditRoute(): React.ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const habits = useHabits();
  const updateHabit = useUpdateHabit();
  const deleteHabit = useDeleteHabit();
  const [failure, setFailure] = React.useState<string | null>(null);

  const habit = habits.data?.find((candidate) => candidate.id === id);

  function close(): void {
    navigate(HOME_PATH, { replace: true });
  }

  function handleSubmit(body: CreateHabitBody): void {
    setFailure(null);
    updateHabit.mutate(
      { id, body },
      {
        onSuccess: close,
        onError: () => setFailure('We could not save that habit. Try again.'),
      },
    );
  }

  function handleArchive(): void {
    setFailure(null);
    updateHabit.mutate(
      { id, body: { archived: !(habit?.archived ?? false) } },
      {
        onSuccess: close,
        onError: () => setFailure('We could not archive that habit. Try again.'),
      },
    );
  }

  function handleDelete(): void {
    setFailure(null);
    deleteHabit.mutate(id, {
      onSuccess: close,
      onError: () => setFailure('We could not delete that habit. Try again.'),
    });
  }

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent title="Edit habit" description="Change the schedule, time or reminder.">
        {habits.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner size="lg" label="Loading habit" />
          </div>
        ) : habit === undefined ? (
          <p role="alert" className="py-8 text-sm text-muted">
            We could not find that habit. It may have been deleted.
          </p>
        ) : (
          <HabitForm
            mode="edit"
            habit={habit}
            submitLabel="Save changes"
            pending={updateHabit.isPending}
            failure={failure}
            onSubmit={handleSubmit}
          >
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <Button variant="outline" fullWidth onClick={handleArchive}>
                {habit.archived ? 'Unarchive habit' : 'Archive habit'}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="danger-outline" fullWidth>
                    <Trash2 aria-hidden="true" />
                    Delete habit
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  title={`Delete ${habit.name}?`}
                  description="This removes the habit and everything logged against it. It cannot be undone."
                >
                  <AlertDialogFooter>
                    <AlertDialogAction onClick={handleDelete}>Delete habit</AlertDialogAction>
                    <AlertDialogCancel>Keep habit</AlertDialogCancel>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </HabitForm>
        )}
      </SheetContent>
    </Sheet>
  );
}
