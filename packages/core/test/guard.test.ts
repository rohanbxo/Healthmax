/**
 * Proves the two ESLint guards from SPEC.md §13 actually fire.
 *
 * A guard that silently stops matching is worse than no guard, so this runs the
 * real root flat config over fixture source text rather than asserting on the
 * config object. Fixtures are linted at plausible repo paths so the config's
 * `files` patterns resolve the same way they do for `pnpm lint`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Vitest runs with cwd = packages/core, but CI, IDEs and `pnpm -r` can all start
 * it elsewhere, so walk up to the directory that actually holds the flat config.
 */
function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (
      fs.existsSync(path.join(dir, 'eslint.config.js')) &&
      fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find the repo root above ${start}`);
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(process.cwd());

/** Absolute, native-separator path inside the repo, so Windows paths match too. */
function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: repoPath('eslint.config.js'),
    // Fixtures are virtual files; never let a cached result stand in for them.
    cache: false,
  });
});

/** Messages a fixture produces for one rule. */
async function messagesFor(code: string, filePath: string, ruleId: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath, warnIgnored: false });
  return results
    .flatMap((result) => result.messages)
    .filter((message) => message.ruleId === ruleId)
    .map((message) => message.message);
}

const DATE_RULE = 'no-restricted-syntax';
const IMPORT_RULE = 'no-restricted-imports';
const DATE_GUARD_MESSAGE = 'Use packages/core time.ts — see SPEC.md §7.';

/** A normal source file, subject to every guard. */
const NORMAL_FILE = repoPath('packages', 'core', 'src', '__guard_fixture__.ts');
/** The one file in core allowed to touch raw Date APIs (SPEC.md §13). */
const TIME_ENGINE_FILE = repoPath('packages', 'core', 'src', 'time.ts');

describe('date guard', () => {
  it('reports new Date() with an argument', async () => {
    const messages = await messagesFor(
      `export const start = new Date('2026-01-01');\n`,
      NORMAL_FILE,
      DATE_RULE,
    );
    expect(messages).toContain(DATE_GUARD_MESSAGE);
  });

  it('reports Date.parse', async () => {
    const messages = await messagesFor(
      `export function toMs(x: string): number {\n  return Date.parse(x);\n}\n`,
      NORMAL_FILE,
      DATE_RULE,
    );
    expect(messages).toContain(DATE_GUARD_MESSAGE);
  });

  it('reports local Date getters such as getFullYear', async () => {
    const messages = await messagesFor(
      `export function year(d: Date): number {\n  return d.getFullYear();\n}\n`,
      NORMAL_FILE,
      DATE_RULE,
    );
    expect(messages).toContain(DATE_GUARD_MESSAGE);
  });

  it('reports every banned accessor, not just the first', async () => {
    const banned = [
      'getFullYear',
      'getMonth',
      'getDate',
      'getDay',
      'getHours',
      'getMinutes',
      'getSeconds',
      'setHours',
      'setMinutes',
      'toLocaleDateString',
      'toLocaleTimeString',
      'getTimezoneOffset',
    ];
    for (const accessor of banned) {
      const messages = await messagesFor(
        `export function probe(d: Date): unknown {\n  return d.${accessor}();\n}\n`,
        NORMAL_FILE,
        DATE_RULE,
      );
      expect(messages, accessor).toContain(DATE_GUARD_MESSAGE);
    }
  });

  it('leaves new Date() with no arguments to the caller', async () => {
    // Banning this is the job of review, not this selector: `new Date()` alone
    // still needs the process clock, which SPEC.md §7 rule 6 forbids by design.
    const messages = await messagesFor(`export const d = new Date();\n`, NORMAL_FILE, DATE_RULE);
    expect(messages).toEqual([]);
  });

  it('does not fire inside packages/core/src/time.ts', async () => {
    const code = [
      `export const start = new Date('2026-01-01');`,
      `export const parsed = Date.parse('2026-01-01');`,
      `export function year(d: Date): number {`,
      `  return d.getFullYear();`,
      `}`,
      ``,
    ].join('\n');
    const messages = await messagesFor(code, TIME_ENGINE_FILE, DATE_RULE);
    expect(messages).toEqual([]);
  });

  it('does not fire inside apps/api/src/lib/instant.ts', async () => {
    const messages = await messagesFor(
      `export function toDbInstant(ms: number): Date {\n  return new Date(ms);\n}\n`,
      repoPath('apps', 'api', 'src', 'lib', 'instant.ts'),
      DATE_RULE,
    );
    expect(messages).toEqual([]);
  });

  it('does not fire in test files', async () => {
    const messages = await messagesFor(
      `export const fixed = new Date('2026-01-01').valueOf();\n`,
      repoPath('apps', 'api', 'test', '__guard_fixture__.test.ts'),
      DATE_RULE,
    );
    expect(messages).toEqual([]);
  });
});

describe('layering guard', () => {
  const forbidden = ['@prisma/client', 'express', 'react'];

  for (const specifier of forbidden) {
    it(`reports an import of ${specifier} from packages/core`, async () => {
      const messages = await messagesFor(
        `import x from '${specifier}';\nexport default x;\n`,
        NORMAL_FILE,
        IMPORT_RULE,
      );
      expect(messages.length, `${specifier} produced ${JSON.stringify(messages)}`).toBeGreaterThan(
        0,
      );
      expect(messages.join('\n')).toContain('SPEC.md');
    });
  }

  it('reports an import reaching from packages/core into apps', async () => {
    const messages = await messagesFor(
      `import { createApp } from '../../../apps/api/src/app';\nexport default createApp;\n`,
      NORMAL_FILE,
      IMPORT_RULE,
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it('allows the dependencies packages/core is meant to use', async () => {
    const messages = await messagesFor(
      `import { z } from 'zod';\nimport type { DayKey } from './types';\nexport const s = z.string();\nexport type K = DayKey;\n`,
      NORMAL_FILE,
      IMPORT_RULE,
    );
    expect(messages).toEqual([]);
  });

  it('reports a controller importing @prisma/client', async () => {
    const messages = await messagesFor(
      `import { PrismaClient } from '@prisma/client';\nexport default PrismaClient;\n`,
      repoPath('apps', 'api', 'src', 'modules', 'habits', 'controller.ts'),
      IMPORT_RULE,
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('SPEC.md');
  });
});
