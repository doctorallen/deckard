/**
 * Refine in the sidebar: while a search page is in front, the values its
 * results could still be narrowed by, in place of related notes, so the
 * page keeps its height for its results. A value narrows the page's search;
 * a tag's icon beside it opens the tag in a tab of its own.
 */
import type { QueryFacet, QueryFacetValue } from '../../ui/protocol/query';
import type { SearchRefineState } from '../../ui/protocol/shared';
import { describeFacetValue, describeShare, facetValuesShown, getWeightLevel, WeightRail } from '../shared/facets';
import { OpenInNewIcon } from '../shared/strokeIcons';
import { TagLabel } from '../shared/tagLabel';

/** A facet whose values are tags, drawn as tag rows with the icon that opens each. */
function isTagFacet(facet: QueryFacet): boolean {
  return facet.id === 'related' || facet.id === 'tags';
}

/**
 * A tag value: the row narrows the search by the tag, with how strongly it
 * is related on its rail; the icon beside it opens the tag's own page in a
 * new tab.
 */
function RefineTagValue({ facet, value }: { readonly facet: QueryFacet; readonly value: QueryFacetValue }) {
  const hasStrength = typeof value.strength === 'number';
  const strength = hasStrength ? describeShare(value) : '';
  const help = describeFacetValue(value);
  return (
    <div class="refine-value">
      <button
        type="button"
        class="tag-open refine-value-open"
        data-action="refine"
        data-facet-id={facet.id}
        data-clause={value.clause}
        data-tip={help}
        aria-label={`Add ${value.label}${strength} to the search, ${value.count}. Enter adds AND, Alt-Enter adds AND NOT, Shift-Enter adds OR.`}
      >
        {hasStrength ? <WeightRail level={getWeightLevel(value.strength)} /> : null}
        <TagLabel label={value.label} />
        <span class="refine-count">{value.count}</span>
      </button>
      <button type="button" class="refine-open-tag" data-action="open-tag" data-tag-key={value.clause} aria-label={`Open ${value.label} in a new tab`} data-tip={`Open ${value.label} in a new tab`}>
        <OpenInNewIcon />
      </button>
    </div>
  );
}

/** One value of a facet: a tag opens, and every value narrows the search by itself. */
export function RefineValue({ facet, value }: { readonly facet: QueryFacet; readonly value: QueryFacetValue }) {
  if (isTagFacet(facet)) {
    return <RefineTagValue facet={facet} value={value} />;
  }
  return (
    <button
      type="button"
      class="refine-choice"
      data-action="refine"
      data-facet-id={facet.id}
      data-clause={value.clause}
      aria-label={`${facet.label}: ${value.label}, ${value.count}`}
      data-tip={describeFacetValue(value)}
    >
      <span>{value.label}</span>
      <span class="refine-count">{value.count}</span>
    </button>
  );
}

/**
 * Refine's heading, the name of the search its values narrow, since with
 * two search pages open nothing else says which one a value would change,
 * and, once there are values, how a click, Alt-click, and Shift-click add
 * one.
 */
function RefineHeading({ title, hint }: { readonly title: string; readonly hint: boolean }) {
  return (
    <div class="refine-heading">
      <h2>Refine</h2>
      {title ? <p class="refine-subject" title={title}>{title}</p> : null}
      {hint
        ? <p class="refine-hint">Selecting a value adds it to the search with AND; Alt-click adds it with AND NOT, and Shift-click with OR, widening the value chosen before it. The icon beside a tag opens it in a new tab.</p>
        : null}
    </div>
  );
}

/** What Refine is drawn from: the page's search, and the facets opened past their first five. */
export interface RefineProps {
  readonly refine: SearchRefineState;
  /** The ids of the facets the reader opened past their first five. */
  readonly expanded: ReadonlySet<string>;
}

/**
 * The active search page's Refine options, in place of related notes. The
 * page shows its own search, terms, and counts, so the sidebar shows only
 * what could narrow them: each facet's first five values, and the rest on
 * request.
 */
export function Refine({ refine, expanded }: RefineProps) {
  const query = refine.query;
  const facets = query.facets || [];
  const searched = Boolean(String(query.text || '').trim());
  const heading = <RefineHeading title={refine.title} hint={Boolean(facets.length) && searched} />;
  if (!searched) {
    return <>{heading}<div class="empty">Search on the page to see what its results could be narrowed by.</div></>;
  }
  if (!facets.length) {
    return <>{heading}<div class="empty">Nothing left to narrow by.</div></>;
  }
  return (
    <>
      {heading}
      {facets.map((facet) => {
        const shown = facetValuesShown(facet, expanded, 'refine-more');
        return (
          <section class="refine-facet" aria-label={facet.label}>
            <span class="section-label">{facet.label}</span>
            <div class="refine-values">
              {shown.values.map((value) => <RefineValue facet={facet} value={value} />)}
              {shown.more}
            </div>
          </section>
        );
      })}
    </>
  );
}
