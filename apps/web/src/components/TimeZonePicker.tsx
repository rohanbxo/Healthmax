/**
 * Searchable IANA timezone picker.
 *
 * `listTimeZones()` returns 400+ zones (SPEC.md §7), so the list is filtered as
 * the user types and is driven from the keyboard: Arrow keys move, Enter picks,
 * Escape closes and restores the current selection. It follows the ARIA
 * combobox pattern and, inside a `Field`, adopts that field's id and messages.
 */
import * as React from 'react';
import { Search } from 'lucide-react';
import { listTimeZones } from '@beta/core';
import { cn } from '@/lib/utils';
import { useFieldControl } from '@/components/ui';

export type TimeZonePickerProps = {
  value: string;
  onChange: (zone: string) => void;
  id?: string;
  /** Accessible name when the picker is used outside a `Field`. */
  label?: string;
  /** How many matches to render at once. */
  maxResults?: number;
  disabled?: boolean;
};

/** 'America/New_York' and 'america new york' should both match the same zone. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[_/]/g, ' ');
}

function filterZones(zones: readonly string[], query: string, limit: number): string[] {
  const needle = normalise(query.trim());
  if (needle.length === 0) return zones.slice(0, limit);
  return zones.filter((zone) => normalise(zone).includes(needle)).slice(0, limit);
}

export function TimeZonePicker({
  value,
  onChange,
  id,
  label = 'Time zone',
  maxResults = 60,
  disabled = false,
}: TimeZonePickerProps): React.ReactElement {
  const field = useFieldControl();
  const generatedId = React.useId();
  const inputId = id ?? field?.id ?? `tz-${generatedId}`;
  const listId = `${inputId}-listbox`;

  const zones = React.useMemo(() => listTimeZones(), []);
  const [query, setQuery] = React.useState(value);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Follow the selection when the parent changes it (defaults arriving late).
  React.useEffect(() => {
    setQuery(value);
  }, [value]);

  const matches = React.useMemo(
    () => filterZones(zones, query === value ? '' : query, maxResults),
    [zones, query, value, maxResults],
  );

  const totalMatches = React.useMemo(() => {
    const needle = normalise((query === value ? '' : query).trim());
    if (needle.length === 0) return zones.length;
    return zones.filter((zone) => normalise(zone).includes(needle)).length;
  }, [zones, query, value]);

  const commit = React.useCallback(
    (zone: string) => {
      onChange(zone);
      setQuery(zone);
      setOpen(false);
      setActiveIndex(0);
    },
    [onChange],
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + step + matches.length) % matches.length);
      return;
    }

    if (event.key === 'Enter') {
      if (!open) return;
      const active = matches[activeIndex];
      if (active) {
        // Enter picks the highlighted zone rather than submitting the form.
        event.preventDefault();
        commit(active);
      }
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setQuery(value);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={field ? undefined : label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined
          }
          aria-describedby={field?.['aria-describedby']}
          aria-invalid={field?.['aria-invalid']}
          required={field?.required}
          value={query}
          placeholder="Search time zones"
          className={cn(
            'h-12 w-full rounded-control border border-border bg-card pr-3.5 pl-10 text-[15px] text-text',
            'font-mono placeholder:font-sans placeholder:text-muted',
            'transition-colors outline-none focus-visible:border-accent',
            'disabled:pointer-events-none disabled:opacity-40',
            'aria-invalid:border-danger',
          )}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={(event) => {
            // Typing replaces the current zone instead of appending to it.
            event.target.select();
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} results`}
          className={cn(
            'absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto',
            'rounded-control border border-border bg-card py-1 shadow-lg',
          )}
        >
          {matches.length === 0 ? (
            <li className="px-3.5 py-2 text-sm text-muted">No matching time zone</li>
          ) : (
            matches.map((zone, index) => (
              <li
                key={zone}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={zone === value}
                // Keep focus on the input so the click is not lost to a blur.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(zone)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'cursor-pointer px-3.5 py-2 font-mono text-sm',
                  index === activeIndex ? 'bg-raised text-text' : 'text-muted',
                  zone === value && 'text-accent',
                )}
              >
                {zone}
              </li>
            ))
          )}

          {totalMatches > matches.length ? (
            <li className="px-3.5 py-2 text-xs text-muted" aria-hidden>
              Showing {matches.length} of {totalMatches} — keep typing to narrow it down.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
