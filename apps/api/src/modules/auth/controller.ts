/**
 * Auth controller (SPEC.md §3: controllers "parse validated input, call
 * service, shape response" — and never touch Prisma).
 *
 * The one thing that lives here rather than in the service is the cookie: it is
 * an HTTP transport detail, so the service hands back a raw refresh token and
 * this layer decides it belongs in `beta_rt` and nowhere else.
 */
import type { RequestHandler } from 'express';
import {
  forgotPasswordBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { getValidated } from '../../http/validate';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookies';
import type { AuthService, AuthSession } from './service';

/** Shared by `validate()` in the router and `getValidated()` here. */
export const authSchemas = {
  register: { body: registerBodySchema },
  login: { body: loginBodySchema },
  forgotPassword: { body: forgotPasswordBodySchema },
  resetPassword: { body: resetPasswordBodySchema },
} as const;

export type AuthControllerDeps = {
  service: AuthService;
  /** Drives the cookie's `Secure` flag (SPEC.md §12). */
  isProduction: boolean;
};

export type AuthController = {
  register: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  forgotPassword: RequestHandler;
  resetPassword: RequestHandler;
};

export function createAuthController(deps: AuthControllerDeps): AuthController {
  /** `{ accessToken, me }` plus the rotating cookie (SPEC.md §9). */
  function sendSession(
    res: Parameters<RequestHandler>[1],
    session: AuthSession,
    status: number,
  ): void {
    setRefreshCookie(res, session.refreshToken, deps.isProduction);
    res.status(status).json({ accessToken: session.accessToken, me: session.me });
  }

  return {
    register: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, authSchemas.register);
      sendSession(res, await deps.service.register(body), 201);
    }),

    login: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, authSchemas.login);
      sendSession(res, await deps.service.login(body), 200);
    }),

    refresh: asyncHandler(async (req, res) => {
      let session: AuthSession;
      try {
        session = await deps.service.refresh(readRefreshCookie(req));
      } catch (err) {
        // The cookie is spent, forged or revoked either way: drop it so the
        // browser stops replaying it and the client falls back to /login.
        clearRefreshCookie(res, deps.isProduction);
        throw err;
      }
      sendSession(res, session, 200);
    }),

    logout: asyncHandler(async (req, res) => {
      await deps.service.logout(readRefreshCookie(req));
      clearRefreshCookie(res, deps.isProduction);
      res.status(204).end();
    }),

    forgotPassword: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, authSchemas.forgotPassword);
      await deps.service.forgotPassword(body);
      // Always 204, whether or not the address exists (SPEC.md §9).
      res.status(204).end();
    }),

    resetPassword: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, authSchemas.resetPassword);
      await deps.service.resetPassword(body);
      // Every session is gone, so the caller signs in again with the new
      // password rather than being handed a fresh one here.
      res.status(204).end();
    }),
  };
}
