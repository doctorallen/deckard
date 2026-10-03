import type { PinnedNote } from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import { PINNED_NOTE_LIMIT, pinKey } from './preferencesSchema';

/**
 * The notes and headings pinned to Home, in the order they were pinned and
 * told apart by `pinKey`. A pin is a deliberate choice: pruning never
 * removes one.
 */
export class PinsService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /** Pins a note to Home, after the notes pinned before it. */
  public async pinNote(pin: PinnedNote): Promise<void> {
    const pinnedNotes = this.repository.current.pinnedNotes ?? [];
    if (
      pinnedNotes.some((candidate) => pinKey(candidate) === pinKey(pin)) ||
      pinnedNotes.length >= PINNED_NOTE_LIMIT
    ) {
      return;
    }
    await this.repository.update({ pinnedNotes: [...pinnedNotes, pin] });
  }

  /** Unpins the pin a row names, by the key `pinKey` writes for it. */
  public async unpinNote(key: string): Promise<void> {
    await this.repository.update({
      pinnedNotes: (this.repository.current.pinnedNotes ?? []).filter(
        (candidate) => pinKey(candidate) !== key,
      ),
    });
  }

  /** Whether something is already pinned, by its key. */
  public isPinned(key: string): boolean {
    return (this.repository.current.pinnedNotes ?? []).some(
      (candidate) => pinKey(candidate) === key,
    );
  }
}
