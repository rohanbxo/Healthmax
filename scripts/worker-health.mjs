#!/usr/bin/env node
/**
 * Health check for the worker container, which serves no HTTP (SPEC.md §10
 * "Worker process").
 *
 * The worker's job is to reach Postgres and Redis, so that is what this
 * checks: a TCP connect to each, parsed out of the same URLs the process runs
 * with. Exits 0 when both answer.
 */
import net from 'node:net';

const TIMEOUT_MS = 2_000;

function target(url, fallbackPort) {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || fallbackPort) };
}

function canConnect({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

const checks = [
  target(process.env.DATABASE_URL ?? 'postgresql://postgres:5432', 5432),
  target(process.env.REDIS_URL ?? 'redis://redis:6379', 6379),
];

const results = await Promise.all(checks.map(canConnect));
process.exit(results.every(Boolean) ? 0 : 1);
