/**
 * The persisted preferences format: what a blob may hold, what it holds by
 * default, how anything read from storage is rebuilt into a valid blob, the
 * migrations that reading applies, and which keys a workspace keeps.
 *
 * Pure: nothing here reads or writes storage, the clock, or VS Code, so the
 * format can be tested without a store. `PreferencesRepository` reads and
 * writes through it, and every write passes through `normalizePreferences`.
 */
import { HOME_WIDGET_LIMIT, isWatchableNamespace, isWidgetKind, WIDGET_ENTRY_COUNTS, WIDGET_KINDS } from '../../domain/dashboard/widgetCatalog';
import { legacyIdOf } from '../../domain/markdown/parser';
import { isBoardNamespace, isTaskColumnId } from '../../domain/tasks/taskColumns';
import {
  AGENDA_GROUP_BYS,
  AgendaGroupBy,
  DashboardColumnCount,
  DashboardViewState,
  DashboardWidgetConfig,
  DashboardWidgetKind,
  DashboardWidgetWidth,
  DEFAULT_SEARCH_PAGE_SIZE,
  FindChoice,
  PersistedPreferences,
  PinnedNote,
  RelatedNotesSortMode,
  SavedFilter,
  SEARCH_PAGE_SIZES,
  SearchPageSize,
  SearchPreview,
  TableSort,
  TAG_OVERVIEW_SORT_MODES,
  TagOverviewLayout,
  TagSortMode,
  TASK_SORT_MODES,
  TaskBoardGroupBy,
  TaskSortMode,
  TaskColumnId,
  TaskLayout,
} from '../../domain/model/preferences';

/**
 * The preferences that name what is in a workspace rather than how Deckard
 * looks, and so belong to that workspace.
 *
 * These were kept machine-wide until 1.19, and pruned against whichever
 * window last built an index. Opening any other folder holding a Markdown
 * file — a repository with a README was enough — deleted the favorites,
 * pins and view counts belonging to the notes workspace, because that
 * folder's index did not contain them.
 *
 * What stays machine-wide is presentation: sort modes, column counts,
 * layouts, page sizes. Those mean the same thing in any workspace, and
 * nothing prunes them.
 */
export const WORKSPACE_PREFERENCE_KEYS = [
  'favoriteTags',
  'favoriteEntities',
  'tagAccessOrder',
  'tagAccessCounts',
  'tagAccessTimes',
  'entityAccessOrder',
  'entityAccessCounts',
  'taskOrder',
  'sectionAccessCounts',
  'sectionAccessTimes',
  'savedFilters',
  'recentQueries',
  'findChoices',
  'recentHeadings',
  'tagFirstSeen',
  'pinnedNotes',
  'dashboardWidgets',
  'dashboardViewState',
  'agendaGroupNamespace',
] as const satisfies readonly (keyof PersistedPreferences)[];

/** Everything except the workspace's share: what stays machine-wide. */
export function omitWorkspacePreferences(
  value: Partial<PersistedPreferences> | undefined,
): Partial<PersistedPreferences> {
  const kept: Record<string, unknown> = { ...(value ?? {}) };
  for (const key of WORKSPACE_PREFERENCE_KEYS) {
    delete kept[key];
  }
  return kept as Partial<PersistedPreferences>;
}

/** The workspace's share of a whole preference blob. */
export function pickWorkspacePreferences(
  value: Partial<PersistedPreferences> | undefined,
): Partial<PersistedPreferences> {
  const picked: Record<string, unknown> = {};
  if (!value) {
    return picked;
  }
  for (const key of WORKSPACE_PREFERENCE_KEYS) {
    if (value[key] !== undefined) {
      picked[key] = value[key];
    }
  }
  return picked as Partial<PersistedPreferences>;
}

/** How many recent searches are kept. */
export const RECENT_QUERY_LIMIT = 20;

/** How many headings Add Task and Move to… remember. */
export const RECENT_HEADING_LIMIT = 5;

/** The most Find choices kept; the least recently chosen goes first. */
export const FIND_CHOICE_LIMIT = 200;

/** The widgets Home starts with, and returns to on Reset. */
export const DEFAULT_DASHBOARD_WIDGETS: readonly DashboardWidgetConfig[] = [
  // One suggestion, when the notes are ready for it, and nothing otherwise.
  { id: 'tryNext', kind: 'tryNext', width: 'full' },
  { id: 'search', kind: 'search', width: 'full' },
  // The Tasks view widget is the one list of tasks: what is overdue and due
  // today. Beside it, the notes opened lately, so a first Home reads as
  // notes as well as tasks, and lists no task twice.
  { id: 'agenda', kind: 'agenda', width: 'half', count: 5 },
  { id: 'recentNotes', kind: 'recentNotes', width: 'half', count: 5 },
  { id: 'favoriteTags', kind: 'favoriteTags', width: 'half', count: 8 },
  { id: 'savedSearches', kind: 'savedSearches', width: 'half' },
];

/** The furthest back a widget can look, in days. */
export const DASHBOARD_WIDGET_DAYS_LIMIT = 365;

/** The most notes Home keeps pinned. */
export const PINNED_NOTE_LIMIT = 50;

