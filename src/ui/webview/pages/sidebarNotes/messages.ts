/**
 * The Related Notes sidebar's narrowing table: what each message it may
 * send must hold. The page only names what it lists, and the host still
 * checks each row a click names against what the sidebar would list now.
 */
import type { RelatedNotesSortMode } from '../../../../domain/model/preferences';
import type {
  ActivateNotesGraphNodeMessage,
  AddSuggestedTagMessage,
  CalendarDayMessage,
  HomeAddWidgetMessage,
  HoverNotesGraphNodeMessage,
  InsertLinkMessage,
  LinkMentionMessage,
  RefineActiveSearchMessage,
  SetHideDailyNotesMessage,
  SetRelatedNotesPreviewLinesMessage,
  SetRelatedNotesSortMessage,
  SidebarNotesPageToHost,
} from '../../../protocol/sidebarNotes';
import { narrowCalendarMessage } from '../calendar/messages';
import {
  isSourceLocation,
  MAX_QUERY_LENGTH,
  narrowAs,
  Narrower,
  NarrowingTable,
  narrowOpenSource,
  narrowOpenTag,
  narrowParkTag,
  narrowRenameTag,
  narrowWith,
  onlyType,
} from '../../host/narrowing';

/** The orders Related Notes can list its notes in. */
function isRelatedNotesSortMode(value: unknown): value is RelatedNotesSortMode {
  return value === 'newest' || value === 'oldest' || value === 'tags' || value === 'access';
}

/** A graph row: the node to select, and whether to open it too. */
const narrowActivateNotesGraphNode: Narrower<ActivateNotesGraphNodeMessage> = (value) =>
  typeof value.nodeId === 'string' && value.nodeId.length > 0 && typeof value.open === 'boolean'
    ? { type: 'activateNotesGraphNode', nodeId: value.nodeId, open: value.open }
    : undefined;

/** A graph row hovered, by its node, or none to clear the highlight. */
const narrowHoverNotesGraphNode: Narrower<HoverNotesGraphNodeMessage> = (value) => {
  if (value.nodeId === undefined) {
    return { type: 'hoverNotesGraphNode' };
  }
  return typeof value.nodeId === 'string' && value.nodeId.length > 0
    ? { type: 'hoverNotesGraphNode', nodeId: value.nodeId }
    : undefined;
};

/** Link on one mention: its line, and the column it starts at, from 0. */
const narrowLinkMention: Narrower<LinkMentionMessage> = (value) =>
  isSourceLocation(value) &&
  typeof value.startColumn === 'number' &&
  Number.isInteger(value.startColumn) &&
  value.startColumn >= 0
    ? { type: 'linkMention', filePath: value.filePath as string, line: value.line as number, startColumn: value.startColumn }
    : undefined;

/** A tag offered to an untagged note, by one non-empty key and nothing else. */
const narrowAddSuggestedTag: Narrower<AddSuggestedTagMessage> = (value) =>
  typeof value.tagKey === 'string' && value.tagKey.length > 0 && Object.keys(value).length === 2
    ? { type: 'addSuggestedTag', tagKey: value.tagKey }
    : undefined;

/** The gear's Preview: none, one, or two lines of each excerpt. */
const narrowSetRelatedNotesPreviewLines: Narrower<SetRelatedNotesPreviewLinesMessage> = (value) =>
  value.lines === 0 || value.lines === 1 || value.lines === 2
    ? { type: 'setRelatedNotesPreviewLines', lines: value.lines }
    : undefined;

/** The gear's Daily notes: hide them or show them. */
const narrowSetHideDailyNotes: Narrower<SetHideDailyNotesMessage> = (value) =>
  typeof value.hide === 'boolean' ? { type: 'setHideDailyNotes', hide: value.hide } : undefined;

/** Insert link on a related note: the note, by its first line. */
const narrowInsertLink: Narrower<InsertLinkMessage> = (value) =>
  isSourceLocation(value)
    ? { type: 'insertLink', filePath: value.filePath as string, line: value.line as number }
    : undefined;

/**
 * A Refine value: the facet, a clause no longer than a search may be, and
 * how it narrows the search.
 */
const narrowRefineActiveSearch: Narrower<RefineActiveSearchMessage> = (value) =>
  typeof value.facetId === 'string' &&
  typeof value.clause === 'string' &&
  value.clause.length > 0 &&
  value.clause.length <= MAX_QUERY_LENGTH &&
  (value.mode === 'and' || value.mode === 'exclude' || value.mode === 'or')
    ? { type: 'refineActiveSearch', facetId: value.facetId, clause: value.clause, mode: value.mode }
    : undefined;

/** The Sort select: one of the orders Related Notes can list in. */
const narrowSetRelatedNotesSort: Narrower<SetRelatedNotesSortMessage> = (value) =>
  isRelatedNotesSortMode(value.mode) ? { type: 'setRelatedNotesSort', mode: value.mode } : undefined;

/** Home's Customize: a widget to add, by its value; Home checks it is one it offers. */
const narrowHomeAddWidget: Narrower<HomeAddWidgetMessage> = (value) =>
  typeof value.value === 'string' ? { type: 'homeAddWidget', value: value.value } : undefined;

/**
 * The calendar day panel's message, narrowed as the Calendar narrows its
 * own, since the calendar page does it as its own panel would.
 */
const narrowCalendarDay: Narrower<CalendarDayMessage> = (value) => {
  const message = narrowCalendarMessage(value.message);
  return message ? { type: 'calendarDay', message } : undefined;
};

/** Each message the Related Notes sidebar may send, and what it must hold. */
export const SIDEBAR_NOTES_MESSAGES: NarrowingTable<SidebarNotesPageToHost> = {
  ready: onlyType('ready'),
  clearEntryRelatedNotes: onlyType('clearEntryRelatedNotes'),
  openSource: narrowOpenSource,
  activateNotesGraphNode: narrowActivateNotesGraphNode,
  hoverNotesGraphNode: narrowHoverNotesGraphNode,
  openTag: narrowOpenTag,
  linkMention: narrowLinkMention,
  linkAllMentions: onlyType('linkAllMentions'),
  openLinksSearch: onlyType('openLinksSearch'),
  addSuggestedTag: narrowAddSuggestedTag,
  setRelatedNotesPreviewLines: narrowSetRelatedNotesPreviewLines,
  setHideDailyNotes: narrowSetHideDailyNotes,
  insertLink: narrowInsertLink,
  renameTag: narrowRenameTag,
  parkTag: narrowAs('parkTag', narrowParkTag),
  unparkTag: narrowAs('unparkTag', narrowParkTag),
  refineActiveSearch: narrowRefineActiveSearch,
  setRelatedNotesSort: narrowSetRelatedNotesSort,
  openDashboard: onlyType('openDashboard'),
  openNotesGraph: onlyType('openNotesGraph'),
  openTaskBoard: onlyType('openTaskBoard'),
  createDailyNote: onlyType('createDailyNote'),
  openHelp: onlyType('openHelp'),
  homeAddWidget: narrowHomeAddWidget,
  homeResetWidgets: onlyType('homeResetWidgets'),
  calendarDay: narrowCalendarDay,
};

/** A message from the Related Notes sidebar, narrowed by its table, or undefined. */
export const narrowSidebarNotesMessage = narrowWith(SIDEBAR_NOTES_MESSAGES);
