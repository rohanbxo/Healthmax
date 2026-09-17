/**
 * Web Push delivery (SPEC.md §3, §10). The dispatcher (M9) uses the `gone`
 * result to delete dead subscriptions and `failed` to bump `failureCount`.
 */
import webpush, { WebPushError, type PushSubscription as WebPushSubscription } from 'web-push';

/** The stored shape of a browser push subscription. */
export type PushTarget = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** SPEC.md §10 "Notification payload". */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export type PushResult =
  | { status: 'ok' }
  /** 404/410: the endpoint is dead; delete the subscription. */
  | { status: 'gone'; statusCode: number }
  | { status: 'failed'; statusCode?: number; reason: string };

export interface PushSender {
  send(sub: PushTarget, payload: PushPayload): Promise<PushResult>;
}

export type VapidDetails = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

/** Production sender. VAPID keys come from the environment (SPEC.md §14). */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: VapidDetails) {}

  async send(sub: PushTarget, payload: PushPayload): Promise<PushResult> {
    const subscription: WebPushSubscription = { endpoint: sub.endpoint, keys: sub.keys };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      });
      return { status: 'ok' };
    } catch (err) {
      if (err instanceof WebPushError) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          return { status: 'gone', statusCode: err.statusCode };
        }
        return { status: 'failed', statusCode: err.statusCode, reason: err.body || err.message };
      }
      return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
    }
  }
}

type FakePushRecord = { sub: PushTarget; payload: PushPayload };

/**
 * Test double. Records every send and replays queued results, so a test can
 * make one endpoint answer `410` (SPEC.md §13 "Reminders" tests).
 */
export class FakePushSender implements PushSender {
  readonly sent: FakePushRecord[] = [];
  private readonly scripted = new Map<string, PushResult>();
  private fallback: PushResult = { status: 'ok' };

  /** Makes the next and all later sends to `endpoint` return `result`. */
  script(endpoint: string, result: PushResult): void {
    this.scripted.set(endpoint, result);
  }

  /** Changes the result used for endpoints without a script. */
  setDefault(result: PushResult): void {
    this.fallback = result;
  }

  async send(sub: PushTarget, payload: PushPayload): Promise<PushResult> {
    this.sent.push({ sub, payload });
    return this.scripted.get(sub.endpoint) ?? this.fallback;
  }

  reset(): void {
    this.sent.length = 0;
    this.scripted.clear();
    this.fallback = { status: 'ok' };
  }
}
