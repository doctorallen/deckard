import type { Disposable, Event } from '../ports/events';

/**
 * Tells its listeners of each value it fires, as VS Code's `EventEmitter`
 * does, without needing VS Code: the core modules that announce changes use
 * this, so they run under plain mocha, and their `event` is a VS Code event
 * as far as any subscriber can tell.
 *
 * Listeners are told synchronously, in the order they subscribed. A listener
 * that throws does not stop the others, as with VS Code's emitter; its error
 * is reported to the console. A listener added or removed while a value is
 * being delivered takes effect from the next value.
 */
export class Emitter<T> implements Disposable {
  private listeners: Array<{ listener: (value: T) => unknown; thisArgs: unknown }> = [];
  private disposed = false;

  /** Subscribes to the values this emitter fires. */
  public readonly event: Event<T> = (listener, thisArgs, disposables) => {
    if (this.disposed) {
      return { dispose: () => undefined };
    }
    const entry = { listener, thisArgs };
    this.listeners = [...this.listeners, entry];
    const subscription = {
      dispose: () => {
        this.listeners = this.listeners.filter((candidate) => candidate !== entry);
      },
    };
    disposables?.push(subscription);
    return subscription;
  };

  /** Tells every listener of `value`. Does nothing once disposed. */
  public fire(value: T): void {
    for (const { listener, thisArgs } of this.listeners) {
      try {
        listener.call(thisArgs, value);
      } catch (error) {
        console.error(error);
      }
    }
  }

  /** Drops every listener; later subscriptions and values are ignored. */
  public dispose(): void {
    this.disposed = true;
    this.listeners = [];
  }
}
