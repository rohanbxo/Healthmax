/**
 * Reminder occurrence persistence (SPEC.md §8, §10).
 *
 * Unlike every other repository here, the dispatcher's reads are deliberately
 * **not** scoped to one user: a dispatch batch serves whoever is due in the
 * next minute. Nothing in this file is reachable from an HTTP route — the
 * routes never touch occurrences — so there is no id a caller could supply.
 *
 * The claim is the one raw query in the codebase (SPEC.md §12), written as a
 * tagged template so every value is a bound parameter. `FOR UPDATE SKIP
 * LOCKED` is what lets two dispatchers run at once without ever selecting the
 * same row, and the `UPDATE … RETURNING` makes claiming and marking one
 * statement, so a crash cannot leave a row claimed but unmarked.
 */
import type { PrismaClient } from '@prisma/client';
import type { PlannedReminder, Schedule } from '@beta/core';

import { fromDbInstant, toDbInstant } from '../../lib/instant';
import { readSchedule } from '../habits/dto';

/** SPEC.md §10.4: at most 200 occurrences per claim. */
export const DISPATCH_BATCH_SIZE = 200;

/** SPEC.md §10: `extend-windows` walks users in batches of 500. */
export const EXTEND_BATCH_SIZE = 500;

export type ReminderRow = {
  id: string;
  userId: string;
  habitId: string;
  dayKey: string;
  fireAtMs: number;
};

/** What the dispatcher needs to decide whether an occurrence still deserves to fire. */
export type DispatchContext = {
  habits: Map<
    string,
    { id: string; name: string; time: string; schedule: Schedule; timeZone: string }
  >;
  /** `habitId|dayKey` for every pair that already has a log. */
  logged: Set<string>;
};

export const pairKey = (habitId: string, dayKey: string): string => `${habitId}|${dayKey}`;

type RawRow = {
  id: string;
  userId: string;
  habitId: string;
  dayKey: string;
  fireAt: Date;
};

export interface ReminderRepository {
  /**
   * Replaces the user's `pending` occurrences with `planned`, in one
   * transaction (SPEC.md §10.3). Days already sent keep their row: the unique
   * `(habitId, dayKey)` means a duplicate is skipped rather than re-notified.
   */
  replacePending(userId: string, planned: PlannedReminder[]): Promise<number>;
  listPending(userId: string): Promise<ReminderRow[]>;
  /** Atomically claims and marks due rows as sent (SPEC.md §10.4). */
  claimDue(nowMs: number, limit?: number): Promise<ReminderRow[]>;
  /** For rows that were claimed but must not be sent after all. */
  markCancelled(ids: string[]): Promise<void>;
  contextFor(rows: ReminderRow[]): Promise<DispatchContext>;
  /** Ids of users with at least one live, reminding habit, oldest id first. */
  listUserIdsWithReminders(afterUserId: string | null, limit: number): Promise<string[]>;
}

export function createReminderRepository(prisma: PrismaClient): ReminderRepository {
  const toRow = (row: RawRow): ReminderRow => ({
    id: row.id,
    userId: row.userId,
    habitId: row.habitId,
    dayKey: row.dayKey,
    fireAtMs: fromDbInstant(row.fireAt),
  });

  return {
    async replacePending(userId, planned) {
      return prisma.$transaction(async (tx) => {
        await tx.reminderOccurrence.deleteMany({ where: { userId, status: 'pending' } });
        if (planned.length === 0) return 0;
        const result = await tx.reminderOccurrence.createMany({
          data: planned.map((entry) => ({
            userId,
            habitId: entry.habitId,
            dayKey: entry.dayKey,
            fireAt: toDbInstant(entry.fireAt),
          })),
          skipDuplicates: true,
        });
        return result.count;
      });
    },

    async listPending(userId) {
      const rows = await prisma.reminderOccurrence.findMany({
        where: { userId, status: 'pending' },
        orderBy: [{ fireAt: 'asc' }, { habitId: 'asc' }],
        select: { id: true, userId: true, habitId: true, dayKey: true, fireAt: true },
      });
      return rows.map(toRow);
    },

    async claimDue(nowMs, limit = DISPATCH_BATCH_SIZE) {
      const now = toDbInstant(nowMs);
      const rows = await prisma.$queryRaw<RawRow[]>`
        UPDATE "ReminderOccurrence"
        SET status = 'sent'::"ReminderStatus", "sentAt" = ${now}
        WHERE id IN (
          SELECT id FROM "ReminderOccurrence"
          WHERE status = 'pending'::"ReminderStatus" AND "fireAt" <= ${now}
          ORDER BY "fireAt"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "userId", "habitId", "dayKey", "fireAt"`;
      return rows.map(toRow);
    },

    async markCancelled(ids) {
      if (ids.length === 0) return;
      await prisma.reminderOccurrence.updateMany({
        where: { id: { in: ids } },
        data: { status: 'cancelled', sentAt: null },
      });
    },

    async contextFor(rows) {
      const habitIds = [...new Set(rows.map((row) => row.habitId))];
      const habits: DispatchContext['habits'] = new Map();
      const logged = new Set<string>();
      if (habitIds.length === 0) return { habits, logged };

      const [habitRows, logRows] = await Promise.all([
        prisma.habit.findMany({
          // A habit the user deleted, archived or silenced since planning is
          // simply absent here, and the dispatcher cancels its occurrence.
          where: { id: { in: habitIds }, deletedAt: null, archived: false, remind: true },
          select: {
            id: true,
            name: true,
            time: true,
            schedule: true,
            user: { select: { timeZone: true } },
          },
        }),
        prisma.log.findMany({
          where: { OR: rows.map((row) => ({ habitId: row.habitId, dayKey: row.dayKey })) },
          select: { habitId: true, dayKey: true },
        }),
      ]);

      for (const habit of habitRows) {
        const schedule = readSchedule(habit.schedule);
        if (schedule === null) continue; // Unreadable schedule: nothing to fire.
        habits.set(habit.id, {
          id: habit.id,
          name: habit.name,
          time: habit.time,
          schedule,
          timeZone: habit.user.timeZone,
        });
      }
      for (const log of logRows) logged.add(pairKey(log.habitId, log.dayKey));

      return { habits, logged };
    },

    async listUserIdsWithReminders(afterUserId, limit) {
      // `groupBy` rather than `distinct`, so the database does the grouping and
      // `take` limits users rather than habit rows.
      const rows = await prisma.habit.groupBy({
        by: ['userId'],
        where: {
          deletedAt: null,
          archived: false,
          remind: true,
          ...(afterUserId === null ? {} : { userId: { gt: afterUserId } }),
        },
        orderBy: { userId: 'asc' },
        take: limit,
      });
      return rows.map((row) => row.userId);
    },
  };
}
