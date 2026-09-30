import type {
  QueryViewState,
  TagReference,
} from '../domain/model';
import type {
  RelatedNotesSortMode,
  TableSort,
  TaskBoardGroupBy,
  TaskColumnId,
  TaskLayout,
  TaskSortMode,
} from '../domain/model/preferences';
import type {
  ChooseThemeMessage,
  DashboardTask,
  ExportResultsMessage,
  OpenHelpMessage,
  OpenSourceMessage,
  OpenTagMessage,
  OpenTaskBoardMessage,
  ParkTagMessage,
  RenameTagMessage,
  SearchRefineState,
  SetZenModeMessage,
  SidebarReadyMessage,
  TagTitleDisplayMode,
  ToggleTaskMessage,
} from '../ui/protocol';

export type * from '../domain/model';
export { DEFAULT_SEARCH_PAGE_SIZE, SEARCH_PAGE_SIZES } from '../domain/model/preferences';
export type * from '../ui/protocol';

export interface RankedNote {
  /** Parked: listed only beside a parked note, after the rest. */
  parked?: true;
  /**
   * The first lines of what a section says, up to 240 characters, from where
   * it shares a word with the note being read. Not on a task or an inline
   * tagged line, whose title is its whole text.
   */
  excerpt?: string;
  /** Listed for its wording alone, under a note with no tags: never strong. */
  kind?: 'wording';
  sectionId?: string;
  filePath: string;
  title: string;
  fileName: string;
  sourceLine: number;
  /** Outline context, including the entry title, for disambiguating daily notes. */
  headingPath: string[];
  /** Date inferred from a daily-note filename or date heading, when present. */
  dailyDate?: string;
  titleTags: TagReference[];
  updatedAt?: number;
  matchedTags: TagReference[];
  matchCount: number;
  totalTagCount: number;
  overlap: number;
  relevanceScore: number;
  associationWeight?: number;
  associationMatches?: Array<{
    selectedTag: TagReference;
    candidateTag: TagReference;
    associationWeight: number;
    normalizedAssociationWeight: number;
    sourceUnitCount: number;
    selectedTagSourceUnitCount: number;
    candidateTagSourceUnitCount: number;
    totalSourceUnitCount: number;
    selectedWeight: number;
    contribution: number;
  }>;
  relevanceEvidence?: {
    directTagWeight: number;
    associationWeight: number;
    normalizedAssociationWeight: number;
    appliedAssociationWeight: number;
    entryLinkWeight: number;
    fileLinkWeight: number;
    lexicalWeight: number;
    recencyWeight: number;
    specificityPenalty: number;
    lexicalTerms: Array<{ term: string; contribution: number }>;
  };
  reasons?: string[];
}

/** Messages from the sidebar calendar. The host finds each note itself. */
export type CalendarMessage =
  | { type: 'ready' }
  | { type: 'openMonth' }
  /** With a date, the day chosen in that month. */
  | { type: 'showMonth'; month: string; date?: string }
  | { type: 'openDay'; date: string }
  | { type: 'openWeek'; date: string }
  | { type: 'selectDay'; date: string }
  | { type: 'createDay'; date: string }
  | { type: 'openNote'; filePath: string }
  | { type: 'openTask'; taskId: string }
  | { type: 'toggleTask'; taskId: string; completed: boolean }
  | { type: 'moveTask'; taskId: string; field: 'due' | 'scheduled'; date: string }
  | { type: 'searchCreated'; date: string };

/** The chosen day, as the panel under the month shows it. */
export interface CalendarDayDetail {
  date: string;
  /** Such as "Friday, September 25", with the year when it is not this one. */
  title: string;
  /** Today, Yesterday, or Tomorrow, when the day is one of them. */
  relative?: string;
  /** The day's daily note, when it has one. */
  notePath?: string;
  /** Open tasks due that day, most important first. */
  due: DashboardTask[];
  /** Open tasks scheduled that day and not due on it. */
  scheduled: DashboardTask[];
  /** Tasks completed that day. */
  done: DashboardTask[];
  /** Repeating tasks whose rule lands on the day, projected: opened, never completed, from here. */
  repeats?: DashboardTask[];
  /**
   * Where the row's button moves a task: tomorrow, or the day after a later
   * day, never earlier.
   */
  move: { date: string; label: 'Tomorrow' | 'Next day' };
  /** Notes created that day, oldest first, daily, weekly, and monthly aside. */
  notes: { filePath: string; title: string; folder: string }[];
  /** How many there are, listed or not. */
  notesTotal: number;
}

/** What the calendar page asks besides what the sidebar Calendar does. */
export type CalendarPageMessage =
  | CalendarMessage
  | { type: 'setShowRepeats'; show: boolean }
  | { type: 'setShowWeekends'; show: boolean }
  | { type: 'setZenMode'; enabled: boolean }
  | { type: 'chooseTheme' }
  | { type: 'openHelp' };

