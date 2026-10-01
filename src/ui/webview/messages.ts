import { isTaskColumnId } from '../state/resultTable';
import { MAXIMUM_LOCAL_GRAPH_DEPTH } from '../state/notesGraphState';
import { isObject } from '../../shared/guards';
import {
  NotesGraphMessage,
  PinNoteMessage,
  RenderMode,
  SearchPageSize,
  SEARCH_PAGE_SIZES,
  SearchPageMessage,
  SidebarMessage,
  TagOverviewLayout,
  TagOverviewSortMode,
  RelatedNotesSortMode,
  TaskSortMode,
  TaskBoardGroupBy,
  TaskBoardMessage,
  CalendarMessage,
  CalendarPageMessage,
} from '../../core/types';

/**
 * A pin names the entry at a line, and an unpin names the pin a row carries.
 */
export function parsePinMessage(
  value: Record<string, unknown>,
): PinNoteMessage | undefined {
  if (typeof value.filePath !== 'string' || !value.filePath) {
    return undefined;
  }
  const type = value.type === 'unpinNote' ? 'unpinNote' : 'pinNote';
  return {
    type,
    filePath: value.filePath,
    ...(typeof value.line === 'number' &&
    Number.isInteger(value.line) &&
    value.line >= 1
      ? { line: value.line }
      : {}),
    ...(typeof value.pinKey === 'string' && value.pinKey
      ? { pinKey: value.pinKey }
      : {}),
  };
}

/**
 * Restricts a search page's messages to its navigation and display API.
 */
export function parseSearchPageMessage(
  value: unknown,
): SearchPageMessage | undefined {
  if (!isObject(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'exportResults':
      return value.kind === 'notes' || value.kind === 'tasks'
        ? { type: 'exportResults', kind: value.kind }
        : undefined;
    case 'setZenMode':
      return typeof value.enabled === 'boolean'
        ? { type: 'setZenMode', enabled: value.enabled }
        : undefined;
    case 'chooseTheme':
      return { type: 'chooseTheme' };
    case 'openSource':
      return isSourceMessage(value)
        ? (value as unknown as SearchPageMessage)
        : undefined;
    case 'previewSearch':
      return Array.isArray(value.words) &&
        value.words.length <= MAX_PREVIEW_WORDS &&
        value.words.every(
          (word) =>
            typeof word === 'string' &&
            word.length > 0 &&
            word.length <= MAX_PREVIEW_WORD_LENGTH,
        )
        ? { type: 'previewSearch', words: value.words as string[] }
        : undefined;
    case 'setResultsPerPage':
      return (SEARCH_PAGE_SIZES as readonly unknown[]).includes(value.size)
        ? { type: 'setResultsPerPage', size: value.size as SearchPageSize }
        : undefined;
    case 'pinNote':
    case 'unpinNote':
      return parsePinMessage(value);
    case 'editResults':
      return value.kind === 'notes' || value.kind === 'tasks'
        ? { type: 'editResults', kind: value.kind }
        : undefined;
    case 'setResultPage':
      return (value.kind === 'notes' || value.kind === 'tasks') &&
        typeof value.page === 'number' &&
        Number.isInteger(value.page) &&
        value.page >= 1
        ? { type: 'setResultPage', kind: value.kind, page: value.page }
        : undefined;
    case 'toggleTask':
      return typeof value.taskId === 'string' &&
        typeof value.completed === 'boolean'
        ? { type: 'toggleTask', taskId: value.taskId, completed: value.completed }
        : undefined;
    case 'setRenderMode':
      return isRenderMode(value.mode)
        ? { type: 'setRenderMode', mode: value.mode }
        : undefined;
    case 'setSearchPreview':
      return value.preview === 'none' || value.preview === 'lines' || value.preview === 'full'
        ? { type: 'setSearchPreview', preview: value.preview }
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
    case 'parkTag':
    case 'unparkTag':
      return isRenameTagMessage(value) && Object.keys(value).length === 2
        ? { type: value.type, tagKey: value.tagKey as string }
        : undefined;
    case 'parkNote':
    case 'unparkNote':
      return typeof value.filePath === 'string' &&
        value.filePath.length > 0 &&
        value.filePath.length <= 4096 &&
        Object.keys(value).length === 2
        ? { type: value.type, filePath: value.filePath }
        : undefined;
    case 'mergeTags':
      return typeof value.sourceKey === 'string' &&
        value.sourceKey.length > 0 &&
        value.sourceKey.length <= 500 &&
        typeof value.targetKey === 'string' &&
        value.targetKey.length > 0 &&
        value.targetKey.length <= 500 &&
        value.sourceKey !== value.targetKey
        ? { type: 'mergeTags', sourceKey: value.sourceKey, targetKey: value.targetKey }
        : undefined;
    case 'saveTagOverviewFilter':
    case 'createHubNote':
    case 'excludeHubLinks':
    case 'clearOverviewQuery':
    case 'openHelp':
      return Object.keys(value).length === 1 ? { type: value.type } : undefined;
    case 'navigateSearchHistory':
      return Object.keys(value).length === 2 &&
        (value.direction === 'back' || value.direction === 'forward')
        ? { type: 'navigateSearchHistory', direction: value.direction }
        : undefined;
    case 'setOverviewQuery':
      return isOverviewQueryMessage(value)
        ? {
            type: 'setOverviewQuery',
            query: value.query as string,
            remember: value.remember !== false,
          }
        : undefined;
    default:
      return undefined;
  }
}

/** Upper bound on query text accepted from the webview. */
/**
 * What a page may send as the words being typed. A draft is a handful of
 * short words; anything longer is not one, whatever sent it.
 */
const MAX_PREVIEW_WORDS = 12;
const MAX_PREVIEW_WORD_LENGTH = 100;

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
    Object.keys(value).length <= 3 &&
    typeof value.query === 'string' &&
    value.query.length <= MAX_QUERY_LENGTH &&
    (value.remember === undefined || typeof value.remember === 'boolean')
  );
}

