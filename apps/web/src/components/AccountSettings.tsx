/**
 * Name, time zone and week start, saved as you type (SPEC.md §11 "Settings":
 * auto-save, debounced 500ms).
 *
 * There is no Save button, so the screen has to say what it is doing: the
 * status line moves between "Saving…", "Saved" and a failure, and it is a live
 * region so a screen reader hears it without the focus moving.
 *
 * A timezone or week-start change moves every due instant and every reminder
 * (SPEC.md §6 "Timezone change"); `useUpdateMe` drops the reads that depend on
 * them, and the API rebuilds the reminder plan.
 */
import * as React from 'react';
import { type MeDTO, type PatchMeBody, type WeekStart, patchMeBodySchema } from '@beta/core';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import { Field, Input, SectionLabel, SegmentedControl } from '@/components/ui';
import { useUpdateMe } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';

/** SPEC.md §11: 500ms. */
export const AUTOSAVE_DELAY_MS = 500;

const WEEK_START_OPTIONS = [
  { value: '0' as const, label: 'Sunday' },
  { value: '1' as const, label: 'Monday' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const STATUS_TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Not saved',
};

export function AccountSettings(): React.ReactElement {
  const { me, setMe } = useAuth();
  const updateMe = useUpdateMe();

  const [name, setName] = React.useState(me?.name ?? '');
  const [timeZone, setTimeZone] = React.useState(me?.timeZone ?? 'UTC');
  const [weekStart, setWeekStart] = React.useState<WeekStart>(me?.weekStart ?? 1);
  const [state, setState] = React.useState<SaveState>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const save = React.useCallback(
    (patch: PatchMeBody) => {
      if (timer.current !== null) clearTimeout(timer.current);
      setState('saving');
      setError(null);

      timer.current = setTimeout(() => {
        const parsed = patchMeBodySchema.safeParse(patch);
        if (!parsed.success) {
          setState('failed');
          setError(parsed.error.issues[0]?.message ?? 'That value is not allowed.');
          return;
        }

        updateMe.mutate(parsed.data, {
          onSuccess: (updated: MeDTO) => {
            setMe(updated);
            setState('saved');
          },
          onError: () => {
            setState('failed');
            setError('We could not save that. Check your connection.');
          },
        });
      }, AUTOSAVE_DELAY_MS);
    },
    [setMe, updateMe],
  );

  return (
    <section className="flex flex-col gap-2" aria-label="Account">
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel>ACCOUNT</SectionLabel>
        <span
          role="status"
          aria-live="polite"
          className={`section-label ${state === 'failed' ? 'text-danger' : 'text-muted'}`}
        >
          {STATUS_TEXT[state]}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Name" error={state === 'failed' ? (error ?? undefined) : undefined}>
          <Input
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              save({ name: event.target.value });
            }}
          />
        </Field>

        <Field label="Time zone" hint="Due times and reminders follow this zone.">
          <TimeZonePicker
            value={timeZone}
            onChange={(next) => {
              setTimeZone(next);
              save({ timeZone: next });
            }}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <SectionLabel>WEEK STARTS ON</SectionLabel>
          <SegmentedControl
            label="Week starts on"
            value={String(weekStart) as '0' | '1'}
            onValueChange={(next) => {
              const value: WeekStart = next === '0' ? 0 : 1;
              setWeekStart(value);
              save({ weekStart: value });
            }}
            options={WEEK_START_OPTIONS}
          />
        </div>
      </div>
    </section>
  );
}