/** The most entries a list widget can show: the most its gear and its pager offer. */
export const DASHBOARD_WIDGET_COUNT_LIMIT = Math.max(...WIDGET_ENTRY_COUNTS);

/** The longest search a tasks widget keeps. */
const DASHBOARD_WIDGET_QUERY_LIMIT = 2000;

/**
 * The furthest page a widget may be left on. A page number is clamped to the
 * pages it actually has when it is drawn; this only keeps a stored number
 * from being unreasonable.
 */
const DASHBOARD_WIDGET_PAGE_LIMIT = 10000;

const TAG_SORT_MODES: readonly TagSortMode[] = ['alphabetical', 'count', 'access', 'custom'];
const COLUMN_COUNTS: readonly DashboardColumnCount[] = [1, 2, 3, 4];
const TAG_OVERVIEW_LAYOUTS: readonly TagOverviewLayout[] = ['tabs', 'split'];
const SEARCH_PREVIEWS: readonly SearchPreview[] = ['none', 'lines', 'full'];
const RELATED_NOTES_SORT_MODES: readonly RelatedNotesSortMode[] = ['newest', 'oldest', 'tags', 'access'];
const TASK_LAYOUTS: readonly TaskLayout[] = ['list', 'board', 'table'];
const WIDGET_WIDTHS: readonly DashboardWidgetWidth[] = ['half', 'full'];

/**
 * Every grouping the board offers is read back, or choosing one would be
 * forgotten the next time preferences were read. A tag grouping holds only
 * with a namespace to group by, so it is offered only then.
 */
const BOARD_GROUPS_WITHOUT_TAG: readonly TaskBoardGroupBy[] = ['status', 'priority', 'due', 'assignee'];
const BOARD_GROUPS: readonly TaskBoardGroupBy[] = [...BOARD_GROUPS_WITHOUT_TAG, 'tag'];

/**
 * `value` when it is one of `allowed`, and `fallback` otherwise: how every
 * enum field of a stored blob is read, so a mode that was renamed, removed,
 * or edited by hand falls back to its default instead of reaching a view.
 */
export function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/**
 * `list` with the entry that has `item`'s id replaced by `item`, or with
 * `item` added at the end when none has: how a saved search is stored
 * whether it is new or replaces one.
 */
export function upsertById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.some((entry) => entry.id === item.id)
    ? list.map((entry) => (entry.id === item.id ? item : entry))
    : [...list, item];
}

/** `list` without `key` when it holds it, and with `key` added at the end when not. */
export function toggled(list: readonly string[], key: string): string[] {
  const keys = new Set(list);
  if (keys.has(key)) {
    keys.delete(key);
  } else {
    keys.add(key);
  }
  return [...keys];
}

/** `counts` with one more under `key`, which starts at nothing. */
export function bumped(counts: Readonly<Record<string, number>>, key: string): Record<string, number> {
  return { ...counts, [key]: (counts[key] ?? 0) + 1 };
}

/**
 * The entries of a stored number record whose key is not empty and whose
 * value `isValid` accepts: the one shape behind view counts, access times,
 * and first-seen times, which differ only in which numbers they accept.
 */
export function filterNumericRecord(
  values: object,
  isValid: (value: unknown) => boolean,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => key.length > 0 && isValid(value)),
  ) as Record<string, number>;
}

