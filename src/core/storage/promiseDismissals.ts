/**
 * Not a promise (docs/implementation/41-said-they-would.md): the lines of
 * today's note the reader said are no promise, so they are not offered
 * again. Kept in VS Code's storage for the workspace, never in the notes,
 * one entry a line: its note's URI and a hash of its words, so the same words in
 * another note are offered there, and a line rewritten is offered again.
 *
 * A promise is offered only in today's note, so an old entry is never read
 * again; past the cap the oldest go first.
 */
import { Emitter } from '../../shared/emitter';
import type { Event } from '../../ports/events';
import type { KeyValueStore } from '../../ports/keyValueStore';

/** The lines marked, as `<note URI>\u0000<hash>`, the latest last. */
export const NOT_PROMISES_KEY = 'deckard.notPromises';
/** The most lines kept. */
export const NOT_PROMISES_LIMIT = 500;

/** The lines the reader said are no promise, read and written in the workspace's store. */
export class PromiseDismissals {
  private readonly changeEmitter = new Emitter<void>();
  /** Fires when a line is marked, so the editor takes its marks away. */
  public readonly onDidChange: Event<void> = this.changeEmitter.event;

  /** Over the workspace's store. */
  public constructor(private readonly store: KeyValueStore) {}

  /** Whether a line of a note, by the note's URI and the hash of its words, was marked. */
  public has(noteKey: string, lineKey: string): boolean {
    return this.read().includes(entryOf(noteKey, lineKey));
  }

  /** Marks a line of a note as no promise; past the cap the oldest mark goes. */
  public async add(noteKey: string, lineKey: string): Promise<void> {
    const entry = entryOf(noteKey, lineKey);
    const kept = this.read().filter((existing) => existing !== entry);
    await this.store.update(NOT_PROMISES_KEY, [...kept, entry].slice(-NOT_PROMISES_LIMIT));
    this.changeEmitter.fire();
  }

  /** Stops telling listeners; what was stored stays. */
  public dispose(): void {
    this.changeEmitter.dispose();
  }

  /** The marks stored; anything that is not a list of text reads as none. */
  private read(): string[] {
    const value = this.store.get<unknown>(NOT_PROMISES_KEY);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  }
}

/** One mark as it is stored. */
function entryOf(noteKey: string, lineKey: string): string {
  return `${noteKey}\u0000${lineKey}`;
}
