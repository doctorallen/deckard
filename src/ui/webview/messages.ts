import { normalizeDashboardWidgets } from '../../core/storage/preferences';
import {
  DashboardMessage,
  NotesGraphMessage,
  RenderMode,
  SearchPageMessage,
  SidebarMessage,
  TagOverviewLayout,
  TagOverviewSortMode,
  RelatedNotesSortMode,
  TagSortMode,
  TaskSortMode,
  TaskFilter,
  DashboardMode,
  DashboardSearchField,
  TaskBoardGroupBy,
  TaskBoardMessage,
  CalendarMessage,
  StatsMessage,
} from '../../core/types';

/**
 * Validates messages received by the dashboard webview before dispatch.
 *
 * Webview payloads cross a trust boundary as `unknown`, so runtime checks keep
 * malformed or stale browser state from reaching commands and preferences.
 */
export function parseDashboardMessage(
  value: unknown,
): DashboardMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'openSource':
      return isSourceMessage(value)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'toggleTask':
      return typeof value.taskId === 'string' &&
        typeof value.completed === 'boolean'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'toggleFavorite':
      return typeof value.tagKey === 'string'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'toggleFavoriteEntity':
      return typeof value.entityKey === 'string'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setTagSort':
      return isTagSortMode(value.mode)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setEntitySort':
      return isTagSortMode(value.mode)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setDashboardMode':
      return isDashboardMode(value.mode)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setDashboardSearch':
      return isDashboardSearchField(value.field) &&
        typeof value.query === 'string'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setDashboardColumns':
      return value.section === 'tags' && isDashboardColumnCount(value.columns)
        ? { type: 'setDashboardColumns', section: 'tags', columns: value.columns }
        : undefined;
    case 'reorderTags':
      return isStringArray(value.tagKeys) &&
        typeof value.tagKey === 'string' &&
        typeof value.isFavorite === 'boolean'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'reorderEntities':
      return isStringArray(value.entityKeys)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'openTag':
      return isOpenTagMessage(value)
        ? { type: 'openTag', tagKey: value.tagKey as string }
        : undefined;
    case 'renameTag':
      return isRenameTagMessage(value)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'openSavedFilter':
    case 'removeSavedFilter':
      return isSavedFilterMessage(value)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'recordRecentQuery':
      return typeof value.query === 'string' &&
        value.query.length <= MAX_QUERY_LENGTH
        ? { type: 'recordRecentQuery', query: value.query }
        : undefined;
    case 'setDashboardWidgets':
      return Array.isArray(value.widgets) &&
        value.widgets.length <= MAX_DASHBOARD_WIDGETS
        ? {
            type: 'setDashboardWidgets',
            widgets: normalizeDashboardWidgets(value.widgets),
          }
        : undefined;
    case 'resetDashboardWidgets':
      return { type: 'resetDashboardWidgets' };
    case 'openSearch':
      return typeof value.query === 'string' &&
        value.query.length <= MAX_QUERY_LENGTH
        ? { type: 'openSearch', query: value.query }
        : undefined;
    case 'openTaskBoard':
      return value.query === undefined ||
        (typeof value.query === 'string' &&
          value.query.length <= MAX_QUERY_LENGTH)
        ? {
            type: 'openTaskBoard',
            ...(typeof value.query === 'string' ? { query: value.query } : {}),
          }
        : undefined;
    case 'openView':
      return value.view === 'agenda' || value.view === 'stats'
        ? { type: 'openView', view: value.view }
        : undefined;
    case 'openDailyNote':
      return { type: 'openDailyNote' };
    case 'quickAdd':
      return typeof value.text === 'string' &&
        value.text.trim().length > 0 &&
        value.text.length <= MAX_QUICK_ADD_LENGTH &&
        !/[\r\n]/.test(value.text)
        ? { type: 'quickAdd', text: value.text }
        : undefined;
    case 'createTagHub':
      return typeof value.tagKey === 'string' && value.tagKey.length > 0
        ? { type: 'createTagHub', tagKey: value.tagKey }
        : undefined;
    case 'pinNote':
    case 'unpinNote':
    case 'openNote':
      return typeof value.filePath === 'string' && value.filePath.length > 0
        ? { type: value.type, filePath: value.filePath }
        : undefined;
    default:
      return undefined;
  }
}

