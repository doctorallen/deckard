/**
 * The Related Notes sidebar's snapshot for one note: the note's tags, the
 * entries the ranking in `src/domain/ranking` relates to it, and, for a note
 * with no tags, the entries worded like it.
 */

import { getFileName } from '../../shared/paths';
import { countTagMatches } from '../../domain/query/queryEvaluator';
import { collectFileTags, rankRelatedNotes as rankRelatedNotesFor } from '../../domain/ranking/relatedNotes';
import { sortRelatedNotes } from '../../domain/ranking/relatedNotesOrder';
import {
  findSimilarWording,
  rankSimilarWording as rankSimilarWordingFor,
  SimilarEntry,
} from '../../domain/ranking/similarWording';
import { RelatedNotesRankingAt, RelatedNotesRankingOptions } from '../../domain/ranking/relatedNotesContext';
import { SidebarTag, SidebarNotesSnapshot } from '../protocol/sidebarNotes';
import type { EntryTagContext } from './entryScope';
import {
  ParsedFile,
  RankedNote,
  RelatedNotesSortMode,
  TagTitleDisplayMode,
  TagReference,
  WorkspaceIndex,
} from '../../domain/model';

/** How Related Notes is drawn for one note, beyond the note itself. */
export interface SidebarSnapshotOptions {
  /** The moment a note's age is counted to, for the recency weight. */
  now: number;
  /** Whether shared wording counts; on unless false. */
  enableKeywordLinks?: boolean;
  /** `tags` unless given. */
  relatedNotesSortMode?: RelatedNotesSortMode;
  sectionAccessCounts?: Record<string, number>;
  /** `inline` unless given. */
  tagTitleDisplayMode?: TagTitleDisplayMode;
  /** The title of the entry chosen within the note, when one is. */
  activeEntryTitle?: string;
  /** How much each of the note's tags counts, when an entry weighs them. */
  activeTagWeights?: ReadonlyMap<string, number>;
  rankingOptions?: RelatedNotesRankingOptions;
}

/**
 * Chooses between tag-overview context and the active Markdown editor context.
 */
export function createSidebarSnapshot(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile | undefined,
  options: SidebarSnapshotOptions,
): SidebarNotesSnapshot {
  const { now, activeEntryTitle, activeTagWeights, rankingOptions } = options;
  const { enableKeywordLinks = true, relatedNotesSortMode = 'tags' } = options;
  const { sectionAccessCounts = {}, tagTitleDisplayMode = 'inline' } = options;
  if (!activeFile) {
    return {
      activeTags: [],
      notes: [],
      relatedNotesSortMode,
      tagTitleDisplayMode,
      state: 'noMarkdown',
    };
  }

  const sortedActiveTags = sortTagReferences(collectFileTags(activeFile));
  const activeTags =
    activeTagWeights && activeTagWeights.size > 0
      ? sortedActiveTags
          .map((tag, index) => ({ tag, index }))
          .sort(
            (left, right) =>
              (activeTagWeights.get(right.tag.key) ?? 1) -
                (activeTagWeights.get(left.tag.key) ?? 1) ||
              left.index - right.index,
          )
          .map(({ tag }) => tag)
      : sortedActiveTags;
  const tagMatches = countTagMatches(index);
  const weightedActiveTags: SidebarTag[] = activeTags.map((tag) => ({
    ...tag,
    weight: activeTagWeights?.get(tag.key) ?? 1,
    matches: tagMatches.get(tag.key) ?? { notes: 0, tasks: 0 },
  }));
  const notes = rankRelatedNotesFor(
    index,
    {
      filePath: activeFilePath,
      file: activeFile,
      tags: activeTags,
      enableKeywordLinks,
      tagTitleDisplayMode,
      tagWeights: activeTagWeights,
    },
    { ...rankingOptions, now },
  );
  // A note with no tags has nothing to rank by but its links, so entries
  // worded like it are listed apart, marked weak, with the tags they use.
  // For a note with any tag, wording alone never makes a note related.
  const similar =
    activeTags.length === 0 && enableKeywordLinks
      ? findSimilarWording(
          index,
          { filePath: activeFilePath, file: activeFile, tagTitleDisplayMode, listed: notes },
          rankingOptions,
        )
      : undefined;
  return {
    activeFileName: getFileName(activeFilePath),
    activeEntryTitle,
    activeTags: weightedActiveTags,
    notes: sortRelatedNotes(notes, relatedNotesSortMode, sectionAccessCounts),
    ...(similar
      ? {
          similar: {
            notes: sortRelatedNotes(similar.notes, relatedNotesSortMode, sectionAccessCounts),
            tags: similar.tags,
          },
        }
      : {}),
    relatedNotesSortMode,
    tagTitleDisplayMode,
    state: getSidebarState(notes, activeTags),
  };
}

