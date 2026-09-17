import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, type ButtonProps } from './button';

const VARIANTS: NonNullable<ButtonProps['variant']>[] = [
  'primary',
  'secondary',
  'ghost',
  'outline',
  'danger-outline',
  'destructive',
];

describe('Button', () => {
  it('renders every variant as a button with its label', () => {
    for (const variant of VARIANTS) {
      const { unmount } = render(<Button variant={variant}>Complete</Button>);
      expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
      unmount();
    }
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Snooze</Button>);
    expect(screen.getByRole('button', { name: 'Snooze' })).toHaveAttribute('type', 'button');
  });

  it('uses black text on the accent fill for the primary action', () => {
    render(<Button variant="primary">Complete</Button>);
    const button = screen.getByRole('button', { name: 'Complete' });
    expect(button.className).toContain('bg-accent');
    expect(button.className).toContain('text-base');
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Complete
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Complete' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disables itself while loading, announces busy and keeps the label in the layout', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Complete
      </Button>,
    );

    const button = screen.getByRole('button', { name: /Complete/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    // The label stays mounted (invisible) so the button keeps its width.
    expect(button).toHaveTextContent('Complete');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards asChild to a single child element', () => {
    render(
      <Button asChild variant="primary">
        <a href="/habits/new">Add your first habit</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Add your first habit' });
    expect(link).toHaveAttribute('href', '/habits/new');
    expect(link.className).toContain('bg-accent');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks an asChild button aria-disabled while loading', () => {
    render(
      <Button asChild loading>
        <a href="/x">Go</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: /Go/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('forwards a ref to the underlying button', () => {
    const ref = { current: null } as React.MutableRefObject<HTMLButtonElement | null>;
    render(<Button ref={ref}>Skip</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('keeps an accessible name for icon-only buttons', () => {
    render(
      <Button size="icon" aria-label="Snooze 15 minutes">
        <svg />
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Snooze 15 minutes' })).toBeInTheDocument();
  });
});
