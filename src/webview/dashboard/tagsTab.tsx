/**
 * The Tags tab: every tag, its search box, its namespace filter and sort,
 * favorites above the rest, and the saved searches under them.
 */
import type { DashboardTag } from '../../ui/protocol/dashboard';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import { EmptyState } from '../shared/emptyState';
import { SortIcon } from '../shared/strokeIcons';
import { FilterIcon } from './icons';
import type { DashboardDraw } from './model';
import { SavedFilterList } from './rows';
import { NO_TAG_NAMESPACE, formatTagDisplay, type TagFilter } from './tagNames';

/** What the Tags tab is drawn from: the page, the tags its search and filter leave, and how many times its lists were changed outside a draw. */
export interface TagsTabProps extends DashboardDraw {
  readonly filter: TagFilter;
  /** Keys the tag lists, so a list a drag changed is drawn afresh. */
  readonly generation: number;
}

/** One way the Tags tab can be narrowed: a select whose value the page reads back. */
interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

/** The choice a select shows: the one wanted, or, when none matches, the first, as a select falls back to. */
function shownChoice(options: readonly ChoiceOption[], wanted: string): string {
  return options.some((option) => option.value === wanted) ? wanted : options[0].value;
}

/** The namespace filter, when any tag is written under one. */
function NamespaceControl({ filter }: { readonly filter: TagFilter }) {
  if (!filter.namespaces.length) {
    return null;
  }
  const options: ChoiceOption[] = [
    { value: '', label: 'All' },
    ...filter.namespaces.map((namespace) => ({ value: namespace, label: formatKeyWords(namespace) })),
    ...(filter.hasTagsWithoutNamespace ? [{ value: NO_TAG_NAMESPACE, label: 'None' }] : []),
  ];
  return (
    <label class="control-label">
      Namespace:
      <span class="control-icon">
        <select data-action="set-tag-namespace" data-has-query={filter.activeNamespace ? '' : undefined} aria-label="Filter tags by namespace" value={shownChoice(options, filter.activeNamespace)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <FilterIcon />
      </span>
    </label>
  );
}

/** How the tags are sorted. */
const SORTS: readonly ChoiceOption[] = [
  { value: 'alphabetical', label: 'A-Z' },
  { value: 'count', label: 'Entry Count' },
  { value: 'access', label: 'Most accessed' },
  { value: 'custom', label: 'Rank' },
];

/** The sort, A to Z, by count, by use, or by the reader's own rank. */
function SortControl({ mode }: { readonly mode: string }) {
  return (
    <label class="control-label">
      Sort:
      <span class="control-icon">
        <select data-action="set-sort" aria-label="Sort tags" value={shownChoice(SORTS, mode)}>
          {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <SortIcon />
      </span>
    </label>
  );
}

/**
 * The line above a list a search is narrowing. Searches are kept between
 * visits, so a list that comes back narrowed says so, with a way out.
 */
function SearchNotice({ shown, total, noun, query }: { readonly shown: number; readonly total: number; readonly noun: string; readonly query: string }) {
  const text = query.trim();
  return (
    <div class="search-notice" role="status">
      <span>Showing <strong>{shown}</strong>{` of ${total} ${noun}${text ? ` matching “${text}”` : ''}`}</span>
      <button data-action="clear-tag-search">Clear</button>
    </div>
  );
}

/** One tag: its name and count, its namespace, and its heart. */
function TagRow({ tag, draggable }: { readonly tag: DashboardTag; readonly draggable: boolean }) {
  const display = formatTagDisplay(tag);
  const displayLabel = display.namespace ? `${display.name} ${display.namespace}` : display.name;
  return (
    <div class={draggable ? 'row tag-row is-draggable' : 'row tag-row'} draggable={false} tabIndex={0} data-tip-around="" data-tag-key={tag.key}>
      <div class="tag-main"><span class="tag-name">{display.name}</span><span class="tag-count">{tag.count}</span></div>
      <div class="tag-actions">
        {display.namespace ? <span class="entity-kind">{display.namespace}</span> : null}
        <button class={tag.isFavorite ? 'favorite-toggle favorite' : 'favorite-toggle'} data-action="favorite-tag" data-tag-key={tag.key} aria-label={`${tag.isFavorite ? 'Unfavorite' : 'Favorite'} ${displayLabel}`}>
          <span class="favorite-heart" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  );
}

/** Favorites, or the rest: a heading with how many, and a row per tag. */
function TagGroup(props: { readonly group: 'favorites' | 'other'; readonly tags: readonly DashboardTag[]; readonly draggable: boolean }) {
  const { group, tags, draggable } = props;
  return (
    <div class="tag-group" data-tag-group={group}>
      <h3>{group === 'favorites' ? 'Favorites ' : 'Other tags '}<span class="tag-count">{`(${tags.length})`}</span></h3>
      <div class="tag-list">{tags.map((tag) => <TagRow key={tag.key} tag={tag} draggable={draggable} />)}</div>
    </div>
  );
}

/**
 * The tags the search and filter leave, favorites first. They are drawn only
 * while the tab is open: Home redraws on every save, and a row per tag was
 * built each time for a panel kept hidden.
 */
function TagLists({ snapshot, view, filter, generation }: TagsTabProps) {
  if (view.mode !== 'browse') {
    return null;
  }
  if (!filter.shown.length) {
    return snapshot.tags.length
      ? <EmptyState as="div" state="No tags match your search." />
      : <EmptyState as="div" state="No tags indexed yet." teach="Write a tag such as #project/atlas on a heading or a task, and it appears here." />;
  }
  const draggable = snapshot.tagSortMode === 'custom';
  const favorites = filter.shown.filter((tag) => tag.isFavorite);
  const others = filter.shown.filter((tag) => !tag.isFavorite);
  return (
    <>
      {favorites.length ? <TagGroup key={`favorites-${generation}`} group="favorites" tags={favorites} draggable={draggable} /> : null}
      {others.length ? <TagGroup key={`other-${generation}`} group="other" tags={others} draggable={draggable} /> : null}
    </>
  );
}

/** The saved searches, under the tags, when there are any. */
function SavedSearches({ snapshot }: DashboardDraw) {
  if (!snapshot.savedFilters.length) {
    return null;
  }
  return (
    <section class="saved-filters" aria-labelledby="saved-filters-heading">
      <div class="section-heading"><h2 id="saved-filters-heading">{'Saved searches '}<span class="tag-count">{snapshot.savedFilters.length}</span></h2></div>
      <SavedFilterList filters={snapshot.savedFilters} />
    </section>
  );
}

/** What the notice above the tags calls them: all of them, those without a namespace, or those in one. */
function noticeNoun(filter: TagFilter): string {
  if (!filter.activeNamespace) {
    return 'tags';
  }
  return filter.activeNamespace === NO_TAG_NAMESPACE ? 'tags, without a namespace' : `tags, in ${filter.namespaceLabel}`;
}

/** The Tags tab's panel, drawn and hidden while Home is shown. */
export function TagsPanel(props: TagsTabProps) {
  const { snapshot, view, filter } = props;
  // A namespace filter narrows the tags as much as a search does, so either says so.
  const narrowed = Boolean(filter.query || filter.activeNamespace);
  return (
    <section id="browse-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="browse-tab" hidden={view.mode !== 'browse'}>
      <div class="browse-toolbar">
        <div class="browse-toolbar-controls">
          <input class="catalog-search" type="search" data-has-query={filter.query ? '' : undefined} data-action="search-browse" value={view.browseQuery} placeholder="Search tags" aria-label="Search tags" autocomplete="off" />
          <div class="control-row"><NamespaceControl filter={filter} /><SortControl mode={snapshot.tagSortMode} /></div>
        </div>
      </div>
      {narrowed ? <SearchNotice shown={filter.shown.length} total={snapshot.tags.length} noun={noticeNoun(filter)} query={view.browseQuery} /> : null}
      <TagLists {...props} />
      <SavedSearches snapshot={snapshot} view={view} />
    </section>
  );
}