/** A count: a whole number from zero. */
function isCount(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

/** An access time: a positive, finite timestamp. */
function isAccessTime(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A first-seen time, where 0 marks a tag known before times were kept. */
function isFirstSeenTime(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Keeps only finite-looking persisted counters accepted by the preference API.
 */
function normalizeAccessCounts(
  values: Record<string, number> | undefined,
): Record<string, number> {
  return filterNumericRecord(values ?? {}, isCount);
}

/**
 * Keeps only positive, finite timestamps.
 */
function normalizeAccessTimes(
  values: Record<string, number> | undefined,
): Record<string, number> {
  return filterNumericRecord(typeof values === 'object' && values !== null ? values : {}, isAccessTime);
}

/** First-seen times, where 0 marks a tag known before times were kept. */
function normalizeFirstSeenTimes(
  values: Record<string, number>,
): Record<string, number> {
  return filterNumericRecord(values, isFirstSeenTime);
}

/**
 * Reconstructs a valid preference shape from persisted or legacy state.
 *
 * It rebuilds the blob from the keys it names, in a fixed order, so a key
 * it does not name is dropped on the next write, and what is written is the
 * same bytes whatever order the stored blob had.
 */
export function normalizePreferences(
  value: Partial<PersistedPreferences> | undefined,
): PersistedPreferences {
  const source: Partial<PersistedPreferences> = value ?? {};
  return {
    version: 1,
    ...normalizeListsAndOrders(source),
    ...normalizeDashboardLayout(source),
    ...normalizeSearchPages(source),
    sectionAccessCounts: normalizeAccessCounts(source.sectionAccessCounts),
    savedFilters: normalizeSavedFilters(source.savedFilters),
    ...normalizeTaskBoard(source),
    ...normalizeWorkspaceMemory(source),
    ...normalizeViewChoices(source),
  };
}

/** The favorites, the orders and counts of tags and entities, and the task order. */
function normalizeListsAndOrders(
  source: Partial<PersistedPreferences>,
): Pick<
  PersistedPreferences,
  | 'favoriteTags'
  | 'favoriteEntities'
  | 'tagSortMode'
  | 'entitySortMode'
  | 'tagAccessOrder'
  | 'tagAccessCounts'
  | 'entityAccessOrder'
  | 'entityAccessCounts'
  | 'taskOrder'
  | 'taskSortMode'
> {
  return {
    favoriteTags: uniqueStrings(source.favoriteTags),
    favoriteEntities: uniqueStrings(source.favoriteEntities),
    tagSortMode: oneOf(source.tagSortMode, TAG_SORT_MODES, 'alphabetical'),
    entitySortMode: oneOf(source.entitySortMode, TAG_SORT_MODES, 'alphabetical'),
    tagAccessOrder: uniqueStrings(source.tagAccessOrder),
    tagAccessCounts: normalizeAccessCounts(source.tagAccessCounts),
    entityAccessOrder: uniqueStrings(source.entityAccessOrder),
    entityAccessCounts: normalizeAccessCounts(source.entityAccessCounts),
    taskOrder: uniqueStrings(source.taskOrder),
    taskSortMode: oneOf(source.taskSortMode, TASK_SORT_MODES, 'rank'),
  };
}

/** The Dashboard's column counts and the tab it was left on. */
function normalizeDashboardLayout(
  source: Partial<PersistedPreferences>,
): Pick<
  PersistedPreferences,
  'dashboardTaskColumns' | 'dashboardNoteColumns' | 'dashboardTagColumns' | 'dashboardViewState'
> {
  return {
    dashboardTaskColumns: oneOf(source.dashboardTaskColumns, COLUMN_COUNTS, 1),
    dashboardNoteColumns: oneOf(source.dashboardNoteColumns, COLUMN_COUNTS, 1),
    dashboardTagColumns: oneOf(source.dashboardTagColumns, COLUMN_COUNTS, 2),
    dashboardViewState: normalizeDashboardViewState(source.dashboardViewState),
  };
}

/** How search pages and Related Notes show their results. */
function normalizeSearchPages(
  source: Partial<PersistedPreferences>,
): Pick<
  PersistedPreferences,
  | 'renderMode'
  | 'renderModeChosen'
  | 'tagOverviewSortMode'
  | 'tagOverviewLayout'
  | 'searchPageSize'
  | 'searchPreview'
  | 'searchHierarchy'
  | 'hubNoteCollapsed'
  | 'relatedNotesSortMode'
  | 'hideDailyNotes'
  | 'relatedNotesPreviewLines'
> {
  const chosen = source.renderModeChosen === true;
  const previewLines = source.relatedNotesPreviewLines;
  return {
    // Every saved blob stored Source whether or not it was chosen, so
    // Source is kept only once it has been chosen since Rendered became the
    // default; everyone else is switched to Rendered once.
    renderMode: source.renderMode === 'markdown' && chosen ? 'markdown' : 'html',
    ...(chosen ? { renderModeChosen: true as const } : {}),
    tagOverviewSortMode: oneOf(source.tagOverviewSortMode, TAG_OVERVIEW_SORT_MODES, 'alphabetical'),
    tagOverviewLayout: oneOf(source.tagOverviewLayout, TAG_OVERVIEW_LAYOUTS, 'tabs'),
    searchPageSize: oneOf<SearchPageSize>(source.searchPageSize, SEARCH_PAGE_SIZES, DEFAULT_SEARCH_PAGE_SIZE),
    searchPreview: oneOf(source.searchPreview, SEARCH_PREVIEWS, 'lines'),
    ...(source.searchHierarchy === 'tags' || source.searchHierarchy === 'headings' ? { searchHierarchy: source.searchHierarchy } : {}),
    ...(source.hubNoteCollapsed === true ? { hubNoteCollapsed: true as const } : {}),
    relatedNotesSortMode: oneOf(source.relatedNotesSortMode, RELATED_NOTES_SORT_MODES, 'tags'),
    ...(source.hideDailyNotes === true ? { hideDailyNotes: true as const } : {}),
    ...(previewLines === 0 || previewLines === 2 ? { relatedNotesPreviewLines: previewLines } : {}),
  };
}

/** The Task Board's layout, its table's columns and sort, its grouping, and its status columns. */
function normalizeTaskBoard(
  source: Partial<PersistedPreferences>,
): Pick<
  PersistedPreferences,
  | 'taskBoardLayout'
  | 'taskTableColumns'
  | 'taskTableSort'
  | 'taskBoardGroup'
  | 'taskBoardGroupNamespace'
  | 'taskBoardColumnOrder'
  | 'taskBoardHiddenColumns'
> {
  const stored = source.taskBoardGroupNamespace;
  const namespace = isBoardNamespace(stored) ? stored.toLowerCase() : undefined;
  const order = normalizeStatusNames(source.taskBoardColumnOrder);
  const hidden = normalizeStatusNames(source.taskBoardHiddenColumns);
  return {
    taskBoardLayout: oneOf(source.taskBoardLayout, TASK_LAYOUTS, 'board'),
    taskTableColumns: normalizeTableColumns(source.taskTableColumns),
    taskTableSort: normalizeTableSort(source.taskTableSort),
    taskBoardGroup: oneOf(source.taskBoardGroup, namespace ? BOARD_GROUPS : BOARD_GROUPS_WITHOUT_TAG, 'status'),
    ...(namespace ? { taskBoardGroupNamespace: namespace } : {}),
    ...(order ? { taskBoardColumnOrder: order } : {}),
    ...(hidden ? { taskBoardHiddenColumns: hidden } : {}),
    ...(source.boardParentTag === true ? { boardParentTag: true as const } : {}),
  };
}

/**
 * The choices the views keep for themselves, each only when it isn't the
 * default, and only a value the view offers: how the Tasks view is grouped
 * and sorted, the Calendar's day panel and weekends, the Outline following
 * the cursor, the page width, and the pages at the top of Context.
 */
function normalizeViewChoices(
  source: Partial<PersistedPreferences>,
): Pick<
  PersistedPreferences,
  | 'agendaGroupBy'
  | 'agendaGroupNamespace'
  | 'agendaSort'
  | 'calendarHideWeekends'
  | 'outlineFollowCursorOff'
  | 'pageWidth'
  | 'contextPagesStyle'
  | 'contextPagesHidden'
> {
  const groupBy = oneOf<AgendaGroupBy>(source.agendaGroupBy, AGENDA_GROUP_BYS, 'due');
  const sort = oneOf(source.agendaSort, TASK_SORT_MODES, 'rank');
  const stored = source.agendaGroupNamespace;
  const namespace = isBoardNamespace(stored) ? stored.toLowerCase() : undefined;
  const hidden = uniqueStrings(source.contextPagesHidden);
  return {
    ...(groupBy === 'due' ? {} : { agendaGroupBy: groupBy }),
    ...(namespace && namespace !== 'project' ? { agendaGroupNamespace: namespace } : {}),
    ...(sort === 'rank' ? {} : { agendaSort: sort }),
    ...(source.calendarHideWeekends === true ? { calendarHideWeekends: true as const } : {}),
    ...(source.outlineFollowCursorOff === true ? { outlineFollowCursorOff: true as const } : {}),
    ...(source.pageWidth === 'full' ? { pageWidth: 'full' as const } : {}),
    ...(source.contextPagesStyle === 'list' ? { contextPagesStyle: 'list' as const } : {}),
    ...(hidden.length ? { contextPagesHidden: hidden } : {}),
  };
}

/** The most status names a board's column choices keep, far more than any list has. */
const MAX_STATUS_NAMES = 100;

/**
 * Status names as the board's column choices keep them: trimmed, each
 * once, no more than a list holds; undefined for anything that is not a
 * list. An empty list is kept, since no hidden column is a choice.
 */
export function normalizeStatusNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const names = value
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0 && name.length <= 80)
    .map((name) => name.trim());
  return [...new Set(names)].slice(0, MAX_STATUS_NAMES);
}

/** What the workspace remembers of its notes: times, searches, Home, pins, and Find. */
function normalizeWorkspaceMemory(
  source: Partial<PersistedPreferences>,
): Pick<
  PersistedPreferences,
  | 'tagAccessTimes'
  | 'sectionAccessTimes'
  | 'recentQueries'
  | 'dashboardWidgets'
  | 'tagFirstSeen'
  | 'pinnedNotes'
  | 'findChoices'
  | 'recentHeadings'
> {
  const { tagFirstSeen, findChoices, recentHeadings } = source;
  return {
    tagAccessTimes: normalizeAccessTimes(source.tagAccessTimes),
    sectionAccessTimes: normalizeAccessTimes(source.sectionAccessTimes),
    recentQueries: normalizeRecentQueries(source.recentQueries),
    // Preferences saved before Home had widgets start with its defaults.
    dashboardWidgets: Array.isArray(source.dashboardWidgets)
      ? normalizeDashboardWidgets(source.dashboardWidgets)
      : cloneWidgets(DEFAULT_DASHBOARD_WIDGETS),
    // Left out until the first index is seen, which marks every tag known.
    ...(typeof tagFirstSeen === 'object' && tagFirstSeen !== null
      ? { tagFirstSeen: normalizeFirstSeenTimes(tagFirstSeen) }
      : {}),
    pinnedNotes: normalizePinnedNotes(source.pinnedNotes),
    ...(Array.isArray(findChoices) && findChoices.length > 0
      ? { findChoices: normalizeFindChoices(findChoices) }
      : {}),
    ...(Array.isArray(recentHeadings) && recentHeadings.length > 0
      ? { recentHeadings: normalizePinnedNotes(recentHeadings).slice(0, RECENT_HEADING_LIMIT) }
      : {}),
  };
}

/** Searches run recently, trimmed, without repeats, newest first. */
function normalizeRecentQueries(values: unknown): string[] {
  return uniqueStrings(
    (Array.isArray(values) ? values : [])
      .filter((query): query is string => typeof query === 'string')
      .map((query) => query.trim()),
  ).slice(0, RECENT_QUERY_LIMIT);
}

/** Whether a stored value is a whole Find choice, with a count and a time. */
function isFindChoice(choice: unknown): choice is FindChoice {
  const candidate = choice as FindChoice;
  return (
    typeof choice === 'object' &&
    choice !== null &&
    typeof candidate.input === 'string' &&
    candidate.input.length > 0 &&
    typeof candidate.key === 'string' &&
    Number.isFinite(candidate.count) &&
    candidate.count > 0 &&
    Number.isFinite(candidate.at)
  );
}

/** The Find choices worth keeping, most recently chosen first. */
function normalizeFindChoices(value: readonly unknown[]): FindChoice[] {
  return value
    .filter(isFindChoice)
    .map(({ input, key, count, at }) => ({ input, key, count, at }))
    .sort((left, right) => right.at - left.at)
    .slice(0, FIND_CHOICE_LIMIT);
}

/** The note a Find choice's key names, when it names one. */
export function findChoiceFilePath(key: string): string | undefined {
  if (!key.startsWith('note:') && !key.startsWith('task:')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(key.slice(5)) as unknown;
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : undefined;
  } catch {
    return undefined;
  }
}

/** A stored widget before it is checked: any of its fields may hold anything. */
type WidgetCandidate = Partial<Record<keyof DashboardWidgetConfig, unknown>>;

/**
 * Keeps only widgets Home can draw: a known kind, a unique id, one of the
 * two widths, and options that kind uses, within their bounds. A kind that
 * cannot repeat keeps its first widget.
 */
export function normalizeDashboardWidgets(
  values: readonly unknown[],
): DashboardWidgetConfig[] {
  const ids = new Set<string>();
  const kinds = new Set<DashboardWidgetKind>();
  const widgets: DashboardWidgetConfig[] = [];
  for (const value of values) {
    const widget = readWidget(value, ids, kinds);
    if (!widget) {
      continue;
    }
    ids.add(widget.id);
    kinds.add(widget.kind);
    widgets.push(widget);
    if (widgets.length >= HOME_WIDGET_LIMIT) {
      break;
    }
  }
  return widgets;
}

/** A stored widget's kind, when it is one Home knows. */
function readWidgetKind(candidate: WidgetCandidate): DashboardWidgetKind | undefined {
  return isWidgetKind(candidate.kind) ? candidate.kind : undefined;
}

/**
 * One stored widget as Home can draw it, or nothing when it has no known
 * kind, no usable id, an id or a single kind already on the page, or an
 * option its kind cannot do without.
 */
function readWidget(
  value: unknown,
  ids: ReadonlySet<string>,
  kinds: ReadonlySet<DashboardWidgetKind>,
): DashboardWidgetConfig | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = migrateRetiredWidget(value as WidgetCandidate);
  const kind = readWidgetKind(candidate);
  if (!kind) {
    return undefined;
  }
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const traits = WIDGET_KINDS[kind];
  if (!id || id.length > 64 || ids.has(id) || (!traits.repeatable && kinds.has(kind))) {
    return undefined;
  }
  const widget: DashboardWidgetConfig = { id, kind, width: oneOf(candidate.width, WIDGET_WIDTHS, 'half') };
  applyListing(candidate, widget);
  applyDays(candidate, widget);
  const rule = WIDGET_OPTION_RULES[kind];
  return !rule || rule(candidate, widget) ? widget : undefined;
}

