/**
 * Account rules (SPEC.md §9 "Account", §6 "Timezone change").
 *
 * The one piece of real behaviour here: changing `timeZone` or `weekStart`
 * changes which instants habits are due at, so it emits `user.scheduleChanged`
 * and M9 turns that into a `reschedule-user` job (SPEC.md §10 step 1).
 */
import { verify as argon2Verify } from '@node-rs/argon2';
import type { DeleteMeBody, MeDTO, PatchMeBody } from '@beta/core';

import type { EventBus } from '../../events/bus';
import { notFound, unprocessable } from '../../http/errors';
import { toMeDto, type MeRow } from './dto';
import type { MeRepository } from './repository';

export type MeServiceDeps = {
  repository: MeRepository;
  eventBus: EventBus;
};

export interface MeService {
  get(userId: string): Promise<MeDTO>;
  patch(userId: string, body: PatchMeBody): Promise<MeDTO>;
  remove(userId: string, body: DeleteMeBody): Promise<void>;
}

/** A token can outlive the account it names; that reads as "gone", not "denied". */
const ACCOUNT_GONE = 'Account not found.';

/**
 * True when the patch actually moves the schedule. A no-op write (`timeZone`
 * set to the value it already had) must not wake the reminder planner.
 */
function schedulingChanged(current: MeRow, body: PatchMeBody): boolean {
  if (body.timeZone !== undefined && body.timeZone !== current.timeZone) return true;
  if (body.weekStart !== undefined && body.weekStart !== current.weekStart) return true;
  return false;
}

async function passwordMatches(digest: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(digest, password);
  } catch {
    return false;
  }
}

export function createMeService(deps: MeServiceDeps): MeService {
  return {
    async get(userId) {
      const user = await deps.repository.findById(userId);
      if (!user) throw notFound(ACCOUNT_GONE);
      return toMeDto(user);
    },

    async patch(userId, body) {
      const current = await deps.repository.findById(userId);
      if (!current) throw notFound(ACCOUNT_GONE);

      const shouldReschedule = schedulingChanged(current, body);
      const updated = await deps.repository.update(userId, body);
      if (!updated) throw notFound(ACCOUNT_GONE);

      if (shouldReschedule) {
        deps.eventBus.emit({ type: 'user.scheduleChanged', userId });
      }
      return toMeDto(updated);
    },

    async remove(userId, body) {
      const digest = await deps.repository.findPasswordHash(userId);
      if (digest === null) throw notFound(ACCOUNT_GONE);
      // SPEC.md §9: deleting the account takes a password confirmation, so a
      // stolen access token alone cannot destroy someone's history.
      //
      // `UNPROCESSABLE`, not `UNAUTHENTICATED`: the caller's token is perfectly
      // good, they simply typed the wrong password. A 401 here is
      // indistinguishable from an expired session, and the web client answers
      // that by signing the user out — so a typo would log you out instead of
      // telling you it was a typo.
      if (!(await passwordMatches(digest, body.password))) {
        throw unprocessable('Password is incorrect.', [
          { path: 'body.password', message: 'Password is incorrect.' },
        ]);
      }
      // Habits, logs, snoozes, tokens and subscriptions go with it through
      // `onDelete: Cascade` (SPEC.md §8).
      await deps.repository.deleteById(userId);
    },
  };
}
