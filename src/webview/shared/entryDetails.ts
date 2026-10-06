/**
 * Which details an entry shows under it, as the reader ticked them in
 * `deckard.display.cardDetails` and the page shell wrote them on the body:
 * its file and line, and a note's created and updated dates. The file and
 * line alone, when the body says nothing.
 */
export type EntryDetail = 'fileAndLine' | 'created' | 'updated';

/** The details ticked, read from the body each time a page draws. */
export function readEntryDetails(): ReadonlySet<EntryDetail> {
  const written = typeof document === 'undefined' ? undefined : document.body.dataset.details;
  return new Set((written ?? 'fileAndLine').split(/\s+/).filter(Boolean) as EntryDetail[]);
}
