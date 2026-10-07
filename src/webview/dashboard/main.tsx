/**
 * The Dashboard page: Home, the widgets the reader arranges, and the Tags
 * tab, every tag with its search, filter, sort, and favorites. The host
 * sends Home's widgets as it built them; the page draws them, arranges them,
 * and sends each change back, which the host answers with the whole state.
 */
import { isWidgetKind, WIDGET_KINDS } from '../../domain/dashboard/widgetCatalog';
import type {
  DashboardColumnCount,
  DashboardMessage,
  DashboardPageState,
  DashboardWidget,
  DashboardWidgetConfig,
  OpenDeckardViewMessage,
  TagSortMode,
} from '../../ui/protocol/dashboard';
import type { StateMessage } from '../../ui/protocol/messaging';
import { installMenuKeys } from '../shared/menuKeys';
import { openSourceMessage } from '../shared/openSource';
import { onHostMessage, startPage } from '../shared/page';
import { createQueryEditor } from '../shared/queryEditor';
import { closeRankMenu, installRankedRows, moveKeyToEdge, rankKeys } from '../shared/rankedRows';
import { announce } from '../shared/status';
import { isParkedTag, setParkedTags } from '../shared/tagMenu';
import { taskTitleOf } from '../shared/taskRow';
import { createUndoNotice } from '../shared/undoToast';
import { installViewOptions } from '../shared/viewOptions';
import { vscodeApi } from '../shared/vscode';
import { ModeTabs, PageHeader } from './header';
import { HOME_FULL_MESSAGE, HomePanel, isHomeFull, widgetChoices } from './home';
import type { HomeContext } from './homeContext';
import { keepView, readKeptView } from './keptView';
import type { DashboardView } from './model';
import { filterTags } from './tagNames';
import { TagsPanel } from './tagsTab';

/** Sends the host one message. */
function send(message: DashboardMessage): void {
  vscodeApi().postMessage(message);
}

/** What the page draws from: the host's last snapshot, once there is one. */
interface DashboardStore {
  readonly snapshot: DashboardPageState | undefined;
}

/** The page's own state, starting from what VS Code kept for it. */
const view: DashboardView = {
  ...readKeptView(),
  openWidgetOptions: undefined,
  widgetQueryDrafts: {},
  quickAddDraft: '',
  quickAddStatus: '',
};

/**
 * Counts the times a list of tags or of Home's widgets was changed outside a
 * draw, by a drag. The lists are keyed by it, so the next draw makes them
 * afresh, as the template's draws always did, rather than patching elements
 * the drag moved.
 */
const lists = { generation: 0 };

/** Where the window was scrolled when a draw began, put back after it. */
let scrolledTo = { x: 0, y: 0 };

/**
 * The host's last snapshot, once there is one, which the page draws, the
 * search box reads, and arranging Home changes in place, as the template's
 * script held it.
 */
let latest: DashboardPageState | undefined;

/** The snapshot the page shows, if it has one yet. */
function shown(): DashboardPageState | undefined {
  return latest;
}

/** Home's widget of a kind, as the host built it. */
function findWidget(kind: DashboardWidget['kind']): DashboardWidget | undefined {
  const snapshot = shown();
  return snapshot && snapshot.widgets ? snapshot.widgets.find((widget) => widget.kind === kind) : undefined;
}

/** What every widget on Home is drawn with, for one draw. */
function homeContext(snapshot: DashboardPageState): HomeContext {
  return {
    editing: view.editingHome,
    savedFilters: snapshot.savedFilters,
    openOptions: view.openWidgetOptions,
    queryDrafts: view.widgetQueryDrafts,
    quickAdd: { draft: view.quickAddDraft, status: view.quickAddStatus },
    searchBar: () => editor.bar(),
  };
}

/** The whole page: its header and tiles, the Home and Tags tabs, and the panel of each. */
function DashboardPage({ snapshot }: { readonly snapshot: DashboardPageState }) {
  const filter = filterTags(snapshot.tags, view.browseQuery, view.tagNamespaceFilter);
  return (
    <>
      <PageHeader snapshot={snapshot} view={view} />
      <ModeTabs view={view} filter={filter} />
      <HomePanel
        snapshot={snapshot}
        view={view}
        home={homeContext(snapshot)}
        choices={widgetChoices(snapshot.widgetConfig || [], snapshot.savedFilters)}
        generation={lists.generation}
      />
      <TagsPanel snapshot={snapshot} view={view} filter={filter} generation={lists.generation} />
    </>
  );
}

// What every page shares comes first, as the template's component script
// did: the busy mark, the indexing line, tips, and the menu keys.
const store = startPage<DashboardStore>({
  initial: { snapshot: undefined },
  ready: (state) => Boolean(state.snapshot),
  view: (state) => <DashboardPage snapshot={state.snapshot as DashboardPageState} />,
  afterDraw: () => {
    syncWidgetOptions();
    bindTagColumnControls();
    applyTagColumns(view.tagColumns ?? 2);
    editor.afterRender();
    window.scrollTo(scrolledTo.x, scrolledTo.y);
  },
});
installMenuKeys();

