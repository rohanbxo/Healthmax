/**
 * Object storage for cloud export. Locally it is S3 on Floci; in production the
 * same code reaches real S3. Tests use `FakeObjectStore`.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Config } from '../config';
import { awsClientConfig, describeAwsError, type AwsClientConfig } from './aws';

export interface ObjectStore {
  /** Stores `body` as JSON at `key`, encrypted at rest. */
  putJson(key: string, body: unknown): Promise<void>;
  /** A time-limited GET link to `key` that needs no credentials. */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
}

export type S3ObjectStoreOptions = {
  bucket: string;
  /** How the API itself reaches S3. */
  clientConfig: AwsClientConfig;
  /** How the browser reaches S3, when that differs (`AWS_PUBLIC_ENDPOINT_URL`). */
  publicEndpoint?: string;
};

/**
 * A custom endpoint (Floci) gets path-style addressing: the virtual-host form
 * would put the bucket in the hostname, and `beta-exports.floci` resolves
 * nowhere. Real AWS keeps the SDK's default.
 */
function s3Client(clientConfig: AwsClientConfig): S3Client {
  return new S3Client({
    ...clientConfig,
    ...(clientConfig.endpoint === undefined ? {} : { forcePathStyle: true }),
  });
}

export class S3ObjectStore implements ObjectStore {
  private readonly bucket: string;
  private readonly client: S3Client;
  /**
   * Presigning gets a client of its own. SigV4 signs the `Host` header, so the
   * URL has to be signed for the host the *browser* will call: the API reaches
   * Floci as `http://floci:4566`, the browser only as `http://localhost:4566`,
   * and rewriting the host after signing would invalidate the signature.
   * Presigning is local crypto — this client never makes a network call. In
   * real AWS neither endpoint is set and both clients use the regional one.
   */
  private readonly presigner: S3Client;

  constructor(options: S3ObjectStoreOptions) {
    this.bucket = options.bucket;
    this.client = s3Client(options.clientConfig);
    this.presigner =
      options.publicEndpoint === undefined
        ? this.client
        : s3Client({ ...options.clientConfig, endpoint: options.publicEndpoint });
  }

  /** `undefined` when `S3_EXPORT_BUCKET` is unset: cloud export is disabled. */
  static fromConfig(
    config: Pick<
      Config,
      | 'AWS_REGION'
      | 'AWS_ENDPOINT_URL'
      | 'AWS_PUBLIC_ENDPOINT_URL'
      | 'AWS_ACCESS_KEY_ID'
      | 'AWS_SECRET_ACCESS_KEY'
      | 'S3_EXPORT_BUCKET'
    >,
  ): S3ObjectStore | undefined {
    if (config.S3_EXPORT_BUCKET === undefined) return undefined;
    return new S3ObjectStore({
      bucket: config.S3_EXPORT_BUCKET,
      clientConfig: awsClientConfig(config),
      ...(config.AWS_PUBLIC_ENDPOINT_URL === undefined
        ? {}
        : { publicEndpoint: config.AWS_PUBLIC_ENDPOINT_URL }),
    });
  }

  async putJson(key: string, body: unknown): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(body),
          ContentType: 'application/json',
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (err) {
      // The AWS error name and message only: the SDK error holds the request,
      // and the request holds the user's data.
      throw new Error(`S3 refused the upload (${describeAwsError(err)})`);
    }
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    try {
      return await getSignedUrl(
        this.presigner,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: ttlSeconds },
      );
    } catch (err) {
      throw new Error(`Could not presign the download (${describeAwsError(err)})`);
    }
  }
}

/** Test double: keeps every object in memory and hands out predictable links. */
export class FakeObjectStore implements ObjectStore {
  static readonly BASE_URL = 'https://fake-object-store.test';

  readonly puts: { key: string; body: unknown }[] = [];
  private failure: Error | undefined;

  /** Makes the next `putJson` reject with `error`. */
  failNextPut(error: Error = new Error('S3 refused the upload (ServiceUnavailable)')): void {
    this.failure = error;
  }

  async putJson(key: string, body: unknown): Promise<void> {
    const failure = this.failure;
    if (failure !== undefined) {
      this.failure = undefined;
      throw failure;
    }
    // A copy through JSON, so the record is exactly what S3 would hold.
    this.puts.push({ key, body: JSON.parse(JSON.stringify(body)) as unknown });
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return FakeObjectStore.urlFor(key, ttlSeconds);
  }

  static urlFor(key: string, ttlSeconds: number): string {
    return `${FakeObjectStore.BASE_URL}/${key}?ttl=${ttlSeconds}`;
  }

  /** Most recent upload, or `undefined` when nothing was stored. */
  last(): { key: string; body: unknown } | undefined {
    return this.puts[this.puts.length - 1];
  }

  reset(): void {
    this.puts.length = 0;
    this.failure = undefined;
  }
}
