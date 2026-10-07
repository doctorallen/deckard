/**
 * Related Notes, in the sidebar: Deckard's pages at its top, then the notes
 * related to the Markdown note being edited, with what links to it, or,
 * while another page is in front, that page's part: a search's Refine, the
 * calendar's chosen day, Home's widgets to add, or a graph node's
 * connections. The host ranks and sends its state; the page draws it and
 * says what the reader asked for, and the host checks every row a click
 * names against what it would list now.
 */
import type { ComponentChild } from 'preact';

import type { StateMessage } from '../../ui/protocol/messaging';
import type { SidebarMessage, SidebarNotesPageState, SidebarNotesSnapshot } from '../../ui/protocol/sidebarNotes';
import { DayPanel, focusCreatedNote, installDayPanel } from '../shared/calendar/dayPanel';
import { Loading } from '../shared/loading';
import { installMenuKeys } from '../shared/menuKeys';
import { markWords, type Unmark } from '../shared/markWords';
import { onHostMessage, readEmbeddedState, startPage } from '../shared/page';
import { describeIndexing } from '../shared/status';
import { closeTagContextMenu, hasTagContextMenu, isTagContextMenuOpen, openTagContextMenu, setParkedTags, tagContextKey } from '../shared/tagMenu';
import { installViewOptions } from '../shared/viewOptions';
import { rememberScroll, restoreScroll } from '../shared/scroll';
import { keepState, keptState, post, vscodeApi } from '../shared/vscode';
import { type CardDisplay, CustomizeHome, GraphConnections, NoTags, RankedNoteCards, Similar } from './cards';
import { Context, RelatedNotesControls } from './context';
import { Links } from './links';
import { choicesToKeep, isPageInFront, NOTE_PAGE_SIZE, noteListKey, previewLines, readChoices, type SidebarChoices, type SidebarStore } from './model';
import { ContextPagesBar, installPagesKeys, settlePagesTabStop } from './pages';
import { Refine } from './refine';

console.log('[Deckard Related Notes] Webview script started.');

/** Sends the host one of the messages the sidebar may send. */
function send(message: SidebarMessage): void {
  post(message);
}

/**
 * What the reader chose in the sidebar, which every draw reads: what the
 * view kept before VS Code loaded it again, or what a new view starts with.
 */
const choices: SidebarChoices = readChoices(keptState());

/** Keeps the reader's choices with setState, beside where the view was scrolled. */
function keepChoices(): void {
  keepState(choicesToKeep(choices));
}

/** The related notes a page at a time, then Show more, then the similar entries. */
function NoteList({ snapshot, display }: { readonly snapshot: SidebarNotesSnapshot; readonly display: CardDisplay }) {
  const shown = snapshot.notes.slice(0, choices.noteLimit);
  const hidden = snapshot.notes.length - shown.length;
  return (
    <>
      <div class="note-list"><RankedNoteCards notes={shown} display={display} /></div>
      {hidden > 0
        ? <button type="button" class="show-more-notes" data-action="show-more-notes">{hidden > NOTE_PAGE_SIZE ? `Show ${NOTE_PAGE_SIZE} more of ${hidden}` : `Show ${hidden} more`}</button>
        : null}
      <Similar similar={snapshot.similar} display={display} />
    </>
  );
}

/** Says why the sidebar lists nothing, for the states that are only that. */
function Empty({ words }: { readonly words: string }) {
  return <div class="empty">{words}</div>;
}

/** What a state draws in place of the related notes, given its snapshot and how cards are shown. */
type OwnContent = (snapshot: SidebarNotesSnapshot, display: CardDisplay) => ComponentChild;

/** The states that draw something of their own in place of the related notes, and what each draws. */
const OWN_CONTENT: Partial<Record<SidebarNotesSnapshot['state'], OwnContent>> = {
  customizeHome: (snapshot) => <CustomizeHome widgets={snapshot.homeWidgets || []} />,
  calendarDay: (snapshot) => (snapshot.calendarDay ? <DayPanel day={snapshot.calendarDay} shownGroups={choices.shownGroups} /> : null),
  refine: (snapshot) => (snapshot.refine ? <Refine refine={snapshot.refine} expanded={choices.expandedRefine} /> : null),
  graph: (snapshot) => <GraphConnections graph={snapshot.graph as NonNullable<SidebarNotesSnapshot['graph']>} />,
  loading: (snapshot) => <Loading label={describeIndexing(snapshot.progress)} immediate />,
  notIndexed: () => <Empty words="This note is not indexed yet. Save it inside the notes folder to see related entries." />,
  noMarkdown: () => <Empty words="Open a Markdown note to see related entries." />,
  noTags: (snapshot, display) => <NoTags similar={snapshot.similar} display={display} />,
  noMatches: () => <Empty words="No other notes share its tags." />,
};