/**
 * Home's search box opens a search page. It is the box every search page
 * uses, with its completions and builder, so a search is written here as it
 * would be anywhere.
 */
const editor = createQueryEditor({
  getState: () => findWidget('search')?.searchState,
  render: () => redraw(),
  apply: (text) => {
    if (String(text).trim()) {
      send({ type: 'openSearch', query: text });
    }
  },
  clear: () => redraw(),
  placeholder: () => 'Search notes and tasks: words, #tags, is:open, has:due, in:folder, updated >= 7d…',
  label: 'Search notes and tasks',
});

/**
 * Undo for a widget removed while customizing. Taken or lapsed with focus
 * on it, focus goes back to the widget's Remove button if it is drawn
 * again, or else to the widget now in its place.
 */
const widgetUndo = createUndoNotice<{ widget: DashboardWidgetConfig; index: number }>(() => redraw(), ({ index }) => widgetInPlaceOf(index));

/**
 * The widget now where a removed one was: the one after it, or the last
 * when it was last, or Finish when Home has none left. Each is a tab stop
 * while Home is arranged, so the next Tab goes on from there rather than
 * from the top of the page.
 */
function widgetInPlaceOf(index: number): HTMLElement | null {
  const frames = Array.from(document.querySelectorAll<HTMLElement>('.home-widget[data-widget-id]'));
  return frames[Math.min(index, frames.length - 1)] ?? document.querySelector<HTMLElement>('[data-action="finish-customizing"]');
}

/** Keeps the page's presentation state, so a data refresh keeps the tab shown. */
function saveView(): void {
  keepView(view);
}

/**
 * Draws the page again without taking the reader's place: the caret in a
 * field being typed in, or what had focus. First it tells the host what
 * + Add widget offers, when that changed, settles the tag columns, puts back
 * what the last draw's new widget changed, and closes the rank menu, as each
 * of the template's draws did.
 */
function redraw(change: Partial<DashboardStore> = {}): void {
  const snapshot = change.snapshot ?? shown();
  if (snapshot) {
    sendWidgetChoices(snapshot);
    const columns = view.tagColumns ?? snapshot.tagColumns ?? 2;
    view.tagColumns = columns;
    snapshot.tagColumns = columns;
    closeRankMenu();
    unmarkNewWidget();
    editor.beforeRender();
    scrolledTo = { x: window.scrollX, y: window.scrollY };
  }
  store.update(change);
}

// ----- Tag searches ----------------------------------------------------------

/** Tag searches wait for typing to settle before telling the host. */
const TAG_SEARCH_DEBOUNCE_MS = 350;

/** The tag search waiting to be told to the host, and the one last told. */
const pendingSearch: { timer?: ReturnType<typeof setTimeout>; query?: string } = {};

/**
 * Tells the host about a tag search once typing settles.
 *
 * The page filters at once on its own; the host only stores the query. Each
 * store sends the whole state back, so storing every keystroke would redraw
 * the page mid-word and could echo an older query over newer typing.
 */
function scheduleSearch(query: string): void {
  clearTimeout(pendingSearch.timer);
  pendingSearch.query = query;
  pendingSearch.timer = setTimeout(() => {
    pendingSearch.timer = undefined;
    send({ type: 'setDashboardSearch', field: 'tags', query });
  }, TAG_SEARCH_DEBOUNCE_MS);
}

/** The host's copy of the tag search, unless the page still holds newer typing. */
function acceptHostSearch(hostQuery: string, localQuery: string): string {
  if (pendingSearch.query === undefined) {
    return hostQuery;
  }
  if (!pendingSearch.timer && hostQuery === pendingSearch.query) {
    pendingSearch.query = undefined;
    return hostQuery;
  }
  return localQuery;
}

// ----- Modes -----------------------------------------------------------------

/** Shows Home or the Tags tab, and tells the host, which sends Home its widgets. */
function setDashboardMode(mode: string | undefined, focusTab: boolean): void {
  view.mode = mode === 'browse' ? 'browse' : 'home';
  saveView();
  send({ type: 'setDashboardMode', mode: view.mode });
  redraw();
  if (focusTab) {
    document.querySelector<HTMLElement>(`[data-dashboard-mode="${view.mode}"]`)?.focus();
  }
}

/** Starts or stops arranging Home. Leaving it withdraws a pending Undo: the widgets are settled. */
function setEditingHome(editing: boolean): void {
  view.editingHome = editing;
  if (!editing) {
    widgetUndo.clear();
    refocusRestored = undefined;
  }
  view.openWidgetOptions = undefined;
  saveView();
  redraw();
}

