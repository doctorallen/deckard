/**
 * The Dashboard's narrowing table: what each message Home and the Tags tab
 * may send must hold. The host still checks each tag, line, and saved search
 * a message names against the index and preferences as they are now.
 */
import type { DashboardMode, DashboardSearchField, TagSortMode } from '../../../../domain/model/preferences';
import { QUICK_ADD_MAX_LENGTH } from '../../../../domain/dashboard/widgetCatalog';
import { isObject } from '../../../../shared/guards';
import type {
  AddNextActionMessage,
  CreateTagHubMessage,
  DashboardPageToHost,
  DashboardWidgetChoicesMessage,
  OpenDeckardViewMessage,
  OpenNoteMessage,
  QuickAddMessage,
  RecordRecentQueryMessage,
  ReorderEntitiesMessage,
  ReorderTagsMessage,
  SetDashboardColumnsMessage,
  SetDashboardModeMessage,
  SetDashboardSearchMessage,
  SetDashboardWidgetsMessage,
  SetEntitySortMessage,
  SetTagSortMessage,
  ToggleFavoriteEntityMessage,
  ToggleFavoriteMessage,
  TryNextMessage,
} from '../../../protocol/dashboard';
import type { OpenTaskBoardMessage } from '../../../protocol/shared';
import {
  isStringArray,
  MAX_QUERY_LENGTH,
  narrowAs,
  Narrower,
  NarrowingTable,
  narrowOpenSearch,
  narrowOpenSource,
  narrowOpenTag,
  narrowParkTag,
  narrowPinNote,
  narrowRenameTag,
  narrowSetZenMode,
  narrowToggleTask,
  narrowWith,
  onlyType,
} from '../../host/narrowing';
import { normalizeDashboardWidgets } from '../../../../core/storage/preferencesSchema';

/** More widgets than Home keeps are refused rather than cut short. */
const MAX_DASHBOARD_WIDGETS = 60;

/** The most widgets + Add widget may offer. */
const MAX_WIDGET_CHOICES = 200;

/** The longest Try next key the page may send back. */
const MAX_TRY_NEXT_KEY_LENGTH = 1000;

/** The longest tag key a next action may be asked for. */
const MAX_NEXT_ACTION_TAG_LENGTH = 200;

/**
 * Keeps tag sorting an explicit allow-list instead of accepting arbitrary UI data.
 */
function isTagSortMode(value: unknown): value is TagSortMode {
  return value === 'alphabetical' || value === 'count' || value === 'access' || value === 'custom';
}

/** Home or the Tags tab. */
function isDashboardMode(value: unknown): value is DashboardMode {
  return value === 'home' || value === 'browse';
}

/** The one list whose search box the Dashboard keeps: its tags. */
function isDashboardSearchField(value: unknown): value is DashboardSearchField {
  return value === 'tags';
}

