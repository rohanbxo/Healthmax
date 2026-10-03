/**
 * `S3ObjectStore` without AWS: presigning is local crypto, and uploads go to a
 * loopback server standing in for S3, so the two-endpoint design — upload
 * through the API's endpoint, sign for the browser's — is checked offline.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'chai';

import { S3ObjectStore } from '../src/lib/objectStore';

const BUCKET = 'beta-exports';
const KEY = 'exports/user-1/2026-09-17T06:00:00.000Z-abc.json';
/** As it appears in a URL: the SDK percent-encodes the colons of the ISO instant. */
const KEY_PATH = KEY.split('/').map(encodeURIComponent).join('/');
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };
const PUBLIC_ENDPOINT = 'http://localhost:4566';

type Recorded = {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
};

describe('S3ObjectStore', () => {
  let server: Server;
  let endpoint: string;
  let recorded: Recorded[];
  let reply: { status: number; body: string };

  before(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        recorded.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(reply.status, { 'Content-Type': 'application/xml', ETag: '"etag"' });
        res.end(reply.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    recorded = [];
    reply = { status: 200, body: '' };
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const store = (publicEndpoint?: string) =>
    new S3ObjectStore({
      bucket: BUCKET,
      clientConfig: { region: 'us-east-1', endpoint, credentials: CREDENTIALS },
      ...(publicEndpoint === undefined ? {} : { publicEndpoint }),
    });

  it('uploads through the internal endpoint, path-style, as encrypted JSON', async () => {
    await store(PUBLIC_ENDPOINT).putJson(KEY, { app: 'beta', habits: [] });

    expect(recorded).to.have.length(1);
    const [put] = recorded;
    expect(put?.method).to.equal('PUT');
    expect(put?.url?.split('?')[0]).to.equal(`/${BUCKET}/${KEY_PATH}`);
    expect(put?.headers['content-type']).to.equal('application/json');
    expect(put?.headers['x-amz-server-side-encryption']).to.equal('AES256');
    expect(JSON.parse(put?.body ?? '')).to.deep.equal({ app: 'beta', habits: [] });
  });

  it('signs download links for the public endpoint without a network call', async () => {
    const url = new URL(await store(PUBLIC_ENDPOINT).presignGet(KEY, 900));

    expect(url.origin).to.equal(PUBLIC_ENDPOINT);
    expect(url.pathname).to.equal(`/${BUCKET}/${KEY_PATH}`);
    expect(url.searchParams.get('X-Amz-Expires')).to.equal('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).to.equal('host');
    expect(url.searchParams.get('X-Amz-Signature')).to.match(/^[0-9a-f]{64}$/);
    expect(recorded).to.deep.equal([]);
  });

  it('signs for the internal endpoint when no public one is set', async () => {
    const url = new URL(await store().presignGet(KEY, 60));

    expect(url.origin).to.equal(endpoint);
    expect(url.pathname).to.equal(`/${BUCKET}/${KEY_PATH}`);
    expect(url.searchParams.get('X-Amz-Expires')).to.equal('60');
  });

  describe('with no endpoint configured', () => {
    // The SDK reads these itself when the client is given no endpoint, so a
    // developer's shell (or the Floci integration run) must not leak in.
    const ENDPOINT_VARS = ['AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_S3'] as const;
    const saved: Partial<Record<(typeof ENDPOINT_VARS)[number], string>> = {};

    before(() => {
      for (const name of ENDPOINT_VARS) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
    });

    after(() => {
      for (const name of ENDPOINT_VARS) {
        if (saved[name] !== undefined) process.env[name] = saved[name];
      }
    });

    it('uses the regional virtual-hosted endpoint, as in real AWS', async () => {
      const aws = new S3ObjectStore({
        bucket: BUCKET,
        clientConfig: { region: 'eu-west-1', credentials: CREDENTIALS },
      });

      const url = new URL(await aws.presignGet(KEY, 900));

      expect(url.host).to.equal(`${BUCKET}.s3.eu-west-1.amazonaws.com`);
      expect(url.pathname).to.equal(`/${KEY_PATH}`);
    });
  });

  it('reports a refused upload by AWS error name and message only', async () => {
    reply = {
      status: 403,
      body:
        '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code>' +
        '<Message>Access Denied</Message></Error>',
    };

    let failure: unknown;
    try {
      await store().putJson(KEY, { secret: 'user-data' });
    } catch (err) {
      failure = err;
    }

    expect(failure).to.be.instanceOf(Error);
    const message = (failure as Error).message;
    expect(message).to.match(/^S3 refused the upload \(AccessDenied: Access Denied\)$/);
    expect(message).to.not.include('user-data');
    expect((failure as Error).cause).to.equal(undefined);
  });

  describe('fromConfig', () => {
    const base = {
      AWS_REGION: 'us-east-1',
      AWS_ENDPOINT_URL: 'http://floci:4566',
      AWS_PUBLIC_ENDPOINT_URL: PUBLIC_ENDPOINT,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    };

    it('is disabled without a bucket', () => {
      expect(S3ObjectStore.fromConfig({ ...base, S3_EXPORT_BUCKET: undefined })).to.equal(
        undefined,
      );
    });

    it('presigns for AWS_PUBLIC_ENDPOINT_URL', async () => {
      const configured = S3ObjectStore.fromConfig({ ...base, S3_EXPORT_BUCKET: BUCKET });

      const url = new URL((await configured?.presignGet(KEY, 900)) ?? '');

      expect(url.origin).to.equal(PUBLIC_ENDPOINT);
      expect(url.pathname).to.equal(`/${BUCKET}/${KEY_PATH}`);
    });
  });
});
