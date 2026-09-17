import * as React from 'react';
import { Link } from 'react-router-dom';
import { Button, SectionLabel } from '@/components/ui';

export function NotFoundRoute(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center gap-3 px-6 text-center">
      <SectionLabel tone="accent">404</SectionLabel>
      <h1 className="text-2xl font-semibold tracking-tight">Nothing lives here.</h1>
      <p className="text-sm text-muted">The page you asked for is not part of Beta.</p>
      <Button asChild variant="primary" className="mt-2">
        <Link to="/">Go to Today</Link>
      </Button>
    </main>
  );
}