/**
 * Validates the notes graph's navigation messages before dispatch.
 */
export function parseNotesGraphMessage(
  value: unknown,
): NotesGraphMessage | undefined {
  if (!isObject(value) || typeof value.type !== 'string') {
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
    value.type === 'setGraphScope' &&
    typeof value.local === 'boolean' &&
    typeof value.depth === 'number' &&
    Number.isInteger(value.depth) &&
    value.depth >= 1 &&
    value.depth <= MAXIMUM_LOCAL_GRAPH_DEPTH &&
    (value.skipPeriodic === undefined || typeof value.skipPeriodic === 'boolean')
  ) {
    return {
      type: 'setGraphScope',
      local: value.local,
      depth: value.depth,
      ...(typeof value.skipPeriodic === 'boolean'
        ? { skipPeriodic: value.skipPeriodic }
        : {}),
    };
  }
  if (
    value.type === 'openTag' &&
    typeof value.tagKey === 'string' &&
    value.tagKey.length > 0
  ) {
    return { type: 'openTag', tagKey: value.tagKey };
  }
  if (
    value.type === 'setGraphFilter' &&
    typeof value.showNotes === 'boolean' &&
    typeof value.showTasks === 'boolean'
  ) {
    return {
      type: 'setGraphFilter',
      showNotes: value.showNotes,
      showTasks: value.showTasks,
    };
  }
  return undefined;
}

/**
 * Validates the sidebar's navigation and shortcut messages independently.
 */
