/**
 * The Task Board's narrowing table: what each message it may send must
 * hold. A task id or a column id is only a string here; the host decides
 * what, if anything, a move to it may write, and checks each task, line,
 * and tag against the index as it is now.
 */
import type { TaskBoardGroupBy, TaskSortMode } from '../../../../domain/model/preferences';
import {
  isBoardNamespace,
  isStatusColumnList,
  isTaskColumnId,
} from '../../../../domain/tasks/taskColumns';
import type {
  AddTaskToColumnMessage,
  BreakIntoStepsMessage,
  EditTaskMessage,
  MoveTaskMessage,
  MoveTaskToMessage,
  PickTaskDateMessage,
  ReorderTasksMessage,
  SaveBoardSearchMessage,
  SetBoardGroupMessage,
  SetBoardQueryMessage,
  SetBoardStatusesMessage,
  SetBoardStatusNamespaceMessage,
  SetTableColumnsMessage,
  SetTableSortMessage,
  SetTaskLayoutMessage,
  SetTaskSortMessage,
  ShowColumnRestMessage,
  TaskBoardPageToHost,
} from '../../../protocol/taskBoard';
import {
  exactlyType,
  isRequestId,
  isStringArray,
  MAX_QUERY_LENGTH,
  Narrower,
  NarrowingTable,
  narrowExportResults,
  narrowOpenSource,
  narrowOpenTag,
  narrowSetZenMode,
  narrowToggleTask,
  narrowWith,
  onlyType,
} from '../../host/narrowing';

/** The board's groupings: the ones it can lay out. */
function isTaskBoardGroupBy(value: unknown): value is TaskBoardGroupBy {
  return value === 'status' || value === 'priority' || value === 'due' || value === 'assignee' || value === 'tag';
}

/** A list's orders: the ones the state layer implements. */
function isTaskSortMode(value: unknown): value is TaskSortMode {
  return value === 'rank' || value === 'created' || value === 'updated';
}

/** The messages that name a task and nothing else. */
type TaskOnlyMessage = PickTaskDateMessage | MoveTaskToMessage | EditTaskMessage | BreakIntoStepsMessage;

/**
 * A card's or row's action on one task: its id, and nothing else. One check
 * serves each type.
 */
function taskOnly<T extends TaskOnlyMessage['type']>(type: T): Narrower<{ type: T; taskId: string }> {
  return (value) =>
    typeof value.taskId === 'string' && Object.keys(value).length === 2 ? { type, taskId: value.taskId } : undefined;
}

/**
 * A card moved to a column: the task, a non-empty column, and the column it
 * left when sent. The move's number is kept when it is one, and a move
 * without one, or with one that is not, is still made, as it was before
 * moves were numbered.
 */
const narrowMoveTask: Narrower<MoveTaskMessage> = (value) => {
  if (typeof value.taskId !== 'string' || typeof value.column !== 'string' || value.column.length === 0) {
    return undefined;
  }
  if (value.from !== undefined && (typeof value.from !== 'string' || value.from.length === 0)) {
    return undefined;
  }
  return {
    type: 'moveTask',
    taskId: value.taskId,
    column: value.column,
    ...(typeof value.from === 'string' ? { from: value.from } : {}),
    ...(isRequestId(value.requestId) ? { requestId: value.requestId } : {}),
  };
};

/** A column's + Add task: a non-empty column, and nothing else. */
const narrowAddTaskToColumn: Narrower<AddTaskToColumnMessage> = (value) =>
  typeof value.column === 'string' && value.column.length > 0 && Object.keys(value).length === 2
    ? { type: 'addTaskToColumn', column: value.column }
    : undefined;

/**
 * A grouping the board can lay out; grouping by tag names its namespace,
 * which is kept in lower case.
 */
const narrowSetBoardGroup: Narrower<SetBoardGroupMessage> = (value) => {
  if (value.groupBy === 'tag') {
    return isBoardNamespace(value.namespace)
      ? { type: 'setBoardGroup', groupBy: 'tag', namespace: value.namespace.toLowerCase() }
      : undefined;
  }
  return isTaskBoardGroupBy(value.groupBy) ? { type: 'setBoardGroup', groupBy: value.groupBy } : undefined;
};

/** A column's Show N more: a non-empty column id. */
const narrowShowColumnRest: Narrower<ShowColumnRestMessage> = (value) =>
  typeof value.columnId === 'string' && value.columnId.length > 0
    ? { type: 'showColumnRest', columnId: value.columnId }
    : undefined;

