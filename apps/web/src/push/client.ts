/**
 * Browser-side push plumbing (SPEC.md §10 "Web client").
 *
 * Everything that touches a browser API that may be missing lives here, behind
 * narrow functions the React layer can call and the tests can stub. Nothing
 * here asks for permission on its own: `enable()` must be called from a user
 * gesture, because that is the only time Chrome and Safari will show the
 * prompt — and because SPEC.md §10 says never on page load.
 */
import { apiFetch } from '@/api/client';

/** Where Vite emits `src/sw/sw.ts` (see `vite.config.ts`). */
export const SERVICE_WORKER_URL = '/sw.js';

export type PushPermission = NotificationPermission | 'unsupported';

/** Web Push needs all three: a worker, a push manager and the Notification API. */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function currentPermission(): PushPermission {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * The VAPID key is base64url; `PushManager.subscribe` wants raw bytes.
 * Exported for its own test — an off-by-one here fails only in the browser.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Backed by a plain `ArrayBuffer`, which is what `BufferSource` wants.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  if (existing) return existing;
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, { type: 'module' });
}

/** The subscription this browser already holds for us, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return (await existing?.pushManager.getSubscription()) ?? null;
}

function toBody(subscription: PushSubscription): Record<string, unknown> {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    ...(typeof navigator.userAgent === 'string' && navigator.userAgent !== ''
      ? { userAgent: navigator.userAgent.slice(0, 512) }
      : {}),
  };
}

export class PushUnavailableError extends Error {
  public override readonly name = 'PushUnavailableError';
}

/**
 * Registers the worker, asks for permission, subscribes and tells the server.
 * Returns the permission the user chose, so the caller can stop asking.
 *
 * Call it from a click handler.
 */
export async function enablePush(): Promise<PushPermission> {
  if (!isPushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;

  const { publicKey } = await apiFetch<{ publicKey: string }>('/push/vapid-public-key');
  const ready = await registration();
  const subscription =
    (await ready.pushManager.getSubscription()) ??
    (await ready.pushManager.subscribe({
      // Chrome refuses a subscription that is not shown to the user.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await apiFetch<void>('/push/subscriptions', { method: 'POST', body: toBody(subscription) });
  return 'granted';
}

/** Drops the browser's subscription and the server's record of it. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription === null) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await apiFetch<void>('/push/subscriptions', { method: 'DELETE', body: { endpoint } });
}
