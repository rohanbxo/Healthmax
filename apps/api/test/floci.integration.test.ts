/**
 * The real AWS clients against Floci (S3 and SES). Opt-in, because it needs the
 * emulator running and provisioned:
 *
 *     docker compose up -d floci mailpit
 *     docker compose run --rm aws-init
 *     FLOCI_TESTS=1 AWS_ENDPOINT_URL=http://localhost:4566 \
 *       pnpm exec ts-mocha -p tsconfig.test.json test/floci.integration.test.ts --timeout 20000 --exit
 *
 * Without `FLOCI_TESTS=1` the whole suite shows as pending.
 */
import { randomUUID } from 'node:crypto';
import { expect } from 'chai';
import { CreateEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2';

import { awsClientConfig } from '../src/lib/aws';
import { S3ObjectStore } from '../src/lib/objectStore';
import { SesMailer } from '../src/lib/sesMailer';

const enabled = process.env.FLOCI_TESTS === '1';

/** The environment's value, or `fallback` when it is missing or blank. */
function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value : fallback;
}

/** `Name <addr@host>` or a bare `addr@host` → the bare address SES verifies. */
function bareAddress(from: string): string {
  return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
}

type CapturedMessage = {
  Source: string;
  Destination: { ToAddresses: string[] };
  Subject: string;
  Body: { text_part: string | null; html_part: string | null };
};

(enabled ? describe : describe.skip)('Floci integration', function flociIntegration() {
  this.timeout(20_000);

  // Read here rather than at load time, so a skipped run never touches them.
  const endpoint = envOr('AWS_ENDPOINT_URL', 'http://localhost:4566').replace(/\/+$/, '');
  const bucket = envOr('S3_EXPORT_BUCKET', 'beta-exports');
  const emailFrom = envOr('EMAIL_FROM', 'Beta <no-reply@beta.test>');
  const config = {
    AWS_REGION: envOr('AWS_REGION', 'us-east-1'),
    AWS_ENDPOINT_URL: endpoint,
    AWS_ACCESS_KEY_ID: envOr('AWS_ACCESS_KEY_ID', 'test'),
    AWS_SECRET_ACCESS_KEY: envOr('AWS_SECRET_ACCESS_KEY', 'test'),
  };
  const sesCapture = `${endpoint}/_aws/ses`;

  describe('S3 cloud export', () => {
    // The test runs on the host, so the API's endpoint and the browser's are
    // the same `localhost` one here.
    const store = new S3ObjectStore({
      bucket,
      clientConfig: awsClientConfig(config),
      publicEndpoint: endpoint,
    });
    const key = `exports/integration-test/${new Date().toISOString()}-${randomUUID()}.json`;
    const body = { app: 'beta', schemaVersion: 1, note: `integration ${randomUUID()}` };

    it('stores JSON and serves it back through a presigned link', async () => {
      await store.putJson(key, body);
      const url = await store.presignGet(key, 60);

      expect(new URL(url).origin).to.equal(endpoint);
      const res = await fetch(url);
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.match(/^application\/json/);
      expect(await res.json()).to.deep.equal(body);
    });

    it('refuses a presigned link whose signature was tampered with', async function tampered() {
      await store.putJson(key, body);
      // Floci only checks signatures with FLOCI_AUTH_VALIDATE_SIGNATURES and
      // FLOCI_SERVICES_S3_ENFORCE_AUTH set; by default it serves even an
      // unsigned GET, so there is nothing to assert. Real S3 always checks.
      const unsigned = await fetch(`${endpoint}/${bucket}/${key}`);
      if (unsigned.status === 200) this.skip();

      const url = new URL(await store.presignGet(key, 60));
      const signature = url.searchParams.get('X-Amz-Signature') ?? '';
      const flipped = signature.endsWith('0') ? '1' : '0';
      url.searchParams.set('X-Amz-Signature', `${signature.slice(0, -1)}${flipped}`);

      const res = await fetch(url);
      expect(res.status).to.equal(403);
    });
  });

  describe('SES email', () => {
    const ses = new SESv2Client(awsClientConfig(config));

    before(async () => {
      // `.env` may carry a different sender from the one aws-init verified, so
      // verify this run's sender here rather than depend on that.
      try {
        await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: bareAddress(emailFrom) }));
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AlreadyExistsException')) throw err;
      }
      await fetch(sesCapture, { method: 'DELETE' });
    });

    after(async () => {
      await fetch(sesCapture, { method: 'DELETE' });
    });

    it('sends through SesMailer and Floci captures the message', async () => {
      const subject = `Beta integration ${randomUUID()}`;
      const to = 'integration@beta.test';

      await new SesMailer(awsClientConfig(config), emailFrom).send({
        to,
        subject,
        html: '<p>Hello from the integration test.</p>',
        text: 'Hello from the integration test.',
      });

      const res = await fetch(sesCapture);
      expect(res.status).to.equal(200);
      const { messages } = (await res.json()) as { messages: CapturedMessage[] };
      const sent = messages.find((message) => message.Subject === subject);
      expect(sent, `a captured message with subject "${subject}"`).to.not.equal(undefined);
      expect(sent?.Destination.ToAddresses).to.deep.equal([to]);
      expect(sent?.Source).to.include(bareAddress(emailFrom));
      expect(sent?.Body.text_part).to.equal('Hello from the integration test.');
    });
  });
});