/** Whether the sidebar lists notes, found none for the tags, or has no tags. */
function getSidebarState(
  notes: readonly RankedNote[],
  activeTags: readonly TagReference[],
): SidebarNotesSnapshot['state'] {
  if (notes.length > 0) {
    return 'ready';
  }
  return activeTags.length > 0 ? 'noMatches' : 'noTags';
}

/**
 * Uses canonical keys for ordering while retaining labels for display.
 */
function sortTagReferences(tags: TagReference[]): TagReference[] {
  return tags.sort(
    (left, right) =>
      left.key.localeCompare(right.key, undefined, { sensitivity: 'base' }) ||
      left.label.localeCompare(right.label),
  );
}

/** The active note, and how the notes related to it are ranked. */
export interface RelatedNotesRequest {
  index: WorkspaceIndex;
  activeFilePath: string | undefined;
  activeFile: ParsedFile;
  activeTags: TagReference[];
  /** Whether shared wording adjusts scores; on by default. */
  enableKeywordLinks?: boolean;
  /** How a tag in a title is drawn; inline by default. */
  tagTitleDisplayMode?: TagTitleDisplayMode;
  /** How much each active tag counts; 1 for a tag not in it. */
  activeTagWeights?: ReadonlyMap<string, number>;
  /** The ranking's settings and the moment it ranks at. */
  ranking: RelatedNotesRankingAt;
}

/**
 * The notes related to the active one, with the ranking's arguments named
 * as its callers here have them; see `rankRelatedNotes` in
 * `src/domain/ranking/relatedNotes.ts`.
 */
export function rankRelatedNotes({
  index,
  activeFilePath,
  activeFile,
  activeTags,
  enableKeywordLinks = true,
  tagTitleDisplayMode = 'inline',
  activeTagWeights = new Map(),
  ranking,
}: RelatedNotesRequest): RankedNote[] {
  return rankRelatedNotesFor(
    index,
    {
      filePath: activeFilePath,
      file: activeFile,
      tags: activeTags,
      enableKeywordLinks,
      tagTitleDisplayMode,
      tagWeights: activeTagWeights,
    },
    ranking,
  );
}

/** A note with no tags, and how the entries worded like it are found. */
export interface SimilarWordingRequest {
  index: WorkspaceIndex;
  activeFilePath: string | undefined;
  activeFile: ParsedFile;
  /** How a tag in a title is drawn; inline by default. */
  tagTitleDisplayMode?: TagTitleDisplayMode;
  /** The ranking's settings; the defaults when absent. */
  ranking?: RelatedNotesRankingOptions;
  /** The notes already listed, which are left out. */
  listed?: readonly RankedNote[];
}

/**
 * The entries worded like a note with no tags, with the arguments named as
 * its callers here have them; see `rankSimilarWording` in
 * `src/domain/ranking/similarWording.ts`.
 */
export function rankSimilarWording({
  index,
  activeFilePath,
  activeFile,
  tagTitleDisplayMode = 'inline',
  ranking = {},
  listed = [],
}: SimilarWordingRequest): SimilarEntry[] {
  return rankSimilarWordingFor(
    index,
    { filePath: activeFilePath, file: activeFile, tagTitleDisplayMode, listed },
    ranking,
  );
}

/** How Related Notes ranks for one entry, as the debug page shows it. */
export interface EntryRelatedNotesDiagnostic {
  filePath: string;
  sourceLine: number;
  title: string;
  tags: Array<{
    key: string;
    weight: number;
    context: EntryTagContext;
    source: string;
  }>;
  snapshot: SidebarNotesSnapshot;
}
