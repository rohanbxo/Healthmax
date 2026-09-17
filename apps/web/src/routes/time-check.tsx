/**
 * `/dev/time-check` — development builds only (SPEC.md §7).
 *
 * `Intl` data differs between browser engines, so the same known-answer table
 * that Vitest runs in `packages/core` is rendered here to be opened in Safari,
 * Chrome and Firefox.
 */
import * as React from 'react';
import { type TimeSelfCheckResult, guessTimeZone, runTimeSelfCheck } from '@beta/core';
import { Badge, SectionLabel } from '@/components/ui';

export function TimeCheckRoute(): React.ReactElement {
  const results = React.useMemo<TimeSelfCheckResult[]>(() => runTimeSelfCheck(), []);
  const passed = results.filter((result) => result.pass).length;
  const allPassed = passed === results.length;

  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 py-8">
      <header className="flex flex-col gap-2">
        <SectionLabel tone="accent">TIME SELF-CHECK</SectionLabel>
        <h1 className="text-2xl font-semibold tracking-tight">Intl known-answer tests</h1>
        <p className="text-sm text-muted">
          Browser zone: <span className="font-mono text-text">{guessTimeZone()}</span>
        </p>
        <p className="font-mono text-sm" data-testid="time-check-summary">
          <span className={allPassed ? 'text-success' : 'text-danger'}>
            {passed} / {results.length} passed
          </span>
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Time engine known-answer checks</caption>
          <thead>
            <tr className="section-label text-muted">
              <th scope="col" className="border-b border-border py-2 pr-3">
                Check
              </th>
              <th scope="col" className="border-b border-border py-2 pr-3">
                Expected
              </th>
              <th scope="col" className="border-b border-border py-2 pr-3">
                Actual
              </th>
              <th scope="col" className="border-b border-border py-2">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.name} className="align-top">
                <th scope="row" className="border-b border-border py-2 pr-3 font-normal">
                  {result.name}
                </th>
                <td className="border-b border-border py-2 pr-3 font-mono text-xs text-muted">
                  {result.expected}
                </td>
                <td className="border-b border-border py-2 pr-3 font-mono text-xs">
                  {result.actual}
                </td>
                <td className="border-b border-border py-2">
                  <Badge variant={result.pass ? 'success' : 'outline-danger'}>
                    {result.pass ? 'PASS' : 'FAIL'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
