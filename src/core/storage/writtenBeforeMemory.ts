import { Emitter } from '../../shared/emitter';
import type { KeyValueStore } from '../../ports/keyValueStore';

/**
 * What You've written this before remembers that is not in the notes, per
 * workspace: the pairs of a line and an older line set aside with Not the
 * same, which are never offered again
 * (docs/implementation/39-written-before.md). It is kept in the
 * workspace's own storage under a key of its own, apart from the
 * preferences blob: a short, capped list that means nothing outside the
 * workspace whose lines it names.
 */

/** The workspace-state key of the pairs set aside with Not the same. */
export const NOT_SAME_KEY = 'deckard.writtenBefore.notSame';
/** The most pairs kept; the oldest go first. */
export const NOT_SAME_LIMIT = 500;

/** You've written this before's memory, over the workspace's key-value store. */
export class WrittenBeforeMemory {
  private readonly changeEmitter = new Emitter<void>();
  /** Fires when a pair is set aside, so whatever shows matches shows them again. */
  public readonly onDidChange = this.changeEmitter.event;
  private rejectedSet: ReadonlySet<string> | undefined;

  /** A memory over `store`, the workspace's state. */
  public constructor(private readonly store: KeyValueStore) {}

  /** The pairs set aside with Not the same, as `notSameKey` writes them. */
  public rejected(): ReadonlySet<string> {
    this.rejectedSet ??= new Set(readStrings(this.store.get<unknown>(NOT_SAME_KEY)));
    return this.rejectedSet;
  }

  /** Sets a pair aside, so it is never offered again. */
  public async reject(key: string): Promise<void> {
    const kept = readStrings(this.store.get<unknown>(NOT_SAME_KEY)).filter((each) => each !== key);
    kept.push(key);
    await this.store.update(NOT_SAME_KEY, kept.slice(-NOT_SAME_LIMIT));
    this.rejectedSet = undefined;
    this.changeEmitter.fire();
  }

  /** Stops telling listeners of changes. */
  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** The strings in a stored list, leaving out anything else a hand edit left there. */
function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];
}
