/**
 * `HabitDTO` projection (SPEC.md §5) and the zod gate on the `schedule` JSON
 * column (SPEC.md §8: "validated with zod on every read and write").
 *
 * The column is `Json`, so Postgres will happily hold whatever a migration, a
 * psql session or a future bug puts there. Nothing downstream — neither
 * `@beta/core`'s rules nor the web client — is written to survive that, so the
 * shape is re-parsed on the way out of Prisma and on the way in. A row that
 * fails the parse is reported as unreadable rather than thrown as a `TypeError`
 * halfway through a response.
 */
import { scheduleDtoSchema, type HabitDTO, type Schedule } from '@beta/core';

/** The columns `HabitDTO` needs — narrower than the Prisma `Habit` row. */
export type HabitRow = {
  id: string;
  name: string;
  /** `Prisma.JsonValue`; only {@link readSchedule} may interpret it. */
  schedule: unknown;
  time: string;
  remind: boolean;
  createdDayKey: string;
  archived: boolean;
  order: number;
};

/** The exact `select` that produces a {@link HabitRow} (SPEC.md §8). */
export const HABIT_SELECT = {
  id: true,
  name: true,
  schedule: true,
  time: true,
  remind: true,
  createdDayKey: true,
  archived: true,
  order: true,
} as const;

/** The stored JSON as a `Schedule`, or `null` when the row is not readable. */
export function readSchedule(value: unknown): Schedule | null {
  const parsed = scheduleDtoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Write-side validation: the normalised shape that goes into the JSON column.
 * Throws if a service ever builds a schedule the DTO contract would reject,
 * which is a bug here and not something a client can trigger.
 */
export function writeSchedule(schedule: Schedule): Schedule {
  return scheduleDtoSchema.parse(schedule);
}

/** A row as the wire contract sees it, or `null` when its schedule is corrupt. */
export function toHabitDto(row: HabitRow): HabitDTO | null {
  const schedule = readSchedule(row.schedule);
  if (schedule === null) return null;
  return {
    id: row.id,
    name: row.name,
    schedule,
    time: row.time,
    remind: row.remind,
    createdDayKey: row.createdDayKey,
    archived: row.archived,
    order: row.order,
  };
}

/**
 * List projection. An unreadable row is dropped instead of failing the whole
 * response: one hand-edited row must not take `/habits` and `/today` down with
 * it. Single-habit routes are stricter — see `requireOwnedHabit`.
 */
export function toHabitDtos(rows: HabitRow[]): HabitDTO[] {
  const habits: HabitDTO[] = [];
  for (const row of rows) {
    const dto = toHabitDto(row);
    if (dto !== null) habits.push(dto);
  }
  return habits;
}