/** A quick-add task is one line. */
const MAX_QUICK_ADD_LENGTH = 1000;

/** More widgets than Home keeps are refused rather than cut short. */
const MAX_DASHBOARD_WIDGETS = 60;

/**
 * Restricts a search page's messages to its navigation and display API.
 */
export function parseSearchPageMessage(
  value: unknown,
): SearchPageMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'openSource':
      return isSourceMessage(value)
        ? (value as unknown as SearchPageMessage)
        : undefined;
    case 'toggleTask':
      return typeof value.taskId === 'string' &&
        typeof value.completed === 'boolean'
        ? { type: 'toggleTask', taskId: value.taskId, completed: value.completed }
        : undefined;
    case 'setTaskFilter':
      return isTaskFilter(value.filter)
        ? { type: 'setTaskFilter', filter: value.filter }
        : undefined;
    case 'setRenderMode':
      return isRenderMode(value.mode)
        ? { type: 'setRenderMode', mode: value.mode }
        : undefined;
    case 'setTagOverviewSort':
      return isTagOverviewSortMode(value.mode)
        ? { type: 'setTagOverviewSort', mode: value.mode }
        : undefined;
    case 'setTagOverviewLayout':
      return isTagOverviewLayout(value.layout)
        ? { type: 'setTagOverviewLayout', layout: value.layout }
        : undefined;
    case 'setSearchColumns':
      return (value.section === 'notes' || value.section === 'tasks') &&
        isDashboardColumnCount(value.columns)
        ? { type: 'setSearchColumns', section: value.section, columns: value.columns }
        : undefined;
    case 'openTag':
      return isOpenTagMessage(value)
        ? { type: 'openTag', tagKey: value.tagKey as string }
        : undefined;
    case 'renameTag':
      return isRenameTagMessage(value)
        ? { type: 'renameTag', tagKey: value.tagKey as string }
        : undefined;
    case 'saveTagOverviewFilter':
    case 'createHubNote':
    case 'clearOverviewQuery':
      return Object.keys(value).length === 1 ? { type: value.type } : undefined;
    case 'setOverviewQuery':
      return isOverviewQueryMessage(value)
        ? { type: 'setOverviewQuery', query: value.query as string }
        : undefined;
    default:
      return undefined;
  }
}

/** Upper bound on query text accepted from the webview. */
const MAX_QUERY_LENGTH = 2000;

/**
 * Bounds query text before it reaches the parser.
 *
 * The parser is linear in the length of its input, but a bound keeps a runaway
 * webview from handing the host an unreasonable string to tokenize on every
 * keystroke.
 */
function isOverviewQueryMessage(value: Record<string, unknown>): boolean {
  return (
    Object.keys(value).length === 2 &&
    typeof value.query === 'string' &&
    value.query.length <= MAX_QUERY_LENGTH
  );
}

/**
 * Validates the notes graph's navigation messages before dispatch.
 */
export function parseNotesGraphMessage(
  value: unknown,
): NotesGraphMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  if (value.type === 'openSource') {
    return isSourceMessage(value)
      ? (value as unknown as NotesGraphMessage)
      : undefined;
  }
  if (
    value.type === 'selectNode' &&
    typeof value.nodeId === 'string' &&
    value.nodeId.length > 0
  ) {
    return { type: 'selectNode', nodeId: value.nodeId };
  }
  if (value.type === 'clearSelection') {
    return { type: 'clearSelection' };
  }
  if (
    value.type === 'openTag' &&
    typeof value.tagKey === 'string' &&
    value.tagKey.length > 0
  ) {
    return { type: 'openTag', tagKey: value.tagKey };
  }
  return undefined;
}

/**
 * Validates the sidebar's navigation and shortcut messages independently.
 */