/** A line in another note that links to, or names, the note being read. */
export interface NoteLinkEntry {
  filePath: string;
  /** The note the line is in. */
  title: string;
  /** One-based. */
  line: number;
  /** The line as written, for context. */
  text: string;
  /** The headings the line sits under, outermost first. */
  headingPath: string[];
  /**
   * The rest of the section the line is in, as plain text, cut at 15 lines
   * or 1,500 characters, for a link row to unfold.
   */
  sectionText?: string;
}

/** The lines of one note that link to the note being read. */
export interface NoteLinkGroup {
  filePath: string;
  title: string;
  updatedAt?: number;
  /** When the note was last updated, in words: `3 days ago`. */
  updatedLabel?: string;
  /** The lines listed, in the order they are written. */
  entries: NoteLinkEntry[];
  /** How many links the note has here, listed or not. */
  linkCount: number;
  /** The linking note is parked: listed after the rest, and said so. */
  parked?: true;
}

/** A mention of the note's name without a link, which can be made one. */
export interface NoteMention extends NoteLinkEntry {
  startColumn: number;
  endColumn: number;
  /** The name as written, which the link keeps. */
  name: string;
}

/** Related Notes' Link on one mention: make that mention a link. */
export interface LinkMentionMessage {
  type: 'linkMention';
  filePath: string;
  line: number;
  startColumn: number;
}

/** Related Notes' Hide daily notes. */
export interface SetHideDailyNotesMessage {
  type: 'setHideDailyNotes';
  hide: boolean;
}

/** A tag offered to an untagged note: write it where the cursor is. */
export interface AddSuggestedTagMessage {
  type: 'addSuggestedTag';
  tagKey: string;
}

/** Related Notes' gear: how many lines of each result's excerpt to show. */
export interface SetRelatedNotesPreviewLinesMessage {
  type: 'setRelatedNotesPreviewLines';
  lines: 0 | 1 | 2;
}

/** Related Notes' Open as search: every entry that links to the note. */
export interface OpenLinksSearchMessage {
  type: 'openLinksSearch';
}

/** Related Notes' Link all: every mention of the note, as one write. */
export interface LinkAllMentionsMessage {
  type: 'linkAllMentions';
}

/** What points at the note being read. */
export interface NoteLinks {
  /** The notes that link here, newest updated first, each with its lines. */
  linkedFromNotes: NoteLinkGroup[];
  /** How many links there are, listed or not. */
  linkedFromCount: number;
  /** How many notes they are in. */
  linkedFromNoteCount: number;
  /** Daily, weekly, and monthly notes left out of Linked from. */
  hiddenDailyNoteCount?: number;
  mentions: NoteMention[];
  mentionCount: number;
}

export interface SidebarNotesSnapshot {
  /** How far the first scan has got, while the state is loading. */
  progress?: { completed: number; total: number };
  /** What links to the note being read, and what names it without a link. */
  links?: NoteLinks;
  activeFileName?: string;
  activeEntryTitle?: string;
  activeTags: SidebarTag[];
  notes: RankedNote[];
  relatedNotesSortMode?: RelatedNotesSortMode;
  /** Whether daily notes are left out of the list and of Linked from. */
  hideDailyNotes?: boolean;
  /** How many lines of each result's excerpt the cards show, 0 for none. */
  previewLines?: 0 | 1 | 2;
  /**
   * For a note with no tags: entries worded like it, kept apart from the
   * related notes, and the tags those entries use.
   */
  similar?: { notes: RankedNote[]; tags: SuggestedTag[] };
  tagTitleDisplayMode: TagTitleDisplayMode;
  graph?: SidebarGraphContext;
  /** The active search page's Refine options, shown in its place. */
  refine?: SearchRefineState;
  /** The calendar page's chosen day, while the page is in front. */
  calendarDay?: CalendarDayDetail;
  /** The widgets Home can add, while Home is in front. */
  homeWidgets?: { value: string; label: string; description?: string }[];
  state:
    | 'ready'
    | 'loading'
    | 'notIndexed'
    | 'noMarkdown'
    | 'noTags'
    | 'noMatches'
    | 'graph'
    | 'refine'
    | 'calendarDay'
    | 'customizeHome';
}

/** A tag the entries worded like an untagged note use, offered to add. */
export interface SuggestedTag {
  key: string;
  label: string;
  /** How many of the similar entries carry it. */
  entryCount: number;
}

export interface SidebarTag extends TagReference {
  /** Relative contribution used when ranking Related Notes. */
  weight: number;
  /** How many notes and tasks a search for the tag finds. */
  matches?: { notes: number; tasks: number };
}

