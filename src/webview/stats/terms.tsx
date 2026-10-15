/**
 * Terms (docs/implementation/42-terms.md): the short terms the notes use.
 * **Used but never defined** lists those used in three entries or more
 * that nothing defines, each with where it was first used and Define…,
 * which makes a term note; a row opens the search for its uses.
 * **Defined** lists the rest with their definitions; a row opens where
 * each was defined. Both most used first.
 */
import type { StatsTermItem } from '../../ui/protocol/stats';
import type { DrawnStats } from './model';

/** "And 12 more.", under a list that shows only some of what it counts. */
function AndMore({ count }: { readonly count: number }) {
  return count > 0 ? <p class="empty">{`And ${count} more.`}</p> : null;
}

/** One list of terms: its rows, or what it says with none. */
function TermList({ name, title, items, total, empty, hint, define }: {
  readonly name: 'undefinedTerms' | 'definedTerms';
  readonly title: string;
  readonly items: readonly StatsTermItem[];
  readonly total: number;
  readonly empty: string;
  readonly hint: string;
  readonly define?: boolean;
}) {
  return (
    <article class="view-panel terms-panel">
      <h3>{`${title} (${total})`}</h3>
      {items.length
        ? (
          <ol class="list">
            {items.map((item, index) => (
              <li>
                <div class="row stat-row term-row" role="button" tabIndex={0} data-tip={hint} data-list={name} data-index={index}>
                  <div>
                    <div class="label">{item.term}</div>
                    {item.detail ? <div class="detail">{item.detail}</div> : null}
                  </div>
                  <strong class="count" aria-label={`${item.count} ${item.count === 1 ? 'entry' : 'entries'}`}>{item.count}</strong>
                  {define
                    ? <button type="button" class="merge" data-action="define-term" data-index={index} aria-label={`Define ${item.term}…`} data-tip={`Make a term note for ${item.term}`}>Define…</button>
                    : null}
                </div>
              </li>
            ))}
          </ol>
        )
        : <p class="empty">{empty}</p>}
      <AndMore count={total - items.length} />
    </article>
  );
}

/** The Terms section: the terms used but never defined, and the terms defined. */
export function TermsSection({ state }: { readonly state: DrawnStats }) {
  const snapshot = state.snapshot;
  return (
    <section class="stats-section" aria-labelledby="terms-heading">
      <h2 id="terms-heading">Terms</h2>
      <div class="views">
        <TermList
          name="undefinedTerms"
          title="Used but never defined"
          items={snapshot.undefinedTerms}
          total={snapshot.undefinedTermCount}
          empty="Every term used in three entries or more has a definition."
          hint="Search for its uses"
          define
        />
        <TermList
          name="definedTerms"
          title="Defined"
          items={snapshot.definedTerms}
          total={snapshot.definedTermCount}
          empty="No term has a definition yet. Write one as NDF (non-deliverable forward), or make a term note."
          hint="Open where it is defined"
        />
      </div>
    </section>
  );
}
