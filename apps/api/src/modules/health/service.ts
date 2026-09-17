/**
 * Health checks (SPEC.md §9): Postgres `SELECT 1` and Redis `PING`.
 *
 * Business logic lives in the service; the controller only shapes the response
 * (SPEC.md §3 "API layering").
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Clock } from '../../lib/clock';

export type CheckResult = {
  ok: boolean;
  latencyMs: number;
  /** Present only when the check failed; never a driver stack trace. */
  error?: string;
};

export type HealthReport = {
  status: 'ok' | 'degraded';
  checks: { database: CheckResult; redis: CheckResult };
};

export type HealthServiceDeps = {
  prisma: PrismaClient;
  redis: Redis;
  clock: Clock;
};

export interface HealthService {
  check(): Promise<HealthReport>;
}

/** Runs `probe`, timing it and turning any rejection into a short reason. */
async function timed(clock: Clock, probe: () => Promise<unknown>): Promise<CheckResult> {
  const startedAt = clock.now();
  try {
    await probe();
    return { ok: true, latencyMs: Math.max(0, clock.now() - startedAt) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.max(0, clock.now() - startedAt),
      error: err instanceof Error ? err.name : 'unknown error',
    };
  }
}

export function createHealthService(deps: HealthServiceDeps): HealthService {
  return {
    async check(): Promise<HealthReport> {
      const [database, redis] = await Promise.all([
        timed(deps.clock, () => deps.prisma.$queryRaw`SELECT 1`),
        timed(deps.clock, () => deps.redis.ping()),
      ]);
      return {
        status: database.ok && redis.ok ? 'ok' : 'degraded',
        checks: { database, redis },
      };
    },
  };
}
