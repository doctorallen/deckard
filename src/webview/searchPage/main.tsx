/**
 * A search page: the search box every search page shares, the tag or
 * entity a one-tag search is about with its hub note, and the notes and
 * tasks the search finds, a page at a time. The host sends the results
 * already found and drawn as tokens; the page draws them and says what the
 * reader asked for.
 */
import type { StateMessage } from '../../ui/protocol/messaging';
import type { SearchPageMessage, SearchPageState } from '../../ui/protocol/searchPage';
import { installMenuKeys } from '../shared/menuKeys';
import { markWords, type Unmark } from '../shared/markWords';
import { openSourceMessage } from '../shared/openSource';
import { onHostMessage, startPage } from '../shared/page';
import { createQueryEditor } from '../shared/queryEditor';
import { installResultTabKeys } from '../shared/resultTabs';
import { rememberScroll, restoreScroll } from '../shared/scroll';
import { announce } from '../shared/status';
import { closeTagContextMenu, hasTagContextMenu, isTagContextMenuOpen, openContextMenu, openTagContextMenu, setParkedTags, tagContextKey } from '../shared/tagMenu';
import { taskTitleOf } from '../shared/taskRow';
import { installViewOptions } from '../shared/viewOptions';
import { vscodeApi } from '../shared/vscode';
import { PageHeader } from './header';
import { HubNote, TagNotes } from './hub';
import { type ResultKind, resultCounts, Results } from './results';

/** What the page draws from: the host's last snapshot, once there is one. */
interface SearchStore {
  readonly snapshot: SearchPageState | undefined;
}

/** What VS Code kept for the page, as the template read it: any value, a record or not. */
type Kept = Record<string, unknown> | null | undefined;

/** What the page kept, read as the template read it, whatever kind of value it is. */
function kept(): Kept {
  return vscodeApi().getState() as Kept;
}

/** Sends the host one message. */
function send(message: SearchPageMessage): void {
  vscodeApi().postMessage(message);
}

/** The snapshot the host sent last, which the search box and the page's actions read. */
let latest: SearchPageState | undefined;

/** The tab shown, in the tabs layout. */
let activeTab: ResultKind = 'notes';

/**
 * Whether the reader picked the tab themselves. Until they do, the page
 * opens the tab that actually has results: a task search would otherwise
 * land on an empty Notes tab while every hit sat behind Tasks.
 */
let tabChosen = false;
const savedPageState = kept();
if (savedPageState && (savedPageState.tab === 'notes' || savedPageState.tab === 'tasks')) {
  activeTab = savedPageState.tab;
  tabChosen = true;
}

/** Cards opened with Show all, by id, until the search changes. */
let openedCards = new Set<string>();
let openedFor: string | undefined;

/** Set once the reader opens or closes the hub, which then outlasts refreshes. */
let hubOpen: boolean | undefined;

/** Where the window was scrolled when a draw began, put back after it. */
let scrolledTo = { x: 0, y: 0 };

/** Takes out the marks the last state's words left, before the page is drawn again. */
let unmark: Unmark = () => undefined;

/** The Show all buttons taken out after a draw, because their body fit its three lines. */
let fittingMore: Array<{ readonly element: Element; readonly parent: Node; readonly next: Node | null }> = [];

/**
 * How long the box waits after a keystroke before searching. Long enough
 * that a word is one search rather than one per letter, short enough that
 * the results feel like they are following the typing.
 */
const PREVIEW_DELAY_MS = 180;
/**
 * The most words, and the longest word, the host narrows by; it refuses a
 * draft past either (`narrowPreviewSearch`), which would leave the results
 * narrowed by the words before. The words past the first twelve, and a
 * word too long to be one, only narrow further, so leaving them out shows
 * a little more rather than something else.
 */
const PREVIEW_WORD_LIMIT = 12;
const PREVIEW_WORD_LENGTH = 100;

/** The words waiting out that delay, until they are sent. */
let previewHandle: ReturnType<typeof setTimeout> | undefined;
/** The words the host narrows by, or will once the words waiting are sent. */
let sentPreview = '';

/** In the tabs layout, the tab with results, until the reader picks one. */
function settleTab(snapshot: SearchPageState): void {
  if (tabChosen || snapshot.layout === 'split') {
    return;
  }
  const counts = resultCounts(snapshot);
  activeTab = counts.notes === 0 && counts.tasks > 0 ? 'tasks' : 'notes';
}

