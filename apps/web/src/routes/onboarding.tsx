/**
 * `/onboarding` (SPEC.md §11 "Screens"): name, a searchable timezone picker and
 * the week start. Saves with `PATCH /me` including `onboarded: true`, after
 * which the route guard stops sending the user here.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { type WeekStart, guessTimeZone, patchMeBodySchema } from '@beta/core';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import { Button, Field, Input, SectionLabel, SegmentedControl } from '@/components/ui';
import { useUpdateMe } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { HOME_PATH } from '@/auth/RequireAuth';
import { fieldErrors } from './form-utils';

type OnboardingField = 'name' | 'timeZone' | 'weekStart';

const WEEK_START_OPTIONS = [
  { value: '0' as const, label: 'Sunday' },
  { value: '1' as const, label: 'Monday' },
];

export function OnboardingRoute(): React.ReactElement {
  const { me, setMe } = useAuth();
  const updateMe = useUpdateMe();
  const navigate = useNavigate();

  const [name, setName] = React.useState(me?.name ?? '');
  const [timeZone, setTimeZone] = React.useState(() => me?.timeZone ?? guessTimeZone());
  const [weekStart, setWeekStart] = React.useState<WeekStart>(me?.weekStart ?? 1);
  const [errors, setErrors] = React.useState<Partial<Record<OnboardingField, string>>>({});
  const [failure, setFailure] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);

    const parsed = patchMeBodySchema.safeParse({ name, timeZone, weekStart, onboarded: true });
    if (!parsed.success) {
      setErrors(fieldErrors<OnboardingField>(parsed.error));
      return;
    }
    setErrors({});

    try {
      const updated = await updateMe.mutateAsync(parsed.data);
      setMe(updated);
      navigate(HOME_PATH, { replace: true });
    } catch {
      setFailure('We could not save your settings. Try again.');
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <SectionLabel tone="accent">SET UP BETA</SectionLabel>
        <h1 className="text-2xl font-semibold tracking-tight">A few details.</h1>
        <p className="text-sm text-muted">
          Your time zone decides when a habit is due and when a reminder fires.
        </p>
      </header>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <Field label="Name" error={errors.name} required>
          <Input
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Time zone"
          hint="Type to search over 400 zones."
          error={errors.timeZone}
          required
        >
          <TimeZonePicker value={timeZone} onChange={setTimeZone} />
        </Field>

        <div className="flex flex-col gap-2">
          <SectionLabel>WEEK STARTS ON</SectionLabel>
          <SegmentedControl
            label="Week starts on"
            value={String(weekStart) as '0' | '1'}
            onValueChange={(next) => setWeekStart(next === '0' ? 0 : 1)}
            options={WEEK_START_OPTIONS}
          />
          {errors.weekStart ? (
            <p role="alert" className="text-xs text-danger">
              {errors.weekStart}
            </p>
          ) : null}
        </div>

        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        ) : null}

        <Button type="submit" variant="primary" fullWidth loading={updateMe.isPending}>
          Save and continue
        </Button>
      </form>
    </main>
  );
}
