/**
 * Environment validation (SPEC.md §12): the email provider rules and the AWS
 * variables. Pure — no database, no Redis.
 */
import { expect } from 'chai';
import { ConfigError, loadConfig, type EnvSource } from '../src/config';

const BASE: EnvSource = {
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://beta:beta@localhost:5433/beta',
  REDIS_URL: 'redis://localhost:6380',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
};

/** The problems `loadConfig` reports for `env`, or `[]` when it is valid. */
function problemsFor(env: EnvSource): readonly string[] {
  try {
    loadConfig({ ...BASE, ...env });
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
}

describe('config', () => {
  describe('EMAIL_PROVIDER', () => {
    it('defaults to none when nothing email-related is set', () => {
      expect(loadConfig(BASE).EMAIL_PROVIDER).to.equal('none');
    });

    it('defaults to resend when only RESEND_API_KEY is set, as before SES', () => {
      const config = loadConfig({ ...BASE, RESEND_API_KEY: 're_123', EMAIL_FROM: 'a@b.test' });
      expect(config.EMAIL_PROVIDER).to.equal('resend');
    });

    it('treats a blank EMAIL_PROVIDER as unset', () => {
      const config = loadConfig({
        ...BASE,
        EMAIL_PROVIDER: '',
        RESEND_API_KEY: 're_123',
        EMAIL_FROM: 'a@b.test',
      });
      expect(config.EMAIL_PROVIDER).to.equal('resend');
    });

    it('accepts none explicitly, even with a Resend key present', () => {
      const config = loadConfig({ ...BASE, EMAIL_PROVIDER: 'none', RESEND_API_KEY: 're_123' });
      expect(config.EMAIL_PROVIDER).to.equal('none');
    });

    it('accepts resend with a key and a sender', () => {
      const config = loadConfig({
        ...BASE,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_123',
        EMAIL_FROM: 'Beta <a@b.test>',
      });
      expect(config.EMAIL_PROVIDER).to.equal('resend');
    });

    it('requires RESEND_API_KEY and EMAIL_FROM for resend', () => {
      expect(problemsFor({ EMAIL_PROVIDER: 'resend' })).to.deep.equal([
        'EMAIL_FROM: is required when EMAIL_PROVIDER is resend',
        'RESEND_API_KEY: is required when EMAIL_PROVIDER is resend',
      ]);
    });

    it('requires EMAIL_FROM when only RESEND_API_KEY implies resend', () => {
      expect(problemsFor({ RESEND_API_KEY: 're_123' })).to.deep.equal([
        'EMAIL_FROM: is required when EMAIL_PROVIDER is resend',
      ]);
    });

    it('accepts ses with a sender and no Resend key', () => {
      const config = loadConfig({ ...BASE, EMAIL_PROVIDER: 'ses', EMAIL_FROM: 'Beta <a@b.test>' });
      expect(config.EMAIL_PROVIDER).to.equal('ses');
    });

    it('requires EMAIL_FROM for ses', () => {
      expect(problemsFor({ EMAIL_PROVIDER: 'ses' })).to.deep.equal([
        'EMAIL_FROM: is required when EMAIL_PROVIDER is ses',
      ]);
    });

    it('rejects an unknown provider', () => {
      const problems = problemsFor({ EMAIL_PROVIDER: 'sendgrid' });
      expect(problems).to.have.length(1);
      expect(problems[0]).to.match(/^EMAIL_PROVIDER: /);
    });
  });

  describe('AWS', () => {
    it('defaults to real AWS in us-east-1 with cloud export off', () => {
      const config = loadConfig(BASE);
      expect(config.AWS_REGION).to.equal('us-east-1');
      expect(config.AWS_ENDPOINT_URL).to.equal(undefined);
      expect(config.AWS_PUBLIC_ENDPOINT_URL).to.equal(undefined);
      expect(config.S3_EXPORT_BUCKET).to.equal(undefined);
      expect(config.EXPORT_URL_TTL_SECONDS).to.equal(900);
    });

    it('reads the Floci settings compose provides', () => {
      const config = loadConfig({
        ...BASE,
        AWS_REGION: 'eu-west-1',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_ENDPOINT_URL: 'http://floci:4566',
        AWS_PUBLIC_ENDPOINT_URL: 'http://localhost:4566',
        S3_EXPORT_BUCKET: 'beta-exports',
        EXPORT_URL_TTL_SECONDS: '60',
      });
      expect(config).to.include({
        AWS_REGION: 'eu-west-1',
        AWS_ENDPOINT_URL: 'http://floci:4566',
        AWS_PUBLIC_ENDPOINT_URL: 'http://localhost:4566',
        S3_EXPORT_BUCKET: 'beta-exports',
        EXPORT_URL_TTL_SECONDS: 60,
      });
    });

    it('rejects an endpoint that is not a URL', () => {
      const problems = problemsFor({ AWS_ENDPOINT_URL: 'not a url' });
      expect(problems.some((problem) => problem.startsWith('AWS_ENDPOINT_URL: '))).to.equal(true);
    });

    it('rejects a TTL beyond the SigV4 maximum', () => {
      const problems = problemsFor({ EXPORT_URL_TTL_SECONDS: '604801' });
      expect(problems).to.have.length(1);
      expect(problems[0]).to.match(/^EXPORT_URL_TTL_SECONDS: /);
    });

    it('requires both access key halves or neither', () => {
      expect(problemsFor({ AWS_ACCESS_KEY_ID: 'test' })).to.deep.equal([
        'AWS_SECRET_ACCESS_KEY: must be set together with its pair, or both left unset',
      ]);
    });

    it('never echoes a value in its problems', () => {
      const secret = 'super-secret-access-key-value';
      const problems = problemsFor({ AWS_SECRET_ACCESS_KEY: secret, EMAIL_PROVIDER: 'ses' });
      expect(problems.join('\n')).to.not.include(secret);
    });
  });
});
