/**
 * Test data factories. M4 and M5 flesh out habits, logs and snoozes; the user
 * factory exists now because almost every later test starts with one.
 */
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { PrismaClient, User } from '@prisma/client';

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
