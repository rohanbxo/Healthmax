/**
 * The service worker (SPEC.md §10 "Web client").
 *
 * Two handlers and nothing else. **No offline caching** — it is explicitly out
 * of scope (SPEC.md §16), and a stale cache of a reminder app is worse than no
 * cache at all.
 *
 *  - `push`: show the notification the dispatcher sent.
 *  - `notificationclick`: focus an open tab, or open one.
 *
 * The payload is the server's `PushPayload` (SPEC.md §10 "Notification
 * payload"); `tag` makes a repeat for the same habit and day replace the
 * previous notification instead of stacking.
 *
 * The worker globals are typed structurally rather than with `lib.webworker`:
 * that lib cannot be mixed into the app's DOM build, and a second tsconfig
 * just for this file would put it out of reach of its own test. The surface
 * used here is five methods wide, so the types below say exactly what it needs.
 */
export type WorkerClient = {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
};

type WorkerGlobal = {
  addEventListener(type: 'push', listener: (event: SwPushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: SwNotificationEvent) => void): void;
  addEventListener(type: 'install', listener: () => void): void;
  addEventListener(type: 'activate', listener: (event: SwLifecycleEvent) => void): void;
  skipWaiting(): Promise<void>;
  location: { origin: string };
  registration: {
    showNotification(title: string, options: Record<string, unknown>): Promise<void>;
  };
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WorkerClient[]>;
    openWindow(url: string): Promise<unknown>;
    claim(): Promise<void>;
  };
};

type SwLifecycleEvent = { waitUntil(promise: Promise<unknown>): void };

type SwPushEvent = {
  data: { json(): unknown } | null;
  waitUntil(promise: Promise<unknown>): void;
};

type SwNotificationEvent = {
  notification: { close(): void; data?: unknown };
  waitUntil(promise: Promise<unknown>): void;
};

const worker = self as unknown as WorkerGlobal;

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

const FALLBACK: PushPayload = {
  title: 'Beta',
  body: 'Something is due.',
  url: '/',
  tag: 'beta:fallback',
};

/** A push with no body, or one this version cannot read, still shows something. */
function readPayload(event: SwPushEvent): PushPayload {
  try {
    const data = event.data?.json() as Partial<PushPayload> | undefined;
    if (data === undefined) return FALLBACK;
    return {
      title: typeof data.title === 'string' ? data.title : FALLBACK.title,
      body: typeof data.body === 'string' ? data.body : FALLBACK.body,
      url: typeof data.url === 'string' ? data.url : FALLBACK.url,
      tag: typeof data.tag === 'string' ? data.tag : FALLBACK.tag,
    };
  } catch {
    return FALLBACK;
  }
}

/**
 * Take over as soon as a new version is installed, instead of waiting for
 * every tab to close. Without these two, an edited worker sits in `waiting`
 * and the browser keeps running the old code — so a fixed reminder bug would
 * not reach anyone still holding a tab open.
 */
worker.addEventListener('install', () => {
  void worker.skipWaiting();
});

worker.addEventListener('activate', (event: SwLifecycleEvent) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener('push', (event: SwPushEvent) => {
  const payload = readPayload(event);
  event.waitUntil(
    worker.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icon-180.png',
      badge: '/icon-180.png',
      data: { url: payload.url },
    }),
  );
});

worker.addEventListener('notificationclick', (event: SwNotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const target = new URL(data?.url ?? '/', worker.location.origin);

  event.waitUntil(
    (async () => {
      const clients = await worker.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clients) {
        // Any open tab of this app will do: focus it rather than opening a
        // second one, and take it to the target.
        if (new URL(client.url).origin === target.origin) {
          await client.focus();
          await client.navigate?.(target.href);
          return;
        }
      }
      await worker.clients.openWindow(target.href);
    })(),
  );
});
