/**
 * Habit persistence (SPEC.md §3, §8 "Query rules").
 *
 * Every method takes `userId` and puts it in the `where` clause, and every
 * method also excludes soft-deleted rows. There is deliberately **no**
 * `findById(habitId)`: a habit can only ever be reached through its owner, so
 * another user's id is indistinguishable from one that does not exist and the
 * service can only answer 404 (SPEC.md §9).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Schedule } from '@beta/core';

import { toDbInstant } from '../../lib/instant';
import { HABIT_SELECT, writeSchedule, type HabitRow } from './dto';

export type HabitCreate = {
  name: string;
  schedule: Schedule;
  time: string;
  remind: boolean;
  createdDayKey: string;
  order: number;
};

export type HabitUpdate = {
  name?: string;
  schedule?: Schedule;
  time?: string;
  remind?: boolean;
  archived?: boolean;
  order?: number;
};

export interface HabitRepository {
  /** Live habits — archived included and flagged — ordered by `order`, then age. */
  listLive(userId: string): Promise<HabitRow[]>;
  /** One live habit belonging to `userId`, or `null`. */
  findOwned(userId: string, habitId: string): Promise<HabitRow | null>;
  /** Cheap existence check for routes that do not need the habit's fields. */
  ownsLiveHabit(userId: string, habitId: string): Promise<boolean>;
  create(userId: string, data: HabitCreate): Promise<HabitRow>;
  /** `null` when the habit is not this user's, or already soft-deleted. */
  update(userId: string, habitId: string, data: HabitUpdate): Promise<HabitRow | null>;
  /** Soft delete (SPEC.md §9). `false` when there was nothing live to delete. */
  softDelete(userId: string, habitId: string, nowMs: number): Promise<boolean>;
}

/** The JSON column is written through the zod contract, never raw. */
function scheduleValue(schedule: Schedule): Prisma.InputJsonValue {
  return writeSchedule(schedule) as unknown as Prisma.InputJsonValue;
}

/** `order` first, then insertion age as a stable tiebreaker (SPEC.md §9). */
const HABIT_ORDER = [{ order: 'asc' as const }, { createdAt: 'asc' as const }];

export function createHabitRepository(prisma: PrismaClient): HabitRepository {
  return {
    async listLive(userId) {
      return prisma.habit.findMany({
        where: { userId, deletedAt: null },
        orderBy: HABIT_ORDER,
        select: HABIT_SELECT,
      });
    },

    async findOwned(userId, habitId) {
      return prisma.habit.findFirst({
        where: { id: habitId, userId, deletedAt: null },
        select: HABIT_SELECT,
      });
    },

    async ownsLiveHabit(userId, habitId) {
      const row = await prisma.habit.findFirst({
        where: { id: habitId, userId, deletedAt: null },
        select: { id: true },
      });
      return row !== null;
    },

    async create(userId, data) {
      return prisma.habit.create({
        data: {
          userId,
          name: data.name,
          schedule: scheduleValue(data.schedule),
          time: data.time,
          remind: data.remind,
          createdDayKey: data.createdDayKey,
          order: data.order,
        },
        select: HABIT_SELECT,
      });
    },

    async update(userId, habitId, data) {
      // `updateMany` so ownership travels in the `where` clause: a habit that is
      // not this user's simply matches nothing.
      const result = await prisma.habit.updateMany({
        where: { id: habitId, userId, deletedAt: null },
        data: {
          ...(data.name === undefined ? {} : { name: data.name }),
          ...(data.schedule === undefined ? {} : { schedule: scheduleValue(data.schedule) }),
          ...(data.time === undefined ? {} : { time: data.time }),
          ...(data.remind === undefined ? {} : { remind: data.remind }),
          ...(data.archived === undefined ? {} : { archived: data.archived }),
          ...(data.order === undefined ? {} : { order: data.order }),
        },
      });
      if (result.count === 0) return null;
      return prisma.habit.findFirst({
        where: { id: habitId, userId, deletedAt: null },
        select: HABIT_SELECT,
      });
    },

    async softDelete(userId, habitId, nowMs) {
      // Soft delete, so logs and reminder history stay intact (SPEC.md §8) while
      // every read filters the habit out.
      const result = await prisma.habit.updateMany({
        where: { id: habitId, userId, deletedAt: null },
        data: { deletedAt: toDbInstant(nowMs) },
      });
      return result.count > 0;
    },
  };
}