/** Lays the tags out in a number of columns without replacing the open gear, and marks the choice. */
function applyTagColumns(columns: number): void {
  view.tagColumns = columns as DashboardColumnCount;
  const snapshot = shown();
  if (snapshot) {
    snapshot.tagColumns = columns as DashboardColumnCount;
  }
  // A style attribute is refused by the page's policy, so columns are set by script.
  document.querySelectorAll<HTMLElement>('.tag-list').forEach((grid) => {
    grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  });
  document.querySelectorAll<HTMLElement>('[data-action="set-columns"][data-section="tags"]').forEach((button) => {
    const selected = Number(button.dataset.value) === columns;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

/** The column buttons already listened to. */
const boundColumnButtons = new WeakSet<Element>();

/**
 * Listens to the column buttons directly, since they sit inside the gear's
 * native menu: a click there lays the tags out at once and keeps the menu
 * open, so it goes no further than the button.
 */
function bindTagColumnControls(): void {
  document.querySelectorAll<HTMLElement>('[data-action="set-columns"]').forEach((button) => {
    if (boundColumnButtons.has(button)) {
      return;
    }
    boundColumnButtons.add(button);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const columns = Number(button.dataset.value);
      if (button.dataset.section !== 'tags' || columns < 1 || columns > 4) {
        return;
      }
      applyTagColumns(columns);
      saveView();
      send({ type: 'setDashboardColumns', section: 'tags', columns: columns as DashboardColumnCount });
    });
  });
}

/** Opens each widget's gear exactly when it is the one the reader left open, as every draw of the template did. */
function syncWidgetOptions(): void {
  document.querySelectorAll<HTMLDetailsElement>('.home-widget-options').forEach((options) => {
    const open = view.openWidgetOptions === options.dataset.widgetId;
    if (options.open !== open) {
      options.open = open;
    }
  });
}

// ----- Arranging Home --------------------------------------------------------

/** Home's widgets as the host keeps them: their settings, in order, each a copy. */
function widgetConfig(snapshot: DashboardPageState): DashboardWidgetConfig[] {
  return (snapshot.widgetConfig || []).map((widget) => ({ ...widget }));
}

/** Saves Home's widgets. The host answers with what each shows. */
function sendWidgets(snapshot: DashboardPageState, widgets: DashboardWidgetConfig[]): void {
  snapshot.widgetConfig = widgets;
  send({ type: 'setDashboardWidgets', widgets });
}

/** Changes one widget's settings. */
function updateWidget(widgetId: string | undefined, changes: Partial<DashboardWidgetConfig>): void {
  const snapshot = shown();
  if (snapshot) {
    sendWidgets(snapshot, widgetConfig(snapshot).map((widget) => (widget.id === widgetId ? Object.assign(widget, changes) : widget)));
  }
}

/** The kind of the widget with this id, as Home holds it. */
function widgetKindOf(widgetId: string | undefined): DashboardWidgetConfig['kind'] | undefined {
  const snapshot = shown();
  return snapshot ? widgetConfig(snapshot).find((widget) => widget.id === widgetId)?.kind : undefined;
}

/** Reorders Home's widgets by their ids; true when it did. */
function rankWidget(reorder: (keys: string[]) => string[] | undefined): boolean {
  const snapshot = shown();
  if (!snapshot) {
    return false;
  }
  const widgets = widgetConfig(snapshot);
  const ids = reorder(widgets.map((widget) => widget.id));
  if (!ids) {
    return false;
  }
  sendWidgets(snapshot, ids.map((id) => widgets.find((widget) => widget.id === id) as DashboardWidgetConfig));
  return true;
}

/** The widget just added, until it has been shown and its mark has faded. */
let newWidget: { id: string; until: number; shown: boolean } | undefined;

/**
 * A widget's id, made on the page so the new widget is drawn at once with
 * its mark: its kind, then the time and a few random letters. The host
 * keeps only ids it can hold.
 */
function mintWidgetId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Adds a widget of a kind, or a saved search's widget as `savedQuery:<id>`, first after Try next. */
function addWidget(value: string): void {
  const separator = value.indexOf(':');
  const kind = separator < 0 ? value : value.slice(0, separator);
  const snapshot = shown();
  if (!isWidgetKind(kind) || !snapshot) {
    return;
  }
  const traits = WIDGET_KINDS[kind];
  const widget: DashboardWidgetConfig = {
    id: mintWidgetId(kind),
    kind,
    width: kind === 'search' || kind === 'stats' || kind === 'quickAdd' ? 'full' : 'half',
  };
  if (traits.listed) {
    widget.count = 5;
  }
  if (kind === 'tasks') {
    widget.query = 'is:open';
  }
  if (traits.defaultDays) {
    widget.days = traits.defaultDays;
  }
  if (kind === 'savedQuery') {
    if (separator < 0) {
      return;
    }
    widget.filterId = value.slice(separator + 1);
  }
  const widgets = widgetConfig(snapshot);
  // The host keeps the first widgets Home can hold, so a new one, which
  // goes first, would push the last off Home with no Undo.
  if (isHomeFull(widgets)) {
    announce(HOME_FULL_MESSAGE);
    return;
  }
  // A new widget goes first, after Try next, where it is seen without
  // scrolling; it is then shown, marked for a moment, and focused.
  widgets.splice(widgets.length && widgets[0].kind === 'tryNext' ? 1 : 0, 0, widget);
  newWidget = { id: widget.id, until: Date.now() + 2400, shown: false };
  sendWidgets(snapshot, widgets);
}

/** What showing the new widget changed outside a draw: its mark, and the tab stop it was given. */
let newWidgetMark: { element: HTMLElement; tabindex: string | null | undefined } | undefined;

/**
 * Takes back what showing the new widget changed, before the page is drawn
 * again: every template draw made the widget afresh, without its mark or
 * its tab stop, until the next state marked it again.
 */
function unmarkNewWidget(): void {
  const mark = newWidgetMark;
  newWidgetMark = undefined;
  if (!mark) {
    return;
  }
  mark.element.classList.remove('is-new');
  if (mark.tabindex === undefined) {
    return;
  }
  if (mark.tabindex === null) {
    mark.element.removeAttribute('tabindex');
  } else {
    mark.element.setAttribute('tabindex', mark.tabindex);
  }
}

/** Scrolls to the widget just added, marks it, focuses it, and says so, once. */
function revealNewWidget(): void {
  if (!newWidget) {
    return;
  }
  const element = document.querySelector<HTMLElement>(`.home-widget[data-widget-id="${newWidget.id}"]`);
  if (!element) {
    return;
  }
  newWidgetMark = { element, tabindex: undefined };
  if (Date.now() < newWidget.until) {
    element.classList.add('is-new');
  }
  if (newWidget.shown) {
    return;
  }
  newWidget.shown = true;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  newWidgetMark.tabindex = element.getAttribute('tabindex');
  element.setAttribute('tabindex', '-1');
  element.focus?.({ preventScroll: true });
  // The widget's name, as its frame is labeled: the title's text also
  // holds the grip and the count.
  announce(`Added ${element.getAttribute('aria-label') || 'a widget'} to the top of Home.`);
  const id = newWidget.id;
  setTimeout(() => {
    document.querySelector(`.home-widget[data-widget-id="${id}"]`)?.classList.remove('is-new');
    if (newWidget && newWidget.id === id) {
      newWidget = undefined;
    }
  }, Math.max(0, newWidget.until - Date.now()));
}

/** The last list of what + Add widget offers that the host was told, as JSON. */
let sentChoices = '';

/**
 * Tells the host what can be added, when that has changed, so Related Notes
 * can offer it too. It is worked out from Home's settings, which every
 * snapshot carries, so a Dashboard opened on the Tags tab, sent no widgets
 * yet, tells it as well.
 */
function sendWidgetChoices(snapshot: DashboardPageState): void {
  const choices = widgetChoices(widgetConfig(snapshot), snapshot.savedFilters);
  const key = JSON.stringify(choices);
  if (key === sentChoices) {
    return;
  }
  sentChoices = key;
  send({ type: 'widgetChoices', choices });
}

/** Removes a widget at once, with Undo for 8 seconds: it goes back where it was, with its width and its options. */
function removeWidget(widgetId: string | undefined): void {
  const snapshot = shown();
  if (!snapshot) {
    return;
  }
  const widgets = widgetConfig(snapshot);
  const index = widgets.findIndex((widget) => widget.id === widgetId);
  if (index < 0) {
    return;
  }
  const removed = widgets[index];
  const drawn = (snapshot.widgets || []).find((widget) => widget.id === removed.id);
  sendWidgets(snapshot, widgets.filter((widget) => widget.id !== removed.id));
  widgetUndo.show(`Removed ${(drawn && drawn.title) || 'the widget'}.`, 'undo-remove-widget', { widget: removed, index });
}

/**
 * The widget Undo put back, whose Remove button takes focus once the host
 * draws it again: Undo was taken with focus on it, and the toast emptied
 * takes focus away to the page itself.
 */
let refocusRestored: string | undefined;

/** Puts back the widget removed last, where it was, and, when Undo had focus, focus where the removal was made. */
function undoRemoveWidget(): void {
  const fromUndo = Boolean(document.getElementById('undo-toast')?.contains(document.activeElement));
  const undone = widgetUndo.take();
  const snapshot = shown();
  if (!undone || !snapshot) {
    return;
  }
  const widgets = widgetConfig(snapshot);
  widgets.splice(Math.min(undone.index, widgets.length), 0, undone.widget);
  refocusRestored = fromUndo ? undone.widget.id : undefined;
  sendWidgets(snapshot, widgets);
  redraw();
}

/**
 * Focuses the restored widget's Remove button once it is drawn, while
 * focus is still on the page itself or somewhere in Home's grid, where a
 * stand-in for the gone widget may have put it; elsewhere, the reader has
 * moved on, and it is left there.
 */
function focusRestoredWidget(): void {
  const id = refocusRestored;
  const button = id ? document.querySelector<HTMLElement>(`.home-widget[data-widget-id="${id}"] [data-action="remove-widget"]`) : null;
  if (!button) {
    return;
  }
  refocusRestored = undefined;
  const active = document.activeElement;
  if (!active || active === document.body || active.closest('.home-grid')) {
    button.focus();
  }
}

// ----- Ranking ---------------------------------------------------------------

/** Ranked modes alone have a meaningful order the reader sets. */
function canRank(kind: string): boolean {
  const snapshot = shown();
  if (!snapshot) {
    return false;
  }
  if (kind === 'widget') {
    return view.editingHome;
  }
  return kind === 'tag' ? snapshot.tagSortMode === 'custom' : snapshot.entitySortMode === 'custom';
}

/** Reorders a tag within its own group, favorites or the rest, in place; true when it did. */
function rankTag(tagKey: string, reorder: (keys: string[]) => string[] | undefined): boolean {
  const snapshot = shown();
  const selected = snapshot?.tags.find((tag) => tag.key === tagKey);
  if (!snapshot || !selected) {
    return false;
  }
  const groupKeys = reorder(snapshot.tags.filter((tag) => tag.isFavorite === selected.isFavorite).map((tag) => tag.key));
  if (!groupKeys) {
    return false;
  }
  let groupPosition = 0;
  const tagKeys = snapshot.tags.map((tag) => {
    if (tag.isFavorite !== selected.isFavorite) {
      return tag.key;
    }
    const key = groupKeys[groupPosition];
    groupPosition += 1;
    return key;
  });
  send({ type: 'reorderTags', tagKeys, tagKey, isFavorite: selected.isFavorite });
  return true;
}

/** Reorders the entities; true when it did. */
function rankEntity(reorder: (keys: string[]) => string[] | undefined): boolean {
  const snapshot = shown();
  const keys = snapshot ? reorder(snapshot.entities.map((entity) => entity.key)) : undefined;
  if (!keys) {
    return false;
  }
  send({ type: 'reorderEntities', entityKeys: keys });
  return true;
}

// Tags, entities, and Home's widgets are ranked by dragging, or from their
// context menu, which also renames a tag and parks it.
installRankedRows({
  kinds: {
    // A favorite and the rest are ranked apart; Move up or down never
    // crosses from one to the other.
    tag: { selector: '.tag-row[data-tag-key]', key: 'tagKey', group: '.tag-group' },
    entity: { selector: '.entity-row[data-entity-key]', key: 'entityKey' },
    widget: { selector: '.home-widget.is-editing[data-widget-id]', key: 'widgetId', edgeLabels: ['Move to first', 'Move to last'] },
  },
  canRank,
  reorder: ({ kind, key, targetKey, before, placeholder }) => {
    if (kind === 'widget') {
      return rankWidget((keys) => rankKeys(keys, key, targetKey, before));
    }
    if (kind === 'entity') {
      return rankEntity((keys) => rankKeys(keys, key, targetKey, before));
    }
    // A tag dropped into the other group moves between favorites and the rest.
    const snapshot = shown();
    const tagKeys = snapshot ? rankKeys(snapshot.tags.map((tag) => tag.key), key, targetKey, before) : undefined;
    if (!tagKeys) {
      return false;
    }
    const group = placeholder ? placeholder.closest<HTMLElement>('.tag-group') : null;
    send({ type: 'reorderTags', tagKeys, tagKey: key, isFavorite: Boolean(group && group.dataset.tagGroup === 'favorites') });
    return true;
  },
  move: (kind, key, toTop) => {
    const reorder = (keys: string[]) => moveKeyToEdge(keys, key, toTop);
    if (kind === 'widget') {
      rankWidget(reorder);
    } else if (kind === 'entity') {
      rankEntity(reorder);
    } else {
      rankTag(key, reorder);
    }
  },
  menuActions: (kind, key) =>
    (kind === 'tag'
      ? [{ action: 'rename-tag', label: 'Rename tag' }, { action: 'park-tag', label: isParkedTag(key) ? 'Unpark tag' : 'Park tag' }]
      : []),
  onMenuAction: (action, _kind, key) => {
    if (action === 'rename-tag') {
      send({ type: 'renameTag', tagKey: key });
    }
    if (action === 'park-tag') {
      send({ type: isParkedTag(key) ? 'unparkTag' : 'parkTag', tagKey: key });
    }
  },
  onListChanged: () => {
    lists.generation += 1;
  },
});

installViewOptions();

// ----- What the reader does --------------------------------------------------

/**
 * A field of a control's dataset, sent as the template sent it: one the
 * control does not carry is left out of the message, which the host
 * refuses.
 */
function data(target: HTMLElement, name: string): string {
  return target.dataset[name] as string;
}

/** What each of the page's own controls does on a click. */
const ACTIONS: Readonly<Record<string, (target: HTMLElement, event: MouseEvent) => void>> = {
  'clear-tag-search': () => {
    // The namespace filter is part of the Tags search, so it clears too.
    view.browseQuery = '';
    view.tagNamespaceFilter = '';
    saveView();
    scheduleSearch('');
    redraw();
    document.querySelector<HTMLElement>('input[data-action="search-browse"]')?.focus();
  },
  'set-dashboard-mode': (target) => setDashboardMode(target.dataset.dashboardMode, document.activeElement === target),
  'customize-home': () => {
    if (view.mode !== 'home') {
      setDashboardMode('home', false);
    }
    setEditingHome(true);
  },
  'finish-customizing': () => setEditingHome(false),
  'run-try-next': (target) => send({ type: 'runTryNext', key: target.getAttribute('data-key') as string }),
  'snooze-try-next': (target) => send({ type: 'snoozeTryNext', key: target.getAttribute('data-key') as string }),
  'retire-try-next': (target) => send({ type: 'retireTryNext', key: target.getAttribute('data-key') as string }),
  'open-whats-new': () => send({ type: 'openWhatsNew' }),
  'dismiss-whats-new': () => send({ type: 'dismissWhatsNew' }),
  'reset-widgets': () => send({ type: 'resetDashboardWidgets' }),
  'remove-widget': (target) => removeWidget(target.dataset.widgetId),
  'undo-remove-widget': () => undoRemoveWidget(),
  'set-widget-width': (target) => updateWidget(target.dataset.widgetId, { width: target.dataset.value === 'full' ? 'full' : 'half' }),
  // A list that starts being paged starts at its first page, and one that
  // stops keeps nothing to come back to.
  'set-widget-paged': (target) => updateWidget(target.dataset.widgetId, target.dataset.value === 'on' ? { paged: true, page: 1 } : { paged: false, page: 1 }),
  'set-widget-page': (target) => updateWidget(target.dataset.widgetId, { page: Number(target.dataset.page) }),
  'set-widget-count': (target) => updateWidget(target.dataset.widgetId, { count: Number(target.dataset.value), page: 1 }),
  'set-widget-days': (target) => updateWidget(target.dataset.widgetId, { days: Number(target.dataset.value) }),
  'open-daily-note': () => send({ type: 'openDailyNote' }),
  'create-tag-hub': (target) => send({ type: 'createTagHub', tagKey: data(target, 'tagKey') }),
  'add-next-action': (target) => send({ type: 'addNextAction', tagKey: data(target, 'tagKey') }),
  'rename-tag': (target) => send({ type: 'renameTag', tagKey: data(target, 'tagKey') }),
  'open-note': (target, event) => send({ type: 'openNote', filePath: data(target, 'filePath'), ...(event?.shiftKey ? { opposite: true } : {}) }),
  'unpin-note': (target) => send({ type: 'unpinNote', filePath: target.dataset.filePath || ' ', pinKey: target.dataset.pinKey }),
  'open-search': (target) => send({ type: 'openSearch', query: target.dataset.query || '' }),
  'open-task-board': (target) => send({ type: 'openTaskBoard', query: target.dataset.query || '' }),
  'open-view': (target) => send({ type: 'openView', view: data(target, 'view') as OpenDeckardViewMessage['view'] }),
  'open-search-page': () => send({ type: 'openSearch', query: '' }),
  'open-tag': (target) => send({ type: 'openTag', tagKey: data(target, 'tagKey') }),
  'remove-saved-filter': (target) => send({ type: 'removeSavedFilter', filterId: data(target, 'savedFilterId') }),
  'add-saved-search-widget': (target) => send({ type: 'addSavedSearchWidget', filterId: data(target, 'savedFilterId') }),
  'favorite-tag': (target) => send({ type: 'toggleFavorite', tagKey: data(target, 'tagKey') }),
  'favorite-entity': (target) => send({ type: 'toggleFavoriteEntity', entityKey: data(target, 'entityKey') }),
  'open-source': (target, event) => send(openSourceMessage(target, event)),
};

/** A row clicked or pressed outside its controls opens what it lists: a task, an entity, a tag, or a saved search. */
function openRow(element: Element, event: MouseEvent | KeyboardEvent): void {
  const taskRow = element.closest<HTMLElement>('.task-row');
  if (taskRow) {
    send(openSourceMessage(taskRow, event as MouseEvent));
  }
  const entityRow = element.closest<HTMLElement>('.entity-row');
  if (entityRow) {
    send({ type: 'openTag', tagKey: data(entityRow, 'entityKey') });
  }
  const tagRow = element.closest<HTMLElement>('.tag-row');
  if (tagRow) {
    send({ type: 'openTag', tagKey: data(tagRow, 'tagKey') });
  }
  const savedFilterRow = element.closest<HTMLElement>('.saved-filter-row[data-saved-filter-id]');
  if (savedFilterRow) {
    send({ type: 'openSavedFilter', filterId: data(savedFilterRow, 'savedFilterId') });
  }
}

// A widget's options stay open across a draw until closed.
document.addEventListener('toggle', (event) => {
  const options = event.target as HTMLDetailsElement | null;
  if (!options || !options.classList || !options.classList.contains('home-widget-options')) {
    return;
  }
  if (options.open) {
    view.openWidgetOptions = options.dataset.widgetId;
  } else if (view.openWidgetOptions === options.dataset.widgetId) {
    view.openWidgetOptions = undefined;
  }
}, true);

document.addEventListener('click', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  if (view.openWidgetOptions && !(element && element.closest('.home-widget-options'))) {
    view.openWidgetOptions = undefined;
    document.querySelectorAll<HTMLDetailsElement>('.home-widget-options[open]').forEach((options) => {
      options.open = false;
    });
  }
  if (editor.handleClick(event) || !element) {
    return;
  }
  const target = element.closest<HTMLElement>('[data-action]');
  if (target) {
    const action = String(target.dataset.action);
    if (Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
      ACTIONS[action](target, event);
    }
    return;
  }
  if (element.closest('button, input, select, a, summary')) {
    return;
  }
  openRow(element, event);
});

