/**
 * Test data factories.
 *
 * The habit, log and snooze factories write straight to Postgres on purpose:
 * the API refuses to backdate `createdDayKey`, to log a future day or to keep a
 * stale snooze, and those are exactly the states a test needs to set up before
 * it can prove the rules (SPEC.md §6, §13).
 */
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type {
  Habit,
  Log,
  PrismaClient,
  PushSubscription,
  ReminderOccurrence,
  ReminderStatus,
  Snooze,
  User,
} from '@prisma/client';
import type { LogStatus, Schedule } from '@beta/core';

import { toDbInstant } from '../../src/lib/instant';

/** Argon2id is the default algorithm of this binding (SPEC.md §12). */
export const DEFAULT_TEST_PASSWORD = 'correct-horse-battery';

export type UserOverrides = {
  email?: string;
  password?: string;
  name?: string;
  timeZone?: string;
  weekStart?: number;
  onboarded?: boolean;
};

export type CreatedUser = { user: User; password: string };

/** Inserts a user with a real argon2id hash, so login tests are honest. */
export async function createUser(
  prisma: PrismaClient,
  overrides: UserOverrides = {},
): Promise<CreatedUser> {
  const password = overrides.password ?? DEFAULT_TEST_PASSWORD;
  const user = await prisma.user.create({
    data: {
      email: (overrides.email ?? `user-${randomUUID()}@example.com`).toLowerCase(),
      passwordHash: await hash(password),
      name: overrides.name ?? 'Test User',
      timeZone: overrides.timeZone ?? 'Asia/Dubai',
      weekStart: overrides.weekStart ?? 1,
      onboarded: overrides.onboarded ?? true,
    },
  });
  return { user, password };
}

export type HabitOverrides = {
  name?: string;
  schedule?: Schedule;
  time?: string;
  remind?: boolean;
  createdDayKey?: string;
  archived?: boolean;
  order?: number;
  /** Set to soft-delete the habit on creation (SPEC.md §8). */
  deletedAtMs?: number;
};

/** A habit owned by `userId`, including states the API will not create. */
export async function createHabit(
  prisma: PrismaClient,
  userId: string,
  overrides: HabitOverrides = {},
): Promise<Habit> {
  const schedule: Schedule = overrides.schedule ?? { kind: 'daily' };
  return prisma.habit.create({
    data: {
      userId,
      name: overrides.name ?? 'Test Habit',
      schedule: schedule as unknown as object,
      time: overrides.time ?? '07:30',
      remind: overrides.remind ?? true,
      createdDayKey: overrides.createdDayKey ?? '2026-01-01',
      archived: overrides.archived ?? false,
      order: overrides.order ?? 0,
      deletedAt: overrides.deletedAtMs === undefined ? null : toDbInstant(overrides.deletedAtMs),
    },
  });
}

/** A log row written behind the backfill rules, for read-model fixtures. */
export async function createLog(
  prisma: PrismaClient,
  args: { userId: string; habitId: string; dayKey: string; status?: LogStatus },
): Promise<Log> {
  return prisma.log.create({
    data: {
      userId: args.userId,
      habitId: args.habitId,
      dayKey: args.dayKey,
      status: args.status ?? 'done',
    },
  });
}

/** A pending reminder occurrence, as `reschedule-user` would have written it. */
export async function createReminder(
  prisma: PrismaClient,
  args: {
    userId: string;
    habitId: string;
    dayKey: string;
    fireAtMs: number;
    status?: ReminderStatus;
  },
): Promise<ReminderOccurrence> {
  return prisma.reminderOccurrence.create({
    data: {
      userId: args.userId,
      habitId: args.habitId,
      dayKey: args.dayKey,
      fireAt: toDbInstant(args.fireAtMs),
      status: args.status ?? 'pending',
    },
  });
}

/** A registered browser. `endpoint` is unique across all users (SPEC.md §8). */
export async function createPushSubscription(
  prisma: PrismaClient,
  args: { userId: string; endpoint?: string; failureCount?: number },
): Promise<PushSubscription> {
  return prisma.pushSubscription.create({
    data: {
      userId: args.userId,
      endpoint: args.endpoint ?? `https://push.example.com/${randomUUID()}`,
      p256dh: 'test-p256dh-key',
      auth: 'test-auth-key',
      failureCount: args.failureCount ?? 0,
    },
  });
}

/** A snooze row — `untilMs` may be in the past, which the API would never write. */
export async function createSnooze(
  prisma: PrismaClient,
  args: { userId: string; habitId: string; dayKey: string; untilMs: number },
): Promise<Snooze> {
  return prisma.snooze.create({
    data: {
      userId: args.userId,
      habitId: args.habitId,
      dayKey: args.dayKey,
      until: toDbInstant(args.untilMs),
    },
  });
}
