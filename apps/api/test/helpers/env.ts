/**
 * Test environment. The application itself reads `process.env` only
 * (SPEC.md §12); this helper only fills the gaps from the developer's local
 * `.env` files so `pnpm --filter @beta/api test` works without a wrapper. In CI
 * the variables are already set, so nothing here does anything.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILES = [
  resolve(__dirname, '../../../../.env'), // repo root
  resolve(__dirname, '../../.env'), // apps/api (Prisma CLI)
];

/** Minimal `KEY=value` reader. Never overwrites a variable already set. */
function loadFile(path: string): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return; // Absent in CI; that is expected.
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    // Strip an inline comment, then surrounding quotes.
    const hash = value.indexOf(' #');
    if (hash >= 0) value = value.slice(0, hash).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

let loaded = false;

export function loadTestEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of ENV_FILES) loadFile(file);
}

export function requireEnv(name: string): string {
  loadTestEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set to run the API tests (see .env.example). Never point it at the dev database.`,
    );
  }
  return value;
}

/**
 * The test suite gets its own Redis logical database so it can never flush a
 * developer's dev keyspace.
 */
export const REDIS_TEST_DB = 15;
