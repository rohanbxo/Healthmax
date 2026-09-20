/**
 * Export and import persistence (SPEC.md §9 "Push, export, health, docs").
 *
 * Import is a **replace**: everything the user has goes, and the file's
 * contents take its place, in one transaction. A partial import would be worse
 * than none — the user would be left with neither their old data nor their new
 * data — so every statement runs inside `$transaction` and any failure, down to
 * a log naming a habit the file never defined, rolls the whole thing back.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { HabitDTO, LogDTO } from '@beta/core';

import { HABIT_SELECT, writeSchedule, type HabitRow } from '../habits/dto';
import { LOG_SELECT, type LogRow } from '../logs/dto';

export type TransferSnapshot = { habits: HabitRow[]; logs: LogRow[] };

export interface TransferRepository {
  /** Everything the user owns, live habits only, oldest first. */
  snapshot(userId: string): Promise<TransferSnapshot>;
  /** Replaces the user's habits and logs with `data`, atomically. */
  replace(userId: string, data: { habits: HabitDTO[]; logs: LogDTO[] }): Promise<void>;
}

export function createTransferRepository(prisma: PrismaClient): TransferRepository {
  return {
    async snapshot(userId) {
      const [habits, logs] = await Promise.all([
        prisma.habit.findMany({
          where: { userId, deletedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: HABIT_SELECT,
        }),
        prisma.log.findMany({
          where: { userId, habit: { deletedAt: null } },
          orderBy: [{ dayKey: 'asc' }, { habitId: 'asc' }],
          select: LOG_SELECT,
        }),
      ]);
      return { habits, logs };
    },

    async replace(userId, data) {
      await prisma.$transaction(async (tx) => {
        // Habits cascade to logs, snoozes and reminder occurrences (SPEC.md §8),
        // so this clears everything derived from them too.
        await tx.habit.deleteMany({ where: { userId } });
        await tx.log.deleteMany({ where: { userId } });

        /**
         * A habit id is unique across the whole table, so a file exported from
         * one account cannot be imported into another as-is. The caller's own
         * rows are gone by now, so anything still holding one of these ids
         * belongs to somebody else: give those habits fresh ids and carry the
         * rename into the logs. Ids that are free — the round-trip case, where
         * the file came from this very account — are kept, so re-importing your
         * own export gives you back exactly what you exported.
         */
        const taken = await tx.habit.findMany({
          where: { id: { in: data.habits.map((habit) => habit.id) } },
          select: { id: true },
        });
        const renamed = new Map(taken.map((row) => [row.id, randomUUID()]));
        const idFor = (id: string): string => renamed.get(id) ?? id;

        if (data.habits.length > 0) {
          await tx.habit.createMany({
            data: data.habits.map((habit) => ({
              id: idFor(habit.id),
              userId,
              name: habit.name,
              schedule: writeSchedule(habit.schedule) as unknown as object,
              time: habit.time,
              remind: habit.remind,
              createdDayKey: habit.createdDayKey,
              archived: habit.archived,
              order: habit.order,
            })),
          });
        }

        if (data.logs.length > 0) {
          // A log naming a habit the file did not define violates the foreign
          // key, which aborts the transaction — exactly the intent.
          await tx.log.createMany({
            data: data.logs.map((log) => ({
              userId,
              habitId: idFor(log.habitId),
              dayKey: log.dayKey,
              status: log.status,
            })),
          });
        }
      });
    },
  };
}
