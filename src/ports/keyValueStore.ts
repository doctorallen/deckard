/**
 * Durable storage of values by key: the part of VS Code's `Memento` that
 * Deckard's preferences use, so `context.globalState` and
 * `context.workspaceState` are key-value stores as they are, and a test can
 * pass a map.
 */
export interface KeyValueStore {
  /** The value stored under `key`, or undefined when there is none. */
  get<T>(key: string): T | undefined;
  /** The value stored under `key`, or `defaultValue` when there is none. */
  get<T>(key: string, defaultValue: T): T;
  /** Stores `value` under `key`; undefined removes it. Settles once it is kept. */
  update(key: string, value: unknown): PromiseLike<void>;
}
