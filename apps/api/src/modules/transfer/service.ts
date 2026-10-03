/**
 * Export and import (SPEC.md §9).
 *
 * The export is the user's own data, in the same DTO shapes the API serves
 * everywhere else, so an import is just an export handed back. `me` travels
 * with it for context but is never written on import: the file cannot change
 * who you are, or move data between accounts (SPEC.md §12).
 *
 * Cloud export is the same file, uploaded to the export bucket instead of
 * streamed back, and answered with a short-lived presigned link to it.
 */
import { randomUUID } from 'node:crypto';
import type { ExportDTO, ImportBody } from '@beta/core';

import type { Clock } from '../../lib/clock';
import type { ObjectStore } from '../../lib/objectStore';
import { toIsoInstant } from '../../lib/instant';
import { unprocessable } from '../../http/errors';
import { toHabitDtos } from '../habits/dto';
import { toLogDto } from '../logs/dto';
import type { EventBus } from '../../events/bus';
import type { MeRepository } from '../me/repository';
import { toMeDto } from '../me/dto';
import { notFound } from '../../http/errors';
import type { TransferRepository } from './repository';

export type TransferServiceDeps = {
  repository: TransferRepository;
  users: MeRepository;
  clock: Clock;
  eventBus: EventBus;
  /** `undefined` when no export bucket is configured: cloud export is off. */
  objectStore: ObjectStore | undefined;
  /** Lifetime of a presigned cloud-export link (`EXPORT_URL_TTL_SECONDS`). */
  exportUrlTtlSeconds: number;
};

/** What `POST /export/cloud` answers with. */
export type CloudExportDTO = {
  /** Presigned GET straight to the bucket; needs no token. */
  url: string;
  /** When `url` stops working. */
  expiresAt: string;
  key: string;
};

/**
 * `exports/<userId>/<ISO instant>-<uuid>.json`. Scoped by user so a bucket
 * policy or lifecycle rule can target one account, timestamped so a listing
 * sorts, and suffixed so two exports in the same millisecond never collide.
 */
export function cloudExportKey(userId: string, isoInstant: string): string {
  return `exports/${userId}/${isoInstant}-${randomUUID()}.json`;
}

export interface TransferService {
  export(userId: string): Promise<ExportDTO>;
  exportToCloud(userId: string): Promise<CloudExportDTO>;
  import(userId: string, body: ImportBody): Promise<{ habits: number; logs: number }>;
}

export function createTransferService(deps: TransferServiceDeps): TransferService {
  const service: TransferService = {
    async export(userId) {
      const user = await deps.users.findById(userId);
      if (!user) throw notFound('Account not found.');
      const { habits, logs } = await deps.repository.snapshot(userId);

      return {
        app: 'beta',
        schemaVersion: 1,
        exportedAt: toIsoInstant(deps.clock.now()),
        me: toMeDto(user),
        habits: toHabitDtos(habits),
        logs: logs.map(toLogDto),
      };
    },

    async exportToCloud(userId) {
      // A 404 rather than a new error code, as `/push/vapid-public-key` does
      // when push is off: the feature simply does not exist on this server.
      if (deps.objectStore === undefined) throw notFound('Cloud export is not configured.');

      const data = await service.export(userId);
      const now = deps.clock.now();
      const key = cloudExportKey(userId, toIsoInstant(now));
      await deps.objectStore.putJson(key, data);

      const ttl = deps.exportUrlTtlSeconds;
      return {
        url: await deps.objectStore.presignGet(key, ttl),
        expiresAt: toIsoInstant(now + ttl * 1000),
        key,
      };
    },

    async import(userId, body) {
      // Caught here rather than by the database, so the user gets a reason
      // instead of a 500 (SPEC.md §9).
      const habitIds = new Set(body.habits.map((habit) => habit.id));
      const orphan = body.logs.find((log) => !habitIds.has(log.habitId));
      if (orphan !== undefined) {
        throw unprocessable(
          `The file has a log for ${orphan.dayKey} whose habit is not in the file.`,
          [{ path: 'logs', message: 'Every log must belong to a habit in the same file.' }],
        );
      }

      const duplicate = body.habits.length !== habitIds.size;
      if (duplicate) {
        throw unprocessable('The file lists the same habit twice.', [
          { path: 'habits', message: 'Habit ids must be unique.' },
        ]);
      }

      await deps.repository.replace(userId, { habits: body.habits, logs: body.logs });

      // Everything derived from habits and logs is now stale: Today, stats and
      // the reminder plan all have to be rebuilt (SPEC.md §10 step 1).
      deps.eventBus.emit({ type: 'habit.changed', userId });
      return { habits: body.habits.length, logs: body.logs.length };
    },
  };
  return service;
}
