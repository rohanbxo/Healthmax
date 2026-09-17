import { describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import type { MeDTO, TodayDTO } from '@beta/core';
import { ApiError, apiFetch, setSessionEvents } from './client';
import { getAccessToken, setAccessToken } from '@/auth/tokenStore';
import {
  apiError,
  expireAccessToken,
  failRefresh,
  mswState,
  signInMswUser,
} from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

function captureRequests(): Map<string, Headers> {
  const seen = new Map<string, Headers>();
  server.events.on('request:start', ({ request }) => {
    seen.set(`${request.method} ${new URL(request.url).pathname}`, request.headers);
  });
  return seen;
}

describe('apiFetch', () => {
  it('serves two concurrent 401s with exactly one refresh', async () => {
    signInMswUser();
    // The tab has been open a while: the token it holds is no longer current.
    setAccessToken('stale-access-token');

    const [today, me] = await Promise.all([apiFetch<TodayDTO>('/today'), apiFetch<MeDTO>('/me')]);

    expect(mswState.refreshCalls).toBe(1);
    // Each original request ran twice: the 401 and the single retry.
    expect(mswState.todayCalls).toBe(2);
    expect(mswState.meCalls).toBe(2);

    expect(today.dayKey).toBe('2026-09-17');
    expect(me.email).toBe('rider@example.com');
    expect(getAccessToken()).toBe(mswState.session?.accessToken);
  });

  it('sends the CSRF header on refresh and the bearer token elsewhere', async () => {
    const tokenBefore = signInMswUser().accessToken;
    const seen = captureRequests();
    setAccessToken('stale-access-token');

    await apiFetch<MeDTO>('/me');

    expect(seen.get('POST /api/auth/refresh')?.get('x-requested-with')).toBe('beta');
    expect(seen.get('GET /api/me')?.get('x-requested-with')).toBeNull();
    expect(seen.get('GET /api/me')?.get('authorization')).toMatch(/^Bearer /);
    // The refresh rotated the token, and the retry carried the new one.
    expect(getAccessToken()).not.toBe(tokenBefore);
    expect(getAccessToken()).toBe(mswState.session?.accessToken);
  });

  it('ends the session when the refresh itself fails', async () => {
    signInMswUser();
    setAccessToken('stale-access-token');
    failRefresh();

    const onSignedOut = vi.fn();
    setSessionEvents({ onRefreshed: vi.fn(), onSignedOut });

    const error = await apiFetch<TodayDTO>('/today').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UNAUTHENTICATED');
    expect((error as ApiError).status).toBe(401);
    expect(mswState.refreshCalls).toBe(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('retries once and gives up when the retry is rejected too', async () => {
    signInMswUser();
    setAccessToken('stale-access-token');

    let attempts = 0;
    server.use(
      http.get('/api/today', () => {
        attempts += 1;
        return apiError('UNAUTHENTICATED', 'Missing or expired access token');
      }),
    );

    const onSignedOut = vi.fn();
    setSessionEvents({ onRefreshed: vi.fn(), onSignedOut });

    await expect(apiFetch<TodayDTO>('/today')).rejects.toBeInstanceOf(ApiError);

    expect(attempts).toBe(2);
    expect(mswState.refreshCalls).toBe(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('unpacks the SPEC §9 error envelope into a typed ApiError', async () => {
    const session = signInMswUser();
    setAccessToken(session.accessToken);

    server.use(
      http.get('/api/today', () =>
        apiError('UNPROCESSABLE', 'Future days cannot be logged', [{ field: 'dayKey' }]),
      ),
    );

    const error = await apiFetch<TodayDTO>('/today').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    const apiFailure = error as ApiError;
    expect(apiFailure.code).toBe('UNPROCESSABLE');
    expect(apiFailure.status).toBe(422);
    expect(apiFailure.message).toBe('Future days cannot be logged');
    expect(apiFailure.details).toEqual([{ field: 'dayKey' }]);
    // A 4xx that is not 401 never touches the refresh flow.
    expect(mswState.refreshCalls).toBe(0);
  });

  it('refreshes once when a valid token goes stale mid-session', async () => {
    const session = signInMswUser();
    setAccessToken(session.accessToken);

    await apiFetch<MeDTO>('/me');
    expect(mswState.refreshCalls).toBe(0);

    expireAccessToken();
    const me = await apiFetch<MeDTO>('/me');

    expect(me.id).toBe(session.me.id);
    expect(mswState.refreshCalls).toBe(1);
  });
});
