/**
 * The habit form shared by `/habits/new` and `/habits/:id` (SPEC.md §11
 * "Screens").
 *
 * Name, schedule (Daily / Weekdays / Times per week) with weekday chips or a
 * count stepper, time, and the reminder toggle. Validation is the shared zod
 * contract from `@beta/core` — `createHabitBodySchema` on create,
 * `updateHabitBodySchema` on edit — so the client rejects exactly what the API
 * would, and the messages land inline through `Field`.
 */
import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  type CreateHabitBody,
  type HabitDTO,
  type Schedule,
  type ScheduleKind,
  createHabitBodySchema,
  updateHabitBodySchema,
} from '@beta/core';
import { Button, Field, Input, SectionLabel, SegmentedControl, Switch } from '@/components/ui';
import { fieldErrors } from '@/routes/form-utils';
import { cn } from '@/lib/utils';

type HabitField = 'name' | 'schedule' | 'time' | 'remind';

const SCHEDULE_OPTIONS: readonly { value: ScheduleKind; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'timesPerWeek', label: 'Times' },
];

/** Index 0 = Sunday, matching `Schedule.days` and `weekday()` (SPEC.md §5). */
const WEEKDAY_CHIPS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MIN_TIMES_PER_WEEK = 1;
const MAX_TIMES_PER_WEEK = 7;
const DEFAULT_TIME = '07:30';
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_COUNT = 3;

export type HabitFormProps = {
  mode: 'create' | 'edit';
  habit?: HabitDTO;
  submitLabel: string;
  pending?: boolean;
  /** A whole-form failure (a rejected request), shown above the submit button. */
  failure?: string | null;
  onSubmit: (body: CreateHabitBody) => void;
  /** Archive and Delete on the edit screen (SPEC.md §11). */
  children?: React.ReactNode;
};

export function HabitForm({
  mode,
  habit,
  submitLabel,
  pending = false,
  failure = null,
  onSubmit,
  children,
}: HabitFormProps): React.ReactElement {
  const [name, setName] = React.useState(habit?.name ?? '');
  const [kind, setKind] = React.useState<ScheduleKind>(habit?.schedule.kind ?? 'daily');
  const [days, setDays] = React.useState<number[]>(
    habit?.schedule.kind === 'weekdays' ? habit.schedule.days : DEFAULT_DAYS,
  );
  const [count, setCount] = React.useState<number>(
    habit?.schedule.kind === 'timesPerWeek' ? habit.schedule.count : DEFAULT_COUNT,
  );
  const [time, setTime] = React.useState(habit?.time ?? DEFAULT_TIME);
  const [remind, setRemind] = React.useState(habit?.remind ?? true);
  const [errors, setErrors] = React.useState<Partial<Record<HabitField, string>>>({});

  function currentSchedule(): Schedule {
    if (kind === 'weekdays') return { kind: 'weekdays', days };
    if (kind === 'timesPerWeek') return { kind: 'timesPerWeek', count };
    return { kind: 'daily' };
  }

  function toggleDay(day: number): void {
    setDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const candidate = { name, schedule: currentSchedule(), time, remind };

    if (mode === 'create') {
      const parsed = createHabitBodySchema.safeParse(candidate);
      if (!parsed.success) {
        setErrors(fieldErrors<HabitField>(parsed.error));
        return;
      }
      setErrors({});
      onSubmit(parsed.data);
      return;
    }

    const parsed = updateHabitBodySchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(fieldErrors<HabitField>(parsed.error));
      return;
    }

    setErrors({});
    // Every field is always sent from this form, so the optional shape of
    // `updateHabitBodySchema` is fully populated; the fallbacks only satisfy TS.
    onSubmit({
      name: parsed.data.name ?? name,
      schedule: parsed.data.schedule ?? currentSchedule(),
      time: parsed.data.time ?? time,
      remind: parsed.data.remind ?? remind,
    });
  }

  return (
    <form className="flex flex-col gap-5 pt-4" onSubmit={handleSubmit} noValidate>
      <Field label="Name" error={errors.name} required>
        <Input
          name="name"
          autoComplete="off"
          placeholder="Morning run"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <SectionLabel>SCHEDULE</SectionLabel>
        <SegmentedControl
          label="Schedule"
          value={kind}
          onValueChange={setKind}
          options={SCHEDULE_OPTIONS}
        />

        {kind === 'weekdays' ? (
          <div role="group" aria-label="Days of the week" className="flex gap-1.5 pt-1">
            {WEEKDAY_CHIPS.map((chip, index) => {
              const selected = days.includes(index);
              return (
                <button
                  key={WEEKDAY_NAMES[index]}
                  type="button"
                  aria-label={WEEKDAY_NAMES[index]}
                  aria-pressed={selected}
                  onClick={() => toggleDay(index)}
                  className={cn(
                    'h-11 flex-1 rounded-control border font-mono text-sm transition-colors',
                    selected
                      ? 'border-accent bg-accent text-base'
                      : 'border-border bg-card text-muted hover:text-text',
                  )}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        ) : null}

        {kind === 'timesPerWeek' ? (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-sm text-muted">Times per week</p>
            <div className="flex items-center gap-2">
              <Button
                size="iconSm"
                variant="outline"
                aria-label="Fewer times per week"
                disabled={count <= MIN_TIMES_PER_WEEK}
                onClick={() => setCount((value) => Math.max(MIN_TIMES_PER_WEEK, value - 1))}
              >
                <Minus aria-hidden="true" />
              </Button>
              <output aria-live="polite" className="w-8 text-center font-mono text-lg tabular-nums">
                {count}
              </output>
              <Button
                size="iconSm"
                variant="outline"
                aria-label="More times per week"
                disabled={count >= MAX_TIMES_PER_WEEK}
                onClick={() => setCount((value) => Math.min(MAX_TIMES_PER_WEEK, value + 1))}
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}

        {errors.schedule ? (
          <p role="alert" className="text-xs text-danger">
            {errors.schedule}
          </p>
        ) : null}
      </div>

      <Field label="Time" hint="When Beta shows it as due, in your time zone." error={errors.time}>
        <Input
          name="time"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </Field>

      <Field label="Reminder" hint="Send a notification when it is due." error={errors.remind}>
        <Switch checked={remind} onCheckedChange={setRemind} aria-label="Reminder" />
      </Field>

      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      ) : null}

      <Button type="submit" variant="primary" fullWidth loading={pending}>
        {submitLabel}
      </Button>

      {children}
    </form>
  );
}
