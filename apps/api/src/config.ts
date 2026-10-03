/**
 * Environment configuration (SPEC.md §12: "Secrets only from environment,
 * validated at startup").
 *
 * Parsed once, at startup, from `process.env` only. Nothing else in the API
 * reads `process.env`. Invalid or missing variables abort the process with one
 * aggregated message that names every offending variable — and never prints a
 * value, because most of them are secrets.
 */
import { isIP } from 'node:net';
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

/** Express's named subnets for `trust proxy`. */
const TRUST_PROXY_PRESETS = ['loopback', 'linklocal', 'uniquelocal'] as const;

/** `false`, a hop count, or the addresses/subnets of the proxies to trust. */
export type TrustProxy = false | number | string[];

function isAddressOrSubnet(entry: string): boolean {
  if ((TRUST_PROXY_PRESETS as readonly string[]).includes(entry)) return true;
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return /^\d+$/.test(prefix) && bits <= (family === 4 ? 32 : 128);
}

/**
 * Resolves `TRUST_PROXY` (SPEC.md §9 "Rate limits"). The client IP the rate
 * limiters key on comes from `X-Forwarded-For`, and only the hops trusted here
 * may write it:
 *
 * - unset: one hop in production (a single reverse proxy or platform load
 *   balancer), none elsewhere;
 * - `false` or `0`: the app is reached directly, so the header is ignored;
 * - a number: that many proxy hops in front of the app;
 * - a comma-separated list of IPs, CIDRs or `loopback`/`linklocal`/`uniquelocal`.
 *
 * `true` is refused: it trusts every hop, so any client could choose its own IP.
 */
export function parseTrustProxy(
  value: string | undefined,
  nodeEnv: string,
): { ok: true; value: TrustProxy } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: nodeEnv === 'production' ? 1 : false };
  if (value === 'false') return { ok: true, value: false };
  if (value === 'true') {
    return {
      ok: false,
      message:
        'must not be true — that trusts every hop, letting clients spoof their IP; give a hop count',
    };
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return { ok: true, value: hops === 0 ? false : hops };
  }
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.every((entry) => entry !== '' && isAddressOrSubnet(entry))) {
    return { ok: true, value: entries };
  }
  return {
    ok: false,
    message:
      'must be false, a hop count, or a comma-separated list of IPs, CIDRs or loopback/linklocal/uniquelocal',
  };
}

const EMAIL_PROVIDERS = ['resend', 'ses', 'none'] as const;

const baseSchema = z.object({
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
  /**
   * Which mailer sends. Left unset, it is `resend` when `RESEND_API_KEY` is
   * set and `none` otherwise — exactly how email was chosen before SES.
   */
  EMAIL_PROVIDER: z.enum(EMAIL_PROVIDERS).optional(),
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,

  // AWS (S3 cloud export, SES). Locally these point at Floci; in production
  // the endpoints and keys are unset and the SDK talks to real AWS through
  // its default credential chain (an IAM role).
  AWS_REGION: z.string().trim().min(1).default('us-east-1'),
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  /** Where the API reaches AWS, e.g. `http://floci:4566`. Unset means real AWS. */
  AWS_ENDPOINT_URL: z.url({ error: 'must be an absolute URL, e.g. http://floci:4566' }).optional(),
  /**
   * The same service as the browser sees it, e.g. `http://localhost:4566`.
   * Only presigned URLs use it: the browser cannot resolve `floci`.
   */
  AWS_PUBLIC_ENDPOINT_URL: z
    .url({ error: 'must be an absolute URL, e.g. http://localhost:4566' })
    .optional(),
  /** Unset disables cloud export. */
  S3_EXPORT_BUCKET: optionalString,
  /** Presigned export link lifetime; SigV4 caps it at seven days. */
  EXPORT_URL_TTL_SECONDS: z.coerce.number().int().min(1).max(604_800).default(900),

  /**
   * Absolute path to the built web app. Set in the production image, where one
   * process serves both; unset in development, where Vite serves the app and
   * the API serves only `/api` (SPEC.md §13).
   */
  WEB_ROOT: optionalString,

  /** Proxy hops trusted to report the client IP; see {@link parseTrustProxy}. */
  TRUST_PROXY: optionalString,

  DOCS_ENABLED: booleanFromEnv(false),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

/** Cross-field rules, reported against the variable that has to change. */
const configSchema = baseSchema
  .superRefine((env, ctx) => {
    const trustProxy = parseTrustProxy(env.TRUST_PROXY, env.NODE_ENV);
    if (!trustProxy.ok) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: trustProxy.message });
    }

    const provider = env.EMAIL_PROVIDER ?? (env.RESEND_API_KEY ? 'resend' : 'none');
    const requireVar = (name: 'RESEND_API_KEY' | 'EMAIL_FROM') => {
      if (env[name] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `is required when EMAIL_PROVIDER is ${provider}`,
        });
      }
    };
    if (provider === 'resend') requireVar('RESEND_API_KEY');
    if (provider !== 'none') requireVar('EMAIL_FROM');

    // One key without the other would silently fall through to whatever the
    // default credential chain finds.
    if ((env.AWS_ACCESS_KEY_ID === undefined) !== (env.AWS_SECRET_ACCESS_KEY === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.AWS_ACCESS_KEY_ID === undefined ? 'AWS_ACCESS_KEY_ID' : 'AWS_SECRET_ACCESS_KEY'],
        message: 'must be set together with its pair, or both left unset',
      });
    }
  })
  .transform((env) => ({
    ...env,
    EMAIL_PROVIDER: env.EMAIL_PROVIDER ?? (env.RESEND_API_KEY ? 'resend' : 'none'),
    TRUST_PROXY: resolvedTrustProxy(env.TRUST_PROXY, env.NODE_ENV),
  }));

/** Only reached after `superRefine` accepted the value. */
function resolvedTrustProxy(value: string | undefined, nodeEnv: string): TrustProxy {
  const result = parseTrustProxy(value, nodeEnv);
  return result.ok ? result.value : false;
}

export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

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
    // A cross-field rule already says why the variable is needed.
    const missing = !(name in present) && issue.code !== 'custom';
    return `${name}: ${missing ? 'is required but missing or empty' : issue.message}`;
  });
  throw new ConfigError([...new Set(problems)].sort());
}
