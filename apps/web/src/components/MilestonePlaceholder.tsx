/**
 * An honest placeholder for a screen a later milestone owns. It names the
 * milestone and what will live there, so nobody mistakes it for a finished
 * screen or reimplements it by accident.
 */
import * as React from 'react';
import { Card, CardContent, SectionLabel } from '@/components/ui';

export type MilestonePlaceholderProps = {
  /** Mono kicker, e.g. `TODAY`. */
  eyebrow: string;
  title: string;
  /** Which milestone builds this screen, e.g. `M7`. */
  milestone: string;
  /** What that milestone will put here. */
  planned: readonly string[];
};

export function MilestonePlaceholder({
  eyebrow,
  title,
  milestone,
  planned,
}: MilestonePlaceholderProps): React.ReactElement {
  return (
    <section className="flex flex-col gap-4 pt-6">
      <header className="flex flex-col gap-1">
        <SectionLabel>{eyebrow}</SectionLabel>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <p className="section-label text-accent">{milestone} BUILDS THIS SCREEN</p>
          <p className="text-sm text-muted">
            The shell, routing and data layer are in place. This screen is intentionally empty until{' '}
            {milestone}.
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            {planned.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
