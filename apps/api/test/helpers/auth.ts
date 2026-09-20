/**
 * Auth test helpers (SPEC.md §13 "API tests").
 *
 * Signing in through the real endpoints rather than inserting rows keeps the
 * tests honest: everything below goes through argon2, the JWT and the cookie
 * exactly as a browser would. M5 reuses `bearer`, `registerUser` and
 * `expectHiddenFromOtherUser` for habits, logs and snoozes.
 */
import { randomUUID } from 'node:crypto';
import { expect } from 'chai';
import request from 'supertest';
import type { Express } from 'express';
import type { MeDTO } from '@beta/core';

import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/cookies';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '../../src/http/requestedWith';
import { signAccessToken } from '../../src/lib/accessToken';
import type { ApiErrorCode } from '../../src/http/errors';

export const AUTH = {
  register: '/api/auth/register',
  login: '/api/auth/login',
  refresh: '/api/auth/refresh',
  logout: '/api/auth/logout',
  forgot: '/api/auth/forgot-password',
  reset: '/api/auth/reset-password',
} as const;

export const ME_PATH = '/api/me';

/** The password every helper-made account uses unless told otherwise. */
export const TEST_PASSWORD = 'correct-horse-battery-staple';

/** `Authorization: Bearer <token>` as a supertest `.set()` pair. */
export function bearer(accessToken: string): [string, string] {
  return ['Authorization', `Bearer ${accessToken}`];
}

/** The CSRF header `/auth/refresh` and `/auth/logout` require (SPEC.md §9). */
export function requestedWith(): [string, string] {
  return [REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE];
}

/** `Cookie: beta_rt=<token>` — supertest keeps no cookie jar of its own. */
export function refreshCookie(token: string): [string, string] {
  return ['Cookie', `${REFRESH_COOKIE_NAME}=${token}`];
}

export function setCookieHeaders(res: request.Response): string[] {
  const raw: unknown = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string');
  return typeof raw === 'string' ? [raw] : [];
}

/** The whole `Set-Cookie` line for `beta_rt`, attributes included. */
export function refreshSetCookie(res: request.Response): string {
  const header = setCookieHeaders(res).find((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (header === undefined) {
    throw new Error(`No ${REFRESH_COOKIE_NAME} cookie on the response (${res.status})`);
  }
  return header;
}

/** Just the token value. base64url needs no decoding. */
export function refreshTokenFrom(res: request.Response): string {
  const value = refreshSetCookie(res).split(';')[0]?.split('=')[1] ?? '';
  if (value === '') throw new Error('The beta_rt cookie was empty');
  return value;
}

export type Session = {
  accessToken: string;
  me: MeDTO;
  refreshToken: string;
  email: string;
  password: string;
};

export type RegisterOverrides = {
  email?: string;
  password?: string;
  name?: string;
  timeZone?: string;
};

/** Registers through `POST /api/auth/register` and returns the live session. */
export async function registerUser(
  app: Express,
  overrides: RegisterOverrides = {},
): Promise<Session> {
  const email = overrides.email ?? `user-${randomUUID()}@example.com`;
  const password = overrides.password ?? TEST_PASSWORD;
  const res = await request(app)
    .post(AUTH.register)
    .send({
      email,
      password,
      name: overrides.name ?? 'Test User',
      timeZone: overrides.timeZone ?? 'Asia/Dubai',
    })
    .expect(201);

  return {
    accessToken: res.body.accessToken as string,
    me: res.body.me as MeDTO,
    refreshToken: refreshTokenFrom(res),
    email: email.toLowerCase(),
    password,
  };
}

/** One rotation of the refresh cookie, with the CSRF header attached. */
export function postRefresh(app: Express, token: string): request.Test {
  return request(app)
    .post(AUTH.refresh)
    .set(...requestedWith())
    .set(...refreshCookie(token));
}

/**
 * Mints a syntactically perfect access token for an id that need not exist —
 * used to prove that an unknown or deleted owner reads as 404, not 403 or 500.
 */
export function forgeAccessToken(
  secret: string,
  nowMs: number,
  userId: string = randomUUID(),
): string {
  return signAccessToken({ userId, secret, nowMs });
}

/** Asserts the SPEC.md §9 envelope and returns its parts. */
export function expectEnvelope(
  body: unknown,
  code: ApiErrorCode,
): { message: string; details: unknown[] } {
  expect(body).to.be.an('object');
  expect(Object.keys(body as object)).to.deep.equal(['error']);
  const error = (body as { error: Record<string, unknown> }).error;
  expect(error.code).to.equal(code);
  expect(error.message).to.be.a('string').and.not.equal('');
  expect(error.details).to.be.an('array');
  return { message: error.message as string, details: error.details as unknown[] };
}

/** The `path` values `validate()` reported, for asserting on a 400. */
export function detailPaths(details: unknown[]): string[] {
  return details
    .map((detail) => (detail as { path?: unknown }).path)
    .filter((path): path is string => typeof path === 'string');
}

/**
 * SPEC.md §9/§12: "Accessing another user's resource returns 404, never 403."
 *
 * M5 hangs its IDOR tests for habits, logs, snoozes and push subscriptions off
 * this helper:
 *
 *     await expectHiddenFromOtherUser(() =>
 *       request(app).get(`/api/habits/${ownersHabitId}`).set(...bearer(intruder.accessToken)),
 *     );
 */
export async function expectHiddenFromOtherUser(send: () => request.Test): Promise<void> {
  const res = await send();
  expect(res.status, `another user's resource must be 404 (never 403), got ${res.status}`).to.equal(
    404,
  );
  expectEnvelope(res.body, 'NOT_FOUND');
}
