/**
 * The Stats page's narrowing table: what each message it may send must
 * hold. The page only opens what it lists, and the host still checks each
 * tag and line against the index as it is now.
 */
import type { MergeTagsMessage } from '../../../protocol/shared';
import type {
  CreateMissingNotesMessage,
  MergeTagIntoMessage,
  OpenStatsNotesGraphMessage,
  OpenTagListMessage,
  StatsPageToHost,
} from '../../../protocol/stats';
import {
  exactlyType,
  Narrower,
  NarrowingTable,
  narrowOpenSearch,
  narrowOpenSource,
  narrowOpenTag,
  narrowWith,
} from '../../host/narrowing';

/** The most names one Create all may carry. */
const MAX_MISSING_NOTE_NAMES = 500;

/** The longest tag key or note name Stats sends. */
const MAX_NAME_LENGTH = 500;

/** A count of entries a tag-use band starts or ends at: a whole number from 1. */
function isCount(count: unknown): count is number {
  return typeof count === 'number' && Number.isInteger(count) && count >= 1;
}

/**
 * A Tags total, or a band of the tag-use bars: whether to list namespaced
 * tags only, and the band's counts when given. A band has a start; its end
 * is no smaller than its start.
 */
const narrowOpenTagList: Narrower<OpenTagListMessage> = (value) => {
  if (typeof value.namespaced !== 'boolean') {
    return undefined;
  }
  if (value.min !== undefined && !isCount(value.min)) {
    return undefined;
  }
  if (value.max !== undefined && (!isCount(value.max) || !isCount(value.min) || value.max < value.min)) {
    return undefined;
  }
  return {
    type: 'openTagList',
    namespaced: value.namespaced,
    ...(isCount(value.min) ? { min: value.min } : {}),
    ...(isCount(value.max) ? { max: value.max } : {}),
  };
};

/** A pair that looks alike, merged one into the other: two different keys. */
const narrowMergeTags: Narrower<MergeTagsMessage> = (value) =>
  typeof value.sourceKey === 'string' &&
  value.sourceKey.length > 0 &&
  typeof value.targetKey === 'string' &&
  value.targetKey.length > 0 &&
  value.sourceKey !== value.targetKey
    ? { type: 'mergeTags', sourceKey: value.sourceKey, targetKey: value.targetKey }
    : undefined;

/** A tag used once, to merge into one the reader chooses. */
const narrowMergeTagInto: Narrower<MergeTagIntoMessage> = (value) =>
  typeof value.sourceKey === 'string' && value.sourceKey.length > 0 && value.sourceKey.length <= MAX_NAME_LENGTH
    ? { type: 'mergeTagInto', sourceKey: value.sourceKey }
    : undefined;

/** The Wiki links total, which opens the graph on the links written. */
const narrowOpenNotesGraph: Narrower<OpenStatsNotesGraphMessage> = (value) =>
  value.onlyWrittenLinks === true ? { type: 'openNotesGraph', onlyWrittenLinks: true } : undefined;

/** Create or Create all: the names to make notes for, or none for every one. */
const narrowCreateMissingNotes: Narrower<CreateMissingNotesMessage> = (value) =>
  Array.isArray(value.names) &&
  value.names.length <= MAX_MISSING_NOTE_NAMES &&
  value.names.every((name) => typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH)
    ? { type: 'createMissingNotes', names: value.names as string[] }
    : undefined;

/** Each message the Stats page may send, and what it must hold. */
export const STATS_MESSAGES: NarrowingTable<StatsPageToHost> = {
  openTag: narrowOpenTag,
  openSource: narrowOpenSource,
  openSearch: narrowOpenSearch,
  mergeTags: narrowMergeTags,
  reindexWorkspace: exactlyType('reindexWorkspace'),
  openGoTo: exactlyType('openGoTo'),
  openTagList: narrowOpenTagList,
  mergeTagInto: narrowMergeTagInto,
  openNotesGraph: narrowOpenNotesGraph,
  createMissingNotes: narrowCreateMissingNotes,
};

/** A message from the Stats page, narrowed by its table, or undefined. */
export const narrowStatsMessage = narrowWith(STATS_MESSAGES);
