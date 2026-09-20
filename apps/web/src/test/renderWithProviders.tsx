/**
 * Renders a tree in the same provider stack as the app (SPEC.md §13), with a
 * throwaway `QueryClient` whose retries are off so a deliberate failure fails
 * once and immediately.
 *
 * `AuthProvider` runs its one-shot `POST /auth/refresh` here too, so a test
 * decides whether it starts signed in by calling `signInMswUser()` from the MSW
 * handlers before rendering.
 */
import * as React from 'react';
import { vi } from 'vitest';
import { type RenderResult, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider, Toaster } from '@/components/ui';
import { AuthProvider } from '@/auth/AuthProvider';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Runs an assertion about a render that is *meant* to throw, without the
 * failure reaching the test output.
 *
 * React 18's development build re-throws a render error through a DOM event so
 * that a debugger can break on it. jsdom sees that as an uncaught exception and
 * prints `Uncaught [Error: …]`, even when the test caught the error itself.
 * Cancelling the event stops that report; silencing `console.error` stops
 * React's own component-stack warning. Both are restored afterwards.
 */
export function withExpectedRenderError<T>(run: () => T): T {
  const cancel = (event: ErrorEvent): void => event.preventDefault();
  window.addEventListener('error', cancel);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return run();
  } finally {
    consoleError.mockRestore();
    window.removeEventListener('error', cancel);
  }
}

export type RenderWithProvidersOptions = {
  /** Initial router entry, e.g. `/login` or `/reset?token=abc`. */
  route?: string;
  queryClient?: QueryClient;
};

export type RenderWithProvidersResult = RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
  queryClient: QueryClient;
};

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const user = userEvent.setup();

  function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
            <Toaster />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Providers });
  return { ...result, user, queryClient };
}
