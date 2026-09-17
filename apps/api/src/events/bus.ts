/**
 * Domain events (SPEC.md §10). Services emit; the handler registered in
 * `server.ts` turns them into a deduplicated `reschedule-user` job (M9).
 *
 * Handlers are intentionally fire-and-forget: emitting must never fail a
 * request, so a throwing handler is swallowed and reported to the logger.
 */

export type DomainEvent =
  | { type: 'habit.changed'; userId: string; habitId?: string }
  | { type: 'log.changed'; userId: string; habitId?: string; dayKey?: string }
  | { type: 'snooze.changed'; userId: string; habitId?: string; dayKey?: string }
  | { type: 'user.scheduleChanged'; userId: string };

export type DomainEventType = DomainEvent['type'];

export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

export type EventHandler<T extends DomainEventType = DomainEventType> = (
  event: EventOf<T>,
) => void | Promise<void>;

export interface EventBus {
  emit(event: DomainEvent): void;
  on<T extends DomainEventType>(type: T, handler: EventHandler<T>): void;
}

/** Reports a handler that threw. `server.ts` wires this to pino. */
export type EventBusErrorReporter = (error: unknown, event: DomainEvent) => void;

/** Single-process implementation — enough while API and worker share a box. */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<DomainEventType, ((event: DomainEvent) => void | Promise<void>)[]>();

  constructor(private readonly onError: EventBusErrorReporter = () => {}) {}

  on<T extends DomainEventType>(type: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type);
    const list = existing ?? [];
    if (!existing) this.handlers.set(type, list);
    list.push(handler as (event: DomainEvent) => void | Promise<void>);
  }

  emit(event: DomainEvent): void {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((error: unknown) => this.onError(error, event));
        }
      } catch (error) {
        this.onError(error, event);
      }
    }
  }
}

/** Test double: keeps every emitted event for assertions. */
export class RecordingEventBus extends InProcessEventBus {
  readonly events: DomainEvent[] = [];

  override emit(event: DomainEvent): void {
    this.events.push(event);
    super.emit(event);
  }

  reset(): void {
    this.events.length = 0;
  }
}
