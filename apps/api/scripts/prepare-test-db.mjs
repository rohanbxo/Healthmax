#!/usr/bin/env node
/**
 * Prepares the TEST database before the API suite runs (SPEC.md §13).
 *
 * The Prisma CLI reads `DATABASE_URL`, so running a migrate command straight
 * from `apps/api` would target the developer's dev database. This wrapper
 * points `DATABASE_URL` at `DATABASE_URL_TEST` for the child process and
 * refuses to run when the two are equal.
 *
 * Default mode is `migrate deploy`: idempotent, non-destructive, and enough for
 * the suite because `test/helpers/db.ts` truncates every table between tests.
 * `--reset` runs `prisma migrate reset --force --skip-seed` instead — use it
 * after changing migrations. It irreversibly destroys all data in the TEST
 * database, and recent Prisma CLI versions refuse to run it non-interactively
 * for an AI agent without explicit developer consent.
 *
 * Environment comes from the process first (CI sets it), then from
 * `apps/api/.env` and the repo-root `.env` for local runs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, '..');
const ENV_FILES = [resolve(apiDir, '.env'), resolve(apiDir, '../../.env')];

/** Minimal `KEY=value` reader that never overwrites an existing variable. */
function loadEnvFile(path) {
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    const inlineComment = value.indexOf(' #');
    if (inlineComment >= 0) value = value.slice(0, inlineComment).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const file of ENV_FILES) loadEnvFile(file);

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  console.error(
    'DATABASE_URL_TEST is not set. Copy .env.example to .env (and apps/api/.env for the Prisma CLI).',
  );
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL_TEST must not equal DATABASE_URL — refusing to touch the dev database.',
  );
  process.exit(1);
}

const prismaCli = resolve(apiDir, 'node_modules/prisma/build/index.js');
if (!existsSync(prismaCli)) {
  console.error(`Prisma CLI not found at ${prismaCli}. Run pnpm install.`);
  process.exit(1);
}

const args = process.argv.includes('--reset')
  ? ['migrate', 'reset', '--force', '--skip-seed', '--skip-generate']
  : ['migrate', 'deploy'];

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  cwd: apiDir,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testUrl },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
