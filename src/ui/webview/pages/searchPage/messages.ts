/**
 * A search page's narrowing table: what each message it may send must hold.
 * The page sends its navigation and its display choices; the host still
 * checks each tag, line, and task against the index as it is now.
 */
import { SEARCH_PAGE_SIZES, SearchPageSize } from '../../../../domain/model/preferences';
import type {
  EditResultsMessage,
  NavigateSearchHistoryMessage,
  ParkNoteMessage,
  PreviewSearchMessage,
  SaveTagOverviewFilterMessage,
  SearchPagePageToHost,
  SetOverviewQueryMessage,
  SetRenderModeMessage,
  SetResultPageMessage,
  SetResultsPerPageMessage,
  SetSearchColumnsMessage,
  SetSearchPreviewMessage,
  SetTagOverviewLayoutMessage,
  SetSearchHierarchyMessage,
  SetTagOverviewSortMessage,
} from '../../../protocol/searchPage';
import type { MergeTagsMessage } from '../../../protocol/shared';
import {
  exactlyType,
  MAX_QUERY_LENGTH,
  narrowAs,
  Narrower,
  narrowExportResults,
  narrowGoToPage,
  NarrowingTable,
  narrowOpenSource,
  narrowOpenTag,
  narrowParkTag,
  narrowPinNote,
  narrowRenameTag,
  narrowDisplayCommand,
  narrowSetDisplay,
  narrowSetZenMode,
  narrowToggleTask,
  narrowWith,
  onlyType,
} from '../../host/narrowing';

/**
 * What a page may send as the words being typed. A draft is a handful of
 * short words; anything longer is not one, whatever sent it.
 */
const MAX_PREVIEW_WORDS = 12;
const MAX_PREVIEW_WORD_LENGTH = 100;

/** The longest tag key a merge may name. */
const MAX_TAG_KEY_LENGTH = 500;

/** The longest path Park Note or Unpark Note may name. */
const MAX_FILE_PATH_LENGTH = 4096;

/**
 * A search to run, no longer than a search may be. Whether to remember it
 * among the recent searches is true unless the page says false.
 */
const narrowSetOverviewQuery: Narrower<SetOverviewQueryMessage> = (value) =>
  Object.keys(value).length <= 3 &&
  typeof value.query === 'string' &&
  value.query.length <= MAX_QUERY_LENGTH &&
  (value.remember === undefined || typeof value.remember === 'boolean')
    ? { type: 'setOverviewQuery', query: value.query, remember: value.remember !== false }
    : undefined;

/** A search to keep under a name, as the box holds it: no longer than a search may be, and nothing else. */
const narrowSaveTagOverviewFilter: Narrower<SaveTagOverviewFilterMessage> = (value) =>
  Object.keys(value).length === 2 && typeof value.query === 'string' && value.query.length <= MAX_QUERY_LENGTH
    ? { type: 'saveTagOverviewFilter', query: value.query }
    : undefined;

/** A step back or forward through the searches the page has shown, and nothing else. */
const narrowNavigateSearchHistory: Narrower<NavigateSearchHistoryMessage> = (value) =>
  Object.keys(value).length === 2 && (value.direction === 'back' || value.direction === 'forward')
    ? { type: 'navigateSearchHistory', direction: value.direction }
    : undefined;

/**
 * A page of notes or of tasks to turn to: a whole number from 1, whatever a
 * page that had been tampered with might ask for.
 */
const narrowSetResultPage: Narrower<SetResultPageMessage> = (value) =>
  (value.kind === 'notes' || value.kind === 'tasks') &&
  typeof value.page === 'number' &&
  Number.isInteger(value.page) &&
  value.page >= 1
    ? { type: 'setResultPage', kind: value.kind, page: value.page }
    : undefined;

/** The words being typed: a handful, each short and not empty. */
const narrowPreviewSearch: Narrower<PreviewSearchMessage> = (value) =>
  Array.isArray(value.words) &&
  value.words.length <= MAX_PREVIEW_WORDS &&
  value.words.every(
    (word) => typeof word === 'string' && word.length > 0 && word.length <= MAX_PREVIEW_WORD_LENGTH,
  )
    ? { type: 'previewSearch', words: value.words as string[] }
    : undefined;

/** One of the page sizes the page offers. */
const narrowSetResultsPerPage: Narrower<SetResultsPerPageMessage> = (value) =>
  (SEARCH_PAGE_SIZES as readonly unknown[]).includes(value.size)
    ? { type: 'setResultsPerPage', size: value.size as SearchPageSize }
    : undefined;

/** Edit every note or every task the search found. */
const narrowEditResults: Narrower<EditResultsMessage> = (value) =>
  value.kind === 'notes' || value.kind === 'tasks' ? { type: 'editResults', kind: value.kind } : undefined;

/** Note bodies rendered or as source. */
const narrowSetRenderMode: Narrower<SetRenderModeMessage> = (value) =>
  value.mode === 'markdown' || value.mode === 'html' ? { type: 'setRenderMode', mode: value.mode } : undefined;

