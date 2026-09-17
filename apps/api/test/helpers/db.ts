/**
 * Test isolation for the two real backing services (SPEC.md §13: API tests run
 * against real Postgres and Redis).
 *
 * Postgres: one `TRUNCATE ... RESTART IDENTITY CASCADE` over every application
 * table. Redis: `FLUSHDB` on the dedicated test database index.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

let truncateStatement: string | undefined;

async function buildTruncateStatement(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const tables = rows.map((row) => `"public"."${row.tablename}"`);
  if (tables.length === 0) {
    throw new Error('No tables found in the test database — did `prisma migrate reset` run?');
  }
  return `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`;
}

/** Empties every application table in one statement. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  truncateStatement ??= await buildTruncateStatement(prisma);
  await prisma.$executeRawUnsafe(truncateStatement);
}

/** Empties the test Redis database (rate-limit counters, caches, queues). */
export async function resetRedis(redis: Redis): Promise<void> {
  await redis.flushdb();
}
