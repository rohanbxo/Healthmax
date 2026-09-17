/**
 * Habit rules (SPEC.md §9 "Habits, logs, snoozes", §6 "Scheduling").
 *
 * What actually happens here, beyond passing data along:
 *  - `createdDayKey` is computed from the injected clock and the *user's*
 *    timezone. The client never sends it, so it cannot backdate a habit to
 *    widen its own backfill window (SPEC.md §6 "Actions", §12).
 *  - deletion is a soft delete, so logs and reminder history survive while every
 *    read filters the habit out (SPEC.md §8).
 *  - every successful write emits `habit.changed`; M9 turns that into a
 *    deduplicated `reschedule-user` job (SPEC.md §10).
 */
import {
  todayKey,
  type CreateHabitBody,
  type HabitDTO,
  type UpdateHabitBody,
} from '@beta/core';

import type { Clock } from '../../lib/clock';
import type { EventBus } from '../../events/bus';
import { notFound, unprocessable } from '../../http/errors';
import {
  requireUserContext,
  type UserContextRepository,
} from '../shared/userContext';
import { toHabitDto, toHabitDtos } from './dto';
import type { HabitRepository } from './repository';

export type HabitServiceDeps = {
  repository: HabitRepository;
  users: UserContextRepository;
  clock: Clock;
  eventBus: EventBus;
};

export interface HabitService {
  list(userId: string): Promise<HabitDTO[]>;
  create(userId: string, body: CreateHabitBody): Promise<HabitDTO>;
  update(userId: string, habitId: string, body: UpdateHabitBody): Promise<HabitDTO>;
  remove(userId: string, habitId: string): Promise<void>;
}

export const HABIT_NOT_FOUND = 'Habit not found.';

/**
 * A row whose `schedule` JSON no longer parses (hand-edited, or written by an
 * older shape) cannot be turned into a `HabitDTO` and cannot be reasoned about
 * by `@beta/core`. Answering 422 keeps the failure honest and local: the list
 * routes still work, and a `PATCH` carrying a valid `schedule` repairs the row.
 */
const UNREADABLE_SCHEDULE =
  "This habit's schedule is stored in a form the server cannot read. PATCH the habit with a valid schedule to repair it.";

/**
 * The one way habits are loaded for a single-habit route. Shared with the logs
 * and snoozes services so the ownership check exists in exactly one place
 * (SPEC.md §8: no repository method loads a habit by id alone).
 */
export async function requireOwnedHabit(
  repository: HabitRepository,
  userId: string,
  habitId: string,
): Promise<HabitDTO> {
  const row = await repository.findOwned(userId, habitId);
  if (!row) throw notFound(HABIT_NOT_FOUND);
  const habit = toHabitDto(row);
  if (habit === null) throw unprocessable(UNREADABLE_SCHEDULE);
  return habit;
}

/** Ownership only, for routes that never look at the habit's fields. */
export async function requireOwnedHabitId(
  repository: HabitRepository,
  userId: string,
  habitId: string,
): Promise<void> {
  if (!(await repository.ownsLiveHabit(userId, habitId))) throw notFound(HABIT_NOT_FOUND);
}

export function createHabitService(deps: HabitServiceDeps): HabitService {
  return {
    async list(userId) {
      return toHabitDtos(await deps.repository.listLive(userId));
    },

    async create(userId, body) {
      const user = await requireUserContext(deps.users, userId);
      const row = await deps.repository.create(userId, {
        name: body.name,
        schedule: body.schedule,
        time: body.time,
        remind: body.remind ?? true,
        // SPEC.md §9: the server sets this, in the user's timezone.
        createdDayKey: todayKey(deps.clock.now(), user.timeZone),
        order: body.order ?? 0,
      });
      const habit = toHabitDto(row);
      if (habit === null) throw unprocessable(UNREADABLE_SCHEDULE);

      deps.eventBus.emit({ type: 'habit.changed', userId, habitId: habit.id });
      return habit;
    },

    async update(userId, habitId, body) {
      const row = await deps.repository.update(userId, habitId, body);
      if (!row) throw notFound(HABIT_NOT_FOUND);
      const habit = toHabitDto(row);
      if (habit === null) throw unprocessable(UNREADABLE_SCHEDULE);

      deps.eventBus.emit({ type: 'habit.changed', userId, habitId });
      return habit;
    },

    async remove(userId, habitId) {
      const deleted = await deps.repository.softDelete(userId, habitId, deps.clock.now());
      if (!deleted) throw notFound(HABIT_NOT_FOUND);

      deps.eventBus.emit({ type: 'habit.changed', userId, habitId });
    },
  };
}