/** How many days a Stale tasks widget looked back until the reader said. */
const STALE_TASKS_DAYS = 30;

/**
 * A stored widget of a kind Home no longer offers, as the kind that took
 * its place. Stale tasks became a Tasks widget holding the same search,
 * open tasks whose note was last updated before its days, sorted Least
 * recently updated as it was; a task's updated date is its note's, which
 * Stale tasks read. The other kinds Home stopped offering
 * (Workspace, Related notes, Quick add, Tags written together, Tags
 * without a hub, and New tags) have nothing to become, so they are
 * dropped as any unknown kind is.
 */
function migrateRetiredWidget(candidate: WidgetCandidate): WidgetCandidate {
  if (candidate.kind !== 'staleTasks') {
    return candidate;
  }
  const days =
    typeof candidate.days === 'number' && Number.isInteger(candidate.days)
      ? Math.min(DASHBOARD_WIDGET_DAYS_LIMIT, Math.max(1, candidate.days))
      : STALE_TASKS_DAYS;
  // Its days stay behind unread, since a Tasks widget has none.
  return { ...candidate, kind: 'tasks', query: `is:open AND updated < ${days}d`, sort: 'updatedOldest' };
}

/** A listed widget's count, and its page when it can be paged and is. */
function applyListing(candidate: WidgetCandidate, widget: DashboardWidgetConfig): void {
  const traits = WIDGET_KINDS[widget.kind];
  if (!traits.listed) {
    return;
  }
  const count = candidate.count;
  widget.count =
    typeof count === 'number' && Number.isInteger(count)
      ? Math.min(DASHBOARD_WIDGET_COUNT_LIMIT, Math.max(1, count))
      : 5;
  // Only a widget that lists one kind of entry can be paged: the Agenda
  // counts its groups separately, and a saved search lists notes beside
  // tasks, so one page number would not say which list it meant.
  if (traits.pageable === false || candidate.paged !== true) {
    return;
  }
  widget.paged = true;
  const page = candidate.page;
  widget.page =
    typeof page === 'number' && Number.isInteger(page) && page > 0
      ? Math.min(DASHBOARD_WIDGET_PAGE_LIMIT, page)
      : 1;
}

