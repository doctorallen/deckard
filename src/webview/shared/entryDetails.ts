/**
 * Which details an entry shows under it, as the reader ticked them in
 * `deckard.display.cardDetails` and the page shell wrote them on the body:
 * its file and line, and its created and updated dates. The file and line
 * alone, when the body says nothing.
 */
import { formatIsoDate } from '../../domain/markdown/calendar';

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

/**
 * An entry's details line, those ticked that it has: "atlas / line 4 ·
 * Created 2026-09-12 · Updated 2026-10-03". Empty when it has none of them.
 */
export function describeEntryDetails(facts: EntryFacts): string {
  const details = readEntryDetails();
  return [
    details.has('fileAndLine') ? facts.location : '',
    details.has('created') && facts.createdAt !== undefined ? `Created ${formatIsoDate(facts.createdAt)}` : '',
    details.has('updated') && facts.updatedAt !== undefined ? `Updated ${formatIsoDate(facts.updatedAt)}` : '',
  ].filter(Boolean).join(' · ');
}
