/**
 * Which details an entry shows under it, as the reader ticked them in
 * `deckard.display.cardDetails` and the page shell wrote them on the body:
 * its file and line, and its created and updated dates. The file and line
 * alone, when the body says nothing.
 */
import { formatPageDate } from './dateFormats';

/** One of the details an entry can show. */
export type EntryDetail = 'fileAndLine' | 'created' | 'updated';

/** The details ticked, read from the body each time a page draws. */
export function readEntryDetails(): ReadonlySet<EntryDetail> {
  const written = typeof document === 'undefined' ? undefined : document.body.dataset.details;
  return new Set((written ?? 'fileAndLine').split(/\s+/).filter(Boolean) as EntryDetail[]);
}

/** What an entry has to show: where it is written, and when it was created and changed. */
export interface EntryFacts {
  readonly location: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

/** An entry's location line, when its file and line are ticked: "atlas / line 4"; empty otherwise. */
export function describeLocation(facts: EntryFacts): string {
  return readEntryDetails().has('fileAndLine') ? facts.location : '';
}

/**
 * An entry's dates line, those ticked that it has: "Created 2026-09-12 ·
 * Updated 2026-10-03", in the reader's format, drawn on a line of its own
 * under where it is written. Empty when it has none of them.
 */
export function describeDates(facts: EntryFacts): string {
  const details = readEntryDetails();
  return [
    details.has('created') && facts.createdAt !== undefined ? `Created ${formatPageDate(facts.createdAt)}` : '',
    details.has('updated') && facts.updatedAt !== undefined ? `Updated ${formatPageDate(facts.updatedAt)}` : '',
  ].filter(Boolean).join(' · ');
}
