/**
 * Log persistence (SPEC.md §3, §8 "Query rules").
 *
 * `userId` is denormalised onto `Log` precisely so a range read is one indexed
 * query scoped to the caller, and so every write can carry the owner in its
 * `where` clause instead of trusting the `(habitId, dayKey)` primary key alone.
 *
 * Reads also join to `Habit` to exclude soft-deleted habits: deleting a habit
 * keeps its rows for reminder history, but they must not come back through
 * `/logs` or `/today` (SPEC.md §8, §9).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { LogStatus } from '@beta/core';

import { LOG_SELECT, type LogRow } from './dto';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

export type LogRangeQuery = {
  from: string;
  to: string;
  habitId?: string | undefined;
};

export type LogWrite = {
  userId: string;
  habitId: string;
  dayKey: string;
  status: LogStatus;
};

export interface LogRepository {
  /** Every log in `[from, to]` for live habits, oldest first. One query. */
  listRange(userId: string, query: LogRangeQuery): Promise<LogRow[]>;
  /**
   * Idempotent upsert of one log, which also clears that day's snooze in the
   * same transaction (SPEC.md §6 "Actions": completing or skipping ends the
   * snooze). Returns whether a snooze was actually removed.
   */
  put(write: LogWrite): Promise<{ snoozeCleared: boolean }>;
  /** Idempotent delete. `false` when there was no log to remove. */
  remove(userId: string, habitId: string, dayKey: string): Promise<boolean>;
}

export function createLogRepository(prisma: PrismaClient): LogRepository {
  /**
   * `update … else insert` rather than `upsert`, because Prisma's `upsert` can
   * only match the `(habitId, dayKey)` primary key and would drop `userId` from
   * the `where` clause.
   */
  async function write(data: LogWrite): Promise<{ snoozeCleared: boolean }> {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.log.updateMany({
        where: { habitId: data.habitId, userId: data.userId, dayKey: data.dayKey },
        data: { status: data.status },
      });
      if (updated.count === 0) {
        await tx.log.create({
          data: {
            habitId: data.habitId,
            userId: data.userId,
            dayKey: data.dayKey,
            status: data.status,
          },
        });
      }
      const snooze = await tx.snooze.deleteMany({
        where: { habitId: data.habitId, userId: data.userId, dayKey: data.dayKey },
      });
      return { snoozeCleared: snooze.count > 0 };
    });
  }

  return {
    async listRange(userId, query) {
      // `dayKey` is 'YYYY-MM-DD', so a lexicographic range is a calendar range.
      return prisma.log.findMany({
        where: {
          userId,
          dayKey: { gte: query.from, lte: query.to },
          ...(query.habitId === undefined ? {} : { habitId: query.habitId }),
          habit: { deletedAt: null },
        },
        orderBy: [{ dayKey: 'asc' }, { habitId: 'asc' }],
        select: LOG_SELECT,
      });
    },

    async put(data) {
      try {
        return await write(data);
      } catch (err) {
        // Two taps landing at once: the loser of the insert race retries, and
        // the second attempt takes the update branch.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
          return write(data);
        }
        throw err;
      }
    },

    async remove(userId, habitId, dayKey) {
      const result = await prisma.log.deleteMany({ where: { userId, habitId, dayKey } });
      return result.count > 0;
    },
  };
}
