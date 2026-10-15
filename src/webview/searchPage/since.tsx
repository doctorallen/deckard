/**
 * Since you last looked (docs/implementation/37-since-you-last-looked.md):
 * the band under a tag's page's bar, when the reader last had the page
 * open over a day ago and something changed. It says when, and what
 * changed, each kind a chip: new mentions, changed fields, tasks done,
 * tasks added, and questions answered. A chip filters the Notes, Tasks, or
 * Questions tab to what it counts, as a Refine value does, and chosen again lets it go; the fields' chip opens
 * the hub card, where each changed field shows its old value. Mark seen
 * counts the visit now. Under Zen the date and counts stay, and Mark seen
 * waits.
 */
import type { SearchPageSince } from '../../ui/protocol/searchPage';

/** What each chip says it does, for its tip. */
const CHIP_TIPS: Readonly<Record<SearchPageSince['chips'][number]['kind'], string>> = {
  mentions: 'Show only the notes written or changed since',
  fields: 'Open the fields, each changed one with its old value',
  done: 'Show only the tasks done since',
  added: 'Show only the tasks added since',
  answered: 'Show only the questions answered since',
};

/** The band, or nothing when the page has none. */
export function SinceBand({ since }: { readonly since: SearchPageSince | undefined }) {
  if (!since) {
    return null;
  }
  return (
    <section class="since" aria-labelledby="since-heading" data-zen-region="">
      <div class="since-header">
        <h2 id="since-heading" class="since-title">{`Since you last looked · ${since.when}`}</h2>
        <button type="button" class="since-seen" data-action="mark-seen" data-tip="Count this visit now: the band goes, and the next one starts from here" data-zen-reveal="">Mark seen</button>
      </div>
      <div class="since-chips" role="group" aria-label="What changed">
        {since.chips.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            class={chip.active ? 'since-chip is-active' : 'since-chip'}
            data-action="since-chip"
            data-kind={chip.kind}
            aria-pressed={chip.kind === 'fields' ? undefined : chip.active === true}
            data-tip={chip.active ? 'Show everything again' : CHIP_TIPS[chip.kind]}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </section>
  );
}
