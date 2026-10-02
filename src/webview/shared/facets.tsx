/**
 * Refine: the values a search's results could still be narrowed by, as
 * the search box shows them under a page's search and the sidebar shows
 * them for the page in front.
 */
import type { ComponentChild } from 'preact';

import type { QueryFacet, QueryFacetValue } from '../../ui/protocol/query';
import { TagLabel } from './tagLabel';

/**
 * How many values a Refine facet shows before "+N more": the page's and
 * the sidebar's Refine both read it, so they cut at the same place.
 */
export const FACET_VISIBLE = 5;

/** A facet as `facetValuesShown` reads it. */
export interface ShownFacet<V> {
  readonly id: string;
  readonly label: string;
  readonly values?: readonly V[];
}

/**
 * The values of one facet a Refine shows, and the control that shows the
 * rest or fewer, with `className`. `expanded` is the set of facet ids
 * opened in this page.
 */
export function facetValuesShown<V>(facet: ShownFacet<V>, expanded: ReadonlySet<string>, className: string): { values: readonly V[]; more: ComponentChild } {
  const all = facet.values || [];
  const open = expanded.has(facet.id);
  const values = open ? all : all.slice(0, FACET_VISIBLE);
  const hidden = all.length - FACET_VISIBLE;
  const more = hidden > 0
    ? (
      <button
        type="button"
        class={className}
        data-action="facet-more"
        data-facet-id={facet.id}
        aria-expanded={open}
        aria-label={open ? `Show fewer ${facet.label} values` : `Show ${hidden} more ${facet.label} values`}
      >
        {open ? 'Show fewer' : `+${hidden} more`}
      </button>
    )
    : null;
  return { values, more };
}

/** The rail step a weight fills to: three for 0.75 and up, two from 0.375, none for nothing. */
export function getWeightLevel(weight: unknown): number {
  const value = Number(weight);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 0.75) {
    return 3;
  }
  return value >= 0.375 ? 2 : 1;
}

/** How much a tag weighs, as a rail of three steps filled to `level`, with `title` on hover. */
export function WeightRail({ level, title }: { readonly level: number; readonly title?: string }) {
  return (
    <span class="tag-weight-rail" title={title || undefined} aria-hidden="true">
      {[0, 1, 2].map((index) => <span class={index < level ? 'tag-weight-rail-segment filled' : 'tag-weight-rail-segment'} />)}
    </span>
  );
}

/** A related tag's share of the results, as its chip says it aloud. */
function describeShare(value: QueryFacetValue): string {
  return typeof value.total === 'number'
    ? `, in ${value.count} of ${value.total} results`
    : `, related ${getWeightLevel(value.strength)} of 3`;
}

/**
 * What clicking a Refine value does to the search, in the words of the
 * query it writes. A reader is choosing between AND, OR and NOT, so the
 * tip names them rather than describing them.
 */
export function describeFacetValue(value: QueryFacetValue): string {
  const clause = value.clause || '';
  return [
    value.detail ? value.detail : '',
    `Click — AND ${clause}: keep only results that match it`,
    `Alt-click — AND NOT ${clause}: leave those results out`,
    `Shift-click — OR ${clause}: widen the last value chosen here, so either matches`,
  ].filter(Boolean).join('\n');
}

/**
 * One value of a facet, with how strongly it is related when it is a tag.
 *
 * A value is one button. The same three things are said by the click,
 * Alt-click and Shift-click the tip spells out, and a keyboard does them
 * with Enter, Alt-Enter and Shift-Enter on the focused value.
 */
export function FacetValue({ facet, value }: { readonly facet: QueryFacet; readonly value: QueryFacetValue }) {
  const isTag = facet.id === 'tags' || facet.id === 'related';
  const hasStrength = typeof value.strength === 'number';
  const name = value.label;
  const strength = hasStrength ? describeShare(value) : '';
  return (
    <button
      class="query-facet-value"
      data-action="facet"
      data-facet-id={facet.id}
      data-clause={value.clause}
      data-tip={describeFacetValue(value)}
      data-tip-overflow={name}
      aria-label={`${facet.label}: ${name}${strength}, ${value.count}. Enter adds AND ${value.clause}, Alt-Enter adds AND NOT, Shift-Enter adds OR.`}
    >
      {hasStrength ? <WeightRail level={getWeightLevel(value.strength)} /> : null}
      {isTag ? <TagLabel label={name} /> : name}
      <span class="query-facet-count">{value.count}</span>
    </button>
  );
}
