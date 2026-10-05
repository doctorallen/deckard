/**
 * What a search found: its notes as cards and its tasks as rows, in two tabs
 * or side by side, each kind a page at a time, or, with the hierarchy on,
 * grouped under the tags Refine offers.
 */
import type { SearchPageSnapshot } from '../../ui/protocol/searchPage';
import type { DashboardTask } from '../../ui/protocol/shared';
import { ResultGroups } from './groups';
import { type Paging, describePageRange, PageSteps } from '../shared/pageSteps';
import { resultPanelAttributes, ResultTabs } from '../shared/resultTabs';
import { type CardDisplay, SearchCard } from '../shared/searchCard';
import { LinesIcon } from '../shared/strokeIcons';
import { TaskListRow } from '../shared/taskRow';

/** A kind of result. */
export type ResultKind = 'notes' | 'tasks';

/** Whether the results are drawn in groups: the hierarchy is on, and there is something to group. */
function isGrouped(snapshot: SearchPageSnapshot): boolean {
  return snapshot.hierarchy === 'tags' && Boolean(snapshot.groups && snapshot.groups.length);
}

/** What the results are drawn from besides the snapshot: the tab shown, and the cards opened with Show all. */
export interface ResultsView {
  readonly snapshot: SearchPageSnapshot;
  readonly activeTab: ResultKind;
  readonly openedCards: ReadonlySet<string>;
}

/**
 * A list's paging, standing in for a host that did not send any: one page
 * holding everything, which is what Home's widgets and an older saved page
 * amount to.
 */
export function pagingOf(paging: Paging | undefined, shown: number): Paging {
  if (paging && typeof paging.total === 'number') {
    return paging;
  }
  return { page: 1, size: Math.max(shown, 1), pageCount: 1, total: shown };
}

/** How many notes and tasks the whole search found, which the tabs, headings, and announcement give. */
export function resultCounts(snapshot: SearchPageSnapshot): Record<ResultKind, number> {
  return {
    notes: pagingOf(snapshot.notePaging, snapshot.sections.length).total,
    tasks: pagingOf(snapshot.taskPaging, snapshot.tasks.length).total,
  };
}

/**
 * The control that turns a list to another of its pages, with the range it
 * is showing and how many it holds. It stays while there is a choice to
 * make about it: a result that fits the smallest page is one page however
 * it is sized, and the per-page chooser would have nothing to change.
 */
function Pagination({ kind, paging, pageSizes }: { readonly kind: ResultKind; readonly paging: Paging; readonly pageSizes: readonly number[] | undefined }) {
  const sizes = pageSizes && pageSizes.length ? pageSizes : [paging.size];
  if (paging.pageCount <= 1 && paging.total <= Math.min(...sizes)) {
    return null;
  }
  return (
    <nav class="pagination" aria-label={kind === 'notes' ? 'Note pages' : 'Task pages'}>
      <span class="page-summary">
        <span class="page-range">{describePageRange(paging)}</span>
        <label class="control-label page-size">
          {'Per page:'}
          <span class="control-icon">
            <select data-action="set-results-per-page" aria-label="Results per page">
              {sizes.map((size) => <option value={size} selected={size === paging.size}>{size}</option>)}
            </select>
            <LinesIcon />
          </span>
        </label>
      </span>
      <span class="page-controls"><PageSteps paging={paging} action="set-result-page" attributes={{ 'data-kind': kind }} noun={kind} /></span>
    </nav>
  );
}

/**
 * Bulk Edit and Export, beside the heading they act on rather than out with
 * the controls that change how the pane is shown; nothing for no results.
 */
function PaneActions({ kind, count }: { readonly kind: ResultKind; readonly count: number }) {
  if (!count) {
    return null;
  }
  const edit = kind === 'tasks' ? 'Bulk edit these tasks' : 'Bulk edit these notes';
  const exported = kind === 'tasks' ? 'Export these tasks' : 'Export these notes';
  return (
    <div class="overview-pane-actions">
      <button type="button" class="edit-results" data-action="edit-results" data-kind={kind} data-tip={`${edit}: complete them, date them, or tag them`} aria-label={edit}>Bulk edit</button>
      <button type="button" class="edit-results" data-action="export-results" data-kind={kind} data-tip={`${exported} as a Markdown table, a list, or CSV: copy, or save to a file`} aria-label={exported}>
        {kind === 'tasks' ? 'Export tasks' : 'Export notes'}
      </button>
    </div>
  );
}

/**
 * An empty side of a search that found something on the other side: the
 * count is in the tab strip, but this says the results are one click away.
 */
function OtherResults({ kind, view }: { readonly kind: ResultKind; readonly view: ResultsView }) {
  if (view.snapshot.layout === 'split') {
    return null;
  }
  const counts = resultCounts(view.snapshot);
  const otherCount = kind === 'notes' ? counts.tasks : counts.notes;
  if (!otherCount) {
    return null;
  }
  const other = kind === 'notes' ? 'tasks' : 'notes';
  const noun = otherCount === 1 ? other.slice(0, -1) : other;
  return <p class="empty-action"><button data-action="show-other-results" data-tab={other}>{`Show ${otherCount} matching ${noun}`}</button></p>;
}

/** A pane's heading, with its count in the side-by-side layout, where there are no tabs to carry it. */
function PaneHeader({ kind, view }: { readonly kind: ResultKind; readonly view: ResultsView }) {
  const count = resultCounts(view.snapshot)[kind];
  const heading = kind === 'notes' ? 'Notes' : 'Tasks';
  return (
    <div class="overview-pane-header">
      <h2 id={`${kind}-heading`} class="overview-pane-heading">
        {/* One text node before the count, as the template wrote it: Chrome lays out a node's edge apart. */}
        {view.snapshot.layout === 'split' ? [`${heading} (`, <span data-search-count={kind}>{count}</span>, ')'] : heading}
      </h2>
      <PaneActions kind={kind} count={count} />
    </div>
  );
}

