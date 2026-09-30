import { Emitter } from '../emitter';
import type { Event } from '../../ports/events';

/**
 * What Deckard remembers of its own writes to the notes: the last write, so
 * Undo can take it back, and the notes it has just saved, so the index reads
 * them back at once.
 *
 * One of each exists for a window, created where the extension starts and
 * handed to every command that writes and to the indexer, so a test builds
 * its own and nothing it does reaches another test's.
 */

/** How long a note Deckard saved counts as its own save, in milliseconds. */
const OWN_WRITE_MS = 5000;

/**
 * Notes Deckard itself has just written, so the index reads them back at
 * once rather than after the 200 ms it waits out a burst of typing.
 *
 * A card moved on the board is written and saved by Deckard; the board then
 * waited the debounce for the index to catch up with a change it made
 * itself. A save the reader makes is still debounced. Each note expires
 * after a few seconds, so a note never picked up does not linger.
 */
export class OwnWrites {
  private readonly until = new Map<string, number>();

  /** Marks a note as about to be saved by Deckard. `uri` is its string form. */
  public note(uri: string, now = Date.now()): void {
    this.until.set(uri, now + OWN_WRITE_MS);
  }

  /** Whether Deckard just saved this note, forgetting it once asked. */
  public take(uri: string, now = Date.now()): boolean {
    const until = this.until.get(uri);
    this.until.delete(uri);
    return until !== undefined && until >= now;
  }
}

/** What the history needs of a write: whether it changed any note. */
export interface RecordedWrite {
  readonly notes: readonly unknown[];
}

/**
 * A write as the history saw it the moment it landed, which can say later
 * whether it is still the write an Undo would take back.
 */
export interface WriteMark {
  /**
   * Whether nothing has replaced or cleared the last write since this mark
   * was taken. A write that changed no note leaves nothing to take back, so
   * its mark holds only while there is still nothing.
   */
  isLatest(): boolean;
}

/**
 * The last write, and only the last: further back is what Git is for, and
 * keeping every write would keep a copy of every note it touched.
 */
export class WriteHistory<Write extends RecordedWrite> {
  private last: Write | undefined;
  private readonly changeEmitter = new Emitter<boolean>();
  /** Fires with whether there is a write to take back, as that changes. */
  public readonly onDidChange: Event<boolean> = this.changeEmitter.event;
  /** The notes Deckard has just saved, which the indexer reads back at once. */
  public readonly ownWrites = new OwnWrites();

  /** The write an Undo would take back, if there is one. */
  public get lastWrite(): Write | undefined {
    return this.last;
  }

  /**
   * Keeps a write as the last. One that changed no note leaves nothing to
   * take back, so it clears the write before it too.
   */
  public remember(write: Write): void {
    this.setLast(write.notes.length > 0 ? write : undefined);
  }

  /** Forgets the last write, as an Undo of it does. */
  public clear(): void {
    this.setLast(undefined);
  }

  /**
   * Marks the last write as it is now, so an Undo offered for it can later
   * tell whether Deckard has written since.
   */
  public mark(): WriteMark {
    const mine = this.last;
    return { isLatest: () => this.last === mine };
  }

  private setLast(write: Write | undefined): void {
    const had = this.last !== undefined;
    this.last = write;
    if (had !== (write !== undefined)) {
      this.changeEmitter.fire(write !== undefined);
    }
  }
}
