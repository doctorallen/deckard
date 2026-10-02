/**
 * The Task Board's protocol: its columns, list, and table, the view options
 * it edits, and the messages the page and its host send each other.
 */
import type {
  TableSort,
  TaskBoardGroupBy,
  TaskColumnId,
  TaskLayout,
  TaskSortMode,
} from '../../domain/model/preferences';
import type { InlineToken } from '../../domain/model/inline';
import type { QueryViewState } from '../../domain/model/query';
import type { TagReference } from '../../domain/model/tags';
import type { Correlated, IndexingMessage, MessageOf, StateMessage } from './messaging';
import type {
  ChooseThemeMessage,
  DashboardTask,
  ExportResultsMessage,
  OpenHelpMessage,
  OpenSourceMessage,
  OpenTagMessage,
  SetZenModeMessage,
  SidebarReadyMessage,
  TagTitleDisplayMode,
  ToggleTaskMessage,
} from './shared';

/** Keeps the order tasks were dragged into as their rank. */
export interface ReorderTasksMessage {
  type: 'reorderTasks';
  taskIds: string[];
}

/** Chooses how a task list is ordered. */
export interface SetTaskSortMessage {
  type: 'setTaskSort';
  mode: TaskSortMode;
}

/** One task as a board card draws it. */
export interface TaskBoardCard {
  taskId: string;
  title: string;
  /** Tags written inside the title, rendered as controls where they appear. */
  titleTags: TagReference[];
  /** The title as inline Markdown tokens, which the page draws as elements and text, as the task list does. */
  titleTokens: InlineToken[];
  completed: boolean;
  filePath: string;
  line: number;
  /** Short facts under the title, such as "due 2026-09-14". */
  details: string[];
  overdue: boolean;
  /** Past `needsNewDateAfterDays`: its date reads `was due …`, muted. */
  stale?: boolean;
  /**
   * How loudly an overdue card says so: `full` in red, or `quiet`, muted
   * with a red dot, once most of a column is overdue and only the worst
   * third keeps the red.
   */
  overdueTone?: 'full' | 'quiet';
  /** The headings above the task, top down, tags stripped. */
  headingPath: string[];
  /**
   * The move values the task already has, such as `status:doing`,
   * `priority:high`, `due:today`, or `done`, so its menu can check them.
   * `due:` is no due date; a date other than today or tomorrow adds none.
   */
  current: string[];
  /** How far along its steps are, `2 of 5 steps`, and the next open one. */
  steps?: { label: string; next?: string };
}

/**
 * One column of the board: what dropping a card there writes, and its cards.
 */
export interface TaskBoardColumn {
  /** What dropping a task here writes, such as `status:doing` or `done`. */
  id: string;
  label: string;
  /** False for a column that no single edit can move a task into. */
  droppable: boolean;
  cards: TaskBoardCard[];
  /** Completed tasks left out of a long Done column. */
  hiddenCount: number;
  /** Open cards in the column that are overdue; 0 for Done and Overdue. */
  overdueCount?: number;
  /** The column's work-in-progress limit, from `deckard.board.limits`. */
  limit?: number;
}

/** A task board's columns, whichever page chose its tasks. */
export interface TaskBoardLayout {
  groupBy: TaskBoardGroupBy;
  columns: TaskBoardColumn[];
  taskCount: number;
  /**
   * Present when the board is grouped by status and almost no open task
   * carries one, so the first column holds nearly everything: how many of
   * the open tasks have no status. The page says so above the columns and
   * offers the due-date grouping, which works for any task.
   */
  statusHint?: { withoutStatus: number; open: number };
  /** The namespace the columns are the tags of, when grouped by tag. */
  groupNamespace?: string;
  /** The namespaces open tasks carry, busiest first, for the Tag… menu. */
  tagNamespaces?: { name: string; openTasks: number }[];
}

