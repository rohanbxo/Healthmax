/**
 * Snooze rules (SPEC.md §6 "Actions", §9).
 *
 * A snooze is 15, 60 or 180 minutes **from now**, where "now" is the injected
 * clock — never `Date.now()` — and the day it belongs to is today in the user's
 * timezone, not the server's (SPEC.md §7.5). It replaces any existing snooze for
 * the habit, and it is **not** a log: nothing here touches the `Log` table, so
 * streaks and accuracy cannot move because somebody pressed Snooze.
 */
import { addMinutes, todayKey, type PutSnoozeBody, type SnoozeDTO } from '@beta/core';

import type { Clock } from '../../lib/clock';
import type { EventBus } from '../../events/bus';
import { toIsoInstant } from '../../lib/instant';
import { requireUserContext, type UserContextRepository } from '../shared/userContext';
import type { HabitRepository } from '../habits/repository';
import { requireOwnedHabitId } from '../habits/service';
import type { SnoozeRepository } from './repository';

export type SnoozeServiceDeps = {
  repository: SnoozeRepository;
  habits: HabitRepository;
  users: UserContextRepository;
  clock: Clock;
  eventBus: EventBus;
};

export interface SnoozeService {
  put(userId: string, habitId: string, body: PutSnoozeBody): Promise<SnoozeDTO>;
  remove(userId: string, habitId: string): Promise<void>;
}

export function createSnoozeService(deps: SnoozeServiceDeps): SnoozeService {
  return {
    async put(userId, habitId, body) {
      const user = await requireUserContext(deps.users, userId);
      await requireOwnedHabitId(deps.habits, userId, habitId);

      const now = deps.clock.now();
      const dayKey = todayKey(now, user.timeZone);
      const untilMs = addMinutes(now, body.minutes);

      await deps.repository.put({ userId, habitId, dayKey, untilMs });

      deps.eventBus.emit({ type: 'snooze.changed', userId, habitId, dayKey });
      return { habitId, dayKey, until: toIsoInstant(untilMs) };
    },

    async remove(userId, habitId) {
      await requireOwnedHabitId(deps.habits, userId, habitId);

      const removed = await deps.repository.remove(userId, habitId);
      // Nothing was snoozed, so there is no plan to rebuild.
      if (removed) deps.eventBus.emit({ type: 'snooze.changed', userId, habitId });
    },
  };
}
