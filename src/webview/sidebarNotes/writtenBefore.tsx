/**
 * Written before, above the related notes: the older lines of other notes
 * like the line at the cursor, each a card that opens it, with the words
 * they share marked, what they share, and Link it here and Not the same
 * (docs/implementation/39-written-before.md § Where it shows). Absent when
 * the line has none.
 */
import type { SidebarWrittenBefore } from '../../ui/protocol/sidebarNotes';

/** One older line: where and when it was written, its words, what it shares, and its two buttons. */
function WrittenBeforeCard({ match }: { readonly match: SidebarWrittenBefore }) {
  return (
    <article
      class="note written-before-card"
      tabIndex={0}
      data-tip-around=""
      data-reveal-region=""
      data-tip="Open the older line. Cmd/Ctrl-click to open it beside the note you are reading."
      data-file-path={match.filePath}
      data-line={match.line}
      data-terms={match.terms.join(' ')}
    >
      <div class="note-header">
        <h2 class="note-title">{match.where}</h2>
      </div>
      <p class="note-excerpt">{match.text}</p>
      <div class="written-before-shares help-text">{match.shares}</div>
      <div class="written-before-actions">
        <button type="button" data-action="written-before-link-here" data-tip="Write a link to the older line at the end of the line you are writing">Link it here</button>
        <button type="button" data-action="written-before-not-same" data-tip="Never offer this line beside that one again">Not the same</button>
      </div>
    </article>
  );
}

/** The section, under its label, with a card for each older line; nothing when there are none. */
export function WrittenBefore({ matches }: { readonly matches: readonly SidebarWrittenBefore[] | undefined }) {
  if (!matches || matches.length === 0) {
    return null;
  }
  return (
    <section class="written-before" aria-label="Written before">
      <span class="section-label">Written before</span>
      {matches.map((match) => <WrittenBeforeCard key={`${match.filePath}:${match.line}`} match={match} />)}
    </section>
  );
}