export type NotesGraphNodeKind = 'note' | 'task' | 'tag';

export type NotesGraphEdgeType =
  | 'wiki-link'
  | 'heading'
  | 'associated-tag'
  | 'tag-membership';

export interface NotesGraphNode {
  /** 'section:<id>' | 'task:<id>' | 'file:<path>' | 'tag:<key>' */
  id: string;
  kind: NotesGraphNodeKind;
  /** Heading or task text with tags stripped, or the tag label. */
  title: string;
  filePath?: string;
  line?: number;
  /** Canonical tag keys carried by this node; empty for tag nodes. */
  tagKeys: string[];
  /**
   * Every indexed edge the node has, whatever the page draws, so its size
   * and tooltip do not change with how many links are shown.
   */
  degree: number;
  /** Its edges by kind, workspace-wide; kinds with none are left out. */
  links?: NotesGraphLinkCounts;
  /** Parked, or a tag only parked notes carry: hidden unless Show parked is on. */
  parked?: true;
}

/**
 * A node's edges by kind: wiki links, heading-and-sub-heading edges, the
 * tags a note or task carries (or, on a tag, the notes and tasks carrying
 * it), and on a tag the tags written with it. An edge of two kinds counts
 * once in each.
 */
export interface NotesGraphLinkCounts {
  wiki?: number;
  heading?: number;
  tag?: number;
  related?: number;
}

export interface NotesGraphEdge {
  /** '<sourceId>::<targetId>' with the two ids sorted. */
  id: string;
  source: string;
  target: string;
  /** Combined evidence weight, used for spring strength. */
  weight: number;
  types: NotesGraphEdgeType[];
}

export interface NotesGraphSnapshot {
  updatedAt: number;
  nodes: NotesGraphNode[];
  edges: NotesGraphEdge[];
  /** All indexed tags for the filter list: [key, label, count]. */
  tags: [string, string, number][];
  totalNoteCount: number;
  totalTaskCount: number;
  /** The note the graph is drawn around, when it is drawn around one. */
  focus?: NotesGraphFocus;
}

/**
 * An edge as the page receives it: without its id, which is its two ends and
 * which the page puts back, since at 5,000 notes the ids alone were about a
 * fifth of the message.
 */
export type NotesGraphWireEdge = Omit<NotesGraphEdge, 'id'> & { id?: string };

/** The graph as the page receives it: only the kinds of node it shows. */
export interface NotesGraphWireSnapshot extends Omit<NotesGraphSnapshot, 'edges'> {
  edges: NotesGraphWireEdge[];
  /** Notes and tasks left out because the page hides their kind. */
  hiddenNodeCount?: number;
  /** How many edges the graph holds before any were left out. */
  edgeCount?: number;
}

/**
 * What a local graph is centered on: the note last open in an editor, how far
 * out it reaches, and whether the graph on screen is that neighborhood or
 * the whole workspace.
 */
export interface NotesGraphFocus {
  /** On, and drawn around the note; off, and the whole workspace is drawn. */
  local: boolean;
  /** How many hops out from the note the local graph reaches. */
  depth: number;
  /** Whether daily and periodic notes are passed through rather than drawn. */
  skipPeriodic?: boolean;
  /** The note it is drawn around, when one is open. */
  filePath?: string;
  title?: string;
  /** How many nodes and edges the whole workspace holds, for the readout. */
  workspaceNodeCount: number;
}

export interface NotesGraphConnection {
  node: NotesGraphNode;
  weight: number;
  types: NotesGraphEdgeType[];
}

export interface SidebarGraphContext {
  selectedNode?: NotesGraphNode;
  connections: NotesGraphConnection[];
}

export interface NotesGraphOpenSourceMessage {
  type: 'openSource';
  filePath: string;
  line: number;
  /** Alt-click: open beside the graph. */
  beside?: boolean;
  pin?: boolean;
}

export interface NotesGraphOpenTagMessage {
  type: 'openTag';
  tagKey: string;
}

export interface NotesGraphSelectNodeMessage {
  type: 'selectNode';
  nodeId: string;
}

export interface NotesGraphClearSelectionMessage {
  type: 'clearSelection';
}

/** Draw the whole workspace, or the neighborhood of the note in the editor. */
export interface NotesGraphSetScopeMessage {
  type: 'setGraphScope';
  local: boolean;
  depth: number;
  /** Pass through daily and periodic notes rather than drawing them. */
  skipPeriodic?: boolean;
}

/** Which kinds of node the page shows, so the host sends only those. */
export interface NotesGraphSetFilterMessage {
  type: 'setGraphFilter';
  showNotes: boolean;
  showTasks: boolean;
}

