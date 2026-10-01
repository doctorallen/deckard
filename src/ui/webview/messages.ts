import { isObject } from '../../shared/guards';
import {
  PinNoteMessage,
  SidebarMessage,
  RelatedNotesSortMode,
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

/** Upper bound on query text accepted from the webview. */
const MAX_QUERY_LENGTH = 2000;

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
 * The sidebar Calendar's narrowing table, under the name Related Notes
 * reads a calendar day's messages with until it has a table of its own.
 */
export { narrowCalendarMessage as parseCalendarMessage } from './pages/calendar/messages';

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
