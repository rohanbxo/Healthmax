/**
 * The service worker's two handlers (SPEC.md §10 "Web client").
 *
 * jsdom is not a worker, but `self` is the window and the handlers only need
 * `registration` and `clients`, so stubbing those and dispatching the events
 * exercises the real code. The module registers its listeners on import, so
 * the stubs go in first.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const showNotification = vi.fn();
const openWindow = vi.fn();
const matchAll = vi.fn();

/** A `push`/`notificationclick` event, with the bits jsdom does not build. */
function dispatch(type: string, extra: Record<string, unknown>): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const event = Object.assign(new Event(type), extra, {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  });
  window.dispatchEvent(event);
  return Promise.all(pending).then(() => undefined);
}

const pushEvent = (payload: unknown): Promise<void> =>
  dispatch('push', { data: { json: () => payload } });

describe('service worker', () => {
  beforeAll(async () => {
    Object.defineProperty(window, 'registration', {
      value: { showNotification },
      configurable: true,
    });
    Object.defineProperty(window, 'clients', {
      value: { matchAll, openWindow },
      configurable: true,
    });
    await import('./sw');
  });

  beforeEach(() => {
    showNotification.mockClear();
    openWindow.mockClear();
    matchAll.mockReset();
    matchAll.mockResolvedValue([]);
  });

  describe('push', () => {
    it('shows the notification the dispatcher sent', async () => {
      await pushEvent({
        title: 'Evening run',
        body: 'Due now',
        url: '/',
        tag: 'habit:abc:2026-09-17',
      });

      expect(showNotification).toHaveBeenCalledTimes(1);
      const [title, options] = showNotification.mock.calls[0] as [string, NotificationOptions];
      expect(title).toBe('Evening run');
      expect(options.body).toBe('Due now');
      // The tag is what makes a repeat replace rather than stack (SPEC.md §10).
      expect(options.tag).toBe('habit:abc:2026-09-17');
      expect(options.data).toEqual({ url: '/' });
    });

    it('still shows something when the payload is unreadable', async () => {
      await dispatch('push', {
        data: {
          json: () => {
            throw new SyntaxError('not JSON');
          },
        },
      });

      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(showNotification.mock.calls[0]?.[0]).toBe('Beta');
    });

    it('fills in anything the payload left out', async () => {
      await pushEvent({ title: 'Read' });

      const [title, options] = showNotification.mock.calls[0] as [string, NotificationOptions];
      expect(title).toBe('Read');
      expect(options.body).toBe('Something is due.');
    });
  });

  describe('notificationclick', () => {
    const clickEvent = (url: string, notification: { close: () => void }) =>
      dispatch('notificationclick', {
        notification: { ...notification, data: { url } },
      });

    it('focuses an open tab instead of opening another', async () => {
      const focus = vi.fn();
      const navigate = vi.fn();
      matchAll.mockResolvedValue([{ url: `${window.location.origin}/stats`, focus, navigate }]);
      const close = vi.fn();

      await clickEvent('/', { close });

      expect(close).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(`${window.location.origin}/`);
      expect(openWindow).not.toHaveBeenCalled();
    });

    it('opens a window when nothing is open', async () => {
      await clickEvent('/', { close: vi.fn() });

      expect(openWindow).toHaveBeenCalledWith(`${window.location.origin}/`);
    });
  });
});
