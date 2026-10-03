/**
 * The Dashboard's own stroked glyphs, drawn as the host's icons.ts writes
 * them with `strokeIcon`: the chevrons a paged widget steps with, the
 * funnel in the corner of the namespace filter, and the mark on a Tags tab
 * that a search is narrowing.
 */
import { StrokeIcon } from '../shared/strokeIcons';

/** The funnel's path, in the shared frame. */
const FUNNEL = 'M2 3h12L9 8v4l-2 1V8L2 3Z';

/** A chevron pointing left: the page before. */
export function ChevronLeftIcon() {
  return (
    <StrokeIcon>
      <path d="M10 3 5 8l5 5" />
    </StrokeIcon>
  );
}

/** A chevron pointing right: the page after. */
export function ChevronRightIcon() {
  return (
    <StrokeIcon>
      <path d="m6 3 5 5-5 5" />
    </StrokeIcon>
  );
}

/** A funnel in the corner of a select that filters. */
export function FilterIcon() {
  return (
    <StrokeIcon className="control-icon-svg">
      <path d={FUNNEL} />
    </StrokeIcon>
  );
}

/**
 * The funnel on a tab whose search has text or a filter, drawn with a class
 * of its own. The select's funnel is placed absolutely at a fixed size in
 * the select's corner; inside a tab that rule met the mark's own 100%
 * sizing, and the funnel floated over the whole page.
 */
export function TabSearchMarkIcon() {
  return (
    <StrokeIcon className="tab-search-mark-icon">
      <path d={FUNNEL} />
    </StrokeIcon>
  );
}