/** What the sidebar lists, by the state it is in: the related notes, unless the state draws its own. */
function Content({ snapshot }: { readonly snapshot: SidebarNotesSnapshot }) {
  const display: CardDisplay = { previewLines: previewLines(snapshot), titleDisplay: snapshot.tagTitleDisplayMode };
  const own = OWN_CONTENT[snapshot.state];
  return <>{own ? own(snapshot, display) : <NoteList snapshot={snapshot} display={display} />}</>;
}

/**
 * The heading over what the sidebar lists: the graph's, or, for the related
 * notes, their sort and gear, and the label once there are any. A page in
 * front otherwise heads its own part.
 */
function SectionHeading({ snapshot }: { readonly snapshot: SidebarNotesSnapshot }) {
  if (snapshot.state === 'graph') {
    return <span class="section-label">Connected nodes</span>;
  }
  if (isPageInFront(snapshot)) {
    return null;
  }
  return (
    <>
      {snapshot.relatedNotesSortMode ? <RelatedNotesControls snapshot={snapshot} /> : null}
      {snapshot.state === 'ready' ? <span class="section-label">Related notes</span> : null}
    </>
  );
}

/**
 * The whole sidebar: Deckard's pages, its context, the heading over its
 * list, the list, and what links to the note. The pages lead in every
 * state, so they are always where the reader left them; the page's own
 * shortcuts are the view's title-bar actions, as every other sidebar
 * view's are.
 */
function SidebarPage({ snapshot }: { readonly snapshot: SidebarNotesPageState }) {
  return (
    <>
      <ContextPagesBar pages={snapshot.pages} />
      <Context snapshot={snapshot} open={choices.contextOpen} showEveryActiveTag={choices.showEveryActiveTag} />
      <SectionHeading snapshot={snapshot} />
      <Content snapshot={snapshot} />
      {isPageInFront(snapshot) ? null : <Links links={snapshot.links} view={{ open: choices.linksOpen, openSections: choices.openLinkSections }} />}
    </>
  );
}

/** Takes out the marks the last draw's shared words left, before the page is drawn again. */
let unmark: Unmark[] = [];

/**
 * Before a state is drawn: the list's Show more count starts over when it
 * is a different list, and `#app` says how many lines of each excerpt show.
 */
function prepare(snapshot: SidebarNotesSnapshot): void {
  if (!OWN_CONTENT[snapshot.state]) {
    const key = noteListKey(snapshot);
    if (key !== choices.noteListKey) {
      choices.noteListKey = key;
      choices.noteLimit = NOTE_PAGE_SIZE;
    }
  }
  const app = document.getElementById('app') as HTMLElement;
  app.dataset.previewLines = String(previewLines(snapshot));
}

/** The shared words, marked where each excerpt says them. */
function markSharedWords(): void {
  document.getElementById('app')?.querySelectorAll<HTMLElement>('.note[data-terms]').forEach((card) => {
    const excerpt = card.querySelector('.note-excerpt');
    if (excerpt) {
      unmark.push(markWords(excerpt, String(card.dataset.terms).split(' '), { wordStart: true }));
    }
  });
}

/**
 * Puts back what the page changed after its last draw: the marked words,
 * and a relevance breakdown opened by its score, which every one of the
 * template's draws closed.
 */
function putBackDrawn(): void {
  unmark.reverse().forEach((undo) => undo());
  unmark = [];
  closeRelevance();
}

/** Closes every relevance breakdown its score opened. */
function closeRelevance(): void {
  document.querySelectorAll('.relevance-wrap.is-open').forEach((other) => {
    other.classList.remove('is-open');
    other.querySelector('[data-action="show-relevance"]')?.setAttribute('aria-expanded', 'false');
  });
}

/** Whether the view has been scrolled back to where the reader left it. */
let scrolled = false;