/** How far back a widget that looks back looks, within a year. */
function applyDays(candidate: WidgetCandidate, widget: DashboardWidgetConfig): void {
  const defaultDays = WIDGET_KINDS[widget.kind].defaultDays;
  if (defaultDays === undefined) {
    return;
  }
  const days = candidate.days;
  widget.days =
    typeof days === 'number' && Number.isInteger(days)
      ? Math.min(DASHBOARD_WIDGET_DAYS_LIMIT, Math.max(1, days))
      : defaultDays;
}

/**
 * The options only one kind of widget has, read onto `widget`. A rule
 * returns false to drop a widget that cannot work without its option.
 */
type WidgetOptionRule = (candidate: WidgetCandidate, widget: DashboardWidgetConfig) => boolean;

/** The search a tasks widget lists, or open tasks, and its own sort when it has one. */
function applyTasksQuery(candidate: WidgetCandidate, widget: DashboardWidgetConfig): boolean {
  widget.query =
    typeof candidate.query === 'string' &&
    candidate.query.length <= DASHBOARD_WIDGET_QUERY_LIMIT
      ? candidate.query.trim()
      : 'is:open';
  if (TASK_SORT_MODES.includes(candidate.sort as TaskSortMode)) {
    widget.sort = candidate.sort as TaskSortMode;
  }
  return true;
}