/** The Task Board page, which chooses its tasks with a search. */
export interface TaskBoardSnapshot extends TaskBoardLayout {
  /** The search narrowing the tasks, as every search box shows one. */
  query: QueryViewState;
  layout: TaskLayout;
  /** The searched tasks as a list, present when `layout` is `list`. */
  tasks?: DashboardTask[];
  /** The searched tasks as rows and columns, present when `layout` is `table`. */
  table?: TaskTable;
  /**
   * What each listed task's ⋯ menu checks, by task id, present when `layout`
   * is `list` or `table`: the menu a board card has, for a row.
   */
  taskMenus?: Record<string, TaskMenuState>;
  /** How many searched tasks are open and how many are done. */
  taskCounts: { all: number; active: number; completed: number };
  taskSortMode: TaskSortMode;
  tagTitleDisplayMode: TagTitleDisplayMode;
  /** The board settings the page's view options edit. */
  settings: TaskBoardSettings;
  /** Whether the sidebar is showing this search's Refine options. */
  refineInSidebar?: boolean;
  /** Whether the Tasks view lists this search, so the board can say so. */
  agendaListsThisSearch?: boolean;
  /** Whether the Tasks view lists every open task, its own default. */
  agendaQueryIsDefault?: boolean;
  /** Whether the search asks for is:available, which lights Can start now. */
  availableOnly?: boolean;
  /** The search Can start now switches to. */
  availableToggleQuery?: string;
}

/** A task's current status, priority, and due choice, as the ⋯ menu marks them. */
export interface TaskMenuState {
  /** Column ids the task is in: `status:…`, `priority:…`, `due:…`, `done`. */
  current: string[];
  /** Whether the task already has steps, so the menu offers to add more. */
  steps?: boolean;
}

/** The Task Board's table: the columns shown, every column there is, and the rows. */
export interface TaskTable {
  columns: { id: TaskColumnId; label: string }[];
  available: { id: TaskColumnId; label: string }[];
  /** The column the rows are ordered by; none means the list's own order. */
  sort?: TableSort;
  rows: TaskTableRow[];
}

/** One task as a row of the table layout. */
export interface TaskTableRow {
  taskId: string;
  filePath: string;
  line: number;
  completed: boolean;
  /** One cell per column, in the columns' order. */
  cells: TableCell[];
}

/** The `deckard.board` settings, as the Task Board's view options show them. */
export interface TaskBoardSettings {
  statuses: string[];
  statusNamespace: string;
  /**
   * Every status column the board draws, in its order: the listed ones,
   * then any other status an open task carries. The gear lists these, so a
   * column that is on the board is in the list that orders it.
   */
  columns?: { status: string; openTasks: number }[];
}

/**
 * One cell: its text, and what it is, so a surface can color an overdue
 * date or quieten a file name without knowing which column it drew.
 */
export interface TableCell {
  text: string;
  /**
   * The cell's Markdown as inline tokens, which the page draws in place of
   * `text`, for a column whose source is prose rather than a value and that
   * draws as something. `text` stays the plain form, which is what a label
   * or a sort reads.
   */
  tokens?: InlineToken[];
  kind?: 'overdue' | 'muted';
}

/** Sorts the table by a column; the same column again turns it round, and none clears it. */
export interface SetTableSortMessage {
  type: 'setTableSort';
  column?: TaskColumnId;
}

/** Chooses the table's columns. */
export interface SetTableColumnsMessage {
  type: 'setTableColumns';
  columns: TaskColumnId[];
}

/** Chooses whether the Task Board shows a list, a board, or a table. */
export interface SetTaskLayoutMessage {
  type: 'setTaskLayout';
  layout: TaskLayout;
}

/**
 * Moves a task to a board column, writing what that column stands for. The
 * page numbers each move, and a refusal carries the number back; a move
 * without one is still made, as it was before moves were numbered.
 */
export interface MoveTaskMessage extends Partial<Correlated> {
  type: 'moveTask';
  taskId: string;
  column: string;
  /** The column the card was moved from: a task with two tags has two cards. */
  from?: string;
}

/**
 * A move the host could not write. The card moved at once on the page, so
 * the page says it did not; the state that follows puts the card back. It
 * carries the move's number when the move had one.
 */