document.addEventListener('mousedown', (event) => {
  editor.handleMousedown(event);
});
document.addEventListener('focusin', (event) => {
  editor.handleFocusIn(event);
});

/** Sends the task typed into Quick add: the field is cleared at once, and the host gives the text back if it could not add it. */
function submitQuickAdd(): void {
  const text = view.quickAddDraft.trim();
  if (!text) {
    return;
  }
  view.quickAddDraft = '';
  view.quickAddStatus = 'Adding…';
  send({ type: 'quickAdd', text });
  redraw();
}

document.addEventListener('submit', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) {
    return;
  }
  if (element.closest('[data-form="quick-add"]')) {
    event.preventDefault();
    submitQuickAdd();
    return;
  }
  const form = element.closest<HTMLElement>('[data-form="widget-query"]');
  if (!form) {
    return;
  }
  event.preventDefault();
  const widgetId = String(form.dataset.widgetId);
  const query = view.widgetQueryDrafts[widgetId];
  delete view.widgetQueryDrafts[widgetId];
  if (query !== undefined) {
    updateWidget(form.dataset.widgetId, { query: query.trim() });
  }
});

/** The Dashboard's tabs in order, for the arrow keys between them. */
const MODES = ['home', 'browse'] as const;

/** Left and Right move between the tabs and choose, Home and End go to the ends; true when the key was one. */
function moveBetweenTabs(event: KeyboardEvent, element: Element): boolean {
  const tab = element.closest('[role="tab"][data-dashboard-mode]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return false;
  }
  event.preventDefault();
  const current = MODES.indexOf(view.mode);
  let next = (current + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
  if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = MODES.length - 1;
  }
  setDashboardMode(MODES[next], true);
  return true;
}

