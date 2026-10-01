/**
 * How often tags are used: six bars, each saying its count. Used once
 * unfolds its tags, each with the tag it looks like and Merge, or Merge
 * into…; any other bar offers its tags to open.
 */
import type { ComponentChildren } from 'preact';

import type { StatsTagBand, StatsTagUsage } from '../../ui/protocol/stats';
import { TagLabel } from '../shared/tagLabel';
import { counted } from './model';

/**
 * One bar and its words. A style attribute is refused by the page's policy,
 * so the bar's height is set through the DOM, as a share of the tallest.
 */
function BandBar({ band, height }: { readonly band: StatsTagBand; readonly height: number }) {
  return [
    <span class="tag-use-track" aria-hidden="true">
      <span class="tag-use-bar" data-height={height} style={{ height: `${height}%` }}></span>
    </span>,
    <span class="tag-use-words">{`${band.label}: ${counted(band.count, 'tag', 'tags')}`}</span>,
  ];
}

/** One band: a plain bar when no tag is in it, Used once's fold, or a bar that offers its tags. */
function Band({ band, index, most, showUsedOnce }: {
  readonly band: StatsTagBand;
  readonly index: number;
  readonly most: number;
  readonly showUsedOnce: boolean;
}) {
  const inner: ComponentChildren = <BandBar band={band} height={Math.round((band.count / most) * 100)} />;
  if (!band.count) {
    return <div class="tag-use-band">{inner}</div>;
  }
  return band.min === 1 && band.max === 1
    ? (
      <button type="button" class="tag-use-band" data-action="toggle-used-once" aria-expanded={showUsedOnce} aria-controls="used-once-list" data-tip="List the tags used once, to merge the ones that repeat another">
        {inner}
      </button>
    )
    : <button type="button" class="tag-use-band" data-action="open-tag-band" data-band={index} data-tip="Choose one of these tags to open">{inner}</button>;
}

/** The tags used once, each with its lookalike and Merge, or with Merge into…. */
function UsedOnceList({ usage }: { readonly usage: StatsTagUsage }) {
  return (
    <article class="view-panel used-once" id="used-once-list">
      <h3>{`Tags used once (${usage.usedOnceCount})`}</h3>
      <ol class="list">
        {usage.usedOnce.map((tag, index) => (
          <li>
            <div class="row stat-row">
              <div class="label pair">
                <button type="button" class="tag-open pair-tag" data-action="open-used-once" data-index={index} data-tip="Open this tag in a search page"><TagLabel label={tag.label} /></button>
                {tag.lookalike ? <span class="pair-arrow" aria-hidden="true">→</span> : null}
                {tag.lookalike
                  ? <button type="button" class="tag-open pair-tag" data-action="open-used-once" data-index={index} data-side="target" data-tip="Open this tag in a search page"><TagLabel label={tag.lookalike.label} /></button>
                  : null}
              </div>
              {tag.lookalike
                ? <button type="button" class="merge" data-action="merge-used-once" data-index={index} aria-label={`Merge ${tag.label} into ${tag.lookalike.label}`} data-tip={`Merge ${tag.label} into ${tag.lookalike.label}`}>Merge</button>
                : <button type="button" class="merge" data-action="merge-used-once-into" data-index={index} aria-label={`Merge ${tag.label} into another tag`} data-tip={`Choose a tag to merge ${tag.label} into`}>Merge into…</button>}
            </div>
          </li>
        ))}
      </ol>
      {usage.usedOnceCount - usage.usedOnce.length > 0
        ? <p class="empty">{`And ${usage.usedOnceCount - usage.usedOnce.length} more.`}</p>
        : null}
    </article>
  );
}

/** How often tags are used, when any tag is; nothing otherwise. */
export function TagUseSection({ usage, showUsedOnce }: { readonly usage: StatsTagUsage | undefined; readonly showUsedOnce: boolean }) {
  if (!usage || !usage.bands.some((band) => band.count > 0)) {
    return null;
  }
  const most = Math.max(...usage.bands.map((band) => band.count), 1);
  return (
    <section class="stats-section" aria-labelledby="tag-use-heading">
      <h2 id="tag-use-heading">How often tags are used</h2>
      <div class="tag-use">
        {usage.bands.map((band, index) => <Band band={band} index={index} most={most} showUsedOnce={showUsedOnce} />)}
      </div>
      {showUsedOnce && usage.usedOnce.length ? <UsedOnceList usage={usage} /> : null}
    </section>
  );
}