export interface MoveRefusedMessage extends Partial<Correlated> {
  type: 'moveRefused';
  taskId: string;
}

/** Chooses what the board's columns group tasks by. */
export interface SetBoardGroupMessage {
  type: 'setBoardGroup';
  groupBy: TaskBoardGroupBy;
  /** The namespace, when grouping by tag. */
  namespace?: string;
}

/** Runs a search on the Task Board. */
export interface SetBoardQueryMessage {
  type: 'setBoardQuery';
  query: string;
}

/** Replaces the status columns, in order. */
export interface SetBoardStatusesMessage {
  type: 'setBoardStatuses';
  statuses: string[];
}

/** Chooses the namespace whose tags are the board's statuses. */
export interface SetBoardStatusNamespaceMessage {
  type: 'setBoardStatusNamespace';
  namespace: string;
}

/** Names the Task Board's search and keeps it as a saved view. */
export interface SaveBoardSearchMessage {
  type: 'saveBoardSearch';
}

/** Makes the Tasks view list the Task Board's search. */
export interface UseSearchForAgendaMessage {
  type: 'useSearchForAgenda';
}

/** Asks the board to show every task a column is holding back. */
export interface ShowColumnRestMessage {
  type: 'showColumnRest';
  columnId: string;
}

/** The board's d key and its menu's Due on a date…: ask the host for one. */
export interface PickTaskDateMessage {
  type: 'pickTaskDate';
  taskId: string;
}

/** The card menu's Move to…: the task and its steps under another heading. */
export interface MoveTaskToMessage {
  type: 'moveTaskTo';
  taskId: string;
}

/** The board's e key: the whole task in the task editor. */
export interface EditTaskMessage {
  type: 'editTask';
  taskId: string;
}

/** The board's s key and its menu's Break into steps…: ask for the steps. */
export interface BreakIntoStepsMessage {
  type: 'breakIntoSteps';
  taskId: string;
}

/** A column's + Add task: capture a task already in that column. */
export interface AddTaskToColumnMessage {
  type: 'addTaskToColumn';
  column: string;
}

/**
 * What the Task Board sends its host, by type. The host checks each task,
 * line, and tag against the index as it is now, since the page may show a
 * task that has since changed.
 */
export interface TaskBoardPageToHost {
  pickTaskDate: PickTaskDateMessage;
  moveTaskTo: MoveTaskToMessage;
  editTask: EditTaskMessage;
  breakIntoSteps: BreakIntoStepsMessage;
  addTaskToColumn: AddTaskToColumnMessage;
  exportResults: ExportResultsMessage;
  setZenMode: SetZenModeMessage;
  chooseTheme: ChooseThemeMessage;
  openHelp: OpenHelpMessage;
  showColumnRest: ShowColumnRestMessage;
  saveBoardSearch: SaveBoardSearchMessage;
  useSearchForAgenda: UseSearchForAgendaMessage;
  ready: SidebarReadyMessage;
  openSource: OpenSourceMessage;
  openTag: OpenTagMessage;
  toggleTask: ToggleTaskMessage;
  moveTask: MoveTaskMessage;
  setBoardGroup: SetBoardGroupMessage;
  setBoardQuery: SetBoardQueryMessage;
  setTaskLayout: SetTaskLayoutMessage;
  setTaskSort: SetTaskSortMessage;
  setTableSort: SetTableSortMessage;
  setTableColumns: SetTableColumnsMessage;
  reorderTasks: ReorderTasksMessage;
  setBoardStatuses: SetBoardStatusesMessage;
  setBoardStatusNamespace: SetBoardStatusNamespaceMessage;
}

/**
 * What the host sends the Task Board, by type: its snapshot, the first
 * scan's progress, and a move it could not write.
 */
export interface TaskBoardHostToPage {
  state: StateMessage<TaskBoardSnapshot>;
  indexing: IndexingMessage;
  moveRefused: MoveRefusedMessage;
}

/** Messages from the Task Board. */
export type TaskBoardMessage = MessageOf<TaskBoardPageToHost>;
