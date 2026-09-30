/**
 * The Related Notes sidebar's snapshot for one note: the note's tags, the
 * entries the ranking in `src/domain/ranking` relates to it, and, for a note
 * with no tags, the entries worded like it. The ranking engine is
 * re-exported from here, so its importers compile as before.
 */

import {
  ParsedFile,
  RankedNote,
  RelatedNotesSortMode,
  TagTitleDisplayMode,
  TagReference,
  SidebarTag,
  SidebarNotesSnapshot,
  WorkspaceIndex,
} from '../../core/types';
import { getFileName } from '../../shared/paths';
import { countTagMatches } from '../../domain/query/queryEvaluator';
import {
  collectFileTags,
  rankRelatedNotes as rankRelatedNotesFor,
  RelatedNotesRankingAt,
  RelatedNotesRankingOptions,
} from '../../domain/ranking/relatedNotes';
import { sortRelatedNotes } from '../../domain/ranking/relatedNotesOrder';
import {
  findSimilarWording,
  rankSimilarWording as rankSimilarWordingFor,
  SimilarEntry,
} from '../../domain/ranking/similarWording';

export { collectFileTags } from '../../domain/ranking/relatedNotes';
export type { RelatedNotesRankingAt, RelatedNotesRankingOptions } from '../../domain/ranking/relatedNotes';
export { sortRelatedNotes } from '../../domain/ranking/relatedNotesOrder';
export { suggestTagsFromSimilar } from '../../domain/ranking/similarWording';
export type { SimilarEntry } from '../../domain/ranking/similarWording';

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

/**
 * The notes related to the active one, with the ranking's arguments in the
 * order they were written before it took one subject; see
 * `rankRelatedNotes` in `src/domain/ranking/relatedNotes.ts`.
 */
export function rankRelatedNotes(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile,
  activeTags: TagReference[],
  enableKeywordLinks = true,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  activeTagWeights: ReadonlyMap<string, number> = new Map(),
  options: RelatedNotesRankingAt,
): RankedNote[] {
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
    options,
  );
}

/**
 * The entries worded like a note with no tags, with the arguments in the
 * order they were written before the search took one subject; see
 * `rankSimilarWording` in `src/domain/ranking/similarWording.ts`.
 */
export function rankSimilarWording(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  options: RelatedNotesRankingOptions = {},
  listed: readonly RankedNote[] = [],
): SimilarEntry[] {
  return rankSimilarWordingFor(
    index,
    { filePath: activeFilePath, file: activeFile, tagTitleDisplayMode, listed },
    options,
  );
}
