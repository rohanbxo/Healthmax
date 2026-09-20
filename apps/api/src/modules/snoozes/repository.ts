/**
 * Snooze persistence (SPEC.md §3, §8 "Query rules").
 *
 * One row per habit (`Snooze.habitId` is the primary key), so "replaces any
 * existing snooze" is an update, not an insert. Like every other repository
 * here, each statement carries `userId` in its `where` clause rather than
 * trusting a key the caller supplied.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { fromDbInstant, toDbInstant } from '../../lib/instant';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

export type SnoozeRow = {
  habitId: string;
  dayKey: string;
  /** Epoch milliseconds; the `Date` stays behind `lib/instant.ts`. */
  untilMs: number;
};

export type SnoozeWrite = {
  userId: string;
  habitId: string;
  dayKey: string;
  untilMs: number;
};

export interface SnoozeRepository {
  /** Live snoozes (`until > now`) on live habits. One query, for `/today`. */
  listLive(userId: string, nowMs: number): Promise<SnoozeRow[]>;
  /** Creates or replaces the habit's snooze. */
  put(write: SnoozeWrite): Promise<void>;
  /** Idempotent delete. `false` when the habit had no snooze. */
  remove(userId: string, habitId: string): Promise<boolean>;
}

export function createSnoozeRepository(prisma: PrismaClient): SnoozeRepository {
  async function write(data: SnoozeWrite): Promise<void> {
    const until = toDbInstant(data.untilMs);
    const updated = await prisma.snooze.updateMany({
      where: { habitId: data.habitId, userId: data.userId },
      data: { dayKey: data.dayKey, until },
    });
    if (updated.count > 0) return;
    await prisma.snooze.create({
      data: { habitId: data.habitId, userId: data.userId, dayKey: data.dayKey, until },
    });
  }

  return {
    async listLive(userId, nowMs) {
      const rows = await prisma.snooze.findMany({
        where: { userId, until: { gt: toDbInstant(nowMs) }, habit: { deletedAt: null } },
        select: { habitId: true, dayKey: true, until: true },
      });
      return rows.map((row) => ({
        habitId: row.habitId,
        dayKey: row.dayKey,
        untilMs: fromDbInstant(row.until),
      }));
    },

    async put(data) {
      try {
        await write(data);
      } catch (err) {
        // Two snoozes at once: the loser of the insert race retries into the
        // update branch, so the later one still wins.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === PRISMA_UNIQUE_VIOLATION
        ) {
          await write(data);
          return;
        }
        throw err;
      }
    },

    async remove(userId, habitId) {
      const result = await prisma.snooze.deleteMany({ where: { userId, habitId } });
      return result.count > 0;
    },
  };
}
