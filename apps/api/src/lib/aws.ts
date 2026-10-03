/**
 * Shared AWS SDK client settings (S3 cloud export, SES).
 *
 * Locally `AWS_ENDPOINT_URL` points every client at Floci and the static
 * `test`/`test` keys satisfy its signature check. In production both are
 * unset: the SDK resolves the regional AWS endpoint itself and finds
 * credentials through its default chain (an IAM role), so no code changes.
 */
import type { Config } from '../config';

export type AwsClientConfig = {
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

/** `endpoint` overrides `AWS_ENDPOINT_URL`, e.g. with the browser-facing one. */
export function awsClientConfig(
  config: Pick<
    Config,
    'AWS_REGION' | 'AWS_ENDPOINT_URL' | 'AWS_ACCESS_KEY_ID' | 'AWS_SECRET_ACCESS_KEY'
  >,
  endpoint: string | undefined = config.AWS_ENDPOINT_URL,
): AwsClientConfig {
  const { AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey } = config;
  return {
    region: config.AWS_REGION,
    // Omitted rather than `undefined`, so the SDK's own resolution runs.
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(accessKeyId !== undefined && secretAccessKey !== undefined
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  };
}

/** The `name: message` of an AWS SDK error, without anything else it carries. */
export function describeAwsError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return 'unknown error';
}
