/**
 * The lists of rows that open what they count: the most viewed tags,
 * canonical tags, and note entries, and the notes nothing links to.
 */
import type { StatsAccessItem, StatsNoteItem } from '../../ui/protocol/stats';
import { EmptyState } from '../shared/emptyState';
import { TagLabel } from '../shared/tagLabel';
import type { DrawnStats, RowList } from './model';

/** A list of rows, as `AccessList` draws it. */
interface AccessListProps {
  readonly name: RowList & ('orphanNotes' | 'tagViews' | 'entityViews' | 'sectionViews');
  readonly items: ReadonlyArray<StatsAccessItem | StatsNoteItem>;
  /** What the list says when it has no rows. */
  readonly empty: string;
  /** What a row's tip says it opens. */
  readonly hint: string;
  /** Draws each label as a tag, its namespace dimmed as everywhere else a tag is shown. */
  readonly isTag?: boolean;
  /** How many rows show before the rest is asked for; every row when absent. */
  readonly shown?: number;
  /** Whether the rows past `shown` are asked for. */
  readonly showAll?: boolean;
}

/**
 * Rows that open what they list. Each row posts the message the host
 * projected for it, so the page never decides what a tag or a line opens.
 */
export function AccessList({ name, items, empty, hint, isTag, shown, showAll }: AccessListProps) {
  if (!items.length) {
    return <p class="empty">{empty}</p>;
  }
  let listClass = 'list';
  if (shown) {
    listClass += showAll ? ' orphan-list show-all' : ' orphan-list';
  }
  return (
    <ol class={listClass}>
      {items.map((item, index) => (
        <li class={shown && index >= shown ? 'is-more' : undefined}>
          <div class="row stat-row" role="button" tabIndex={0} data-tip={hint} data-list={name} data-index={index}>
            <div>
              <div class="label">{isTag ? <TagLabel label={item.label} /> : item.label}</div>
              <div class="detail">{item.detail}</div>
            </div>
            {'count' in item && item.count !== undefined ? <strong class="count">{item.count}</strong> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The three most-viewed lists: their name, title, noun, row tip, and whether rows are tags. */
const VIEW_LISTS: ReadonlyArray<readonly ['tagViews' | 'entityViews' | 'sectionViews', string, string, string, boolean]> = [
  ['tagViews', 'Most viewed tags', 'tags', 'Open tag overview', true],
  ['entityViews', 'Most viewed canonical tags', 'canonical tags', 'Open tag overview', false],
  ['sectionViews', 'Most viewed note entries', 'note entries', 'Open note entry', false],
];

/** How views are counted, said after the lists that have none yet. */
const VIEWS_COUNTED = "Views are counted when you open a tag's page or a note entry from a search page.";

/** Says which lists have no views yet. */
function describeUnviewed(empty: readonly string[]): string {
  if (empty.length === VIEW_LISTS.length) {
    return 'Nothing viewed yet.';
  }
  if (!empty.length) {
    return '';
  }
  return `Nothing viewed yet among ${empty.length === 2 ? `${empty[0]} and ${empty[1]}` : empty[0]}.`;
}

/**
 * The most viewed tags, canonical tags, and note entries. A list with
 * nothing in it folds into one line naming what has no views yet.
 */
export function ViewsSection({ state }: { readonly state: DrawnStats }) {
  const empty: string[] = [];
  const panels = VIEW_LISTS.flatMap(([name, title, noun, hint, isTag]) => {
    const items = state.snapshot[name];
    if (!items.length) {
      empty.push(noun);
      return [];
    }
    return [
      <article key={name} class="view-panel">
        <h3>{title}</h3>
        <AccessList name={name} items={items} empty="" hint={hint} isTag={isTag} />
      </article>,
    ];
  });
  const emptyLine = describeUnviewed(empty);
  return (
    <section class="stats-section" aria-labelledby="views-heading">
      <h2 id="views-heading">Most viewed</h2>
      {panels.length ? <div class="views">{panels}</div> : null}
      {emptyLine ? <EmptyState class="views-empty" state={emptyLine} teach={VIEWS_COUNTED} /> : null}
    </section>
  );
}
