/**
 * The M5 URLs in one place, plus the two "arrange" helpers nearly every habit
 * test needs. Built from the path the router actually mounts, so a renamed
 * route breaks here once instead of in twenty string literals.
 */
import request from 'supertest';
import type { Express } from 'express';
import type { CreateHabitBody, DayKey, HabitDTO } from '@beta/core';

import { bearer, type Session } from './auth';

export const HABITS_URL = '/api/habits';
export const LOGS_URL = '/api/logs';
export const TODAY_URL = '/api/today';

export const habitUrl = (habitId: string): string => `${HABITS_URL}/${habitId}`;
export const logUrl = (habitId: string, dayKey: DayKey): string =>
  `${habitUrl(habitId)}/logs/${dayKey}`;
export const snoozeUrl = (habitId: string): string => `${habitUrl(habitId)}/snooze`;

/** The smallest valid create body; override what the test is about. */
export function habitBody(overrides: Partial<CreateHabitBody> = {}): CreateHabitBody {
  return { name: 'Morning run', schedule: { kind: 'daily' }, time: '07:30', ...overrides };
}

/** Creates a habit through the API, so `createdDayKey` is the server's. */
export async function postHabit(
  app: Express,
  session: Session,
  overrides: Partial<CreateHabitBody> = {},
): Promise<HabitDTO> {
  const res = await request(app)
    .post(HABITS_URL)
    .set(...bearer(session.accessToken))
    .send(habitBody(overrides))
    .expect(201);
  return res.body as HabitDTO;
}
