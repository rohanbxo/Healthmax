/**
 * A fake Web Push environment for jsdom, which has none of these APIs.
 *
 * Models just enough to exercise the real client: permission that starts
 * `default` and becomes whatever the browser "chooses", a service worker
 * registration, and a push manager that hands out one subscription.
 */
import { vi } from 'vitest';

export const TEST_ENDPOINT = 'https://push.example.com/fake-endpoint';

export type FakePushEnvironment = {
  requestPermission: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  /** The key the page passed to `pushManager.subscribe`. */
  applicationServerKey: () => Uint8Array | undefined;
  setPermission: (permission: NotificationPermission) => void;
  restore: () => void;
};

export type InstallOptions = {
  /** Permission before anything is asked. */
  permission?: NotificationPermission;
  /** What the browser answers when asked. Defaults to `permission` or granted. */
  answer?: NotificationPermission;
  /** Start with a subscription already registered in this browser. */
  existingSubscription?: boolean;
  /** Leave the APIs missing, as an unsupported browser would. */
  supported?: boolean;
};

function fakeSubscription(unsubscribe: ReturnType<typeof vi.fn>) {
  return {
    endpoint: TEST_ENDPOINT,
    toJSON: () => ({ keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' } }),
    unsubscribe,
  };
}

export function installPushEnvironment(options: InstallOptions = {}): FakePushEnvironment {
  const { permission = 'default', existingSubscription = false, supported = true } = options;
  const answer = options.answer ?? (permission === 'default' ? 'granted' : permission);

  const original = {
    Notification: Reflect.get(window, 'Notification') as unknown,
    PushManager: Reflect.get(window, 'PushManager') as unknown,
    serviceWorker: Reflect.get(navigator, 'serviceWorker') as unknown,
  };

  let current = permission;
  const unsubscribe = vi.fn(async () => true);
  let subscription: ReturnType<typeof fakeSubscription> | null = existingSubscription
    ? fakeSubscription(unsubscribe)
    : null;
  let passedKey: Uint8Array | undefined;

  const requestPermission = vi.fn(async () => {
    current = answer;
    notification.permission = current;
    return current;
  });

  const subscribe = vi.fn(async (init: { applicationServerKey?: Uint8Array }) => {
    passedKey = init.applicationServerKey;
    subscription = fakeSubscription(unsubscribe);
    return subscription;
  });

  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => subscription),
      subscribe,
    },
  };
  const register = vi.fn(async () => registration);

  const notification = { permission: current, requestPermission } as {
    permission: NotificationPermission;
    requestPermission: typeof requestPermission;
  };

  const define = (target: object, key: string, value: unknown): void => {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  };

  if (supported) {
    define(window, 'Notification', notification);
    define(window, 'PushManager', function PushManager() {});
    define(navigator, 'serviceWorker', {
      register,
      getRegistration: vi.fn(async () => registration),
    });
  } else {
    for (const key of ['Notification', 'PushManager']) {
      Reflect.deleteProperty(window, key);
    }
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }

  return {
    requestPermission,
    register,
    subscribe,
    unsubscribe,
    applicationServerKey: () => passedKey,
    setPermission: (next) => {
      current = next;
      notification.permission = next;
    },
    restore: () => {
      define(window, 'Notification', original.Notification);
      define(window, 'PushManager', original.PushManager);
      define(navigator, 'serviceWorker', original.serviceWorker);
    },
  };
}
