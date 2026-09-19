/**
 * Snooze (SPEC.md §4.9).
 *
 * A **tap** snoozes for 15 minutes — the one-tap default. A **long press**, a
 * right click, or the keyboard context-menu key opens a bottom sheet offering
 * 15 minutes / 1 hour / 3 hours, each showing the time it would run to, with 15
 * minutes highlighted as the default.
 *
 * The resulting instants come from `addMinutes` + `formatTime` in `@beta/core`,
 * so the sheet and the optimistic cache patch agree to the minute.
 */
import * as React from 'react';
import { AlarmClock } from 'lucide-react';
import { type SnoozeMinutes, addMinutes, formatTime } from '@beta/core';
import { Button, Sheet, SheetContent } from '@/components/ui';
import { cn } from '@/lib/utils';

/** How long a press has to be held before it counts as a long press. */
export const LONG_PRESS_MS = 450;

/** SPEC §6 "Actions": the only three durations the API accepts. */
const OPTIONS: readonly { minutes: SnoozeMinutes; label: string }[] = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
];

const DEFAULT_MINUTES: SnoozeMinutes = 15;

export type SnoozeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habitName: string;
  /** The instant the offsets are measured from — the ticking `now`. */
  now: number;
  timeZone: string;
  onSelect: (minutes: SnoozeMinutes) => void;
};

export function SnoozeSheet({
  open,
  onOpenChange,
  habitName,
  now,
  timeZone,
  onSelect,
}: SnoozeSheetProps): React.ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={`Snooze ${habitName}`} description="Pick how long to push it back.">
        <div className="flex flex-col gap-2 pt-3">
          {OPTIONS.map((option) => (
            <Button
              key={option.minutes}
              variant={option.minutes === DEFAULT_MINUTES ? 'primary' : 'secondary'}
              fullWidth
              className="justify-between"
              onClick={() => {
                onSelect(option.minutes);
                onOpenChange(false);
              }}
            >
              <span>{option.label}</span>
              <span className="font-mono text-sm opacity-80">
                {`until ${formatTime(addMinutes(now, option.minutes), timeZone)}`}
              </span>
            </Button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export type SnoozeControlProps = {
  habitName: string;
  now: number;
  timeZone: string;
  onSnooze: (minutes: SnoozeMinutes) => void;
  /** `text` is the next-up card's 48px button; `icon` is the dense row button. */
  appearance?: 'text' | 'icon';
  disabled?: boolean;
};

/**
 * The snooze trigger and its sheet. The press timer lives in a ref and is
 * cleared on pointer up, on pointer cancel and on unmount, so a row that leaves
 * the screen mid-press never fires.
 */
export function SnoozeControl({
  habitName,
  now,
  timeZone,
  onSnooze,
  appearance = 'text',
  disabled = false,
}: SnoozeControlProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = React.useRef(false);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearTimer, [clearTimer]);

  function handlePointerDown(): void {
    longPressedRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      timerRef.current = null;
      setOpen(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerEnd(): void {
    clearTimer();
  }

  function handleClick(): void {
    // The long press already opened the sheet; the click that follows the
    // release must not also snooze for the default 15 minutes.
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    onSnooze(DEFAULT_MINUTES);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    // The Menu / Applications key is the keyboard equivalent of a right click.
    if (event.key === 'ContextMenu') {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <Button
        variant={appearance === 'text' ? 'secondary' : 'ghost'}
        size={appearance === 'text' ? 'default' : 'iconSm'}
        aria-label={appearance === 'text' ? undefined : `Snooze ${habitName}`}
        disabled={disabled}
        className={cn(appearance === 'text' && 'h-12 px-4')}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          clearTimer();
          longPressedRef.current = true;
          setOpen(true);
        }}
        onClick={handleClick}
      >
        {appearance === 'text' ? 'Snooze' : <AlarmClock aria-hidden="true" />}
      </Button>

      <SnoozeSheet
        open={open}
        onOpenChange={setOpen}
        habitName={habitName}
        now={now}
        timeZone={timeZone}
        onSelect={onSnooze}
      />
    </>
  );
}
