/**
 * The protocol types more than one page uses: how a task and a note card are
 * drawn, a page of results, the search the sidebar refines, and the messages
 * several pages send.
 */
import type { BlockToken } from '../../domain/model/blocks';
import type { InlineToken } from '../../domain/model/inline';
import type { QueryViewState } from '../../domain/model/query';
import type { TagReference } from '../../domain/model/tags';
import type { Task } from '../../domain/model/tasks';

export type { TagReference, TagTitleDisplayMode } from '../../domain/model/tags';

/**
 * A task as a list draws it: the task, its title as tokens, and where it
 * sits.
 */
export interface DashboardTask {
  task: Task;
  /** Listed on a tag's page because it links to the tag's hub note. */
  via?: 'hubLink';
  /** In a parked folder or under a parked tag: listed last, and said so. */
  parked?: true;
  /** The title as inline Markdown tokens, which a page draws as elements and text. */
  titleTokens: InlineToken[];
  titleTags: TagReference[];
  sectionHeading?: string;
  /** The headings above the task, top down, tags stripped. */
  headingPath?: string[];
  fileName: string;
  /**
   * The due date as a row writes it, `Overdue 15 days · 2026-09-08`, worded
   * by the host so every list says it the same way. Open, dated tasks only.
   */
  dueLabel?: string;
  /** Whether the due date has passed; set with `dueLabel`. */
  overdue?: boolean;
  /**
   * An overdue date as a row under an Overdue heading says it, where the
   * word would only repeat the heading: `20 days late · 2026-09-01`.
   */
  dueLate?: string;
  /** Whether it passed so long ago the task needs a new date; drawn muted. */
  stale?: boolean;
  /** Whether it is due today, drawn in the theme's warning color, between the green of later and the red of overdue. */
  dueToday?: boolean;
  /** `2 of 5 steps · next: Draft the email`, for a task with steps. */
  stepsLabel?: string;
}

/**
 * One page of a search's results.
 *
 * A search page shows a page at a time rather than everything it found: a
 * search that matches a workspace would otherwise send, and draw, every note
 * on every save — megabytes of card text for the screenful anyone reads.
 * `total` is of the whole search, so every count on the page is of the search
 * and not of the page being shown.
 */
export interface ResultPaging {
  /** 1-based, clamped to the pages the search has. */
  page: number;
  /** How many results a page holds. */
  size: number;
  /** How many pages the results fill; at least one, even when empty. */
  pageCount: number;
  /** How many results the search found. */
  total: number;
}

/** One entry a search found, as its card draws it. */
export interface TagOverviewCard {
  id: string;
  filePath: string;
  heading: string;
  /** Listed on a tag's page because it links to the tag's hub note. */
  via?: 'hubLink';
  /** In a parked folder or under a parked tag: listed last, and said so. */
  parked?: true;
  /** Whether this entry is pinned to Home, so a menu says which it offers. */
  pinned?: boolean;
  titleTags: TagReference[];
  tags: TagReference[];
  rawContent: string;
  /** The body as block tokens, which a page draws as elements and text. */
  bodyTokens: BlockToken[];
  startLine: number;
  createdAt?: number;
  updatedAt?: number;
  accessCount: number;
  /** The headings down to this entry, top down, tags stripped. */
  headingPath?: string[];
  /**
   * The body from the paragraph holding the first searched word, when that
   * word sits below the three lines a card shows. `line` is its first line
   * in the note.
   */
  snippet?: { rawContent: string; bodyTokens: BlockToken[]; line: number };
  /** Whether the body runs past three lines, so a card offers Show all. */
  long?: boolean;
}

/** Asks the host to merge one of the tags that look alike into the other. */
export interface MergeTagsMessage {
  type: 'mergeTags';
  sourceKey: string;
  targetKey: string;
}

/**
 * The search a page is showing, as the sidebar's Refine view needs it.
 */
export interface SearchRefineState {
  /** Which page the search is on. */
  page: 'search' | 'taskBoard';
  /** The page's name, such as "Person: Sable Ortiz". */
  title: string;
  query: QueryViewState;
  /** What the page can find, so the counts name only those. */
  resultKinds: Array<'notes' | 'tasks'>;
}

/** Opens a note at a line. */
export interface OpenSourceMessage {
  type: 'openSource';
  filePath: string;
  line: number;
  /** Open beside the current editor rather than replacing it. */
  beside?: boolean;
  /** Keep the tab, from a double-click, rather than previewing in it. */
  pin?: boolean;
  /** Shift was held: open it where `deckard.openNotesIn` does not. */
  opposite?: boolean;
}

/** Checks or unchecks a task's box. */
export interface ToggleTaskMessage {
  type: 'toggleTask';
  taskId: string;
  completed: boolean;
}

/** Opens a search page on a search. */
export interface OpenSearchMessage {
  type: 'openSearch';
  query: string;
}

/** Pins the note at a line to Home, or unpins the pin a row names. */
export interface PinNoteMessage {
  type: 'pinNote' | 'unpinNote';
  filePath: string;
  /** The line whose entry is pinned; the whole note without one. */
  line?: number;
  /** Which pin to remove, as `pinKey` writes it. */
  pinKey?: string;
}

/** Opens a tag's page. */
export interface OpenTagMessage {
  type: 'openTag';
  tagKey: string;
}

/** Starts renaming a tag across the workspace. */
export interface RenameTagMessage {
  type: 'renameTag';
  tagKey: string;
}

/** Park Tag or Unpark Tag, from a tag's menu or a tag's page. */
export interface ParkTagMessage {
  type: 'parkTag' | 'unparkTag';
  tagKey: string;
}

/** Opens the Task Board, on a search when one is given. */
export interface OpenTaskBoardMessage {
  type: 'openTaskBoard';
  query?: string;
}

/** Opens the Help page. */
export interface OpenHelpMessage {
  type: 'openHelp';
}

/** Take everything a search found out, as Markdown or CSV. */
export interface ExportResultsMessage {
  type: 'exportResults';
  kind: 'notes' | 'tasks';
}

/** Opens Choose Theme…, from a page's gear. */
export interface ChooseThemeMessage {
  type: 'chooseTheme';
}

/** The gear's zen row, on every page that has a gear. */
export interface SetZenModeMessage {
  type: 'setZenMode';
  enabled: boolean;
}

/** Says the page has loaded and is ready for its state. */
export interface SidebarReadyMessage {
  type: 'ready';
}
