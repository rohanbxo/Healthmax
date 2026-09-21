/**
 * Route guards (SPEC.md §11 "Routing").
 *
 * `RequireAuth` wraps every authenticated route, including `/onboarding`:
 *  - anonymous          -> `/login`, remembering where they were headed;
 *  - signed in, not yet onboarded -> `/onboarding`;
 *  - signed in and onboarded      -> kept out of `/onboarding`.
 *
 * `PublicOnly` is its mirror for `/login`, `/register` and `/forgot`.
 * `/reset` is deliberately outside it: that link arrives by email and is
 * opened on whichever device shows the mail, which is usually still signed in.
 */
import * as React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { useAuth } from './AuthProvider';

export const LOGIN_PATH = '/login';
export const ONBOARDING_PATH = '/onboarding';
export const HOME_PATH = '/';

/** Where the guard sends a user after they sign in. */
export type FromLocationState = { from?: { pathname: string } };

/** Shown only while the first refresh is in flight — never a login flash. */
function SessionLoading(): React.ReactElement {
  return (
    <div
      className="flex min-h-dvh items-center justify-center text-muted"
      data-testid="session-loading"
    >
      <Spinner size="lg" label="Restoring your session" />
    </div>
  );
}

export function RequireAuth(): React.ReactElement {
  const { status, me } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <SessionLoading />;

  if (status === 'anonymous' || me === null) {
    return <Navigate to={LOGIN_PATH} replace state={{ from: { pathname: location.pathname } }} />;
  }

  const onOnboarding = location.pathname === ONBOARDING_PATH;
  if (!me.onboarded && !onOnboarding) return <Navigate to={ONBOARDING_PATH} replace />;
  if (me.onboarded && onOnboarding) return <Navigate to={HOME_PATH} replace />;

  return <Outlet />;
}

export function PublicOnly(): React.ReactElement {
  const { status } = useAuth();

  if (status === 'loading') return <SessionLoading />;
  if (status === 'authenticated') return <Navigate to={HOME_PATH} replace />;

  return <Outlet />;
}