/** The whole page: its header, the search box and Refine, the hub, the tag's notes, and the results. */
function SearchPage({ snapshot }: { readonly snapshot: SearchPageState }) {
  settleTab(snapshot);
  // A search that does not parse leaves the previous results on the page.
  // Say so, rather than letting them read as answers to what was typed.
  const invalid = (snapshot.query.diagnostics || []).some((diagnostic) => diagnostic.severity === 'error');
  return (
    <>
      <PageHeader snapshot={snapshot} />
      {editor.bar()}
      {editor.facets()}
      <HubNote snapshot={snapshot} hubOpen={hubOpen} />
      <TagNotes snapshot={snapshot} />
      {invalid ? <p class="stale-results">The search above has not run. These are the results of the last one that did.</p> : null}
      {/* A search that found nothing, and a closer spelling that finds something, so the dead end has a way out of it. */}
      {!invalid && snapshot.suggestion
        ? <p class="did-you-mean">Nothing matched. Search for <button data-action="run-suggestion">{snapshot.suggestion}</button> instead?</p>
        : null}
      <Results view={{ snapshot, activeTab, openedCards }} />
    </>
  );
}

const store = startPage<SearchStore>({
  initial: { snapshot: undefined },
  ready: (state) => Boolean(state.snapshot),
  view: (state) => <SearchPage snapshot={state.snapshot as SearchPageState} />,
  afterDraw: () => {
    applyColumns();
    dropFittingMore();
    editor.afterRender();
    window.scrollTo(scrolledTo.x, scrolledTo.y);
    const snapshot = store.state.snapshot as SearchPageState;
    // Every draw is unmarked first, the page's own redraws included, such
    // as a tab or Show all, so every draw is marked again.
    unmark = markWords(document.getElementById('app'), editor.previewWords((snapshot.query && snapshot.query.text) || ''));
    const counts = resultCounts(snapshot);
    announce(`${counts.notes}${counts.notes === 1 ? ' note' : ' notes'} and ${counts.tasks}${counts.tasks === 1 ? ' task' : ' tasks'} match this search.`);
  },
});
installMenuKeys();
installResultTabKeys();

const editor = createQueryEditor({
  getState: () => latest && latest.query,
  render: () => redraw(),
  apply: (text, remember) => send({ type: 'setOverviewQuery', query: text, remember: remember !== false }),
  // Clear returns the page to the search it was opened with, such as its
  // own tag, rather than to nothing.
  clear: () => send({ type: 'clearOverviewQuery' }),
  clearedText: () => (latest ? latest.originQuery : ''),
  // The words being typed narrow the whole search, which only the host can
  // do: the page holds one page of the results, and hiding rows on it
  // would search thirty notes and call the answer a search of the
  // workspace. Sent on a short delay so a word costs one search, not one
  // per letter.
  onDraft: () => {
    const words = editor.previewWords(editor.currentText())
      .filter((word) => word.length <= PREVIEW_WORD_LENGTH)
      .slice(0, PREVIEW_WORD_LIMIT);
    if (words.join(' ') === sentPreview) {
      return;
    }
    sentPreview = words.join(' ');
    clearTimeout(previewHandle);
    previewHandle = setTimeout(() => {
      previewHandle = undefined;
      send({ type: 'previewSearch', words });
    }, PREVIEW_DELAY_MS);
  },
  placeholder: () => 'Search notes and tasks: words, #tags, is:open, has:due, in:folder, updated >= 7d…',
  label: 'Search notes and tasks',
  refineElsewhere: () => Boolean(latest && latest.refineInSidebar),
  // The Notes and Tasks tabs carry the counts; the strip repeats them only
  // in the split layout, where there are no tabs.
  countElsewhere: () => Boolean(latest && latest.layout !== 'split'),
  actions: (hasText) => (
    <button data-action="save-filter" data-query-needs-text="" data-tip="Keep this search, named, on Home" data-tip-disabled="Type a search to save it" aria-disabled={hasText ? undefined : 'true'}>Save</button>
  ),
});

document.addEventListener('toggle', (event) => {
  const target = event.target as HTMLDetailsElement | null;
  if (target && target.classList && target.classList.contains('hub')) {
    hubOpen = target.open;
  }
}, true);