/**
 * The namespace a widget lists when it is not its kind's default, which is
 * kept as no namespace, so a widget that never chose one stays unchosen.
 */
function applyNamespace(candidate: WidgetCandidate, widget: DashboardWidgetConfig): boolean {
  const namespace = typeof candidate.namespace === 'string' ? candidate.namespace.trim() : '';
  if (namespace && isWatchableNamespace(namespace) && namespace.toLowerCase() !== WIDGET_KINDS[widget.kind].defaultNamespace) {
    widget.namespace = namespace.toLowerCase();
  }
  return true;
}

/** The namespace Gone quiet watches when it is not `person`, and whether it lists only tags with no open task. */
function applyQuietPeople(candidate: WidgetCandidate, widget: DashboardWidgetConfig): boolean {
  applyNamespace(candidate, widget);
  if (candidate.noOpenTasks === true) {
    widget.noOpenTasks = true;
  }
  return true;
}

/** The saved search a saved-search widget shows; without one it is dropped. */
function applySavedQuery(candidate: WidgetCandidate, widget: DashboardWidgetConfig): boolean {
  if (typeof candidate.filterId !== 'string' || !candidate.filterId) {
    return false;
  }
  widget.filterId = candidate.filterId;
  return true;
}

/**
 * The per-kind option rules, beside the traits and look-back defaults in
 * the widget catalog's `WIDGET_KINDS`: a kind with
 * options of its own adds a rule here rather than a branch in the loop.
 */
const WIDGET_OPTION_RULES: Readonly<Partial<Record<DashboardWidgetKind, WidgetOptionRule>>> = {
  tasks: applyTasksQuery,
  quietPeople: applyQuietPeople,
  progress: applyNamespace,
  savedQuery: applySavedQuery,
};

/** Copies of widgets, so a stored list and a snapshot never share one. */
export function cloneWidgets(
  widgets: readonly DashboardWidgetConfig[],
): DashboardWidgetConfig[] {
  return widgets.map((widget) => ({ ...widget }));
}

/**
 * Whether Home still holds the widgets it started with, in their order and
 * with their settings. Home says it can be arranged only while this is so:
 * once a reader has moved, sized, or swapped a widget, they know.
 */
export function isDefaultHomeLayout(
  widgets: readonly DashboardWidgetConfig[],
): boolean {
  const same = (
    left: DashboardWidgetConfig,
    right: DashboardWidgetConfig,
  ): boolean =>
    left.id === right.id &&
    left.kind === right.kind &&
    left.width === right.width &&
    left.count === right.count &&
    left.query === right.query &&
    left.paged === right.paged;
  return (
    widgets.length === DEFAULT_DASHBOARD_WIDGETS.length &&
    widgets.every((widget, index) =>
      same(widget, DEFAULT_DASHBOARD_WIDGETS[index]),
    )
  );
}

/**
 * The Dashboard's tab and tag filter. Tasks moved to the Task Board and
 * searches to their own pages, so a Dashboard left on either opens on Home,
 * and the fields those tabs kept are dropped.
 */
export function normalizeDashboardViewState(
  value: Partial<DashboardViewState> | undefined,
): DashboardViewState {
  return {
    mode: value?.mode === 'browse' ? 'browse' : 'home',
    tagSearchQuery: normalizeSearchQuery(value?.tagSearchQuery),
  };
}

