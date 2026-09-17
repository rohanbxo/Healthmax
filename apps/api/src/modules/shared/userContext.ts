/**
 * The three user columns every M5 route needs before it can talk about days:
 * the id, the IANA timezone and the week start (SPEC.md §7.5 — "the server
 * never uses its own timezone").
 *
 * It lives outside `modules/me` because habits, logs, snoozes and the Today
 * read model all need it, and none of them should reach into another module's
 * repository. The query is keyed by `userId`, like every other repository call
 * (SPEC.md §8 "Query rules").
 */
import type { PrismaClient } from '@prisma/client';
import type { WeekStart } from '@beta/core';

import { notFound } from '../../http/errors';
import { toWeekStart } from '../me/dto';

export type UserContext = {
  id: string;
  timeZone: string;
  weekStart: WeekStart;
};

export interface UserContextRepository {
  findContext(userId: string): Promise<UserContext | null>;
}

export function createUserContextRepository(prisma: PrismaClient): UserContextRepository {
  return {
    async findContext(userId) {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, timeZone: true, weekStart: true },
      });
      if (!row) return null;
      return { id: row.id, timeZone: row.timeZone, weekStart: toWeekStart(row.weekStart) };
    },
  };
}

/**
 * The caller's context, or 404. An access token can outlive the account it
 * names; that reads as "gone", never as a 500 (SPEC.md §9).
 */
export async function requireUserContext(
  repository: UserContextRepository,
  userId: string,
): Promise<UserContext> {
  const context = await repository.findContext(userId);
  if (!context) throw notFound('Account not found.');
  return context;
}
