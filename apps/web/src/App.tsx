/**
 * Composition root for the web client (SPEC.md §11).
 *
 * QueryClientProvider -> AuthProvider -> ToastProvider -> router, with the
 * toast viewport rendered next to the router so it floats above the tab bar.
 */
import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider, Toaster } from '@/components/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { createQueryClient } from '@/api/queryClient';
import { AuthProvider } from '@/auth/AuthProvider';
import { AppRoutes } from '@/routes';

const queryClient = createQueryClient();

export function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
            <Toaster />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
