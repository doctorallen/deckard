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
import type { DueParts } from '../../domain/model/tasks';
import type { Correlated, IndexingMessage, MessageOf, StateMessage } from './messaging';
import type {
  ChooseThemeMessage,
  ExportResultsMessage,
  GoToPageMessage,
  ListGoToMessage,
  OpenGoToMessage,
  OpenHelpMessage,
  OpenSourceMessage,
  OpenTagMessage,
  SetDisplayMessage,
  SetZenModeMessage,
  SidebarReadyMessage,
  ToggleTaskMessage,
  DrawnStatus,
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

/**
 * What a card draws of one of its details that holds a date: the date,
 * which is kept on one line, and for its due date the parts and how it is
 * colored. The date is in the reader's format, so the page never looks for
 * it by its shape.
 */
export interface CardDetailParts {
  /** The detail's place in `details`. */
  index: number;
  /** The date the detail writes, at its end. */
  date?: string;
  /** The due date's parts, each drawn in its own element. */
  due?: DueParts;
  /** Overdue, red or quiet by the card's `overdueTone`; due today; or past needing a new date. */
  tone?: 'overdue' | 'today' | 'stale';
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
  /** Its status, when it is neither a plain to do nor done, which its box is drawn by. */
  status?: DrawnStatus;
  /** The tag of the nearest tagged heading it is under, or its note's, when the board shows them. */
  parentTag?: TagReference;
  filePath: string;
  line: number;
  /** When the task was created, its own ➕ date or its note's, and when its note last changed, for Card details. */
  createdAt?: number;
  updatedAt?: number;
  /** Short facts under the title, such as "due 2026-09-14". */
  details: string[];
  /** The parts of the details that hold a date, so the page draws them without reading the words. */
  detailParts?: CardDetailParts[];
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
  /** What dropping a task here writes, such as `status:in-progress` or `done`. */
  id: string;
  label: string;
  /** The character of the status a status column stands for, which its header says after its name: `/`. */
  symbol?: string;
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
  /** The searched tasks as rows and columns, present when `layout` is `table`. */
  table?: TaskTable;
  /**
   * What each table row's ⋯ menu checks, by task id, present when `layout`
   * is `table`: the menu a board card has, for a row.
   */
  taskMenus?: Record<string, TaskMenuState>;
  /** How many searched tasks are open and how many are done. */
  taskCounts: { all: number; active: number; completed: number };
  taskSortMode: TaskSortMode;
  /** The board settings the page's view options edit. */
  settings: TaskBoardSettings;
  /** Whether the sidebar is showing this search's Refine options. */
  refineInSidebar?: boolean;
  /** Whether the Tasks view lists this search, so the board can say so. */
  agendaListsThisSearch?: boolean;
  /** Whether the Tasks view lists every open task, its own default. */
  agendaQueryIsDefault?: boolean;
  /**
   * Present while the board was opened from the Tasks view's search icon to
   * edit what the view lists: the page says so above its search box and
   * saves to the view. Only that command sets it, and Cancel clears it.
   */
  tasksViewMode?: TasksViewMode;
  /** Whether the search asks for is:available, which lights Can start now. */
  availableOnly?: boolean;
  /** The search Can start now switches to. */
  availableToggleQuery?: string;
  /**
   * While task lines still carry status tags Deckard no longer reads, what
   * the strip above the board says of them, "23 tasks still have #status
   * tags.", beside Move them.
   */
  statusTagsLeft?: string;
}

/** The board as the Tasks view's search editor. */
export interface TasksViewMode {
  /**
   * Whether the Tasks view lists the board's search, as last run, so Save
   * to Tasks view has nothing to do until the box shows another.
   */
  listed: boolean;
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
  /** Its status, when it is neither a plain to do nor done. */
  status?: DrawnStatus;
  /** One cell per column, in the columns' order. */
  cells: TableCell[];
}

/** What the Task Board's view options show and edit. */
export interface TaskBoardSettings {
  /**
   * Every status the gear lists, in the board's order: the open statuses,
   * then Done, then Cancelled. A card's menu offers each.
   */
  columns: BoardStatusColumn[];
  /** Whether each card and row shows its task's nearest parent tag. */
  parentTag?: boolean;
}

/** One status as the gear lists it, a column or not. */
export interface BoardStatusColumn {
  /** What a drop on its column writes: `status:in-progress`, `done`, or `cancelled`. */
  id: string;
  name: string;
  /** Its character: `/`. */
  symbol: string;
  /** Whether the board draws a column for it; the gear's tick. */
  shown: boolean;
  /** Open tasks in the workspace with it, whether its column is drawn or not. */
  openTasks: number;
  /** Done: always a column, after every open status, and not moved. */
  fixed?: boolean;
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

/** Chooses whether the Task Board shows a board or a table. */
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

/**
 * A completion or reopening the host could not write, of a task that has
 * gone or a line that changed. The page marked the card at once, so it
 * says it was not; the state that follows puts the card back.
 */
export interface ToggleRefusedMessage {
  type: 'toggleRefused';
  taskId: string;
  completed: boolean;
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

/** Orders the board's status columns, by status name. */
export interface SetBoardColumnOrderMessage {
  type: 'setBoardColumnOrder';
  names: string[];
}

/** Shows or hides one status's column, by its name. */
export interface SetBoardColumnShownMessage {
  type: 'setBoardColumnShown';
  name: string;
  shown: boolean;
}

/** Runs Move Status Tags into Checkboxes…, from the strip that says how many are left. */
export interface MoveStatusTagsMessage {
  type: 'moveStatusTags';
}

/** Opens Edit Task Statuses; on a new row when `newStatus` is true. */
export interface EditTaskStatusesMessage {
  type: 'editTaskStatuses';
  newStatus?: boolean;
}

/** Shows or hides each card's nearest parent tag. */
export interface SetBoardParentTagMessage {
  type: 'setBoardParentTag';
  show: boolean;
}

/**
 * Names the Task Board's search and keeps it as a saved view: the search
 * the box shows, typed or run, or the board's own search when it sends none.
 */
export interface SaveBoardSearchMessage {
  type: 'saveBoardSearch';
  query?: string;
}

/** Makes the Tasks view list the Task Board's search. */
export interface UseSearchForAgendaMessage {
  type: 'useSearchForAgenda';
}

/**
 * Makes the Tasks view list the search the box shows, typed or run. Sent
 * only while the board edits what the view lists.
 */
export interface SaveToTasksViewMessage {
  type: 'saveToTasksView';
  query: string;
}

/** Cancel: the board stops editing what the Tasks view lists, and the view keeps its search. */
export interface LeaveTasksViewModeMessage {
  type: 'leaveTasksViewMode';
}

/**
 * The Tasks view lists a search the board saved to it now, without the
 * board's own `is:open`; empty for every open task. The page says so.
 */
export interface SavedToTasksViewMessage {
  type: 'savedToTasksView';
  query: string;
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

/** The board's f key and its menu's For someone…: ask the host who the task is for. */
export interface PickTaskAssigneeMessage {
  type: 'pickTaskAssignee';
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

/** The page's Add task: Add Task, into the note it names, today's by default. */
export interface AddTaskMessage {
  type: 'addTask';
}

/** A column's +: Add Task, the task started in that column. */
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
  pickTaskAssignee: PickTaskAssigneeMessage;
  moveTaskTo: MoveTaskToMessage;
  editTask: EditTaskMessage;
  breakIntoSteps: BreakIntoStepsMessage;
  addTask: AddTaskMessage;
  addTaskToColumn: AddTaskToColumnMessage;
  exportResults: ExportResultsMessage;
  setZenMode: SetZenModeMessage;
  setDisplay: SetDisplayMessage;
  chooseTheme: ChooseThemeMessage;
  openHelp: OpenHelpMessage;
  openGoTo: OpenGoToMessage;
  listGoTo: ListGoToMessage;
  goToPage: GoToPageMessage;
  showColumnRest: ShowColumnRestMessage;
  saveBoardSearch: SaveBoardSearchMessage;
  useSearchForAgenda: UseSearchForAgendaMessage;
  saveToTasksView: SaveToTasksViewMessage;
  leaveTasksViewMode: LeaveTasksViewModeMessage;
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
  setBoardColumnOrder: SetBoardColumnOrderMessage;
  setBoardColumnShown: SetBoardColumnShownMessage;
  editTaskStatuses: EditTaskStatusesMessage;
  moveStatusTags: MoveStatusTagsMessage;
  setBoardParentTag: SetBoardParentTagMessage;
}

/**
 * What the host sends the Task Board, by type: its snapshot, the first
 * scan's progress, a move or a completion it could not write, and a search
 * it saved to the Tasks view.
 */
export interface TaskBoardHostToPage {
  state: StateMessage<TaskBoardSnapshot>;
  indexing: IndexingMessage;
  moveRefused: MoveRefusedMessage;
  toggleRefused: ToggleRefusedMessage;
  savedToTasksView: SavedToTasksViewMessage;
}

/** Messages from the Task Board. */
export type TaskBoardMessage = MessageOf<TaskBoardPageToHost>;