export function parseSidebarMessage(
  value: unknown,
): SidebarMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  if (value.type === 'ready') {
    return { type: 'ready' };
  }
  if (value.type === 'clearEntryRelatedNotes') {
    return { type: 'clearEntryRelatedNotes' };
  }
  if (value.type === 'openSource') {
    return isSourceMessage(value)
      ? (value as unknown as SidebarMessage)
      : undefined;
  }
  if (
    value.type === 'activateNotesGraphNode' &&
    typeof value.nodeId === 'string' &&
    value.nodeId.length > 0 &&
    typeof value.open === 'boolean'
  ) {
    return value as unknown as SidebarMessage;
  }
  if (
    value.type === 'hoverNotesGraphNode' &&
    (value.nodeId === undefined ||
      (typeof value.nodeId === 'string' && value.nodeId.length > 0))
  ) {
    return value as unknown as SidebarMessage;
  }
  if (value.type === 'openTag' && isOpenTagMessage(value)) {
    return { type: 'openTag', tagKey: value.tagKey as string };
  }
  if (value.type === 'renameTag' && isRenameTagMessage(value)) {
    return value as unknown as SidebarMessage;
  }
  if (
    value.type === 'refineActiveSearch' &&
    typeof value.facetId === 'string' &&
    typeof value.clause === 'string' &&
    value.clause.length > 0 &&
    value.clause.length <= MAX_QUERY_LENGTH &&
    (value.mode === 'and' || value.mode === 'exclude' || value.mode === 'or')
  ) {
    return {
      type: 'refineActiveSearch',
      facetId: value.facetId,
      clause: value.clause,
      mode: value.mode,
    };
  }
  if (
    value.type === 'setRelatedNotesSort' &&
    isRelatedNotesSortMode(value.mode)
  ) {
    return value as unknown as SidebarMessage;
  }
  if (
    value.type === 'openDashboard' ||
    value.type === 'openNotesGraph' ||
    value.type === 'openTaskBoard' ||
    value.type === 'createDailyNote' ||
    value.type === 'openHelp'
  ) {
    return { type: value.type };
  }
  return undefined;
}

/**
 * Validates the task board's messages. A column id is only a string here;
 * the host decides what, if anything, a move to it may write.
 */
export function parseTaskBoardMessage(
  value: unknown,
): TaskBoardMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'saveBoardSearch':
      return Object.keys(value).length === 1
        ? { type: 'saveBoardSearch' }
        : undefined;
    case 'openSource':
      return isSourceMessage(value)
        ? (value as unknown as TaskBoardMessage)
        : undefined;
    case 'openTag':
      return isOpenTagMessage(value)
        ? { type: 'openTag', tagKey: value.tagKey as string }
        : undefined;
    case 'toggleTask':
      return typeof value.taskId === 'string' &&
        typeof value.completed === 'boolean'
        ? { type: 'toggleTask', taskId: value.taskId, completed: value.completed }
        : undefined;
    case 'moveTask':
      return typeof value.taskId === 'string' &&
        typeof value.column === 'string' &&
        value.column.length > 0
        ? { type: 'moveTask', taskId: value.taskId, column: value.column }
        : undefined;
    case 'setBoardGroup':
      return isTaskBoardGroupBy(value.groupBy)
        ? { type: 'setBoardGroup', groupBy: value.groupBy }
        : undefined;
    case 'setBoardQuery':
      return typeof value.query === 'string' &&
        value.query.length <= MAX_QUERY_LENGTH
        ? { type: 'setBoardQuery', query: value.query }
        : undefined;
    case 'setTaskLayout':
      return value.layout === 'list' || value.layout === 'board'
        ? { type: 'setTaskLayout', layout: value.layout }
        : undefined;
    case 'setTaskFilter':
      return isTaskFilter(value.filter)
        ? { type: 'setTaskFilter', filter: value.filter }
        : undefined;
    case 'setTaskSort':
      return isTaskSortMode(value.mode)
        ? { type: 'setTaskSort', mode: value.mode }
        : undefined;
    case 'reorderTasks':
      return isStringArray(value.taskIds)
        ? { type: 'reorderTasks', taskIds: [...value.taskIds] }
        : undefined;
    case 'setBoardStatuses':
      return Array.isArray(value.statuses) &&
        value.statuses.length <= MAX_BOARD_STATUSES &&
        value.statuses.every(
          (status) => typeof status === 'string' && BOARD_NAME.test(status),
        )
        ? { type: 'setBoardStatuses', statuses: [...value.statuses] }
        : undefined;
    case 'setBoardStatusNamespace':
      return typeof value.namespace === 'string' &&
        BOARD_NAMESPACE.test(value.namespace)
        ? { type: 'setBoardStatusNamespace', namespace: value.namespace }
        : undefined;
    default:
      return undefined;
  }
}

/** The patterns `deckard.board.statuses` and `statusNamespace` allow. */
const BOARD_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const BOARD_NAMESPACE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_BOARD_STATUSES = 50;