/** A stored filter's text, or nothing typed. */
function normalizeSearchQuery(value: string | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the pins a workspace kept, whichever shape they were written in.
 *
 * Pins were paths before a pin could name an entry, so a string is read as a
 * pin on the whole note — which is what it meant.
 */
export function normalizePinnedNotes(value: unknown): PinnedNote[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const pins: PinnedNote[] = [];
  for (const entry of value) {
    const pin = readPin(entry);
    if (!pin || !pin.filePath) {
      continue;
    }
    if (!pins.some((kept) => pinKey(kept) === pinKey(pin))) {
      pins.push(pin);
    }
  }
  return pins.slice(0, PINNED_NOTE_LIMIT);
}

/** One stored pin: a path, or a record naming a note and perhaps a heading of it. */
function readPin(entry: unknown): PinnedNote | undefined {
  if (typeof entry === 'string') {
    return { filePath: entry };
  }
  if (!isPinRecord(entry) || typeof entry.filePath !== 'string') {
    return undefined;
  }
  const { heading, headingLevel, occurrence } = entry;
  return {
    filePath: entry.filePath,
    ...(typeof heading === 'string' && heading ? { heading } : {}),
    ...(typeof headingLevel === 'number' && Number.isInteger(headingLevel) ? { headingLevel } : {}),
    ...(typeof occurrence === 'number' && Number.isInteger(occurrence) && occurrence >= 0
      ? { occurrence }
      : {}),
  };
}

/** Whether a stored value could be a pin at all. */
function isPinRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A typed search as Find remembers it: trimmed, lowercased, spaces collapsed. */
export function normalizeFindInput(input: string): string {
  return input.trim().toLocaleLowerCase().replace(/\s+/g, ' ').slice(0, 100);
}

/**
 * A pin's identity: its note, the heading it named, and which heading of
 * that text it was. Kept here so preferences can compare pins without
 * reaching into the view layer that resolves them.
 */
export function pinKey(pin: PinnedNote): string {
  // Printable, because a row carries this key in an HTML attribute and a
  // separator such as NUL does not survive being written into one.
  return JSON.stringify([pin.filePath, pin.heading ?? '', pin.occurrence ?? 0]);
}

/**
 * Removes duplicate and empty identifiers before they reach ordering logic.
 */
export function uniqueStrings(values: readonly unknown[] | undefined): string[] {
  return [
    ...new Set(
      (Array.isArray(values) ? values : []).filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    ),
  ];
}

/** A stored saved filter with the fields every one needs: a non-blank id and a name. */
function isSavedFilterRecord(
  value: unknown,
): value is Record<string, unknown> & { id: string; name: string } {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof candidate.id === 'string' &&
    Boolean(candidate.id.trim()) &&
    typeof candidate.name === 'string'
  );
}

/**
 * One stored saved filter as it is kept, or nothing when it has no name, or
 * neither a query nor two tags.
 */
function readSavedFilter(value: unknown): SavedFilter | undefined {
  if (!isSavedFilterRecord(value)) {
    return undefined;
  }
  const name = value.name.trim();
  const tagKeys = normalizeSavedFilterTagKeys(value.tagKeys);
  const query =
    typeof value.query === 'string' && value.query.trim()
      ? value.query.trim()
      : undefined;
  if (!name || (!query && tagKeys.length < 2)) {
    return undefined;
  }
  if (!query) {
    return { id: value.id, name, tagKeys };
  }
  return { id: value.id, name, tagKeys, query, ...(value.page === 'taskBoard' ? { page: value.page } : {}) };
}

/**
 * What makes two saved views the same view. A saved view is identified by
 * its query when it has one and by its tag set otherwise, so the two kinds
 * never collide.
 */
function savedFilterIdentity(filter: SavedFilter): string {
  return filter.query
    ? `query\u0000${filter.page ?? ''}\u0000${filter.query}`
    : `tags\u0000${filter.tagKeys.join('\u0000')}`;
}

/**
 * Ensures filters remain valid version-one preference data, even when read
 * from an old or manually modified global-state value. Anything but a list
 * reads as no filters, as a malformed filter in the list reads as none.
 */
export function normalizeSavedFilters(values: unknown): SavedFilter[] {
  const seenTagSets = new Set<string>();
  const seenIds = new Set<string>();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const filter = readSavedFilter(value);
    if (!filter) {
      return [];
    }
    const identity = savedFilterIdentity(filter);
    if (seenIds.has(filter.id) || seenTagSets.has(identity)) {
      return [];
    }
    seenIds.add(filter.id);
    seenTagSets.add(identity);
    return [filter];
  });
}

/** A tag set as a saved filter keeps it: trimmed, unique, and sorted. */
export function normalizeSavedFilterTagKeys(tagKeys: unknown): string[] {
  if (!Array.isArray(tagKeys)) {
    return [];
  }
  return [
    ...new Set(
      tagKeys
        .filter(
          (tagKey): tagKey is string =>
            typeof tagKey === 'string' && tagKey.trim().length > 0,
        )
        .map((tagKey) => tagKey.trim()),
    ),
  ].sort();
}

/** Whether two sorted tag sets hold the same tags. */
export function areTagKeyListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

/** A copy of a saved filter that shares no array with the stored one. */
export function cloneSavedFilter(value: SavedFilter): SavedFilter {
  return { ...value, tagKeys: [...value.tagKeys] };
}

/**
 * Clones nested arrays and records so a snapshot cannot mutate stored state.
 */