/** Lays the result grids out in their columns; a style attribute is not allowed here. */
function applyColumns(): void {
  const snapshot = latest as SearchPageState;
  document.querySelectorAll<HTMLElement>('.cards').forEach((grid) => {
    grid.style.gridTemplateColumns = `repeat(${snapshot.noteColumns || 1}, minmax(0, 1fr))`;
  });
  document.querySelectorAll<HTMLElement>('.task-list').forEach((grid) => {
    grid.style.gridTemplateColumns = `repeat(${snapshot.taskColumns || 1}, minmax(0, 1fr))`;
  });
}

/**
 * A clamped body that fits its three lines has nothing more to show, so its
 * Show all goes. It is put back before the next draw, which then finds the
 * page as it drew it.
 */
function dropFittingMore(): void {
  document.querySelectorAll('.card-body.is-clamped').forEach((body) => {
    const inner = body.lastElementChild;
    if (body.querySelector('.card-snippet-lead') || !inner || !(inner.clientHeight > 0) || inner.scrollHeight > inner.clientHeight + 1) {
      return;
    }
    const more = body.nextElementSibling;
    if (!more || !more.classList.contains('card-more') || !more.parentNode) {
      return;
    }
    fittingMore.push({ element: more, parent: more.parentNode, next: more.nextSibling });
    more.remove();
  });
}

/** Puts back what the page changed after its last draw: the marked words, then the Show all buttons it took out. */
function putBackDrawn(): void {
  unmark();
  unmark = () => undefined;
  for (const { element, parent, next } of fittingMore.reverse()) {
    parent.insertBefore(element, next);
  }
  fittingMore = [];
}

/**
 * Draws the page again without taking the reader's place. The draw closes
 * the tag menu, as each of the template's draws did, and keeps the window
 * where it was scrolled.
 */
function redraw(change: Partial<SearchStore> = {}): void {
  if (store.state.snapshot || change.snapshot) {
    // The draw is about to change the search box.
    editor.beforeRender();
    closeTagContextMenu();
    scrolledTo = { x: window.scrollX, y: window.scrollY };
  }
  putBackDrawn();
  store.update(change);
}

/** Keeps the page's own view state across a window reload: its search, the scroll in it, and a tab the reader chose. */
function saveState(): void {
  if (!latest) {
    return;
  }
  const previous = (kept() || {}) as Record<string, unknown>;
  const saved: Record<string, unknown> = { query: latest.query.text, origin: latest.originQuery };
  // The scroll position belongs to the search it was scrolled in.
  if (previous.query === saved.query && typeof previous.scrollY === 'number') {
    saved.scrollY = previous.scrollY;
  }
  // The host reads this same record to restore a page, so the tab is added
  // only once it is the reader's own choice.
  if (tabChosen) {
    saved.tab = activeTab;
  }
  vscodeApi().setState(saved);
}

/** The result a card's menu is about, while the menu is open. */
let cardContext: { filePath: string; line: number; pinned: boolean; parked: boolean } | null = null;

/** Pinning and parking, on the results a search already gathered. */
function openCardContextMenu(event: MouseEvent, card: HTMLElement): void {
  cardContext = {
    filePath: String(card.dataset.filePath),
    line: Number(card.dataset.line),
    pinned: card.dataset.pinned === 'true',
    parked: card.dataset.parked === 'true',
  };
  openContextMenu(event, [
    { action: 'pin-note', label: cardContext.pinned ? 'Unpin from Home' : 'Pin to Home' },
    { action: 'park-note', label: cardContext.parked ? 'Unpark note' : 'Park note' },
  ]);
}

/** Runs a row of the open menu, for the tag or the card it was opened on. */
function chooseFromMenu(action: string | undefined): void {
  const tagKey = tagContextKey();
  const card = cardContext;
  closeTagContextMenu();
  cardContext = null;
  if (action === 'rename-tag' && tagKey) {
    send({ type: 'renameTag', tagKey });
  }
  if ((action === 'park-tag' || action === 'unpark-tag') && tagKey) {
    send({ type: action === 'park-tag' ? 'parkTag' : 'unparkTag', tagKey });
  }
  if (action === 'pin-note' && card) {
    send({ type: card.pinned ? 'unpinNote' : 'pinNote', filePath: card.filePath, line: card.line });
  }
  if (action === 'park-note' && card) {
    send({ type: card.parked ? 'unparkNote' : 'parkNote', filePath: card.filePath });
  }
}