/**
 * After each draw: the shared words are marked, the pages are one Tab stop
 * again, the first draw goes back to where the reader left the view, and
 * the choices are kept, since a draw is how each of them is made, and a new
 * list starts Show more over.
 */
function afterDraw(): void {
  markSharedWords();
  settlePagesTabStop();
  focusCreatedNote();
  if (!scrolled) {
    scrolled = true;
    restoreScroll(keptState());
  }
  keepChoices();
}

const initial = readEmbeddedState<SidebarNotesPageState>();
if (initial) {
  setParkedTags(initial.parkedTags);
  prepare(initial);
}
const store = startPage<SidebarStore>({
  initial: { snapshot: initial },
  ready: (state) => Boolean(state.snapshot),
  view: (state) => <SidebarPage snapshot={state.snapshot as SidebarNotesPageState} />,
  afterDraw,
});
installMenuKeys();
installPagesKeys();

/**
 * Draws the page again, as each of the template's draws did: the tag menu
 * closes, and what the last draw changed after it is put back first.
 */
function redraw(change: Partial<SidebarStore> = {}): void {
  const snapshot = change.snapshot ?? store.state.snapshot;
  if (!snapshot) {
    return;
  }
  putBackDrawn();
  closeTagContextMenu();
  prepare(snapshot);
  store.update(change);
}

installViewOptions();
// The calendar page's chosen day, drawn here while the page is in front:
// what is done in it goes to the page's host, through this one.
installDayPanel({
  send: (message) => send({ type: 'calendarDay', message }),
  showGroup: (group) => {
    if (!choices.shownGroups.includes(group)) {
      choices.shownGroups = [...choices.shownGroups, group];
    }
    redraw();
  },
});

