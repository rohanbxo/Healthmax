/**
 * Auth persistence (SPEC.md §3: "repositories never contain business rules").
 *
 * Everything here is one Prisma call or one transaction. The transactions exist
 * for atomicity, not for policy: rotation must revoke-and-replace as a unit, and
 * consuming a reset token must be a single conditional update so it cannot be
 * replayed by two concurrent requests.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { toDbInstant } from '../../lib/instant';
import { ME_SELECT, type MeRow } from '../me/dto';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** A user plus the one extra column login needs. */
export type AuthUserRow = MeRow & { passwordHash: string };

const AUTH_USER_SELECT = { ...ME_SELECT, passwordHash: true } as const;

/** A stored refresh token and its owner, as rotation needs them. */
export type RefreshTokenRow = {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: MeRow;
};

export type PasswordResetRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export interface AuthRepository {
  /** Returns `null` when the email is already taken (unique violation). */
  createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    timeZone: string;
  }): Promise<MeRow | null>;

  findUserByEmail(email: string): Promise<AuthUserRow | null>;
  findUserById(id: string): Promise<MeRow | null>;

  insertRefreshToken(input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAtMs: number;
  }): Promise<string>;

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | null>;

  /**
   * Revokes `currentId` and issues `tokenHash` in the same family, linking the
   * two, in one transaction. Returns `false` when `currentId` was already
   * revoked by a concurrent request — the caller treats that as reuse.
   */
  rotateRefreshToken(input: {
    currentId: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAtMs: number;
    nowMs: number;
  }): Promise<boolean>;

  /** Revokes every live token in a family. Returns how many were still live. */
  revokeFamily(familyId: string, nowMs: number): Promise<number>;

  /** Revokes every live token of a user (SPEC.md §12: reset revokes sessions). */
  revokeAllForUser(userId: string, nowMs: number): Promise<number>;

  createPasswordReset(input: {
    userId: string;
    tokenHash: string;
    expiresAtMs: number;
  }): Promise<void>;

  findPasswordResetByHash(tokenHash: string): Promise<PasswordResetRow | null>;

  /**
   * Marks the token used, sets the new password and revokes every refresh token
   * of that user — all or nothing. Returns `false` when the token was consumed
   * or expired in the meantime, so it can never be replayed.
   */
  consumePasswordReset(input: {
    tokenId: string;
    userId: string;
    passwordHash: string;
    nowMs: number;
  }): Promise<boolean>;
}

export function createAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async createUser(input) {
      try {
        return await prisma.user.create({ data: input, select: ME_SELECT });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === PRISMA_UNIQUE_VIOLATION
        ) {
          return null;
        }
        throw err;
      }
    },

    async findUserByEmail(email) {
      return prisma.user.findUnique({ where: { email }, select: AUTH_USER_SELECT });
    },

    async findUserById(id) {
      return prisma.user.findUnique({ where: { id }, select: ME_SELECT });
    },

    async insertRefreshToken(input) {
      const row = await prisma.refreshToken.create({
        data: {
          userId: input.userId,
          familyId: input.familyId,
          tokenHash: input.tokenHash,
          expiresAt: toDbInstant(input.expiresAtMs),
        },
        select: { id: true },
      });
      return row.id;
    },

    async findRefreshTokenByHash(tokenHash) {
      return prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          familyId: true,
          expiresAt: true,
          revokedAt: true,
          user: { select: ME_SELECT },
        },
      });
    },

    async rotateRefreshToken(input) {
      return prisma.$transaction(async (tx) => {
        // `revokedAt: null` is the guard: exactly one concurrent caller wins.
        const claimed = await tx.refreshToken.updateMany({
          where: { id: input.currentId, revokedAt: null },
          data: { revokedAt: toDbInstant(input.nowMs) },
        });
        if (claimed.count === 0) return false;

        const replacement = await tx.refreshToken.create({
          data: {
            userId: input.userId,
            familyId: input.familyId,
            tokenHash: input.tokenHash,
            expiresAt: toDbInstant(input.expiresAtMs),
          },
          select: { id: true },
        });
        await tx.refreshToken.update({
          where: { id: input.currentId },
          data: { replacedById: replacement.id },
        });
        return true;
      });
    },

    async revokeFamily(familyId, nowMs) {
      const result = await prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: toDbInstant(nowMs) },
      });
      return result.count;
    },

    async revokeAllForUser(userId, nowMs) {
      const result = await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: toDbInstant(nowMs) },
      });
      return result.count;
    },

    async createPasswordReset(input) {
      await prisma.passwordResetToken.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: toDbInstant(input.expiresAtMs),
        },
      });
    },

    async findPasswordResetByHash(tokenHash) {
      return prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, expiresAt: true, usedAt: true },
      });
    },

    async consumePasswordReset(input) {
      return prisma.$transaction(async (tx) => {
        const now = toDbInstant(input.nowMs);
        const consumed = await tx.passwordResetToken.updateMany({
          where: { id: input.tokenId, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (consumed.count === 0) return false;

        await tx.user.update({
          where: { id: input.userId },
          data: { passwordHash: input.passwordHash },
        });
        await tx.refreshToken.updateMany({
          where: { userId: input.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        return true;
      });
    },
  };
}
