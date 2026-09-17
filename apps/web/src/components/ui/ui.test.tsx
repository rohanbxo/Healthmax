import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import { Card, CardContent, CardFooter, CardHeader, Row } from './card';
import { SectionLabel } from './section-label';
import { Spinner } from './spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTrigger,
} from './alert-dialog';
import { Button } from './button';

describe('cn', () => {
  it('keeps the last conflicting token utility', () => {
    expect(cn('bg-base', 'bg-card')).toBe('bg-card');
    expect(cn('text-text', 'text-danger')).toBe('text-danger');
    expect(cn('border-border', 'border-danger')).toBe('border-danger');
    expect(cn('rounded-card', 'rounded-control')).toBe('rounded-control');
  });

  it('treats text-base as the black colour token, not a font size', () => {
    // Tailwind v4 generates .text-base { color: var(--color-base) } in this app.
    expect(cn('text-sm', 'text-base')).toBe('text-sm text-base');
    expect(cn('text-base', 'text-accent')).toBe('text-accent');
  });

  it('passes the custom utilities through untouched', () => {
    expect(cn('section-label', 'text-muted')).toBe('section-label text-muted');
    expect(cn('tap-target', 'size-11')).toBe('tap-target size-11');
  });

  it('applies conditional classes', () => {
    expect(cn('a', false, undefined, ['c'])).toBe('a c');
  });
});

describe('Card and Row', () => {
  it('renders the card surface and its slots', () => {
    render(
      <Card data-testid="card">
        <CardHeader>header</CardHeader>
        <CardContent>content</CardContent>
        <CardFooter>footer</CardFooter>
      </Card>,
    );

    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('rounded-card');
    expect(card).toHaveTextContent('headercontentfooter');
  });

  it('renders a 56px list row and supports asChild', () => {
    render(
      <Row asChild>
        <li data-testid="row">Morning run</li>
      </Row>,
    );

    const row = screen.getByTestId('row');
    expect(row.tagName).toBe('LI');
    expect(row.className).toContain('min-h-14');
  });
});

describe('SectionLabel', () => {
  it('uses the mono section-label utility and the requested tone', () => {
    render(<SectionLabel tone="danger">Overdue</SectionLabel>);
    const label = screen.getByText('Overdue');
    expect(label.className).toContain('section-label');
    expect(label.className).toContain('text-danger');
  });

  it('defaults to the muted tone', () => {
    render(<SectionLabel>Later today</SectionLabel>);
    expect(screen.getByText('Later today').className).toContain('text-muted');
  });
});

describe('Badge', () => {
  it('renders the AT RISK badge with a red outline', () => {
    render(<Badge variant="outline-danger">At risk</Badge>);
    const badge = screen.getByText('At risk');
    expect(badge.className).toContain('border-danger');
    expect(badge.className).toContain('font-mono');
    expect(badge.className).toContain('uppercase');
  });
});

describe('Spinner', () => {
  it('is announced with a visually hidden label', () => {
    render(<Spinner label="Saving" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saving');
  });

  it('stops animating for reduced motion', () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain(
      'motion-reduce:animate-none',
    );
  });
});

describe('AlertDialog', () => {
  it('confirms a destructive action and closes on cancel', async () => {
    const user = userEvent.setup();
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete habit</Button>
        </AlertDialogTrigger>
        <AlertDialogContent title="Delete this habit?" description="This cannot be undone.">
          <AlertDialogFooter>
            <AlertDialogAction>Delete</AlertDialogAction>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete habit' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this habit?' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');

    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