/** The element an event happened on, when it is one. */
function eventTarget(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

// Home's widgets, while Home is in front: each is Home's to add, and to reset.
document.addEventListener('click', (event) => {
  const target = eventTarget(event);
  const add = target ? target.closest<HTMLElement>('[data-action="home-add-widget"]') : null;
  if (add) {
    send({ type: 'homeAddWidget', value: String(add.dataset.value) });
    return;
  }
  if (target && target.closest('[data-action="home-reset-widgets"]')) {
    send({ type: 'homeResetWidgets' });
  }
});
// The context and Links groups stay as the reader left them across draws.
document.addEventListener('toggle', (event) => {
  const target = event.target as HTMLDetailsElement | null;
  if (target && target.classList && target.classList.contains('active-file')) {
    choices.contextOpen = target.open;
  }
  const group = target && target.dataset ? target.dataset.linksGroup : undefined;
  if (group === 'linked' || group === 'mentions') {
    choices.linksOpen[group] = target ? target.open : false;
  }
  keepChoices();
}, true);

/** Unfolds a link row onto its section, or folds it, keeping focus on its button. */
function toggleLinkSection(expand: HTMLElement): void {
  const key = String(expand.dataset.sectionKey);
  if (choices.openLinkSections.has(key)) {
    choices.openLinkSections.delete(key);
  } else {
    choices.openLinkSections.add(key);
  }
  redraw();
  const again = Array.from(document.querySelectorAll<HTMLElement>('[data-action="toggle-link-section"]')).find((button) => button.dataset.sectionKey === key);
  again?.focus();
}

/** What Links and the gear's rows ask for, by `data-action`. */
const LINK_ACTIONS: ReadonlyArray<readonly [string, (element: HTMLElement, event: MouseEvent) => void]> = [
  ['open-link', (link, event) => send({ type: 'openSource', filePath: String(link.dataset.filePath), line: Number(link.dataset.line), beside: Boolean(event.metaKey || event.ctrlKey), ...(event.shiftKey ? { opposite: true } : {}) })],
  ['link-mention', (one) => send({ type: 'linkMention', filePath: String(one.dataset.filePath), line: Number(one.dataset.line), startColumn: Number(one.dataset.startColumn) })],
  ['toggle-link-section', toggleLinkSection],
  ['show-daily-notes', () => send({ type: 'setHideDailyNotes', hide: false })],
  ['set-hide-daily', (choice) => send({ type: 'setHideDailyNotes', hide: choice.dataset.value === 'hide' })],
  ['add-suggested-tag', (add) => send({ type: 'addSuggestedTag', tagKey: String(add.dataset.suggestedTag) })],
  ['set-preview-lines', (choice) => send({ type: 'setRelatedNotesPreviewLines', lines: Number(choice.dataset.value) as 0 | 1 | 2 })],
  ['open-links-search', () => send({ type: 'openLinksSearch' })],
  ['link-all-mentions', () => send({ type: 'linkAllMentions' })],
];

// Links, the gear's rows, and a suggested tag's Add, each checked in the
// order the template checked them.
document.addEventListener('click', (event) => {
  const target = eventTarget(event);
  if (!target) {
    return;
  }
  for (const [action, act] of LINK_ACTIONS) {
    const element = target.closest<HTMLElement>(`[data-action="${action}"]`);
    if (element) {
      act(element, event);
      return;
    }
  }
});

/** Show more: the next page of results, with focus on the first card it drew. */
function showMoreNotes(): void {
  const firstNewNote = choices.noteLimit;
  choices.noteLimit += NOTE_PAGE_SIZE;
  redraw();
  // Keyboard readers continue from the first card the button revealed.
  const list = document.querySelector('.note-list');
  const next = list ? (list.children[firstNewNote] as HTMLElement | undefined) : undefined;
  next?.focus();
}

/** Runs the row of the open tag menu that was chosen, for the tag it is open on. */
function chooseFromTagMenu(choice: HTMLElement): void {
  const tagKey = tagContextKey();
  closeTagContextMenu();
  const action = choice.dataset.contextAction;
  if (action === 'rename-tag' && tagKey) {
    send({ type: 'renameTag', tagKey });
  }
  if ((action === 'park-tag' || action === 'unpark-tag') && tagKey) {
    send({ type: action === 'park-tag' ? 'parkTag' : 'unparkTag', tagKey });
  }
}

/**
 * Pressing a result's score opens the breakdown that hovering shows, so the
 * reasons are reachable without a pointer; any other open breakdown closes.
 */
function toggleRelevance(score: HTMLElement): void {
  const wrap = score.closest('.relevance-wrap');
  const open = wrap && !wrap.classList.contains('is-open');
  closeRelevance();
  if (!wrap || !open) {
    return;
  }
  wrap.classList.add('is-open');
  score.setAttribute('aria-expanded', 'true');
}

/** Opens a Refine facet past its first five values, or folds it back. */
function toggleRefineFacet(more: HTMLElement): void {
  const id = String(more.dataset.facetId);
  if (choices.expandedRefine.has(id)) {
    choices.expandedRefine.delete(id);
  } else {
    choices.expandedRefine.add(id);
  }
  redraw();
}

/** The pages and commands a control may name, which the host runs as asked. */
const PLAIN_ACTIONS: Readonly<Record<string, SidebarMessage['type']>> = {
  'open-help': 'openHelp',
  'open-dashboard': 'openDashboard',
  'open-notes-graph': 'openNotesGraph',
  'open-task-board': 'openTaskBoard',
  'create-daily-note': 'createDailyNote',
  'clear-entry-related-notes': 'clearEntryRelatedNotes',
};

/** What each of the page's own controls does on a click, by its `data-action`. */
const ACTIONS: Readonly<Record<string, (target: HTMLElement, event: MouseEvent) => void>> = {
  'show-every-active-tag': () => {
    choices.showEveryActiveTag = true;
    redraw();
  },
  'show-relevance': toggleRelevance,
  'insert-link': (target) => {
    const card = target.closest<HTMLElement>('.note');
    if (card) {
      send({ type: 'insertLink', filePath: String(card.dataset.filePath), line: Number(card.dataset.line) });
    }
  },
  'open-tag': (target) => send({ type: 'openTag', tagKey: String(target.dataset.tagKey) }),
  'facet-more': toggleRefineFacet,
  refine: (target, event) => send({
    type: 'refineActiveSearch',
    facetId: String(target.dataset.facetId),
    clause: String(target.dataset.clause),
    mode: event.altKey ? 'exclude' : refineMode(event),
  }),
  'open-selected-graph-node': (target) => send({ type: 'activateNotesGraphNode', nodeId: String(target.dataset.nodeId), open: true }),
  'go-to-page': (target) => send({ type: 'goToPage', page: String(target.dataset.page) }),
};

/** How a click without Alt adds a value to the search: Shift widens it with OR, and a plain click narrows with AND. */
function refineMode(event: MouseEvent): 'or' | 'and' {
  return event.shiftKey ? 'or' : 'and';
}

/** Runs a control's action; a control the page does not act on does nothing. */
function runAction(target: HTMLElement, event: MouseEvent): void {
  const action = String(target.dataset.action);
  const plain = Object.prototype.hasOwnProperty.call(PLAIN_ACTIONS, action) ? PLAIN_ACTIONS[action] : undefined;
  if (plain) {
    send({ type: plain } as SidebarMessage);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    ACTIONS[action](target, event);
  }
}

/** Opens a card a click or a key lands on: a graph node on the graph, or a result where it is written. */
function openCard(element: Element, event: MouseEvent | KeyboardEvent): boolean {
  const graphNode = element.closest<HTMLElement>('.graph-node');
  if (graphNode) {
    send({ type: 'activateNotesGraphNode', nodeId: String(graphNode.dataset.nodeId), open: event.metaKey || event.ctrlKey });
    return true;
  }
  const note = element.closest<HTMLElement>('.note');
  if (!note) {
    return false;
  }
  // Cmd/Ctrl opens the result beside the note it was ranked from, the way
  // a graph node already did.
  send({ type: 'openSource', filePath: String(note.dataset.filePath), line: Number(note.dataset.line), beside: Boolean(event.metaKey || event.ctrlKey), ...(event.shiftKey ? { opposite: true } : {}) });
  return true;
}

document.addEventListener('click', (event) => {
  const element = eventTarget(event);
  if (!element) {
    return;
  }
  if (element.closest('[data-action="show-more-notes"]')) {
    showMoreNotes();
    return;
  }
  const contextAction = element.closest<HTMLElement>('#tag-context-menu [data-context-action]');
  if (contextAction) {
    chooseFromTagMenu(contextAction);
    return;
  }
  if (hasTagContextMenu() && !element.closest('#tag-context-menu')) {
    closeTagContextMenu();
  }
  const target = element.closest<HTMLElement>('[data-action]');
  if (target) {
    runAction(target, event);
    return;
  }
  openCard(element, event);
});

// A graph node's card under the pointer lights the node on the graph, and
// lets it go when the pointer leaves the card.
document.addEventListener('pointerover', (event) => {
  const graphNode = eventTarget(event)?.closest<HTMLElement>('.graph-node');
  if (graphNode && !graphNode.contains(event.relatedTarget as Node | null)) {
    send({ type: 'hoverNotesGraphNode', nodeId: graphNode.dataset.nodeId });
  }
});
document.addEventListener('pointerout', (event) => {
  const graphNode = eventTarget(event)?.closest<HTMLElement>('.graph-node');
  if (graphNode && !graphNode.contains(event.relatedTarget as Node | null)) {
    send({ type: 'hoverNotesGraphNode' });
  }
});
document.addEventListener('contextmenu', (event) => {
  const target = eventTarget(event)?.closest<HTMLElement>('[data-action="open-tag"][data-tag-key]');
  if (target) {
    openTagContextMenu(event, target);
  }
});

/** Escape closes the tag menu, or else an open relevance breakdown, giving focus back to its score; says whether it did. */
function closeByEscape(): boolean {
  if (isTagContextMenuOpen()) {
    closeTagContextMenu();
    return true;
  }
  const open = document.querySelector('.relevance-wrap.is-open');
  if (!open) {
    return false;
  }
  open.classList.remove('is-open');
  const button = open.querySelector<HTMLElement>('[data-action="show-relevance"]');
  if (button) {
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  }
  return true;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && closeByEscape()) {
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const element = eventTarget(event);
  if (!element || element.closest('[data-action]')) {
    return;
  }
  if (openCard(element, event)) {
    event.preventDefault();
  }
});
document.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.dataset && target.dataset.action === 'set-related-notes-sort') {
    send({ type: 'setRelatedNotesSort', mode: target.value as NonNullable<SidebarNotesSnapshot['relatedNotesSortMode']> });
  }
});
onHostMessage<StateMessage<SidebarNotesPageState>>('state', (message) => {
  console.log('[Deckard Related Notes] Received state:', message.data.state);
  setParkedTags(message.data.parkedTags);
  redraw({ snapshot: message.data });
});
rememberScroll(keptState, (value) => vscodeApi().setState(value));
console.log('[Deckard Related Notes] Requesting initial state.');
send({ type: 'ready' });
