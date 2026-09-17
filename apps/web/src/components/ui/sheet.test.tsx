import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from './sheet';

function SnoozeSheet({ hideTitle = false }: { hideTitle?: boolean }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Snooze</Button>
      </SheetTrigger>
      <SheetContent title="Snooze options" hideTitle={hideTitle}>
        <Button>15 minutes</Button>
        <Button>1 hour</Button>
        <SheetClose asChild>
          <Button variant="ghost">Cancel</Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

describe('Sheet', () => {
  it('opens from its trigger and exposes its accessible name', async () => {
    const user = userEvent.setup();
    render(<SnoozeSheet />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Snooze' }));

    const dialog = await screen.findByRole('dialog', { name: 'Snooze options' });
    expect(within(dialog).getByRole('button', { name: '15 minutes' })).toBeInTheDocument();
  });

  it('keeps the accessible name when the title is visually hidden', async () => {
    const user = userEvent.setup();
    render(<SnoozeSheet hideTitle />);

    await user.click(screen.getByRole('button', { name: 'Snooze' }));
    expect(await screen.findByRole('dialog', { name: 'Snooze options' })).toBeInTheDocument();
  });

  it('moves focus inside the sheet and traps it there', async () => {
    const user = userEvent.setup();
    render(<SnoozeSheet />);

    await user.click(screen.getByRole('button', { name: 'Snooze' }));
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await user.tab();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<SnoozeSheet />);

    const trigger = screen.getByRole('button', { name: 'Snooze' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes from a SheetClose child', async () => {
    const user = userEvent.setup();
    render(<SnoozeSheet />);

    await user.click(screen.getByRole('button', { name: 'Snooze' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
