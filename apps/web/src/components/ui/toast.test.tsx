import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Toaster, ToastProvider, useToast, type ToastOptions } from './toast';

function Harness({ options }: { options: ToastOptions }) {
  const { toast, dismiss } = useToast();
  return (
    <>
      <button type="button" onClick={() => toast(options)}>
        show
      </button>
      <button type="button" onClick={() => dismiss()}>
        dismiss all
      </button>
      <Toaster />
    </>
  );
}

function renderToaster(options: ToastOptions) {
  return render(
    <ToastProvider>
      <Harness options={options} />
    </ToastProvider>,
  );
}

const show = () => act(() => screen.getByRole('button', { name: 'show' }).click());

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-dismisses after the default 5s timeout', () => {
    renderToaster({ title: 'Marked done' });

    show();
    expect(screen.getByText('Marked done')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Marked done')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Marked done')).not.toBeInTheDocument();
  });

  it('honours a custom duration', () => {
    renderToaster({ title: 'Saved', duration: 1000 });

    show();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('keeps a toast with duration 0 until it is dismissed', () => {
    renderToaster({ title: 'Sticky', duration: 0 });

    show();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Sticky')).toBeInTheDocument();

    act(() => screen.getByRole('button', { name: 'dismiss all' }).click());
    expect(screen.queryByText('Sticky')).not.toBeInTheDocument();
  });

  it('renders an action and calls its handler, then dismisses', () => {
    const onUndo = vi.fn();
    renderToaster({ title: 'Marked done', action: { label: 'UNDO', onClick: onUndo } });

    show();
    const action = screen.getByRole('button', { name: 'UNDO' });
    expect(action.className).toContain('text-accent');
    expect(action.className).toContain('font-mono');

    act(() => action.click());

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Marked done')).not.toBeInTheDocument();
  });

  it('announces politely by default and assertively for errors', () => {
    const { unmount } = renderToaster({ title: 'Marked done' });
    show();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    unmount();

    renderToaster({ title: 'Could not save', variant: 'error' });
    show();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  });

  it('pauses the timer while hovered and resumes on leave', () => {
    renderToaster({ title: 'Marked done' });
    show();

    const toast = screen.getByRole('status');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // React derives onPointerEnter/Leave from the pointerover/pointerout pair.
    act(() => {
      fireEvent.pointerOver(toast);
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Marked done')).toBeInTheDocument();

    act(() => {
      fireEvent.pointerOut(toast);
    });
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByText('Marked done')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Marked done')).not.toBeInTheDocument();
  });

  it('pauses the timer while focused inside', () => {
    renderToaster({ title: 'Marked done', action: { label: 'UNDO', onClick: () => {} } });
    show();

    act(() => {
      vi.advanceTimersByTime(3000);
      screen.getByRole('button', { name: 'UNDO' }).focus();
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Marked done')).toBeInTheDocument();
  });

  it('clears its timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderToaster({ title: 'Marked done' });
    show();
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('stacks several toasts', () => {
    renderToaster({ title: 'One' });
    show();
    show();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('throws when useToast is used outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness options={{ title: 'x' }} />)).toThrow(/ToastProvider/);
    consoleError.mockRestore();
  });
});
