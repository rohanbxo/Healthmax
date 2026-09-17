/**
 * Session state for the whole app (SPEC.md §11).
 *
 * On load it calls `POST /auth/refresh` exactly once to trade the httpOnly
 * refresh cookie for an access token. Until that settles the status is
 * `loading` and the route guard renders nothing route-specific, so a signed-in
 * user never sees a flash of the login screen.
 */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type AuthDTO, type MeDTO } from '@beta/core';
import { endSession, refreshSession, setSessionEvents } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { setAccessToken } from './tokenStore';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export type AuthContextValue = {
  /** `loading` until the first refresh settles. */
  status: AuthStatus;
  /** The signed-in user, or `null` while loading or anonymous. */
  me: MeDTO | null;
  /** Adopt the result of a login, a register or a manual refresh. */
  signIn: (auth: AuthDTO) => void;
  /** Drop the local session. The API call is `useLogout()`. */
  signOut: () => void;
  /** Record a `PATCH /me` result (onboarding, settings). */
  setMe: (me: MeDTO) => void;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export type AuthProviderProps = { children: React.ReactNode };

export function AuthProvider({ children }: AuthProviderProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<AuthStatus>('loading');
  const [me, setMeState] = React.useState<MeDTO | null>(null);

  const signIn = React.useCallback(
    (auth: AuthDTO) => {
      setAccessToken(auth.accessToken);
      setMeState(auth.me);
      setStatus('authenticated');
      queryClient.setQueryData(queryKeys.me(), auth.me);
    },
    [queryClient],
  );

  const forget = React.useCallback(() => {
    setMeState(null);
    setStatus('anonymous');
    // Nothing in the cache belongs to a signed-out user.
    queryClient.clear();
  }, [queryClient]);

  const setMe = React.useCallback(
    (next: MeDTO) => {
      setMeState(next);
      queryClient.setQueryData(queryKeys.me(), next);
    },
    [queryClient],
  );

  const signOut = React.useCallback(() => {
    // `endSession` clears the token and calls back into `forget` below.
    endSession();
  }, []);

  // The client refreshes tokens on its own; this keeps the provider in step.
  React.useEffect(() => {
    setSessionEvents({
      onRefreshed: (auth) => {
        signIn(auth);
      },
      onSignedOut: () => {
        forget();
      },
    });
    return () => setSessionEvents(null);
  }, [signIn, forget]);

  // Exactly once per mounted provider, even under StrictMode's double effect.
  const bootstrapped = React.useRef(false);
  React.useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    void refreshSession().then((restored) => {
      // A successful refresh already arrived through `onRefreshed`.
      if (!restored) forget();
    });
  }, [forget]);

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, me, signIn, signOut, setMe }),
    [status, me, signIn, signOut, setMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider>.');
  return context;
}