/** How many columns the Tags tab may lay its tags out in. */
function isDashboardColumnCount(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** A tag's heart, by any key; the host checks the index has it. */
const narrowToggleFavorite: Narrower<ToggleFavoriteMessage> = (value) =>
  typeof value.tagKey === 'string' ? { type: 'toggleFavorite', tagKey: value.tagKey } : undefined;

/** An entity's heart, by any key; the host checks the index has it. */
const narrowToggleFavoriteEntity: Narrower<ToggleFavoriteEntityMessage> = (value) =>
  typeof value.entityKey === 'string' ? { type: 'toggleFavoriteEntity', entityKey: value.entityKey } : undefined;

/** How the Tags tab orders its tags. */
const narrowSetTagSort: Narrower<SetTagSortMessage> = (value) =>
  isTagSortMode(value.mode) ? { type: 'setTagSort', mode: value.mode } : undefined;

/** How the Tags tab orders its entities. */
const narrowSetEntitySort: Narrower<SetEntitySortMessage> = (value) =>
  isTagSortMode(value.mode) ? { type: 'setEntitySort', mode: value.mode } : undefined;

/** Home or the Tags tab. */
const narrowSetDashboardMode: Narrower<SetDashboardModeMessage> = (value) =>
  isDashboardMode(value.mode) ? { type: 'setDashboardMode', mode: value.mode } : undefined;

/** What is typed in the Tags tab's search box. */
const narrowSetDashboardSearch: Narrower<SetDashboardSearchMessage> = (value) =>
  isDashboardSearchField(value.field) && typeof value.query === 'string'
    ? { type: 'setDashboardSearch', field: value.field, query: value.query }
    : undefined;

/** The Tags tab's grid, from one to four columns. */
const narrowSetDashboardColumns: Narrower<SetDashboardColumnsMessage> = (value) =>
  value.section === 'tags' && isDashboardColumnCount(value.columns)
    ? { type: 'setDashboardColumns', section: 'tags', columns: value.columns }
    : undefined;

/** The order tags were dragged into, and whether the dragged one is a favorite. */
const narrowReorderTags: Narrower<ReorderTagsMessage> = (value) =>
  isStringArray(value.tagKeys) && typeof value.tagKey === 'string' && typeof value.isFavorite === 'boolean'
    ? { type: 'reorderTags', tagKeys: value.tagKeys, tagKey: value.tagKey, isFavorite: value.isFavorite }
    : undefined;

/** The order entities were dragged into. */
const narrowReorderEntities: Narrower<ReorderEntitiesMessage> = (value) =>
  isStringArray(value.entityKeys) ? { type: 'reorderEntities', entityKeys: value.entityKeys } : undefined;

/**
 * A saved search, by its id and nothing else. A message that carries more,
 * such as tags of its own, is refused rather than trusted: the host reads
 * the search from what it saved.
 */
function narrowSavedFilter<T extends 'openSavedFilter' | 'removeSavedFilter' | 'addSavedSearchWidget'>(
  type: T,
): Narrower<{ type: T; filterId: string }> {
  return (value) =>
    Object.keys(value).length === 2 && typeof value.filterId === 'string' && value.filterId.length > 0
      ? { type, filterId: value.filterId }
      : undefined;
}

/** A search that was run, no longer than a search may be. */
const narrowRecordRecentQuery: Narrower<RecordRecentQueryMessage> = (value) =>
  typeof value.query === 'string' && value.query.length <= MAX_QUERY_LENGTH
    ? { type: 'recordRecentQuery', query: value.query }
    : undefined;

/** Home's widgets, in order, each kept only as far as it is a widget Home knows. */
const narrowSetDashboardWidgets: Narrower<SetDashboardWidgetsMessage> = (value) =>
  Array.isArray(value.widgets) && value.widgets.length <= MAX_DASHBOARD_WIDGETS
    ? { type: 'setDashboardWidgets', widgets: normalizeDashboardWidgets(value.widgets) }
    : undefined;

/** What + Add widget offers, each choice with a value and a label. */
const narrowWidgetChoices: Narrower<DashboardWidgetChoicesMessage> = (value) =>
  Array.isArray(value.choices) &&
  value.choices.length <= MAX_WIDGET_CHOICES &&
  value.choices.every(
    (choice) =>
      isObject(choice) &&
      typeof choice.value === 'string' &&
      typeof choice.label === 'string' &&
      (choice.description === undefined || typeof choice.description === 'string'),
  )
    ? {
        type: 'widgetChoices',
        choices: (value.choices as Array<Record<string, string>>).map((choice) => ({
          value: choice.value,
          label: choice.label,
          ...(choice.description ? { description: choice.description } : {}),
        })),
      }
    : undefined;

/** Try next's suggestion, named by the key the host gave it. */
function narrowTryNext<T extends TryNextMessage['type']>(type: T): Narrower<TryNextMessage & { type: T }> {
  return (value) =>
    typeof value.key === 'string' && value.key.length > 0 && value.key.length <= MAX_TRY_NEXT_KEY_LENGTH
      ? { type, key: value.key }
      : undefined;
}

/** The Task Board, with a search no longer than a search may be, or none. */
const narrowOpenTaskBoard: Narrower<OpenTaskBoardMessage> = (value) =>
  value.query === undefined || (typeof value.query === 'string' && value.query.length <= MAX_QUERY_LENGTH)
    ? { type: 'openTaskBoard', ...(typeof value.query === 'string' ? { query: value.query } : {}) }
    : undefined;

/** One of the Deckard views Home links to. */
const narrowOpenView: Narrower<OpenDeckardViewMessage> = (value) =>
  value.view === 'agenda' ||
  value.view === 'stats' ||
  value.view === 'sampleWorkspace' ||
  value.view === 'checkSetup' ||
  value.view === 'walkthrough'
    ? { type: 'openView', view: value.view }
    : undefined;

/** A task to add to today's note: one line, with something on it, no longer than its field takes. */
const narrowQuickAdd: Narrower<QuickAddMessage> = (value) =>
  typeof value.text === 'string' &&
  value.text.trim().length > 0 &&
  value.text.length <= QUICK_ADD_MAX_LENGTH &&
  !/[\r\n]/.test(value.text)
    ? { type: 'quickAdd', text: value.text }
    : undefined;

/** A tag's hub note to make, by any non-empty key. */
const narrowCreateTagHub: Narrower<CreateTagHubMessage> = (value) =>
  typeof value.tagKey === 'string' && value.tagKey.length > 0 ? { type: 'createTagHub', tagKey: value.tagKey } : undefined;

/** A tag to capture a next action for. */
const narrowAddNextAction: Narrower<AddNextActionMessage> = (value) =>
  typeof value.tagKey === 'string' && value.tagKey.length > 0 && value.tagKey.length <= MAX_NEXT_ACTION_TAG_LENGTH
    ? { type: 'addNextAction', tagKey: value.tagKey }
    : undefined;

/** A note to open at its top. */
const narrowOpenNote: Narrower<OpenNoteMessage> = (value) =>
  typeof value.filePath === 'string' && value.filePath.length > 0
    ? { type: 'openNote', filePath: value.filePath, ...(value.opposite === true ? { opposite: true } : {}) }
    : undefined;

/** Each message the Dashboard may send, and what it must hold. */
export const DASHBOARD_MESSAGES: NarrowingTable<DashboardPageToHost> = {
  setZenMode: narrowSetZenMode,
  chooseTheme: onlyType('chooseTheme'),
  openSource: narrowOpenSource,
  toggleTask: narrowToggleTask,
  toggleFavorite: narrowToggleFavorite,
  toggleFavoriteEntity: narrowToggleFavoriteEntity,
  setTagSort: narrowSetTagSort,
  setEntitySort: narrowSetEntitySort,
  setDashboardMode: narrowSetDashboardMode,
  setDashboardSearch: narrowSetDashboardSearch,
  setDashboardColumns: narrowSetDashboardColumns,
  reorderTags: narrowReorderTags,
  reorderEntities: narrowReorderEntities,
  openTag: narrowOpenTag,
  renameTag: narrowRenameTag,
  parkTag: narrowAs('parkTag', narrowParkTag),
  unparkTag: narrowAs('unparkTag', narrowParkTag),
  openSavedFilter: narrowSavedFilter('openSavedFilter'),
  removeSavedFilter: narrowSavedFilter('removeSavedFilter'),
  addSavedSearchWidget: narrowSavedFilter('addSavedSearchWidget'),
  recordRecentQuery: narrowRecordRecentQuery,
  setDashboardWidgets: narrowSetDashboardWidgets,
  resetDashboardWidgets: onlyType('resetDashboardWidgets'),
  widgetChoices: narrowWidgetChoices,
  openWhatsNew: onlyType('openWhatsNew'),
  dismissWhatsNew: onlyType('dismissWhatsNew'),
  runTryNext: narrowTryNext('runTryNext'),
  snoozeTryNext: narrowTryNext('snoozeTryNext'),
  retireTryNext: narrowTryNext('retireTryNext'),
  openSearch: narrowOpenSearch,
  openTaskBoard: narrowOpenTaskBoard,
  openView: narrowOpenView,
  openDailyNote: onlyType('openDailyNote'),
  quickAdd: narrowQuickAdd,
  createTagHub: narrowCreateTagHub,
  addNextAction: narrowAddNextAction,
  openNote: narrowOpenNote,
  pinNote: narrowAs('pinNote', narrowPinNote),
  unpinNote: narrowAs('unpinNote', narrowPinNote),
};

/** A message from the Dashboard, narrowed by its table, or undefined. */
export const narrowDashboardMessage = narrowWith(DASHBOARD_MESSAGES);
