/**
 * An entry's card details on the one line its row or card keeps for them,
 * under its date line: where it is written, the headings above it, then its
 * created and updated dates, as Card details ticks them, joined by a dot and
 * cut short with an ellipsis (provenance.css). The line is drawn at no
 * opacity until its entry is under the pointer or holds focus (reveal.css).
 */
import type { ComponentChild } from 'preact';

import { describeDates, type EntryFacts } from './entryDetails';

/** The details line, from its parts in order; nothing when no part has anything to say. */
export function DetailsLine({ parts }: { readonly parts: readonly ComponentChild[] }) {
  const shown = parts.filter((part) => part !== null && part !== undefined && part !== false && part !== '');
  if (!shown.length) {
    return null;
  }
  const line: ComponentChild[] = [];
  shown.forEach((part, index) => {
    // The dot between two parts is drawn, not read: each part says itself.
    if (index > 0) {
      line.push(<span key={`joiner-${index}`} class="entry-details-joiner" aria-hidden="true">{' · '}</span>);
    }
    line.push(part);
  });
  return <div key="details" class="entry-details" data-reveal="">{line}</div>;
}

/**
 * An entry's dates as a part of its details line, those ticked that it has,
 * "Created 2026-09-12 · Updated 2026-10-03", in the class its other parts
 * take; nothing when none is ticked or known. A function rather than a
 * component, so the line knows before it draws whether the part is there.
 */
export function entryDatesPart(facts: EntryFacts, className: string): ComponentChild {
  const dates = describeDates(facts);
  return dates ? <span key="dates" class={`${className} entry-dates`}>{dates}</span> : null;
}