/** The results grouped under Refine's tags, or not. */
const narrowSetSearchHierarchy: Narrower<SetSearchHierarchyMessage> = (value) =>
  value.hierarchy === 'off' || value.hierarchy === 'tags'
    ? { type: 'setSearchHierarchy', hierarchy: value.hierarchy }
    : undefined;

/** How much of each result to show. */
const narrowSetSearchPreview: Narrower<SetSearchPreviewMessage> = (value) =>
  value.preview === 'none' || value.preview === 'lines' || value.preview === 'full'
    ? { type: 'setSearchPreview', preview: value.preview }
    : undefined;

/** One of the orders a search page sorts its notes in, apart from Home's tag orders. */
const narrowSetTagOverviewSort: Narrower<SetTagOverviewSortMessage> = (value) =>
  value.mode === 'alphabetical' || value.mode === 'created' || value.mode === 'updated' || value.mode === 'access'
    ? { type: 'setTagOverviewSort', mode: value.mode }
    : undefined;

/** Notes and tasks as tabs or side by side. */
const narrowSetTagOverviewLayout: Narrower<SetTagOverviewLayoutMessage> = (value) =>
  value.layout === 'tabs' || value.layout === 'split'
    ? { type: 'setTagOverviewLayout', layout: value.layout }
    : undefined;

/** From one to four columns, for the notes or the tasks. */
const narrowSetSearchColumns: Narrower<SetSearchColumnsMessage> = (value) =>
  (value.section === 'notes' || value.section === 'tasks') &&
  (value.columns === 1 || value.columns === 2 || value.columns === 3 || value.columns === 4)
    ? { type: 'setSearchColumns', section: value.section, columns: value.columns }
    : undefined;

/**
 * Park Note or Unpark Note, for one path of a sensible length and nothing
 * else.
 */
function narrowParkNote<T extends ParkNoteMessage['type']>(type: T): Narrower<ParkNoteMessage & { type: T }> {
  return (value) =>
    typeof value.filePath === 'string' &&
    value.filePath.length > 0 &&
    value.filePath.length <= MAX_FILE_PATH_LENGTH &&
    Object.keys(value).length === 2
      ? { type, filePath: value.filePath }
      : undefined;
}

/** A tag that looks like the page's, merged one into the other: two different keys. */
const narrowMergeTags: Narrower<MergeTagsMessage> = (value) =>
  typeof value.sourceKey === 'string' &&
  value.sourceKey.length > 0 &&
  value.sourceKey.length <= MAX_TAG_KEY_LENGTH &&
  typeof value.targetKey === 'string' &&
  value.targetKey.length > 0 &&
  value.targetKey.length <= MAX_TAG_KEY_LENGTH &&
  value.sourceKey !== value.targetKey
    ? { type: 'mergeTags', sourceKey: value.sourceKey, targetKey: value.targetKey }
    : undefined;

/** Each message a search page may send, and what it must hold. */
export const SEARCH_PAGE_MESSAGES: NarrowingTable<SearchPagePageToHost> = {
  exportResults: narrowExportResults,
  setZenMode: narrowSetZenMode,
  setDisplay: narrowSetDisplay,
  displayCommand: narrowDisplayCommand,
  chooseTheme: onlyType('chooseTheme'),
  openSource: narrowOpenSource,
  previewSearch: narrowPreviewSearch,
  setResultsPerPage: narrowSetResultsPerPage,
  pinNote: narrowAs('pinNote', narrowPinNote),
  unpinNote: narrowAs('unpinNote', narrowPinNote),
  editResults: narrowEditResults,
  setResultPage: narrowSetResultPage,
  toggleTask: narrowToggleTask,
  setRenderMode: narrowSetRenderMode,
  setSearchPreview: narrowSetSearchPreview,
  setSearchHierarchy: narrowSetSearchHierarchy,
  setTagOverviewSort: narrowSetTagOverviewSort,
  setTagOverviewLayout: narrowSetTagOverviewLayout,
  setSearchColumns: narrowSetSearchColumns,
  openTag: narrowOpenTag,
  renameTag: narrowRenameTag,
  parkTag: narrowAs('parkTag', narrowParkTag),
  unparkTag: narrowAs('unparkTag', narrowParkTag),
  parkNote: narrowParkNote('parkNote'),
  unparkNote: narrowParkNote('unparkNote'),
  mergeTags: narrowMergeTags,
  saveTagOverviewFilter: narrowSaveTagOverviewFilter,
  createHubNote: exactlyType('createHubNote'),
  excludeHubLinks: exactlyType('excludeHubLinks'),
  clearOverviewQuery: exactlyType('clearOverviewQuery'),
  openHelp: exactlyType('openHelp'),
  openGoTo: exactlyType('openGoTo'),
  listGoTo: exactlyType('listGoTo'),
  goToPage: narrowGoToPage,
  navigateSearchHistory: narrowNavigateSearchHistory,
  setOverviewQuery: narrowSetOverviewQuery,
};

/** A message from a search page, narrowed by its table, or undefined. */
export const narrowSearchPageMessage = narrowWith(SEARCH_PAGE_MESSAGES);