/**
 * Escape closes the widget gear focus is in and hands focus back to the
 * gear, as the page's own gear does; true when it did.
 */
function closeWidgetOptions(event: KeyboardEvent, element: Element | null): boolean {
  const options = event.key === 'Escape' && element ? element.closest<HTMLDetailsElement>('.home-widget-options[open]') : null;
  if (!options) {
    return false;
  }
  event.preventDefault();
  options.open = false;
  view.openWidgetOptions = undefined;
  options.querySelector<HTMLElement>('summary')?.focus();
  return true;
}

document.addEventListener('keydown', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  if (closeWidgetOptions(event, element)) {
    return;
  }
  // The search box takes / only where it is on screen.
  const inSearch = Boolean(element && element.closest('[data-suggest-key]'));
  if ((inSearch || (view.mode === 'home' && findWidget('search'))) && editor.handleKeydown(event)) {
    return;
  }
  if (!element || moveBetweenTabs(event, element)) {
    return;
  }
  if ((event.key !== 'Enter' && event.key !== ' ') || element.closest('button, input, select, a, summary')) {
    return;
  }
  const row = element.closest('.task-row, .entity-row, .tag-row, .saved-filter-row[data-saved-filter-id]');
  if (!row) {
    return;
  }
  event.preventDefault();
  openRow(row, event);
});

