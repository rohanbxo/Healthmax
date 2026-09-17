/**
 * Time source (SPEC.md §3 "Dependency injection"). Nothing in the API calls
 * `Date.now()` directly; it takes a `Clock`, so tests can pin the instant.
 */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

/** Production clock. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Test clock: starts at a fixed instant and only moves when told to. */
export class FixedClock implements Clock {
  private current: number;

  constructor(ms: number) {
    this.current = ms;
  }

  now(): number {
    return this.current;
  }

  /** Moves the clock forward (or backward, with a negative delta). */
  advance(ms: number): void {
    this.current += ms;
  }

  /** Jumps the clock to an absolute instant. */
  set(ms: number): void {
    this.current = ms;
  }
}
