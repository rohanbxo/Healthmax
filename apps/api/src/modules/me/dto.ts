/**
 * `MeDTO` projection (SPEC.md §5). The DTO is the contract the web app parses,
 * so it is built in exactly one place and never leaks a column the client has
 * no business seeing (`passwordHash`, `createdAt`, and the rest).
 */
import type { MeDTO, WeekStart } from '@beta/core';

/** The columns `MeDTO` needs — deliberately narrower than the Prisma `User`. */
export type MeRow = {
  id: string;
  email: string;
  name: string;
  timeZone: string;
  weekStart: number;
  onboarded: boolean;
};

/** The column is a plain `Int`; SPEC.md §5 allows only 0 (Sunday) or 1 (Monday). */
export function toWeekStart(value: number): WeekStart {
  return value === 0 ? 0 : 1;
}

export function toMeDto(row: MeRow): MeDTO {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    timeZone: row.timeZone,
    weekStart: toWeekStart(row.weekStart),
    onboarded: row.onboarded,
  };
}

/** The exact `select` that produces a {@link MeRow}. Shared by both modules. */
export const ME_SELECT = {
  id: true,
  email: true,
  name: true,
  timeZone: true,
  weekStart: true,
  onboarded: true,
} as const;
