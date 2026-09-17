/**
 * Environment configuration (SPEC.md §12: "Secrets only from environment,
 * validated at startup").
 *
 * Parsed once, at startup, from `process.env` only. Nothing else in the API
 * reads `process.env`. Invalid or missing variables abort the process with one
 * aggregated message that names every offending variable — and never prints a
 * value, because most of them are secrets.
 */
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** `''` is what an unset key in a `.env` file looks like; treat it as absent. */
const optionalString = z.string().trim().min(1).optional();

/** Accepts the usual shell spellings of a boolean. */
const booleanFromEnv = (fallback: boolean) =>
  z
    .enum(['true', '1', 'yes', 'on', 'false', '0', 'no', 'off'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => ['true', '1', 'yes', 'on'].includes(value));

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.url({ error: 'must be an absolute URL, e.g. http://localhost:5173' }),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      error: 'must be a postgres:// or postgresql:// connection string',
    }),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
      error: 'must be a redis:// or rediss:// connection string',
    }),
  JWT_SECRET: z.string().min(32, { error: 'must be at least 32 characters' }),

  // Web Push — required from M9 onwards, optional until then (SPEC.md §14).
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: optionalString,

  // Email — required from M10 onwards (SPEC.md §14).
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,

  DOCS_ENABLED: booleanFromEnv(false),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type Config = Readonly<z.infer<typeof configSchema>>;

/** Environment source: a plain record so tests can pass a literal. */
export type EnvSource = Record<string, string | undefined>;

export class ConfigError extends Error {
  public override readonly name = 'ConfigError';

  constructor(public readonly problems: readonly string[]) {
    super(
      `Invalid environment (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
  }
}

/** Strips `''` values so zod defaults and `.optional()` behave as expected. */
function compact(env: EnvSource): EnvSource {
  const out: EnvSource = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') out[key] = value;
  }
  return out;
}

/**
 * Validates the environment. Throws {@link ConfigError} listing every problem —
 * variable names only, never values.
 */
export function loadConfig(env: EnvSource = process.env): Config {
  const result = configSchema.safeParse(compact(env));
  if (result.success) return Object.freeze(result.data);

  const present = compact(env);
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join('.') || '(root)';
    const missing = !(name in present);
    return `${name}: ${missing ? 'is required but missing or empty' : issue.message}`;
  });
  throw new ConfigError([...new Set(problems)].sort());
}
