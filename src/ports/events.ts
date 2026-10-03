/**
 * The shapes events and resources have across the ports: VS Code's own
 * `Disposable` and `Event` have exactly these, so a VS Code object can be
 * passed where a port expects one, and a port's can be pushed onto an
 * extension context's subscriptions, with no adapter between them.
 */

/** Something that holds a resource, a listener, or a timer until it is disposed. */
export interface Disposable {
  dispose(): unknown;
}

/**
 * A subscription to a stream of values: call it with a listener to be told
 * of each one, and dispose of what it returns to stop. When `disposables` is
 * given, the subscription is also pushed onto it, as VS Code's events do.
 */
export type Event<T> = (
  listener: (value: T) => unknown,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;
