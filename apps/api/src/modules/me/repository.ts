/**
 * Account persistence (SPEC.md §3, §8 "Query rules").
 *
 * Every method is keyed by `userId`: there is no "load any user" call, so a
 * missing row is indistinguishable from somebody else's row and the service can
 * only ever answer 404 (SPEC.md §9: "Accessing another user's resource returns
 * 404, never 403").
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { ME_SELECT, type MeRow } from './dto';

const PRISMA_RECORD_NOT_FOUND = 'P2025';

export type MeUpdate = {
  name?: string;
  timeZone?: string;
  weekStart?: number;
  onboarded?: boolean;
};

export interface MeRepository {
  findById(userId: string): Promise<MeRow | null>;
  /** The password digest, for the `DELETE /me` confirmation only. */
  findPasswordHash(userId: string): Promise<string | null>;
  update(userId: string, data: MeUpdate): Promise<MeRow | null>;
  /** `true` when a row was deleted; the schema cascades the rest (SPEC.md §8). */
  deleteById(userId: string): Promise<boolean>;
}

export function createMeRepository(prisma: PrismaClient): MeRepository {
  return {
    async findById(userId) {
      return prisma.user.findUnique({ where: { id: userId }, select: ME_SELECT });
    },

    async findPasswordHash(userId) {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      return row?.passwordHash ?? null;
    },

    async update(userId, data) {
      try {
        // Prisma leaves `undefined` fields untouched, so a partial body is a
        // partial update without any hand-rolled key filtering.
        return await prisma.user.update({ where: { id: userId }, data, select: ME_SELECT });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === PRISMA_RECORD_NOT_FOUND
        ) {
          return null;
        }
        throw err;
      }
    },

    async deleteById(userId) {
      // `deleteMany` so a already-deleted account is not an exception.
      const result = await prisma.user.deleteMany({ where: { id: userId } });
      return result.count > 0;
    },
  };
}