export function clonePreferences(value: PersistedPreferences): PersistedPreferences {
  return {
    ...value,
    favoriteTags: [...value.favoriteTags],
    favoriteEntities: [...value.favoriteEntities],
    tagAccessOrder: [...value.tagAccessOrder],
    tagAccessCounts: { ...value.tagAccessCounts },
    entityAccessOrder: [...value.entityAccessOrder],
    entityAccessCounts: { ...value.entityAccessCounts },
    taskOrder: [...value.taskOrder],
    dashboardViewState: { ...value.dashboardViewState },
    sectionAccessCounts: { ...value.sectionAccessCounts },
    savedFilters: value.savedFilters.map(cloneSavedFilter),
    tagAccessTimes: { ...value.tagAccessTimes },
    sectionAccessTimes: { ...value.sectionAccessTimes },
    recentQueries: [...(value.recentQueries ?? [])],
    dashboardWidgets: cloneWidgets(value.dashboardWidgets),
    ...(value.findChoices ? { findChoices: value.findChoices.map((choice) => ({ ...choice })) } : {}),
    ...(value.recentHeadings ? { recentHeadings: value.recentHeadings.map((pin) => ({ ...pin })) } : {}),
    ...(value.contextPagesHidden ? { contextPagesHidden: [...value.contextPagesHidden] } : {}),
  };
}

/** The columns a stored value names, title first; nothing for an empty or unusable value. */
export function normalizeTableColumns(value: unknown): TaskColumnId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const columns = value.filter(isTaskColumnId);
  const unique = ['title' as const, ...columns.filter((column) => column !== 'title')]
    .filter((column, at, all) => all.indexOf(column) === at);
  return unique.length > 1 ? unique : undefined;
}

/** The column a stored sort names and its direction, ascending unless it says otherwise. */
export function normalizeTableSort(value: unknown): TableSort | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const { column, direction } = value as { column?: unknown; direction?: unknown };
  return isTaskColumnId(column)
    ? { column, direction: direction === 'desc' ? 'desc' : 'asc' }
    : undefined;
}

/** The id-keyed preferences `carryLegacyIds` renames. */
type IdKeyedPreferences = Pick<
  PersistedPreferences,
  'taskOrder' | 'sectionAccessCounts' | 'sectionAccessTimes'
>;

/** Whether an id has the shape ids had before 1.23: a prefix and one hash. */
function isLegacyId(id: string): boolean {
  return /^[a-z]+-[0-9a-z]+$/.test(id);
}

/** Whether a kept id is an old one the index no longer has. */
function isStaleLegacyId(id: string, valid: ReadonlySet<string> | undefined): boolean {
  return !valid?.has(id) && isLegacyId(id);
}

/** Each old id the index's ids widened, to the id it became. */
function legacyRenames(valid: ReadonlySet<string> | undefined): Map<string, string> {
  const map = new Map<string, string>();
  valid?.forEach((id) => {
    const legacy = legacyIdOf(id);
    // Two entries sharing an old id is the collision this fixes; the
    // first keeps what was stored, as the index kept one of them.
    if (legacy && !map.has(legacy)) {
      map.set(legacy, id);
    }
  });
  return map;
}

/**
 * The id-keyed preferences with each id from before 1.23 renamed to the
 * entry's id now, when the index has an entry whose id it is the first half
 * of. Nothing is looked up unless an old id is actually kept.
 */
export function carryLegacyIds(
  preferences: IdKeyedPreferences,
  validTaskIds: ReadonlySet<string>,
  validSectionIds: ReadonlySet<string> | undefined,
): IdKeyedPreferences {
  const sectionKeys = [
    ...Object.keys(preferences.sectionAccessCounts),
    ...Object.keys(preferences.sectionAccessTimes ?? {}),
  ];
  const tasksNeed = preferences.taskOrder.some((id) => isStaleLegacyId(id, validTaskIds));
  const sectionsNeed =
    validSectionIds !== undefined && sectionKeys.some((id) => isStaleLegacyId(id, validSectionIds));
  if (!tasksNeed && !sectionsNeed) {
    return preferences;
  }
  const taskRenames = tasksNeed ? legacyRenames(validTaskIds) : new Map<string, string>();
  const sectionRenames = sectionsNeed ? legacyRenames(validSectionIds) : new Map<string, string>();
  const renameKeys = <T>(record: Record<string, T>): Record<string, T> => {
    const renamed: Record<string, T> = {};
    Object.entries(record).forEach(([id, value]) => {
      const next = sectionRenames.get(id) ?? id;
      // A count already kept under the new id wins over the old one.
      if (!(next in renamed) || next === id) {
        renamed[next] = value;
      }
    });
    return renamed;
  };
  const seen = new Set<string>();
  return {
    taskOrder: preferences.taskOrder
      .map((id) => taskRenames.get(id) ?? id)
      .filter((id) => !seen.has(id) && Boolean(seen.add(id))),
    sectionAccessCounts: renameKeys(preferences.sectionAccessCounts),
    sectionAccessTimes: preferences.sectionAccessTimes
      ? renameKeys(preferences.sectionAccessTimes)
      : preferences.sectionAccessTimes,
  };
}
