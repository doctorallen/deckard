import { pinKey } from '../core/storage/preferencesSchema';
import type { PinnedNote, WorkspaceIndex } from '../domain/model';
import { createPinForLine } from '../domain/notes/pins';

/**
 * Pins by the line a reader points at: which entry a line of a note pins,
 * whether it is pinned, and pinning or unpinning it. What a pin is kept as
 * is the preferences' PinsService; this answers for a line of a note, as
 * the tag hover and Find's rows ask.
 */

/** Where pins are kept, told apart by `pinKey`. */
export interface PinStore {
  isPinned(key: string): boolean;
  pinNote(pin: PinnedNote): PromiseLike<void>;
  unpinNote(key: string): PromiseLike<void>;
}

/** What PinService reads: the index a line is resolved in, and the pins. */
export interface PinServiceOptions {
  index: { getSnapshot(): WorkspaceIndex };
  store: PinStore;
}

/**
 * A pin or unpin by line: asked of the store for the pin the line resolves
 * to (which keeps a pin once, and no more than it holds), or not asked,
 * because the index has no such note.
 */
export type PinChange =
  | { kind: 'pinned' | 'unpinned'; pin: PinnedNote }
  | { kind: 'no-entry' };

/** Pins asked for by the one-based line of a note, by its index path. */
export class PinService {
  /** Resolves lines in `options.index` and keeps pins in `options.store`. */
  public constructor(private readonly options: PinServiceOptions) {}

  /**
   * The pin for a line: the heading it sits under, or the whole note when
   * it sits above every heading. Undefined when the index has no such note.
   */
  public pinFor(filePath: string, line: number): PinnedNote | undefined {
    return createPinForLine(this.options.index.getSnapshot(), filePath, line);
  }

  /** Whether the entry a line sits in is pinned; false for a note the index lacks. */
  public isLinePinned(filePath: string, line: number): boolean {
    const pin = this.pinFor(filePath, line);
    return pin !== undefined && this.options.store.isPinned(pinKey(pin));
  }

  /** Pins the entry a line sits in, after the pins before it. */
  public async pin(filePath: string, line: number): Promise<PinChange> {
    const pin = this.pinFor(filePath, line);
    if (!pin) {
      return { kind: 'no-entry' };
    }
    await this.options.store.pinNote(pin);
    return { kind: 'pinned', pin };
  }

  /** Unpins the entry a line sits in. */
  public async unpin(filePath: string, line: number): Promise<PinChange> {
    const pin = this.pinFor(filePath, line);
    if (!pin) {
      return { kind: 'no-entry' };
    }
    await this.options.store.unpinNote(pinKey(pin));
    return { kind: 'unpinned', pin };
  }
}