/** A search typed in the box, no longer than a search may be. */
const narrowSetBoardQuery: Narrower<SetBoardQueryMessage> = (value) =>
  typeof value.query === 'string' && value.query.length <= MAX_QUERY_LENGTH
    ? { type: 'setBoardQuery', query: value.query }
    : undefined;

/** Save, with the search the box shows, no longer than a search may be, or with none. */
const narrowSaveBoardSearch: Narrower<SaveBoardSearchMessage> = (value) => {
  if (value.query === undefined) {
    return Object.keys(value).length === 1 ? { type: 'saveBoardSearch' } : undefined;
  }
  return typeof value.query === 'string' && value.query.length <= MAX_QUERY_LENGTH && Object.keys(value).length === 2
    ? { type: 'saveBoardSearch', query: value.query }
    : undefined;
};

/** A list, a board, or a table. */
const narrowSetTaskLayout: Narrower<SetTaskLayoutMessage> = (value) =>
  value.layout === 'list' || value.layout === 'board' || value.layout === 'table'
    ? { type: 'setTaskLayout', layout: value.layout }
    : undefined;

/** A table header's sort: a column there is, or none to clear the sort. */
const narrowSetTableSort: Narrower<SetTableSortMessage> = (value) => {
  if (value.column === undefined) {
    return { type: 'setTableSort' };
  }
  return isTaskColumnId(value.column) ? { type: 'setTableSort', column: value.column } : undefined;
};

/** The table's columns, each one there is. */
const narrowSetTableColumns: Narrower<SetTableColumnsMessage> = (value) =>
  Array.isArray(value.columns) && value.columns.every(isTaskColumnId)
    ? { type: 'setTableColumns', columns: [...value.columns] }
    : undefined;

/** A list order the state layer implements. */
const narrowSetTaskSort: Narrower<SetTaskSortMessage> = (value) =>
  isTaskSortMode(value.mode) ? { type: 'setTaskSort', mode: value.mode } : undefined;

/** The order tasks were dragged into: task ids. */
const narrowReorderTasks: Narrower<ReorderTasksMessage> = (value) =>
  isStringArray(value.taskIds) ? { type: 'reorderTasks', taskIds: [...value.taskIds] } : undefined;

/**
 * The status columns, in order: no more than the gear keeps, each a status
 * the setting allows, by the validator the page checks them with.
 */
const narrowSetBoardStatuses: Narrower<SetBoardStatusesMessage> = (value) =>
  isStatusColumnList(value.statuses) ? { type: 'setBoardStatuses', statuses: [...value.statuses] } : undefined;

/** The statuses' namespace, as the setting allows one. */
const narrowSetBoardStatusNamespace: Narrower<SetBoardStatusNamespaceMessage> = (value) =>
  isBoardNamespace(value.namespace) ? { type: 'setBoardStatusNamespace', namespace: value.namespace } : undefined;

/** Each message the Task Board may send, and what it must hold. */
export const TASK_BOARD_MESSAGES: NarrowingTable<TaskBoardPageToHost> = {
  exportResults: narrowExportResults,
  setZenMode: narrowSetZenMode,
  chooseTheme: onlyType('chooseTheme'),
  ready: onlyType('ready'),
  saveBoardSearch: narrowSaveBoardSearch,
  useSearchForAgenda: exactlyType('useSearchForAgenda'),
  openSource: narrowOpenSource,
  openTag: narrowOpenTag,
  toggleTask: narrowToggleTask,
  moveTask: narrowMoveTask,
  pickTaskDate: taskOnly('pickTaskDate'),
  moveTaskTo: taskOnly('moveTaskTo'),
  editTask: taskOnly('editTask'),
  breakIntoSteps: taskOnly('breakIntoSteps'),
  addTaskToColumn: narrowAddTaskToColumn,
  setBoardGroup: narrowSetBoardGroup,
  showColumnRest: narrowShowColumnRest,
  openHelp: exactlyType('openHelp'),
  setBoardQuery: narrowSetBoardQuery,
  setTaskLayout: narrowSetTaskLayout,
  setTableSort: narrowSetTableSort,
  setTableColumns: narrowSetTableColumns,
  setTaskSort: narrowSetTaskSort,
  reorderTasks: narrowReorderTasks,
  setBoardStatuses: narrowSetBoardStatuses,
  setBoardStatusNamespace: narrowSetBoardStatusNamespace,
};

/** A message from the Task Board, narrowed by its table, or undefined. */
export const narrowTaskBoardMessage = narrowWith(TASK_BOARD_MESSAGES);
