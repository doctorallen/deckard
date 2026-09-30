/**
 * The Stats page's protocol: the workspace's totals and trends, the lists
 * that need attention, and the messages the page sends.
 */
import type { UnreadableNote } from '../../domain/model/workspaceIndex';
import type {
  MergeTagsMessage,
  OpenSearchMessage,
  OpenSourceMessage,
  OpenTagMessage,
} from './shared';

/** A tag, entity, or entry the Stats page lists by how often it was opened. */
export interface StatsAccessItem {
  label: string;
  detail: string;
  count: number;
  /** The message that opens the item: its tag overview or its source line. */
  open: OpenTagMessage | OpenSourceMessage;
}

/**
 * Why two tags look like two spellings of one idea, most confusable first:
 * the same name written with a different marker or under a different
 * namespace, punctuated differently, pluralized, or simply mistyped.
 */
export type TagMergeReason =
  | 'marker'
  | 'namespace'
  | 'separator'
  | 'plural'
  | 'spelling';

/** Two tags that look alike, and what merging them would spend and keep. */
export interface TagMergeCandidate {
  /** The tag with fewer entries, which a merge spends. */
  sourceKey: string;
  sourceLabel: string;
  sourceCount: number;
  /** The tag a merge keeps. */
  targetKey: string;
  targetLabel: string;
  targetCount: number;
  reason: TagMergeReason;
  /** Why the pair was picked, as the row reads it. */
  detail: string;
}

/** A note the Stats page lists by name, which opens at its first line. */
export interface StatsNoteItem {
  label: string;
  detail: string;
  open: OpenSourceMessage;
}

/** An unreadable note as Stats lists it: the note, why, and what opens it. */
export interface StatsUnreadableItem extends UnreadableNote {
  open: OpenSourceMessage;
}

/**
 * What the Stats page draws: the workspace's totals, trends, and the lists
 * that need attention.
 */
export interface DeckardStatsSnapshot {
  updatedAt: number;
  /**
   * Notes the last scan or update could not read, so they are not indexed.
   * A search that misses one of these looks like a bad search; this is
   * where it is said instead.
   */
  unreadable: StatsUnreadableItem[];
  fileCount: number;
  sectionCount: number;
  taskCount: number;
  activeTaskCount: number;
  tagCount: number;
  entityCount: number;
  wikiLinkCount: number;
  tagViews: StatsAccessItem[];
  entityViews: StatsAccessItem[];
  sectionViews: StatsAccessItem[];
  /** Notes no other note links to, periodic notes aside: the first by title. */
  orphanNotes: StatsNoteItem[];
  /** How many such notes there are, listed or not. */
  orphanNoteCount: number;
  /** How many notes hold something parked, and how many open tasks are; absent when nothing is. */
  parked?: { notes: number; openTasks: number };
  /** Tags that look like two spellings of one idea: the clearest first. */
  lookalikeTags: TagMergeCandidate[];
  /** How many such pairs there are, listed or not. */
  lookalikeTagCount: number;
  /** Names links write that open no note, most linked first. */
  missingLinkTargets: StatsMissingLink[];
  /** How many such names there are, listed or not. */
  missingLinkTargetCount: number;
  /** How the Notes, Tasks, and Open tasks totals moved over twelve weeks. */
  trends: { notes: StatsTrend; tasks: StatsTrend; openTasks: StatsTrend };
  /** How many tags are used how often, and the tags used once. */
  tagUsage: StatsTagUsage;
  /** How often the most-used tags are written on the same entry. */
  tagPairs: StatsTagPairs;
}

/**
 * The most-used tags, [key, label, entries], and for each two of them, i
 * before j, `pairs[i][j]`: how many notes and tasks carry both.
 */
export interface StatsTagPairs {
  tags: [string, string, number][];
  pairs: number[][];
}

/** Tags by how many entries carry them, in six bands. */
export interface StatsTagUsage {
  bands: StatsTagBand[];
  /** The tags on one entry, by label, with a lookalike when one is found. */
  usedOnce: StatsUsedOnceTag[];
  /** How many tags are used once, listed or not. */
  usedOnceCount: number;
}

/**
 * One band of the tag-use bars: the tags carried by between `min` and `max`
 * entries.
 */
export interface StatsTagBand {
  label: string;
  min: number;
  /** Absent for the last band, which has no upper end. */
  max?: number;
  /** How many tags fall in the band. */
  count: number;
}

/** A tag only one entry carries, with the tag it may be a misspelling of. */
export interface StatsUsedOnceTag {
  key: string;
  label: string;
  /** The tag it looks like, which a merge would keep. */
  lookalike?: { key: string; label: string };
}

/**
 * A total as it stood 84, 77, … 7, and 0 days ago: thirteen points, the
 * last the total now. `change` is the last point less the one before.
 */
export interface StatsTrend {
  points: number[];
  change: number;
}

/** A name links write that no note carries, as Stats lists it. */
export interface StatsMissingLink {
  name: string;
  /** How many links write it. */
  count: number;
  /** The first three notes the links are in, by title. */
  sources: string[];
  /** How many notes the links are in. */
  sourceCount: number;
  /** Whether the name can be a file name, so Create can make its note. */
  creatable: boolean;
}

/** Stats' Create and Create all: notes for links that open none. */
export interface CreateMissingNotesMessage {
  type: 'createMissingNotes';
  /** The names to create; empty means every creatable one. */
  names: string[];
}

/** Asks the host to read every note again. */
export interface ReindexWorkspaceMessage {
  type: 'reindexWorkspace';
}

/**
 * Stats' Tags and Namespaced tags totals, and its tag-use bars: choose a
 * tag to open, among those used from `min` to `max` times when given.
 */
export interface OpenTagListMessage {
  type: 'openTagList';
  namespaced: boolean;
  min?: number;
  max?: number;
}

/** Stats' Merge into…: merge a tag into one the reader chooses. */
export interface MergeTagIntoMessage {
  type: 'mergeTagInto';
  sourceKey: string;
}

/** Stats' Wiki links total: the graph, drawing only the links written. */
export interface OpenStatsNotesGraphMessage {
  type: 'openNotesGraph';
  onlyWrittenLinks: true;
}

/** Messages from the Stats page, which only opens what it lists. */
export type StatsMessage =
  | OpenTagListMessage
  | MergeTagIntoMessage
  | OpenStatsNotesGraphMessage
  | OpenTagMessage
  | OpenSourceMessage
  | OpenSearchMessage
  | ReindexWorkspaceMessage
  | MergeTagsMessage
  | CreateMissingNotesMessage;
