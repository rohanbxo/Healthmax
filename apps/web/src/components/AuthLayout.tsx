/**
 * Shared frame for the four unauthenticated screens: centred 480px column,
 * mono section label, amber reserved for the single primary action (SPEC.md §4).
 */
import * as React from 'react';
import { SectionLabel } from '@/components/ui';

export type AuthLayoutProps = {
  /** Mono uppercase kicker, e.g. `SIGN IN`. */
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthLayout({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthLayoutProps): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <SectionLabel tone="accent">{eyebrow}</SectionLabel>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </header>

      {children}

      {footer ? <footer className="text-sm text-muted">{footer}</footer> : null}
    </main>
  );
}
