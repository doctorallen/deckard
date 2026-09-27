/**
 * Notes Deckard itself has just written, so the index reads them back at
 * once rather than after the 200 ms it waits out a burst of typing.
 *
 * A card moved on the board is written and saved by Deckard; the board then
 * waited the debounce for the index to catch up with a change it made
 * itself. A save the reader makes is still debounced. Each note expires
 * after a few seconds, so a note never picked up does not linger.
 */
const OWN_WRITE_MS = 5000;
const ownWrites = new Map<string, number>();

/** Marks a note as about to be saved by Deckard. `uri` is its string form. */
export function noteOwnWrite(uri: string, now = Date.now()): void {
  ownWrites.set(uri, now + OWN_WRITE_MS);
}

/** Whether Deckard just saved this note, forgetting it once asked. */
export function takeOwnWrite(uri: string, now = Date.now()): boolean {
  const until = ownWrites.get(uri);
  ownWrites.delete(uri);
  return until !== undefined && until >= now;
}