/** Opens or closes a card's whole body, which stays as it is until the search changes. */
function toggleCardBody(target: HTMLElement): void {
  const id = String(target.dataset.cardId);
  if (openedCards.has(id)) {
    openedCards.delete(id);
  } else {
    openedCards.add(id);
  }
  redraw();
}

/** Lays one kind of result out in more or fewer columns at once, and keeps the choice. */
function setColumns(target: HTMLElement, snapshot: SearchPageState): void {
  const columns = Number(target.dataset.value) as SearchPageState['noteColumns'];
  const section = target.dataset.section;
  if (section === 'notes') {
    snapshot.noteColumns = columns;
  }
  if (section === 'tasks') {
    snapshot.taskColumns = columns;
  }
  applyColumns();
  send({ type: 'setSearchColumns', section: section as ResultKind, columns });
}

/** Shows one of the result tabs, which is the reader's choice from then on. */
function showTab(target: HTMLElement): void {
  activeTab = target.dataset.tab === 'tasks' ? 'tasks' : 'notes';
  tabChosen = true;
  saveState();
  redraw();
}

/** What each of the page's own controls does on a click, given the snapshot it shows. */
const ACTIONS: Readonly<Record<string, (target: HTMLElement, snapshot: SearchPageState, event: MouseEvent) => void>> = {
  'set-mode': (target) => send({ type: 'setRenderMode', mode: target.dataset.mode as never }),
  'set-layout': (target) => send({ type: 'setTagOverviewLayout', layout: target.dataset.layout as never }),
  'set-preview': (target) => send({ type: 'setSearchPreview', preview: target.dataset.value as never }),
  'toggle-card-body': (target) => toggleCardBody(target),
  'edit-results': (target) => send({ type: 'editResults', kind: target.dataset.kind === 'tasks' ? 'tasks' : 'notes' }),
  'export-results': (target) => send({ type: 'exportResults', kind: target.dataset.kind === 'tasks' ? 'tasks' : 'notes' }),
  'set-columns': (target, snapshot) => setColumns(target, snapshot),
  'set-result-tab': (target) => showTab(target),
  'show-other-results': (target) => showTab(target),
  'set-result-page': (target) => send({ type: 'setResultPage', kind: target.dataset.kind as ResultKind, page: Number(target.dataset.page) }),
  'run-suggestion': (_target, snapshot) => {
    if (snapshot.suggestion) {
      send({ type: 'setOverviewQuery', query: snapshot.suggestion });
    }
  },
  'open-help': () => send({ type: 'openHelp' }),
  'history-back': () => send({ type: 'navigateSearchHistory', direction: 'back' }),
  'history-forward': () => send({ type: 'navigateSearchHistory', direction: 'forward' }),
  // What the box holds, words typed and not yet run among it, is what the
  // reader sees and so what Save keeps.
  'save-filter': () => send({ type: 'saveTagOverviewFilter', query: editor.currentText() }),
  'create-hub': () => send({ type: 'createHubNote' }),
  'exclude-hub-links': () => send({ type: 'excludeHubLinks' }),
  'unpark-tag': (target) => {
    if (target.dataset.tagKey) {
      send({ type: 'unparkTag', tagKey: target.dataset.tagKey });
    }
  },
  'show-mentions': (_target, snapshot) => {
    if (snapshot.tagPage && snapshot.tagPage.mention) {
      send({ type: 'setOverviewQuery', query: snapshot.tagPage.mention.query });
    }
  },
  'include-lookalike': (target, snapshot) => {
    if (snapshot.tag) {
      send({ type: 'setOverviewQuery', query: `${snapshot.tag.key} OR ${target.dataset.tagKey}` });
    }
  },
  'merge-lookalike': (target) => send({ type: 'mergeTags', sourceKey: String(target.dataset.sourceKey), targetKey: String(target.dataset.targetKey) }),
  'open-source': (target, _snapshot, event) => send(openSourceMessage(target, event)),
  'open-tag': (target) => send({ type: 'openTag', tagKey: String(target.dataset.tagKey) }),
};

installViewOptions();
rememberScroll(kept, (value) => vscodeApi().setState(value));