/**
 * Keeps the task board's grouping to the three it can lay out.
 */
export function isTaskBoardGroupBy(value: unknown): value is TaskBoardGroupBy {
  return value === 'status' || value === 'priority' || value === 'due';
}

/**
 * Checks source locations before they are used to open an editor line.
 */
/**
 * Validates the Stats page's messages. The page only opens what it lists, and
 * the host still checks each tag and line against the current index.
 */
export function parseStatsMessage(value: unknown): StatsMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'openTag':
      return isOpenTagMessage(value)
        ? { type: 'openTag', tagKey: value.tagKey as string }
        : undefined;
    case 'openSource':
      return isSourceMessage(value)
        ? {
            type: 'openSource',
            filePath: value.filePath as string,
            line: value.line as number,
          }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Accepts the calendar page's messages. Dates and months are checked for their
 * shape; the host checks that each names a real day.
 */
export function parseCalendarMessage(
  value: unknown,
): CalendarMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  const date = typeof value.date === 'string' ? value.date : '';
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'openMonth':
      return { type: 'openMonth' };
    case 'showMonth':
      return typeof value.month === 'string' &&
        /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month)
        ? { type: 'showMonth', month: value.month }
        : undefined;
    case 'openDay':
      return isDate ? { type: 'openDay', date } : undefined;
    case 'openWeek':
      return isDate ? { type: 'openWeek', date } : undefined;
    default:
      return undefined;
  }
}

function isSourceMessage(value: Record<string, unknown>): boolean {
  return (
    typeof value.filePath === 'string' &&
    typeof value.line === 'number' &&
    Number.isInteger(value.line) &&
    value.line > 0
  );
}

function isOpenTagMessage(value: Record<string, unknown>): boolean {
  return typeof value.tagKey === 'string' && value.tagKey.length > 0;
}

function isRenameTagMessage(value: Record<string, unknown>): boolean {
  return typeof value.tagKey === 'string' && value.tagKey.length > 0;
}

function isSavedFilterMessage(value: Record<string, unknown>): boolean {
  return (
    Object.keys(value).length === 2 &&
    typeof value.filterId === 'string' &&
    value.filterId.length > 0
  );
}

/**
 * Narrows arrays before their values are used as persisted ordering input.
 */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * Keeps tag sorting an explicit allow-list instead of accepting arbitrary UI data.
 */
function isTagSortMode(value: unknown): value is TagSortMode {
  return (
    value === 'alphabetical' ||
    value === 'count' ||
    value === 'access' ||
    value === 'custom'
  );
}

/**
 * Keeps task filtering constrained to the three supported dashboard states.
 */
function isTaskFilter(value: unknown): value is TaskFilter {
  return value === 'all' || value === 'active' || value === 'completed';
}

function isDashboardColumnCount(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isDashboardMode(value: unknown): value is DashboardMode {
  return value === 'home' || value === 'browse';
}

function isDashboardSearchField(
  value: unknown,
): value is DashboardSearchField {
  return value === 'tags';
}

/**
 * Keeps task sorting constrained to modes implemented by the state layer.
 */
function isTaskSortMode(value: unknown): value is TaskSortMode {
  return value === 'rank' || value === 'created' || value === 'updated';
}

/**
 * Validates the two tag-overview body representations.
 */
function isRenderMode(value: unknown): value is RenderMode {
  return value === 'markdown' || value === 'html';
}

/**
 * Validates overview sorting separately from dashboard tag sorting.
 */
function isTagOverviewSortMode(value: unknown): value is TagOverviewSortMode {
  return (
    value === 'alphabetical' ||
    value === 'created' ||
    value === 'updated' ||
    value === 'access'
  );
}

/**
 * Keeps the Tag Overview layout constrained to its two supported views.
 */
function isTagOverviewLayout(value: unknown): value is TagOverviewLayout {
  return value === 'tabs' || value === 'split';
}

/**
 * Keeps Related Notes sorting constrained to its supported modes.
 */
function isRelatedNotesSortMode(value: unknown): value is RelatedNotesSortMode {
  return (
    value === 'newest' ||
    value === 'oldest' ||
    value === 'tags' ||
    value === 'access'
  );
}

/**
 * Narrows non-null objects without making assumptions about their properties.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
