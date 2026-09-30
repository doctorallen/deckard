import { pinKey } from '../../core/storage/preferences';
import { PinnedNote } from '../../core/types';

/**
 * What Home's pinned notes point at: the rules are in `domain/notes/pins`,
 * and a pin's identity is the preferences schema's `pinKey`.
 */

export { createPinForLine, findPinnedSection, resolvePin } from '../../domain/notes/pins';

/** A pin's identity, which a row sends back to unpin it. */
export { pinKey };

/** Whether two pins name the same thing. */
export function samePin(left: PinnedNote, right: PinnedNote): boolean {
  return pinKey(left) === pinKey(right);
}