/** What each of the page's own fields and selects does when it changes. */
const CHANGES: Readonly<Record<string, (target: HTMLInputElement) => void>> = {
  'set-sort': (target) => send({ type: 'setTagSort', mode: target.value as TagSortMode }),
  'set-tag-namespace': (target) => {
    view.tagNamespaceFilter = target.value;
    saveView();
    redraw();
    document.querySelector<HTMLElement>('select[data-action="set-tag-namespace"]')?.focus();
  },
  'add-widget': (target) => {
    if (target.value) {
      addWidget(target.value);
    }
  },
  'set-widget-filter': (target) => updateWidget(target.dataset.widgetId, { filterId: target.value }),
  'set-widget-namespace': (target) => {
    // A widget's own default is kept as no namespace, as the host keeps it.
    const kind = widgetKindOf(target.dataset.widgetId);
    const fallback = kind ? WIDGET_KINDS[kind].defaultNamespace : undefined;
    updateWidget(target.dataset.widgetId, { namespace: target.value === fallback ? undefined : target.value, page: 1 });
  },
  'set-widget-no-open-tasks': (target) => updateWidget(target.dataset.widgetId, { noOpenTasks: target.checked ? true : undefined, page: 1 }),
  // A different page size is a different set of pages, so the list is read
  // again from its top.
  'set-widget-page-size': (target) => updateWidget(target.dataset.widgetId, { count: Number(target.value), page: 1 }),
  'toggle-task': (target) => {
    send({ type: 'toggleTask', taskId: data(target, 'taskId'), completed: target.checked });
    announce(`${target.checked ? 'Completed ' : 'Reopened '}${taskTitleOf(target)}.`);
  },
};

