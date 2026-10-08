/**
 * What can be done with a note, in one table and one order, which three
 * places list: Note Actions (the Deckard button in a note's title bar), the
 * editor's right-click Deckard submenu, and the note page's ⋯. Each lists
 * the rows it can act on: the submenu every row VS Code's context keys can
 * tell apart, Note Actions the rows that fit where the cursor is, and the
 * note page only those that make sense outside the editor.
 *
 * The submenu is written in package.json, which cannot read this table; a
 * test holds the two to the same rows in the same order, with the same
 * titles as the commands.
 *
 * No `vscode` here, so the table is read by the tests without VS Code.
 */

/** When a row is listed, by where the cursor is and what the note is. */
export type NoteActionWhen =
  | 'onTaskLine'
  | 'underHeading'
  | 'pinned'
  | 'notPinned'
  | 'parked'
  | 'notParked';

/**
 * How the note page runs a row for the note it shows: with no argument,
 * the note's path, its URI, or its URI as text with its first line, as a
 * hover pins an entry.
 */
export type NotePageArgument = 'none' | 'filePath' | 'uri' | 'uriText';

/** One row: its command, its title, the codicon Note Actions draws it with, and its submenu group. */
export interface NoteAction {
  readonly command: string;
  /** The command's own title, as the submenu shows it. */
  readonly title: string;
  readonly icon: string;
  /** The submenu's group, which a separator ends. */
  readonly group: '1_task' | '2_heading' | '3_note' | '4_keep';
  readonly when?: NoteActionWhen;
  /** Set for a row the note page's ⋯ lists, and how it runs it there. */
  readonly page?: NotePageArgument;
}

/** Every row, in the one order: the task, the heading, the note, then keeping it. */
export const NOTE_ACTIONS: readonly NoteAction[] = [
  { command: 'deckard.toggleTaskDone', title: 'Toggle Task Done', icon: 'check', group: '1_task', when: 'onTaskLine' },
  { command: 'deckard.editTask', title: 'Edit Task', icon: 'edit', group: '1_task', when: 'onTaskLine' },
  { command: 'deckard.setTaskStatus', title: 'Set Task Status…', icon: 'circle-large-outline', group: '1_task', when: 'onTaskLine' },
  { command: 'deckard.breakIntoSteps', title: 'Break into Steps…', icon: 'list-ordered', group: '1_task', when: 'onTaskLine' },
  { command: 'deckard.addTask', title: 'Add Task', icon: 'add', group: '1_task' },
  { command: 'deckard.renameHeading', title: 'Rename Heading', icon: 'symbol-text', group: '2_heading', when: 'underHeading' },
  { command: 'deckard.extractHeading', title: 'Extract Heading', icon: 'export', group: '2_heading', when: 'underHeading' },
  { command: 'deckard.linkCurrentHeading', title: 'Tag Heading with a Person or Project…', icon: 'person', group: '2_heading', when: 'underHeading' },
  { command: 'deckard.focusSection', title: 'Focus Section', icon: 'target', group: '2_heading', when: 'underHeading' },
  { command: 'deckard.openNotePage', title: 'Open Note as Page', icon: 'preview', group: '3_note' },
  { command: 'deckard.openRelatedNotes', title: 'Open Related Notes', icon: 'references', group: '3_note', page: 'none' },
  { command: 'deckard.showNotesGraphAroundNote', title: 'Open Notes Graph Around This Note', icon: 'type-hierarchy', group: '3_note', page: 'filePath' },
  { command: 'deckard.moveTo', title: 'Move to…', icon: 'arrow-right', group: '3_note' },
  { command: 'deckard.copyAsPlainMarkdown', title: 'Copy as Plain Markdown', icon: 'copy', group: '3_note' },
  { command: 'deckard.moveTagsToFrontmatter', title: 'Move Inline Tags to Front Matter', icon: 'tag', group: '3_note' },
  { command: 'deckard.pinNote', title: 'Pin Note to Home', icon: 'pin', group: '4_keep', when: 'notPinned', page: 'uriText' },
  { command: 'deckard.unpinNote', title: 'Unpin Note from Home', icon: 'pinned', group: '4_keep', when: 'pinned', page: 'uriText' },
  { command: 'deckard.parkNote', title: 'Park Note', icon: 'archive', group: '4_keep', when: 'notParked', page: 'uri' },
  { command: 'deckard.unparkNote', title: 'Unpark Note', icon: 'inbox', group: '4_keep', when: 'parked', page: 'uri' },
];

/** What decides the rows: where the cursor is, and whether the note is pinned or parked. */
export interface NoteActionFacts {
  readonly onTaskLine: boolean;
  readonly underHeading: boolean;
  readonly pinned: boolean;
  readonly parked: boolean;
}

/** Whether a row's condition holds. */
export function noteActionApplies(when: NoteActionWhen | undefined, facts: NoteActionFacts): boolean {
  switch (when) {
    case undefined:
      return true;
    case 'onTaskLine':
      return facts.onTaskLine;
    case 'underHeading':
      return facts.underHeading;
    case 'pinned':
      return facts.pinned;
    case 'notPinned':
      return !facts.pinned;
    case 'parked':
      return facts.parked;
    case 'notParked':
      return !facts.parked;
  }
}

/**
 * The `when` clause the submenu gives a row: the context keys VS Code
 * keeps for the cursor's line and the note. No key says whether the cursor
 * is under a heading, so the heading's rows are always listed there, and
 * each says so when there is none.
 */
export function noteActionMenuWhen(when: NoteActionWhen | undefined): string | undefined {
  switch (when) {
    case 'onTaskLine':
      return 'deckard.onTaskLine';
    case 'pinned':
      return 'deckard.activeNotePinned';
    case 'notPinned':
      return '!deckard.activeNotePinned';
    case 'parked':
      return 'deckard.activeNoteParked';
    case 'notParked':
      return '!deckard.activeNoteParked';
    case 'underHeading':
    case undefined:
      return undefined;
  }
}

/** The rows the note page's ⋯ lists for a note, in the table's order. */
export function notePageActions(facts: Pick<NoteActionFacts, 'pinned' | 'parked'>): NoteAction[] {
  const outside: NoteActionFacts = { onTaskLine: false, underHeading: false, ...facts };
  return NOTE_ACTIONS.filter((action) => action.page && noteActionApplies(action.when, outside));
}
