/**
 * Cloud export: `POST /export/cloud` stores the same file `GET /export` serves
 * and answers with a presigned link to it. Storage is `FakeObjectStore`; the
 * real S3 client is covered by `objectStore.test.ts` and, against Floci, by
 * `floci.integration.test.ts`.
 */
import { expect } from 'chai';
import request from 'supertest';
import { exportDtoSchema } from '@beta/core';

import { createApp } from '../src/app';
import { RecordingEventBus } from '../src/events/bus';
import { GENERIC_INTERNAL_MESSAGE } from '../src/http/errors';
import { FakeObjectStore } from '../src/lib/objectStore';
import {
  CLOUD_EXPORT_RATE_LIMIT,
  CLOUD_EXPORT_RATE_LIMIT_MESSAGE,
} from '../src/modules/transfer/rateLimits';
import { TEST_NOW_MS, useTestApp } from './helpers/testApp';
import { bearer, expectEnvelope, registerUser, type Session } from './helpers/auth';
import { createHabit, createLog } from './helpers/factories';

const CLOUD_EXPORT_URL = '/api/export/cloud';
const EXPORT_URL = '/api/export';

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('POST /export/cloud', () => {
  const harness = useTestApp();
  const app = () => harness().app;
  const store = () => harness().objectStore;

  /** A user with one habit and one log, both named after `label`. */
  const arrange = async (label: string): Promise<Session> => {
    const session = await registerUser(app());
    const habit = await createHabit(harness().prisma, session.me.id, {
      name: `${label} habit`,
      createdDayKey: '2026-09-01',
    });
    await createLog(harness().prisma, {
      userId: session.me.id,
      habitId: habit.id,
      dayKey: '2026-09-16',
    });
    return session;
  };

  const cloudExport = (session: Session) =>
    request(app())
      .post(CLOUD_EXPORT_URL)
      .set(...bearer(session.accessToken));

  it('stores the export and answers with a presigned link to it', async () => {
    const session = await arrange('Mine');
    const ttl = harness().config.EXPORT_URL_TTL_SECONDS;

    const res = await cloudExport(session).expect(201);

    expect(Object.keys(res.body as object).sort()).to.deep.equal(['expiresAt', 'key', 'url']);
    const { url, expiresAt, key } = res.body as { url: string; expiresAt: string; key: string };
    expect(key).to.match(
      new RegExp(
        `^exports/${escapeRegExp(session.me.id)}/2026-09-17T06:00:00\\.000Z-${UUID_V4}\\.json$`,
      ),
    );
    expect(expiresAt).to.equal(new Date(TEST_NOW_MS + ttl * 1000).toISOString());
    expect(url).to.equal(FakeObjectStore.urlFor(key, ttl));

    // Exactly one object, holding exactly what `GET /export` serves.
    expect(store().puts).to.have.length(1);
    expect(store().last()?.key).to.equal(key);
    const download = await request(app())
      .get(EXPORT_URL)
      .set(...bearer(session.accessToken))
      .expect(200);
    expect(store().last()?.body).to.deep.equal(download.body);
    expect(exportDtoSchema.parse(store().last()?.body).habits).to.have.length(1);
  });

  it('gives every export its own key', async () => {
    const session = await arrange('Mine');

    const first = await cloudExport(session).expect(201);
    const second = await cloudExport(session).expect(201);

    expect(first.body.key).to.not.equal(second.body.key);
    expect(store().puts.map((put) => put.key)).to.deep.equal([first.body.key, second.body.key]);
  });

  it('404s while cloud export is not configured on the server', async () => {
    // A fresh bus: `createApp` subscribes to it, and sharing the harness bus
    // would double every handler for the suites that run after this one.
    const disabled = createApp({
      ...harness().deps,
      objectStore: undefined,
      eventBus: new RecordingEventBus(),
    });
    const session = await arrange('Mine');

    const res = await request(disabled)
      .post(CLOUD_EXPORT_URL)
      .set(...bearer(session.accessToken))
      .expect(404);

    expect(expectEnvelope(res.body, 'NOT_FOUND').message).to.equal(
      'Cloud export is not configured.',
    );
    expect(store().puts).to.deep.equal([]);
  });

  it('requires a token', async () => {
    expectEnvelope(
      (await request(app()).post(CLOUD_EXPORT_URL).expect(401)).body,
      'UNAUTHENTICATED',
    );
    expect(store().puts).to.deep.equal([]);
  });

  it('only ever exports the caller’s own data', async () => {
    const alice = await arrange('Alice');
    const bob = await arrange('Bob');

    // Nothing in the request can name another account: a query string is ignored.
    const aliceRes = await request(app())
      .post(`${CLOUD_EXPORT_URL}?userId=${bob.me.id}`)
      .set(...bearer(alice.accessToken))
      .send({ userId: bob.me.id })
      .expect(201);
    const bobRes = await cloudExport(bob).expect(201);

    const [aliceUpload, bobUpload] = store().puts;
    expect(aliceRes.body.key).to.match(new RegExp(`^exports/${escapeRegExp(alice.me.id)}/`));
    expect(bobRes.body.key).to.match(new RegExp(`^exports/${escapeRegExp(bob.me.id)}/`));
    expect(aliceUpload?.key).to.equal(aliceRes.body.key);
    expect(bobUpload?.key).to.equal(bobRes.body.key);

    const aliceData = exportDtoSchema.parse(aliceUpload?.body);
    const bobData = exportDtoSchema.parse(bobUpload?.body);
    expect(aliceData.me.id).to.equal(alice.me.id);
    expect(aliceData.habits.map((habit) => habit.name)).to.deep.equal(['Alice habit']);
    expect(bobData.me.id).to.equal(bob.me.id);
    expect(bobData.habits.map((habit) => habit.name)).to.deep.equal(['Bob habit']);
    const aliceHabitIds = new Set(aliceData.habits.map((habit) => habit.id));
    expect(aliceData.logs.every((log) => aliceHabitIds.has(log.habitId))).to.equal(true);
    expect(bobData.logs.some((log) => aliceHabitIds.has(log.habitId))).to.equal(false);
  });

  it(`is rate limited to ${CLOUD_EXPORT_RATE_LIMIT.limit} per hour per user`, async () => {
    const session = await arrange('Mine');
    const other = await arrange('Other');

    for (let i = 0; i < CLOUD_EXPORT_RATE_LIMIT.limit; i += 1) {
      await cloudExport(session).expect(201);
    }
    const limited = await cloudExport(session).expect(429);
    expect(expectEnvelope(limited.body, 'RATE_LIMITED').message).to.equal(
      CLOUD_EXPORT_RATE_LIMIT_MESSAGE,
    );
    expect(store().puts).to.have.length(CLOUD_EXPORT_RATE_LIMIT.limit);

    // Keyed by user, not shared across everyone behind one IP.
    await cloudExport(other).expect(201);
  });

  it('answers a storage failure with the generic 500, never the S3 error', async () => {
    const session = await arrange('Mine');
    store().failNextPut(new Error('S3 refused the upload (AccessDenied: bucket-policy-detail)'));

    const res = await cloudExport(session).expect(500);

    expect(expectEnvelope(res.body, 'INTERNAL').message).to.equal(GENERIC_INTERNAL_MESSAGE);
    expect(res.text).to.not.include('AccessDenied');
    expect(store().puts).to.deep.equal([]);
  });
});