document.addEventListener('change', (event) => {
  if (editor.handleChange(event)) {
    return;
  }
  const target = event.target as HTMLInputElement;
  const action = target.dataset ? target.dataset.action : undefined;
  if (action && Object.prototype.hasOwnProperty.call(CHANGES, action)) {
    CHANGES[action](target);
  }
});

document.addEventListener('input', (event) => {
  if (editor.handleInput(event)) {
    return;
  }
  const target = event.target as HTMLInputElement;
  const action = target.dataset ? target.dataset.action : undefined;
  if (action === 'search-browse') {
    view.browseQuery = target.value;
    saveView();
    scheduleSearch(view.browseQuery);
    redraw();
  }
  if (action === 'quick-add-draft') {
    view.quickAddDraft = target.value;
  }
  if (action === 'widget-query-draft') {
    view.widgetQueryDrafts[String(target.dataset.widgetId)] = target.value;
  }
});

// ----- What the host sends ---------------------------------------------------

// A widget chosen in Related Notes: Home is shown, goes into customizing,
// and adds it. On the Tags tab the new widget would be added out of sight.
onHostMessage<{ type: 'addWidget'; value: unknown }>('addWidget', (message) => {
  if (typeof message.value !== 'string') {
    return;
  }
  if (view.mode !== 'home') {
    setDashboardMode('home', false);
  }
  if (!view.editingHome) {
    setEditingHome(true);
  }
  addWidget(message.value);
});