export type NotesGraphMessage =
  | NotesGraphOpenSourceMessage
  | NotesGraphOpenTagMessage
  | NotesGraphSelectNodeMessage
  | NotesGraphClearSelectionMessage
  | NotesGraphSetScopeMessage
  | NotesGraphSetFilterMessage;

/**
 * Write a `[[Note#Heading]]` link to a related note at the cursor of the note
 * being edited.
 */
export interface InsertLinkMessage {
  type: 'insertLink';
  filePath: string;
  line: number;
}

export interface ReorderTasksMessage {
  type: 'reorderTasks';
  taskIds: string[];
}

export interface SetTaskSortMessage {
  type: 'setTaskSort';
  mode: TaskSortMode;
}

export interface OpenDashboardMessage {
  type: 'openDashboard';
}

export interface OpenNotesGraphMessage {
  type: 'openNotesGraph';
}

export interface ActivateNotesGraphNodeMessage {
  type: 'activateNotesGraphNode';
  nodeId: string;
  open: boolean;
}

export interface HoverNotesGraphNodeMessage {
  type: 'hoverNotesGraphNode';
  nodeId?: string;
}

export interface CreateDailyNoteMessage {
  type: 'createDailyNote';
}

export interface SetRelatedNotesSortMessage {
  type: 'setRelatedNotesSort';
  mode: RelatedNotesSortMode;
}

/**
 * Narrows the active search by one of its facet values, from the sidebar's
 * Refine view: `and` keeps only it, `exclude` leaves it out, and `or` allows
 * it beside the value of the same facet already chosen.
 */
export interface RefineActiveSearchMessage {
  type: 'refineActiveSearch';
  facetId: string;
  clause: string;
  mode: 'and' | 'exclude' | 'or';
}

export interface ClearEntryRelatedNotesMessage {
  type: 'clearEntryRelatedNotes';
}

export type SidebarMessage =
  | LinkMentionMessage
  | OpenLinksSearchMessage
  | SetHideDailyNotesMessage
  | SetRelatedNotesPreviewLinesMessage
  | AddSuggestedTagMessage
  | LinkAllMentionsMessage
  | SidebarReadyMessage
  | OpenSourceMessage
  | OpenTagMessage
  | RenameTagMessage
  | ParkTagMessage
  | OpenDashboardMessage
  | OpenNotesGraphMessage
  | OpenTaskBoardMessage
  | ActivateNotesGraphNodeMessage
  | HoverNotesGraphNodeMessage
  | CreateDailyNoteMessage
  | OpenHelpMessage
  | SetRelatedNotesSortMessage
  | ClearEntryRelatedNotesMessage
  | InsertLinkMessage
  | RefineActiveSearchMessage;

export interface TaskBoardCard {
  taskId: string;
  title: string;
  /** Tags written inside the title, rendered as controls where they appear. */
  titleTags: TagReference[];
  /** The title as sanitized inline Markdown, as the task list shows it. */
  renderedTitle: string;
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
   * The cell's Markdown, already rendered and sanitized by the host, for a
   * column whose source is prose rather than a value. `text` stays the plain
   * form, which is what a label or a sort reads.
   */
  html?: string;
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

export interface SetTaskLayoutMessage {
  type: 'setTaskLayout';
  layout: TaskLayout;
}

export interface MoveTaskMessage {
  type: 'moveTask';
  taskId: string;
  column: string;
  /** The column the card was moved from: a task with two tags has two cards. */
  from?: string;
}

export interface SetBoardGroupMessage {
  type: 'setBoardGroup';
  groupBy: TaskBoardGroupBy;
  /** The namespace, when grouping by tag. */
  namespace?: string;
}

export interface SetBoardQueryMessage {
  type: 'setBoardQuery';
  query: string;
}

/** Replaces the status columns, in order. */
export interface SetBoardStatusesMessage {
  type: 'setBoardStatuses';
  statuses: string[];
}

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

export type TaskBoardMessage =
  | PickTaskDateMessage
  | MoveTaskToMessage
  | EditTaskMessage
  | BreakIntoStepsMessage
  | AddTaskToColumnMessage
  | ExportResultsMessage
  | SetZenModeMessage
  | ChooseThemeMessage
  | OpenHelpMessage
  | ShowColumnRestMessage
  | SaveBoardSearchMessage
  | UseSearchForAgendaMessage
  | SidebarReadyMessage
  | OpenSourceMessage
  | OpenTagMessage
  | ToggleTaskMessage
  | MoveTaskMessage
  | SetBoardGroupMessage
  | SetBoardQueryMessage
  | SetTaskLayoutMessage
  | SetTaskSortMessage
  | SetTableSortMessage
  | SetTableColumnsMessage
  | ReorderTasksMessage
  | SetBoardStatusesMessage
  | SetBoardStatusNamespaceMessage;
