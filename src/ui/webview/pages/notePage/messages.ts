/**
 * The note page's narrowing table: what each message it may send must
 * hold. The page only opens what it draws, and the host still checks each
 * note, link, tag, and task against the index as it is now.
 */
import type {
  NavigateNoteHistoryMessage,
  NotePagePageToHost,
  OpenInEditorMessage,
  OpenNoteMessage,
  OpenSearchMessage,
  RunNoteActionMessage,
} from '../../../protocol/notePage';
import { NOTE_ACTIONS } from '../../../commands/noteActionTable';
import {
  exactlyType,
  MAX_NAME_LENGTH,
  Narrower,
  narrowGoToPage,
  NarrowingTable,
  narrowOpenTag,
  narrowOpenWikiLink,
  narrowSetDisplay,
  narrowSetZenMode,
  narrowToggleTask,
  narrowWith,
  onlyType,
  readModifiers,
} from '../../host/narrowing';

/** Whether a value is a line to open: a whole number from 1. */
function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** A note to open: its path, a line when given, and the modifiers. */
const narrowOpenNote: Narrower<OpenNoteMessage> = (value) => {
  const modifiers = readModifiers(value);
  if (!modifiers || typeof value.filePath !== 'string' || !value.filePath || value.filePath.length > MAX_NAME_LENGTH) {
    return undefined;
  }
  if (value.line !== undefined && !isLine(value.line)) {
    return undefined;
  }
  return { type: 'openNote', filePath: value.filePath, ...(isLine(value.line) ? { line: value.line } : {}), ...modifiers };
};

/** Open in Editor: at a line when given, beside when asked. */
const narrowOpenInEditor: Narrower<OpenInEditorMessage> = (value) => {
  if ((value.line !== undefined && !isLine(value.line)) || (value.beside !== undefined && typeof value.beside !== 'boolean')) {
    return undefined;
  }
  return { type: 'openInEditor', ...(isLine(value.line) ? { line: value.line } : {}), ...(value.beside === true ? { beside: true } : {}) };
};

/** Back or Forward. */
const narrowNavigate: Narrower<NavigateNoteHistoryMessage> = (value) =>
  value.direction === 'back' || value.direction === 'forward' ? { type: 'navigateNoteHistory', direction: value.direction } : undefined;

/** A progress line's search: its text, as the page drew it, which the host checks against the note shown. */
const narrowOpenSearch: Narrower<OpenSearchMessage> = (value) =>
  typeof value.query === 'string' && value.query.length > 0 && value.query.length <= 2 * MAX_NAME_LENGTH
    ? { type: 'openSearch', query: value.query }
    : undefined;

/** One of ⋯'s note actions: a command the table lists for the note page, and no other. */
const narrowRunNoteAction: Narrower<RunNoteActionMessage> = (value) =>
  NOTE_ACTIONS.some((action) => action.page && action.command === value.command)
    ? { type: 'runNoteAction', command: value.command as string }
    : undefined;

/** Each message the note page may send, and what it must hold. */
export const NOTE_PAGE_MESSAGES: NarrowingTable<NotePagePageToHost> = {
  openNote: narrowOpenNote,
  openWikiLink: narrowOpenWikiLink,
  openInEditor: narrowOpenInEditor,
  openTag: narrowOpenTag,
  toggleTask: narrowToggleTask,
  openGoTo: exactlyType('openGoTo'),
  listGoTo: exactlyType('listGoTo'),
  goToPage: narrowGoToPage,
  setZenMode: narrowSetZenMode,
  setDisplay: narrowSetDisplay,
  chooseTheme: onlyType('chooseTheme'),
  openHelp: exactlyType('openHelp'),
  navigateNoteHistory: narrowNavigate,
  openSearch: narrowOpenSearch,
  runNoteAction: narrowRunNoteAction,
};

/** A message from the note page, narrowed by its table, or undefined. */
export const narrowNotePageMessage = narrowWith(NOTE_PAGE_MESSAGES);