onHostMessage<{ type: 'quickAddResult'; text: string; added: boolean }>('quickAddResult', (message) => {
  if (message.added) {
    view.quickAddStatus = `Added “${message.text}”.`;
  } else {
    view.quickAddStatus = 'Could not add the task.';
    if (!view.quickAddDraft) {
      view.quickAddDraft = message.text;
    }
  }
  redraw();
});

/**
 * Takes the host's next snapshot: its parked tags, its tag columns, the tab
 * and the tag search it keeps unless the page holds newer typing, and Home's
 * widgets, which are sent only while Home is showing; the last set is kept,
 * so Home does not blank to "Loading Home…" on every return from the Tags
 * tab. The search box is told, the page is drawn, and a widget just added is
 * shown.
 */
function receiveState(incoming: DashboardPageState): void {
  setParkedTags(incoming.parkedTags);
  view.tagColumns = incoming.tagColumns ?? view.tagColumns ?? 2;
  if (incoming.viewState) {
    view.mode = incoming.viewState.mode === 'browse' ? 'browse' : 'home';
    view.browseQuery = acceptHostSearch(incoming.viewState.tagSearchQuery, view.browseQuery);
  }
  incoming.tagColumns = view.tagColumns;
  const previous = shown();
  if (!incoming.widgets && previous && previous.widgets) {
    incoming.widgets = previous.widgets;
  }
  latest = incoming;
  editor.receive();
  redraw({ snapshot: incoming });
  revealNewWidget();
  focusRestoredWidget();
}

onHostMessage<StateMessage<DashboardPageState>>('state', (message) => receiveState(message.data));