document.addEventListener('mousedown', (event) => {
  editor.handleMousedown(event);
});
// The mouse's back and forward buttons step through the searches the page
// has shown, as they step through a browser's pages. The webview's frame
// would otherwise take them as its own navigation, or drop them.
document.addEventListener('mouseup', (event) => {
  if (event.button !== 3 && event.button !== 4) {
    return;
  }
  event.preventDefault();
  send({ type: 'navigateSearchHistory', direction: event.button === 3 ? 'back' : 'forward' });
});
document.addEventListener('focusin', (event) => {
  editor.handleFocusIn(event);
});

document.addEventListener('click', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) {
    return;
  }
  const contextAction = element.closest<HTMLElement>('#tag-context-menu [data-context-action]');
  if (contextAction) {
    chooseFromMenu(contextAction.dataset.contextAction);
    return;
  }
  if (hasTagContextMenu() && !element.closest('#tag-context-menu')) {
    closeTagContextMenu();
  }
  if (editor.handleClick(event)) {
    return;
  }
  const target = element.closest<HTMLElement>('[data-action]');
  if (target) {
    const action = String(target.dataset.action);
    if (latest && Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
      ACTIONS[action](target, latest, event);
    }
    return;
  }
  const entry = element.closest<HTMLElement>('.card, .task-row');
  if (entry && !element.closest('button, input, a')) {
    send(openSourceMessage(entry, event));
  }
});

document.addEventListener('contextmenu', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  const tag = element ? element.closest<HTMLElement>('[data-tag-key]') : null;
  if (tag) {
    openTagContextMenu(event, tag);
    return;
  }
  // A result carries what a pin needs: its note, and the line its entry
  // starts on. The host turns that into a pin on the entry itself.
  const card = element ? element.closest<HTMLElement>('.card') : null;
  if (card) {
    openCardContextMenu(event, card);
  }
});

/**
 * Alt+Left and Alt+Right step through the searches the page has shown,
 * outside a field, where they move the caret by word; true when they did.
 */
function stepHistoryByKey(event: KeyboardEvent, element: Element | null): boolean {
  if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || (element && element.closest('input, textarea'))) {
    return false;
  }
  event.preventDefault();
  send({ type: 'navigateSearchHistory', direction: event.key === 'ArrowLeft' ? 'back' : 'forward' });
  return true;
}

/** Enter or Space on a card or a task row, not on a control in it, opens where it is written. */
function openEntryByKey(event: KeyboardEvent, element: Element | null): void {
  if ((event.key !== 'Enter' && event.key !== ' ') || !element || element.closest('[data-action], button, input, a')) {
    return;
  }
  const entry = element.closest<HTMLElement>('.card, .task-row');
  if (!entry) {
    return;
  }
  event.preventDefault();
  send(openSourceMessage(entry, event));
}

document.addEventListener('keydown', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  if (stepHistoryByKey(event, element) || editor.handleKeydown(event)) {
    return;
  }
  if (event.key === 'Escape' && isTagContextMenuOpen()) {
    closeTagContextMenu();
    return;
  }
  openEntryByKey(event, element);
});

document.addEventListener('change', (event) => {
  if (editor.handleChange(event)) {
    return;
  }
  const target = event.target as HTMLInputElement;
  if (target.dataset.action === 'set-sort') {
    send({ type: 'setTagOverviewSort', mode: target.value as never });
  }
  if (target.dataset.action === 'set-results-per-page') {
    send({ type: 'setResultsPerPage', size: Number(target.value) as never });
  }
  if (target.dataset.action !== 'toggle-task') {
    return;
  }
  send({ type: 'toggleTask', taskId: String(target.dataset.taskId), completed: target.checked });
  announce(`${target.checked ? 'Completed ' : 'Reopened '}${taskTitleOf(target)}.`);
});

document.addEventListener('input', (event) => {
  editor.handleInput(event);
});

onHostMessage<StateMessage<SearchPageState>>('state', (message) => {
  const first = !latest;
  latest = message.data;
  setParkedTags(latest.parkedTags);
  // Cards opened with Show all stay open through a save, and close when
  // the search changes.
  const searched = (latest.query && latest.query.text) || '';
  if (searched !== openedFor) {
    openedFor = searched;
    openedCards = new Set();
  }
  // The host lets go of the typed words whenever the search changes, and
  // says which it still narrows by; typing the same words again must send
  // them again. Words still waiting to be sent are newer than its answer.
  if (previewHandle === undefined) {
    sentPreview = (latest.draftWords || []).join(' ');
  }
  editor.receive();
  redraw({ snapshot: latest });
  if (first) {
    restoreScroll(kept());
  }
  saveState();
});
