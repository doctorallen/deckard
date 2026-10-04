/**
 * The note page's protocol: one note as the page draws it, its blocks each
 * with the line it starts on, and the messages the page sends.
 */
import type { InlineToken } from '../../domain/model/inline';
import type { IndexingMessage, MessageOf, StateMessage } from './messaging';
import type {
  ChooseThemeMessage,
  GoToPageMessage,
  ListGoToMessage,
  OpenGoToMessage,
  OpenHelpMessage,
  OpenTagMessage,
  DisplayCommandMessage,
  SetDisplayMessage,
  SetZenModeMessage,
  ToggleTaskMessage,
} from './shared';

/** A task's box in a note: the task it ticks, and whether it is done. */
export interface NoteTaskBox {
  taskId: string;
  completed: boolean;
}

/** One item of a list, its blocks, and its box when it is a task. */
export interface NoteListItem {
  /** The one-based line the item starts on. */
  line: number;
  task?: NoteTaskBox;
  blocks: NoteBlock[];
}

/** A row a query block lists: a note, or a task with its box. */
export interface NoteQueryRow {
  title: string;
  filePath: string;
  line: number;
  /** Where it lives, or for a task its due date and where it lives. */
  detail: string;
  task?: NoteTaskBox;
  /** For a table, the cells after the title, as text. */
  cells?: string[];
}

/** What a query block found, as the page draws it. */
export interface NoteQueryResult {
  /** "3 notes · 5 tasks, 2 open". */
  counts: string;
  /** Why the query could not run; nothing else is drawn then. */
  error?: string;
  /** Whether the rows are drawn as tables, with these headings after the title. */
  table?: { noteHead: string[]; taskHead: string[] };
  notes: NoteQueryRow[];
  tasks: NoteQueryRow[];
  /** How many there are in all, before the block's `limit`. */
  noteCount: number;
  taskCount: number;
}

/** One block of a note, with the one-based line it starts on. */
export type NoteBlock =
  | { kind: 'paragraph'; line: number; children: InlineToken[] }
  | { kind: 'heading'; line: number; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineToken[] }
  | { kind: 'list'; line: number; ordered: boolean; start?: number; items: NoteListItem[] }
  | { kind: 'code'; line: number; text: string; language?: string }
  | { kind: 'quote'; line: number; children: NoteBlock[] }
  | { kind: 'rule'; line: number }
  | { kind: 'table'; line: number; rows: InlineToken[][][] }
  | { kind: 'query'; line: number; query: string; result: NoteQueryResult }
  | NoteEmbedBlock;

/** An embed, drawn as what it names, or as why it names nothing. */
export interface NoteEmbedBlock {
  kind: 'embed';
  line: number;
  /** What the embed names, as written. */
  target: string;
  title: string;
  /** Where what it names is, to open it. */
  source?: { filePath: string; line: number };
  blocks?: NoteBlock[];
  /** The tags the note it reads writes, for its blocks' buttons, when that is another note. */
  tags?: Array<{ key: string; label: string }>;
  /** Why it draws nothing, when it does not. */
  missing?: string;
}

/** A front-matter property: its name, and its values, a tag among them a button. */
export interface NoteProperty {
  name: string;
  values: Array<{ text: string; tagKey?: string }>;
}

/** A note that links to the one shown, and the lines that do. */
export interface NoteBacklink {
  filePath: string;
  title: string;
  lines: Array<{ line: number; text: string }>;
  /** How many of its lines link here, listed or not. */
  count: number;
}

/** A way up from the note to its hubs, as the Hubs view files it. */
export interface NoteBreadcrumb {
  /** Each step's words, the namespace first when there is one. */
  labels: string[];
  /** The note each step after the namespace is, by path. */
  notes: string[];
}

/** One part of a progress line's words, and the search that lists the tasks it counts, when it counts any. */
export interface NoteProgressPart {
  text: string;
  query?: string;
  tip?: string;
}

/** One note, as the note page draws it. */
export interface NotePageSnapshot {
  filePath: string;
  /** Set when the index has no such note, so the page says so. */
  missing?: boolean;
  title: string;
  /** The folder the note is in, or nothing at the top. */
  folder: string;
  properties: NoteProperty[];
  breadcrumbs: NoteBreadcrumb[];
  /** For a hub note, its tag and how far along the tag's tasks are, wherever they are written. */
  hub?: {
    tagKey: string;
    tagLabel: string;
    /** What the tag names, by its namespace: Project, Team, Person, or Tag for one with none. */
    kind: string;
    done: number;
    total: number;
    label: string;
    /** The label's parts, each that counts tasks with the search that lists them. */
    parts: NoteProgressPart[];
  };
  /** How far along the note's own tasks are, steps aside, when it has any. */
  taskProgress?: { done: number; total: number; label: string; parts: NoteProgressPart[] };
  /** Every tag the note writes, by the words it writes them in, for the page to make buttons of. */
  tags: Array<{ key: string; label: string }>;
  blocks: NoteBlock[];
  backlinks: NoteBacklink[];
  /** How many notes link here, listed or not. */
  backlinkCount: number;
  /** The line to show and mark, as the note was asked for. */
  focusLine?: number;
  /** Whether there is a note to go back to, and one to go forward to. */
  history: { back: boolean; forward: boolean };
  /** Changes with each note asked for, so the page knows a new one from a redraw. */
  visit: number;
}

/** Opens a note: on this page, or, with `opposite`, in the editor. */
export interface OpenNoteMessage {
  type: 'openNote';
  filePath: string;
  line?: number;
  /** Shift was held: open it where the setting does not. */
  opposite?: true;
  beside?: true;
}

/** Follows a `[[link]]` written in the note, or in a note it embeds. */
export interface OpenWikiLinkMessage {
  type: 'openWikiLink';
  target: string;
  /** The note the link is written in, when it is an embedded note's rather than the one shown. */
  from?: string;
  opposite?: true;
  beside?: true;
}

/** Opens the note shown in the editor, at a line. */
export interface OpenInEditorMessage {
  type: 'openInEditor';
  line?: number;
  beside?: true;
}

/** Opens a search on a search page of its own, such as a progress line's overdue tasks. */
export interface OpenSearchMessage {
  type: 'openSearch';
  query: string;
}

/** Steps back or forward through the notes the page has shown. */
export interface NavigateNoteHistoryMessage {
  type: 'navigateNoteHistory';
  direction: 'back' | 'forward';
}

/** What the note page sends, keyed by message type. */
export interface NotePagePageToHost {
  openNote: OpenNoteMessage;
  openWikiLink: OpenWikiLinkMessage;
  openInEditor: OpenInEditorMessage;
  openTag: OpenTagMessage;
  toggleTask: ToggleTaskMessage;
  navigateNoteHistory: NavigateNoteHistoryMessage;
  openSearch: OpenSearchMessage;
  openGoTo: OpenGoToMessage;
  listGoTo: ListGoToMessage;
  goToPage: GoToPageMessage;
  setZenMode: SetZenModeMessage;
  setDisplay: SetDisplayMessage;
  displayCommand: DisplayCommandMessage;
  chooseTheme: ChooseThemeMessage;
  openHelp: OpenHelpMessage;
}

/** What the host sends the note page, keyed by message type. */
export interface NotePageHostToPage {
  state: StateMessage<NotePageSnapshot>;
  indexing: IndexingMessage;
}

/** A message from the note page. */
export type NotePageMessage = MessageOf<NotePagePageToHost>;
