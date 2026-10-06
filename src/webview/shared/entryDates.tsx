/**
 * An entry's dates, on a line of their own under where it is written: those
 * ticked in Card details, "Created 2026-09-12 · Updated 2026-10-03".
 */
import { describeDates, type EntryFacts } from './entryDetails';

/** The dates line, in the class the entry's other carried-down lines take; nothing when none is ticked or known. */
export function EntryDates({ facts, className }: { readonly facts: EntryFacts; readonly className: string }) {
  const line = describeDates(facts);
  return line ? <div key="dates" class={`${className} entry-dates`}>{line}</div> : null;
}
