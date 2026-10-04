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
  OpenWikiLinkMessage,
} from '../../../protocol/notePage';
import {
  exactlyType,
  Narrower,
  narrowGoToPage,
  NarrowingTable,
  narrowOpenTag,
  narrowToggleTask,
  narrowWith,
  UncheckedMessage,
} from '../../host/narrowing';

/** The longest note path or link target the page sends. */
const MAX_NAME_LENGTH = 1000;

/** Whether a value is a line to open: a whole number from 1. */
function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** The two modifiers a click may carry, each only when on. */
function readModifiers(value: UncheckedMessage): { opposite?: true; beside?: true } | undefined {
  if ((value.opposite !== undefined && typeof value.opposite !== 'boolean') || (value.beside !== undefined && typeof value.beside !== 'boolean')) {
    return undefined;
  }
  return { ...(value.opposite === true ? { opposite: true } : {}), ...(value.beside === true ? { beside: true } : {}) };
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

/** Whether a value is a note path or a link target the page could send. */
function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

/** A `[[link]]` to follow: what it names, as written, and the note it is written in when that is an embedded one. */
const narrowOpenWikiLink: Narrower<OpenWikiLinkMessage> = (value) => {
  const modifiers = readModifiers(value);
  if (!modifiers || !isName(value.target) || (value.from !== undefined && !isName(value.from))) {
    return undefined;
  }
  return { type: 'openWikiLink', target: value.target, ...(isName(value.from) ? { from: value.from } : {}), ...modifiers };
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
  navigateNoteHistory: narrowNavigate,
  openSearch: narrowOpenSearch,
};

/** A message from the note page, narrowed by its table, or undefined. */
export const narrowNotePageMessage = narrowWith(NOTE_PAGE_MESSAGES);
