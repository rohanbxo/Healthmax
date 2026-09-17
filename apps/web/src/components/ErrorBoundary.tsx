/**
 * Last line of defence: a render error shows a readable screen instead of a
 * blank page. Data errors are handled by React Query and the toast queue.
 */
import * as React from 'react';
import { Button, SectionLabel } from '@/components/ui';

export type ErrorBoundaryProps = {
  children: React.ReactNode;
  /** Replaces the default screen; receives the error that was caught. */
  fallback?: (error: Error) => React.ReactNode;
};

type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[beta] Unhandled render error', error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    if (typeof globalThis.location !== 'undefined') globalThis.location.reload();
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);

    return (
      <main
        role="alert"
        className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <SectionLabel tone="danger">SOMETHING BROKE</SectionLabel>
        <h1 className="text-xl font-semibold">Beta hit an unexpected error.</h1>
        <p className="text-sm text-muted">
          Reloading usually clears it. Your habits and logs are safe on the server.
        </p>
        <Button variant="primary" onClick={this.handleReload} className="mt-2">
          Reload
        </Button>
      </main>
    );
  }
}