export function parseSidebarMessage(
  value: unknown,
): SidebarMessage | undefined {
  if (!isObject(value) || typeof value.type !== 'string') {
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
  if (
    value.type === 'linkMention' &&
    isSourceMessage(value) &&
    typeof value.startColumn === 'number' &&
    Number.isInteger(value.startColumn) &&
    value.startColumn >= 0
  ) {
    return {
      type: 'linkMention',
      filePath: value.filePath as string,
      line: value.line as number,
      startColumn: value.startColumn,
    };
  }
  if (value.type === 'linkAllMentions') {
    return { type: 'linkAllMentions' };
  }
  if (value.type === 'openLinksSearch') {
    return { type: 'openLinksSearch' };
  }
  if (
    value.type === 'addSuggestedTag' &&
    typeof value.tagKey === 'string' &&
    value.tagKey.length > 0 &&
    Object.keys(value).length === 2
  ) {
    return { type: 'addSuggestedTag', tagKey: value.tagKey };
  }
  if (
    value.type === 'setRelatedNotesPreviewLines' &&
    (value.lines === 0 || value.lines === 1 || value.lines === 2)
  ) {
    return { type: 'setRelatedNotesPreviewLines', lines: value.lines };
  }
  if (value.type === 'setHideDailyNotes' && typeof value.hide === 'boolean') {
    return { type: 'setHideDailyNotes', hide: value.hide };
  }
  if (value.type === 'insertLink' && isSourceMessage(value)) {
    return {
      type: 'insertLink',
      filePath: value.filePath as string,
      line: value.line as number,
    };
  }
  if (value.type === 'renameTag' && isRenameTagMessage(value)) {
    return value as unknown as SidebarMessage;
  }
  if (
    (value.type === 'parkTag' || value.type === 'unparkTag') &&
    isRenameTagMessage(value) &&
    Object.keys(value).length === 2
  ) {
    return { type: value.type, tagKey: value.tagKey as string };
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
  if (!isObject(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'exportResults':
      return value.kind === 'notes' || value.kind === 'tasks'
        ? { type: 'exportResults', kind: value.kind }
        : undefined;
    case 'setZenMode':
      return typeof value.enabled === 'boolean'
        ? { type: 'setZenMode', enabled: value.enabled }
        : undefined;
    case 'chooseTheme':
      return { type: 'chooseTheme' };
    case 'ready':
      return { type: 'ready' };
    case 'saveBoardSearch':
      return Object.keys(value).length === 1
        ? { type: 'saveBoardSearch' }
        : undefined;
    case 'useSearchForAgenda':
      return Object.keys(value).length === 1
        ? { type: 'useSearchForAgenda' }
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
        value.column.length > 0 &&
        (value.from === undefined || (typeof value.from === 'string' && value.from.length > 0))
        ? {
            type: 'moveTask',
            taskId: value.taskId,
            column: value.column,
            ...(typeof value.from === 'string' ? { from: value.from } : {}),
          }
        : undefined;
    case 'pickTaskDate':
    case 'moveTaskTo':
    case 'editTask':
    case 'breakIntoSteps':
      return typeof value.taskId === 'string' && Object.keys(value).length === 2
        ? { type: value.type, taskId: value.taskId }
        : undefined;
    case 'addTaskToColumn':
      return typeof value.column === 'string' &&
        value.column.length > 0 &&
        Object.keys(value).length === 2
        ? { type: 'addTaskToColumn', column: value.column }
        : undefined;
    case 'setBoardGroup':
      if (value.groupBy === 'tag') {
        return typeof value.namespace === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value.namespace)
          ? { type: 'setBoardGroup', groupBy: 'tag', namespace: value.namespace.toLowerCase() }
          : undefined;
      }
      return isTaskBoardGroupBy(value.groupBy)
        ? { type: 'setBoardGroup', groupBy: value.groupBy }
        : undefined;
    case 'showColumnRest':
      return typeof value.columnId === 'string' && value.columnId.length > 0
        ? { type: 'showColumnRest', columnId: value.columnId }
        : undefined;
    case 'openHelp':
      return Object.keys(value).length === 1
        ? { type: 'openHelp' }
        : undefined;
    case 'setBoardQuery':
      return typeof value.query === 'string' &&
        value.query.length <= MAX_QUERY_LENGTH
        ? { type: 'setBoardQuery', query: value.query }
        : undefined;
    case 'setTaskLayout':
      return value.layout === 'list' || value.layout === 'board' || value.layout === 'table'
        ? { type: 'setTaskLayout', layout: value.layout }
        : undefined;
    case 'setTableSort':
      return value.column === undefined
        ? { type: 'setTableSort' }
        : isTaskColumnId(value.column)
          ? { type: 'setTableSort', column: value.column }
          : undefined;
    case 'setTableColumns':
      return Array.isArray(value.columns) && value.columns.every(isTaskColumnId)
        ? { type: 'setTableColumns', columns: [...value.columns] }
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
  return (
    value === 'status' ||
    value === 'priority' ||
    value === 'due' ||
    value === 'assignee' ||
    value === 'tag'
  );
}

/**
 * Checks source locations before they are used to open an editor line.
 */
/** What the Help page may ask of its host. */
export type HelpMessage =
  | { type: 'runCommand'; command: string }
  | { type: 'openChangelog' }
  | { type: 'openGuide'; page: string; anchor?: string };

/**
 * Validates the Help page's messages. Only the shape is checked here; the
 * host runs a command only when Help is allowed to run it.
 */
export function parseHelpMessage(value: unknown): HelpMessage | undefined {
  if (!isObject(value) || typeof value.type !== 'string') {
    return undefined;
  }
  switch (value.type) {
    case 'runCommand':
      return typeof value.command === 'string' && /^deckard\.[\w.]+$/.test(value.command)
        ? { type: 'runCommand', command: value.command }
        : undefined;
    case 'openChangelog':
      return { type: 'openChangelog' };
    case 'openGuide':
      // A page's file name and a heading's anchor: nothing that climbs out.
      return typeof value.page === 'string' && /^[\w-]+$/.test(value.page) &&
        (value.anchor === undefined || (typeof value.anchor === 'string' && /^[\w-]+$/.test(value.anchor)))
        ? { type: 'openGuide', page: value.page, ...(typeof value.anchor === 'string' ? { anchor: value.anchor } : {}) }
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
  if (!isObject(value) || typeof value.type !== 'string') {
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
        /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month) &&
        (value.date === undefined || isDate)
        ? { type: 'showMonth', month: value.month, ...(isDate ? { date } : {}) }
        : undefined;
    case 'openDay':
      return isDate ? { type: 'openDay', date } : undefined;
    case 'openWeek':
      return isDate ? { type: 'openWeek', date } : undefined;
    case 'selectDay':
      return isDate && Object.keys(value).length === 2 ? { type: 'selectDay', date } : undefined;
    case 'createDay':
      return isDate && Object.keys(value).length === 2 ? { type: 'createDay', date } : undefined;
    case 'openNote':
      return typeof value.filePath === 'string' &&
        value.filePath.length > 0 &&
        value.filePath.length <= 4096 &&
        Object.keys(value).length === 2
        ? { type: 'openNote', filePath: value.filePath }
        : undefined;
    case 'searchCreated':
      return isDate && Object.keys(value).length === 2 ? { type: 'searchCreated', date } : undefined;
    case 'openTask':
      return typeof value.taskId === 'string' && value.taskId.length > 0 && Object.keys(value).length === 2
        ? { type: 'openTask', taskId: value.taskId }
        : undefined;
    case 'toggleTask':
      return typeof value.taskId === 'string' &&
        value.taskId.length > 0 &&
        typeof value.completed === 'boolean' &&
        Object.keys(value).length === 3
        ? { type: 'toggleTask', taskId: value.taskId, completed: value.completed }
        : undefined;
    case 'moveTask':
      return typeof value.taskId === 'string' &&
        value.taskId.length > 0 &&
        (value.field === 'due' || value.field === 'scheduled') &&
        isDate &&
        Object.keys(value).length === 4
        ? { type: 'moveTask', taskId: value.taskId, field: value.field, date }
        : undefined;
    default:
      return undefined;
  }
}

/** The calendar page's messages: the sidebar Calendar's, and its gear's and help's. */
export function parseCalendarPageMessage(value: unknown): CalendarPageMessage | undefined {
  if (isObject(value)) {
    switch (value.type) {
      case 'setShowRepeats':
      case 'setShowWeekends':
        return typeof value.show === 'boolean' && Object.keys(value).length === 2
          ? { type: value.type, show: value.show }
          : undefined;
      case 'setZenMode':
        return typeof value.enabled === 'boolean' ? { type: 'setZenMode', enabled: value.enabled } : undefined;
      case 'chooseTheme':
        return { type: 'chooseTheme' };
      case 'openHelp':
        return { type: 'openHelp' };
    }
  }
  return parseCalendarMessage(value);
}

function isSourceMessage(value: Record<string, unknown>): boolean {
  return (
    typeof value.filePath === 'string' &&
    typeof value.line === 'number' &&
    Number.isInteger(value.line) &&
    value.line > 0 &&
    (value.beside === undefined || typeof value.beside === 'boolean') &&
    (value.pin === undefined || typeof value.pin === 'boolean')
  );
}

function isOpenTagMessage(value: Record<string, unknown>): boolean {
  return typeof value.tagKey === 'string' && value.tagKey.length > 0;
}

function isRenameTagMessage(value: Record<string, unknown>): boolean {
  return typeof value.tagKey === 'string' && value.tagKey.length > 0;
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
 * Keeps task filtering constrained to the three supported dashboard states.
 */

function isDashboardColumnCount(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
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