/** What the empty notes pane says: nothing carries the tag, nothing matches, or there are no notes. */
function emptyNotesMessage(snapshot: SearchPageSnapshot): string {
  // A draft narrows the results as surely as the search does, so an empty
  // list is answering the draft, not reporting on the tag.
  const drafting = Boolean(snapshot.draftWords && snapshot.draftWords.length);
  const hasText = Boolean(String(snapshot.query.text || '').trim()) || drafting;
  if (snapshot.tag && !drafting) {
    return 'No sections currently carry this tag.';
  }
  return hasText ? 'No notes match this search.' : 'No notes yet.';
}

/** The notes pane: its heading and actions, the cards, and its pages. */
function NotesPane({ view }: { readonly view: ResultsView }) {
  const { snapshot, openedCards } = view;
  const display: CardDisplay = { renderMode: snapshot.renderMode, preview: snapshot.preview, titleDisplay: snapshot.tagTitleDisplayMode };
  if (isGrouped(snapshot) && snapshot.sections.length) {
    return (
      <section class="overview-pane" aria-labelledby="notes-heading">
        <PaneHeader kind="notes" view={view} />
        <ResultGroups key="notes-groups" snapshot={snapshot} openedCards={openedCards} part="notes" />
      </section>
    );
  }
  return (
    <section class="overview-pane" aria-labelledby="notes-heading">
      <PaneHeader kind="notes" view={view} />
      <div class="cards">
        {snapshot.sections.length
          ? snapshot.sections.map((card, position) => (
            <SearchCard key={`${position}:${card.id}`} card={card} position={position} display={display} opened={openedCards.has(card.id)} />
          ))
          : <div class="empty">{emptyNotesMessage(snapshot)}<OtherResults kind="notes" view={view} /></div>}
      </div>
      <Pagination kind="notes" paging={pagingOf(snapshot.notePaging, snapshot.sections.length)} pageSizes={snapshot.pageSizes} />
    </section>
  );
}

/** One task a search found, marked so plain words being typed can hide it, and saying when it is listed for the hub. */
function SearchTask({ item, snapshot }: { readonly item: DashboardTask; readonly snapshot: SearchPageSnapshot }) {
  // Said after the task's location, as a card says it in its source row.
  const via = item.via === 'hubLink' ? <span key="via" class="card-via">Links the hub note</span> : null;
  return <TaskListRow item={item} titleDisplay={snapshot.tagTitleDisplayMode} entry="tasks" afterSource={via} />;
}

/** The tasks pane: its heading and actions, the rows, and its pages. */
function TasksPane({ view }: { readonly view: ResultsView }) {
  const { snapshot } = view;
  if (isGrouped(snapshot) && snapshot.tasks.length) {
    return (
      <section class="overview-pane" aria-labelledby="tasks-heading">
        <PaneHeader kind="tasks" view={view} />
        <ResultGroups key="tasks-groups" snapshot={snapshot} openedCards={view.openedCards} part="tasks" />
      </section>
    );
  }
  return (
    <section class="overview-pane" aria-labelledby="tasks-heading">
      <PaneHeader kind="tasks" view={view} />
      {snapshot.tasks.length
        ? <div key="list" class="task-list">{snapshot.tasks.map((item, position) => <SearchTask key={`${position}:${item.task.id}`} item={item} snapshot={snapshot} />)}</div>
        : <div key="empty" class="empty">No tasks match this search.<OtherResults kind="tasks" view={view} /></div>}
      <Pagination kind="tasks" paging={pagingOf(snapshot.taskPaging, snapshot.tasks.length)} pageSizes={snapshot.pageSizes} />
    </section>
  );
}

/**
 * Side by side with the hierarchy on: the two headings over their columns,
 * then each group a row, its notes beside its tasks.
 */
function SplitGroups({ view }: { readonly view: ResultsView }) {
  return (
    <div key="split-groups" class="overview-split-groups">
      <div class="overview-split">
        <section class="overview-pane" aria-labelledby="notes-heading"><PaneHeader kind="notes" view={view} /></section>
        <section class="overview-pane" aria-labelledby="tasks-heading"><PaneHeader kind="tasks" view={view} /></section>
      </div>
      <ResultGroups snapshot={view.snapshot} openedCards={view.openedCards} part="both" />
    </div>
  );
}

/**
 * The results: side by side, or as Notes and Tasks tabs over their panes,
 * each tab counting what its pane holds, so a tab never promises more rows
 * than the pane behind it; either grouped under Refine's tags when the
 * hierarchy is on.
 */
export function Results({ view }: { readonly view: ResultsView }) {
  if (view.snapshot.layout === 'split' && isGrouped(view.snapshot)) {
    return <SplitGroups view={view} />;
  }
  if (view.snapshot.layout === 'split') {
    return <div key="split" class="overview-split"><NotesPane view={view} /><TasksPane view={view} /></div>;
  }
  const counts = resultCounts(view.snapshot);
  return (
    <>
      <ResultTabs tabs={[{ id: 'notes', label: 'Notes', count: counts.notes }, { id: 'tasks', label: 'Tasks', count: counts.tasks }]} active={view.activeTab} label="Search results" />
      <div class="overview-tab-panel" {...resultPanelAttributes('notes')} hidden={view.activeTab !== 'notes'}><NotesPane view={view} /></div>
      <div class="overview-tab-panel" {...resultPanelAttributes('tasks')} hidden={view.activeTab !== 'tasks'}><TasksPane view={view} /></div>
    </>
  );
}
