/**
 * Related Notes: which entries in other notes relate to the one being read,
 * how strongly, and why. An entry qualifies by sharing a tag, an associated
 * tag, or a Wiki link with it; shared wording and recency then adjust its
 * score, and a more specific entry outranks the broad heading it sits under.
 */

import { isParkedFile, isParkedSection, isParkedTask } from '../../core/workspace/parked';
import {
  ParsedFile,
  RelatedNotesSortMode,
  RankedNote,
  Section,
  Task,
  TagTitleDisplayMode,
  TagReference,
  TagAssociation,
  SidebarTag,
  SidebarNotesSnapshot,
  SuggestedTag,
  WorkspaceIndex,
} from '../../core/types';
import {
  extractWikiLinks,
  findDailyNoteDate,
  isPeriodicNoteFile,
  isPersonTag,
  stripTags,
} from '../../core/markdown/parser';
import { getFileName } from '../../core/paths';
import { countTagMatches } from '../../core/query/queryEvaluator';
import {
  findTagAssociation,
  getHeadingPath,
  getInlineSource,
  getNoteTitle,
  getTitleTags,
} from './dashboardState';
import { createSectionExcerpt } from './entryExcerpt';
import {
  createLexicalModel,
  createMoreLikeThisModel,
  getCachedLexicalTerms,
  getEntryTerms,
  getLexicalWeight,
  getSectionLexicalContent,
  getTermPostings,
} from './wordSimilarity';

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
  const notes = rankRelatedNotes(
    index,
    activeFilePath,
    activeFile,
    activeTags,
    enableKeywordLinks,
    tagTitleDisplayMode,
    activeTagWeights,
    { ...rankingOptions, now },
  );
  // A note with no tags has nothing to rank by but its links, so entries
  // worded like it are listed apart, marked weak, with the tags they use.
  // For a note with any tag, wording alone never makes a note related.
  const similar =
    activeTags.length === 0 && enableKeywordLinks
      ? findSimilarWording(index, activeFilePath, activeFile, tagTitleDisplayMode, notes, rankingOptions)
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
    state:
      notes.length > 0
        ? 'ready'
        : activeTags.length > 0
          ? 'noMatches'
          : 'noTags',
  };
}

/**
 * Deduplicates tags across sections and tasks so one note has one tag list.
 */
export function collectFileTags(file: ParsedFile): TagReference[] {
  const tags = new Map<string, TagReference>();
  const addTag = (key: string, label: string | undefined): void => {
    if (!tags.has(key)) {
      tags.set(key, { key, label: label ?? key });
    }
  };

  file.frontmatterTags.forEach((tag) => addTag(tag.key, tag.label));
  file.sections.forEach((section) => {
    section.tags.forEach((key) => addTag(key, section.tagLabels[key]));
  });
  file.tasks.forEach((task) => {
    task.tags.forEach((key) => addTag(key, task.tagLabels[key]));
  });

  return [...tags.values()];
}

function getTagReferences(
  keys: string[],
  labels: Record<string, string>,
): TagReference[] {
  return keys.map((key) => ({ key, label: labels[key] ?? key }));
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
 * Ranks other notes by shared tags and exposes matching sections/tasks as source
 * references without duplicating a task already represented by its section.
 */
export interface RelatedNotesRankingOptions {
  /**
   * One preserves intentional one-off associations; higher values suppress
   * low-support learned edges without discarding their index evidence.
   */
  associationMinimumSupport?: number;
  /** Disabled at zero; a positive value is the recency decay half-life. */
  recencyHalfLifeDays?: number;
  /** Leaves out daily, weekly, and monthly notes. */
  hidePeriodicNotes?: boolean;
  /** Namespaces never suggested as a tag, such as the board's status. */
  excludedTagNamespaces?: string[];
}

/** A ranking's settings, with the moment a note's age is counted to. */
export type RelatedNotesRankingAt = RelatedNotesRankingOptions & {
  /** Now, in milliseconds since the epoch, for the recency weight. */
  now: number;
};

/** What a wording-only result needs: two shared terms, or one rare one. */
const WORDING_MIN_TERMS = 2;
const WORDING_RARE_TERM = 1.5;
/** At most this many results from one note, and in all. */
const WORDING_PER_FILE = 2;
const WORDING_LIMIT = 10;
/** A wording-only score is never more than weak. */
const WORDING_MAX_SCORE = 30;

export interface SimilarEntry {
  note: RankedNote;
  rawWeight: number;
  tags: TagReference[];
}

/**
 * The entries worded like a note that has no tags: up to ten, two per note,
 * each needing two shared terms or one rare one, ordered by their BM25 sum
 * and scored weak at most. Entries already listed as related are left out.
 */
export function rankSimilarWording(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  options: RelatedNotesRankingOptions = {},
  listed: readonly RankedNote[] = [],
): SimilarEntry[] {
  const model = createMoreLikeThisModel(index, activeFile);
  if (model.queryTerms.size === 0) {
    return [];
  }
  const postings = getTermPostings(index);
  const keepParked = activeFilePath !== undefined && isParkedFile(index, activeFilePath);
  const already = new Set(listed.map((note) => `${note.filePath}:${note.sourceLine}`));
  const candidates = new Set<Section | Task>();
  model.queryTerms.forEach((term) =>
    (postings.get(term) ?? []).forEach((entry) => {
      if (entry.filePath !== activeFilePath && entry.filePath !== activeFile.filePath) {
        candidates.add(entry);
      }
    }),
  );
  const scored = [...candidates].flatMap((entry) => {
    const file = index.files.get(entry.filePath);
    if (!file) {
      return [];
    }
    const isSection = 'heading' in entry;
    const parked = isSection ? isParkedSection(index, entry.id) : isParkedTask(index, entry.id);
    if ((!keepParked && (parked || isParkedFile(index, entry.filePath))) ||
      (options.hidePeriodicNotes && isPeriodicNoteFile(file))) {
      return [];
    }
    const title = isSection ? entry.heading : entry.title;
    const content = isSection ? getSectionLexicalContent(entry, file.sections) : entry.sourceLineText;
    const evidence = getLexicalWeight(model, title, content, getEntryTerms(index, entry));
    const rare = evidence.terms[0]?.contribution ?? 0;
    if (evidence.terms.length < WORDING_MIN_TERMS && rare < WORDING_RARE_TERM) {
      return [];
    }
    return [{ entry, file, isSection, evidence }];
  });
  // A task under a section that is listed too is seen through that section.
  const sectionIds = new Set(scored.filter((item) => item.isSection).map((item) => item.entry.id));
  const perFile = new Map<string, number>();
  return scored
    .filter((item) => item.isSection || !(item.entry as Task).sectionId || !sectionIds.has((item.entry as Task).sectionId as string))
    .sort((left, right) => right.evidence.rawWeight - left.evidence.rawWeight)
    .filter((item) => {
      const line = item.isSection ? (item.entry as Section).startLine : (item.entry as Task).lineNumber;
      if (already.has(`${item.entry.filePath}:${line}`)) {
        return false;
      }
      const count = perFile.get(item.entry.filePath) ?? 0;
      if (count >= WORDING_PER_FILE) {
        return false;
      }
      perFile.set(item.entry.filePath, count + 1);
      return true;
    })
    .slice(0, WORDING_LIMIT)
    .map(({ entry, file, isSection, evidence }) => {
      const sectionsById = new Map(file.sections.map((section) => [section.id, section]));
      const section = isSection ? (entry as Section) : undefined;
      const task = isSection ? undefined : (entry as Task);
      const rawTitle = section ? section.heading : (task as Task).title;
      const title = getNoteTitle(rawTitle, tagTitleDisplayMode);
      const terms = evidence.terms.slice(0, 3).map((term) => term.term);
      const excerpt = section ? createSectionExcerpt(section, file.sections, title, terms) : undefined;
      const score = Math.min(
        WORDING_MAX_SCORE,
        Math.round(Math.min(0.3, evidence.rawWeight / (evidence.rawWeight + 1)) * 100),
      );
      const tags = getTagReferences(entry.tags, entry.tagLabels);
      const note: RankedNote = {
        kind: 'wording',
        ...(excerpt ? { excerpt } : {}),
        sectionId: section ? section.id : task?.sectionId,
        filePath: entry.filePath,
        title,
        fileName: getFileName(entry.filePath) ?? entry.filePath,
        sourceLine: section ? section.startLine : (task as Task).lineNumber,
        headingPath: section ? getHeadingPath(section, sectionsById) : getTaskHeadingPath(task as Task, sectionsById),
        dailyDate: getDailyNoteDate(file),
        titleTags: getTitleTags(entry.tags, entry.tagLabels, section ? getInlineSource(section) : rawTitle),
        updatedAt: file.updatedAt ?? entry.updatedAt,
        matchedTags: [],
        matchCount: 0,
        totalTagCount: 0,
        overlap: score / 100,
        relevanceScore: score,
        relevanceEvidence: {
          directTagWeight: 0,
          associationWeight: 0,
          normalizedAssociationWeight: 0,
          appliedAssociationWeight: 0,
          entryLinkWeight: 0,
          fileLinkWeight: 0,
          lexicalWeight: evidence.weight,
          recencyWeight: 0,
          specificityPenalty: 0,
          lexicalTerms: evidence.terms,
        },
        reasons: [`Similar wording: ${terms.join(', ')}`],
      };
      return { note, rawWeight: evidence.rawWeight, tags };
    });
}

/** The most a note with no tags is offered, and how few it looks for. */
const SUGGESTED_TAG_LIMIT = 5;
const SUGGESTED_TAG_FILL = 3;

/**
 * The tags the entries worded like a note use, as suggestions for it: each
 * weighted by those entries' wording and by how rare the tag is, so a tag
 * on every daily note does not lead. People and the board's status are
 * left out. A tag on two or more of the entries comes first; single ones
 * fill up to three; five at most.
 */
export function suggestTagsFromSimilar(
  index: WorkspaceIndex,
  similar: readonly SimilarEntry[],
  options: RelatedNotesRankingOptions = {},
): SuggestedTag[] {
  const excluded = new Set((options.excludedTagNamespaces ?? []).map((namespace) => namespace.toLowerCase()));
  const matches = countTagMatches(index);
  const entryTotal = Math.max(1, index.sections.size + index.tasks.size);
  const byKey = new Map<string, { score: number; entries: number; label: string }>();
  similar.forEach((item) => {
    new Map(item.tags.map((tag) => [tag.key, tag])).forEach((tag) => {
      const namespace = tag.key.replace(/^[#@]/, '').split('/')[0]?.toLowerCase();
      if (isPersonTag(tag.key) || (tag.key.includes('/') && excluded.has(namespace))) {
        return;
      }
      if (index.parked?.tags.has(tag.key)) {
        return;
      }
      const current = byKey.get(tag.key) ?? { score: 0, entries: 0, label: index.tags.get(tag.key)?.label ?? tag.label };
      current.score += item.rawWeight;
      current.entries += 1;
      byKey.set(tag.key, current);
    });
  });
  const ranked = [...byKey.entries()]
    .map(([key, value]) => {
      const count = matches.get(key);
      const tagEntries = (count?.notes ?? 0) + (count?.tasks ?? 0);
      return { key, ...value, tagEntries, weight: value.score * Math.log(1 + entryTotal / (1 + tagEntries)) };
    })
    // A tag on a third of everything, as #daily is in a journal, says
    // nothing about this note in particular.
    .filter((tag) => entryTotal < 10 || tag.tagEntries <= entryTotal / 3)
    .sort((left, right) => right.weight - left.weight || left.key.localeCompare(right.key));
  const shared = ranked.filter((tag) => tag.entries >= 2);
  const single = ranked.filter((tag) => tag.entries < 2);
  return [...shared, ...single.slice(0, Math.max(0, SUGGESTED_TAG_FILL - shared.length))]
    .slice(0, SUGGESTED_TAG_LIMIT)
    .map((tag) => ({ key: tag.key, label: tag.label, entryCount: tag.entries }));
}

/** The similar-wording list and its tags, for a note with no tags. */
function findSimilarWording(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile,
  tagTitleDisplayMode: TagTitleDisplayMode,
  listed: readonly RankedNote[],
  options: RelatedNotesRankingOptions = {},
): { notes: RankedNote[]; tags: SuggestedTag[] } {
  const similar = rankSimilarWording(index, activeFilePath, activeFile, tagTitleDisplayMode, options, listed);
  return {
    notes: similar.map((item) => item.note),
    tags: suggestTagsFromSimilar(index, similar, options),
  };
}

/**
 * The notes related to the active one, by shared tags, the tags learned to
 * go with them, links, and wording, each scored in `options`; a dated note's
 * recency is counted to `options.now`.
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
  const activeKeys = new Set(activeTags.map((tag) => tag.key));
  const notes: RankedNote[] = [];
  const associationMinimumSupport = Math.max(
    1,
    Math.floor(options.associationMinimumSupport ?? 1),
  );
  const lexicalModel = enableKeywordLinks
    ? createLexicalModel(index, activeFile)
    : undefined;

  // Parked notes are left out, unless the note being read is parked itself;
  // then they are ranked, after the rest.
  const keepParked = activeFilePath !== undefined && isParkedFile(index, activeFilePath);
  index.files.forEach((file, filePath) => {
    if (filePath === activeFilePath) {
      return;
    }
    if (!keepParked && isParkedFile(index, filePath)) {
      return;
    }
    if (options.hidePeriodicNotes && isPeriodicNoteFile(file)) {
      return;
    }

    const findAssociatedMatches = (
      candidateTags: TagReference[],
    ): Array<{ tag: TagReference; weight: number; rawWeight: number }> =>
      candidateTags.flatMap((candidateTag) => {
        const associations = activeTags
          .map((activeTag) => ({
            association: findTagAssociation(
              index,
              activeTag.key,
              candidateTag.key,
            ),
            activeWeight: activeTagWeights.get(activeTag.key) ?? 1,
          }))
          .filter(
            (match): match is {
              association: TagAssociation;
              activeWeight: number;
            } =>
              match.association !== undefined &&
              match.association.count >= associationMinimumSupport,
          );
        const weight = associations.reduce(
          (total, match) =>
            total + match.association.normalizedWeight * match.activeWeight,
          0,
        );
        const rawWeight = associations.reduce(
          (total, match) =>
            total + match.association.weight * match.activeWeight,
          0,
        );
        return weight > 0
          ? [{ tag: candidateTag, weight, rawWeight }]
          : [];
      });
    const totalActiveWeight = activeTags.reduce(
      (total, tag) => total + (activeTagWeights.get(tag.key) ?? 1),
      0,
    );
    const matchingSections = file.sections.filter((section) => {
      if (!keepParked && isParkedSection(index, section.id)) {
        return false;
      }
      const tags = getTagReferences(section.tags, section.tagLabels);
      const associatedMatches = findAssociatedMatches(tags);
      const linkEvidence = getLinkEvidence(
        activeFile,
        activeFilePath,
        file,
        extractWikiLinks(
          getSectionLexicalContent(section, file.sections),
        ),
        section.heading,
      );
      // Shared wording only adjusts the score of an entry that shares a tag,
      // an association, or a link. On its own it would make nearly every
      // entry in the workspace "related".
      return (
        tags.some((tag) => activeKeys.has(tag.key)) ||
        associatedMatches.length > 0 ||
        linkEvidence.entryWeight > 0 ||
        linkEvidence.fileWeight > 0
      );
    });
    const matchingSectionIds = new Set(
      matchingSections.map((section) => section.id),
    );
    const sectionsById = new Map(
      file.sections.map((section) => [section.id, section]),
    );
    const references: Array<{
      sectionId?: string;
      title: string;
      sourceLine: number;
      titleTags: TagReference[];
      updatedAt?: number;
      tags: TagReference[];
      rawContent: string;
      links: string[];
      headingPath: string[];
      dailyDate?: string;
      parked?: boolean;
      section?: Section;
    }> = matchingSections.map((section) => ({
      parked: isParkedSection(index, section.id),
      section,
      sectionId: section.id,
      title: getNoteTitle(section.heading, tagTitleDisplayMode),
      sourceLine: section.startLine,
      titleTags: getTitleTags(
        section.tags,
        section.tagLabels,
        getInlineSource(section),
      ),
      updatedAt: file.updatedAt ?? section.updatedAt,
      tags: getTagReferences(section.tags, section.tagLabels),
      rawContent: getSectionLexicalContent(section, file.sections),
      links: extractWikiLinks(
        getSectionLexicalContent(section, file.sections),
      ),
      headingPath: getHeadingPath(section, sectionsById),
      dailyDate: getDailyNoteDate(file),
    }));
    // A task under a matching section is already visible through that section;
    // include only standalone matches to keep sidebar entries distinct.
    const matchingTasks = file.tasks.filter((task) => {
      if (!keepParked && isParkedTask(index, task.id)) {
        return false;
      }
      const tags = getTagReferences(task.tags, task.tagLabels);
      const linkEvidence = getLinkEvidence(
        activeFile,
        activeFilePath,
        file,
        extractWikiLinks(task.sourceLineText),
        task.title,
      );
      return (
        (tags.some((tag) => activeKeys.has(tag.key)) ||
          findAssociatedMatches(tags).length > 0 ||
          linkEvidence.entryWeight > 0 ||
          linkEvidence.fileWeight > 0) &&
        (!task.sectionId || !matchingSectionIds.has(task.sectionId))
      );
    });

    matchingTasks.forEach((task) => {
      references.push({
        parked: isParkedTask(index, task.id),
        sectionId: task.sectionId,
        title: getNoteTitle(task.title, tagTitleDisplayMode),
        sourceLine: task.lineNumber,
        titleTags: getTitleTags(task.tags, task.tagLabels, task.title),
        updatedAt: file.updatedAt ?? task.updatedAt,
        tags: getTagReferences(task.tags, task.tagLabels),
        rawContent: task.sourceLineText,
        links: extractWikiLinks(task.sourceLineText),
        headingPath: getTaskHeadingPath(task, sectionsById),
        dailyDate: getDailyNoteDate(file),
      });
    });

    notes.push(
      ...references.map((reference) => {
        const matchedTags = activeTags.filter((tag) =>
          reference.tags.some((candidateTag) => candidateTag.key === tag.key),
        );
        const associatedMatches = findAssociatedMatches(reference.tags);
        const associationMatches = reference.tags.flatMap((candidateTag) =>
          activeTags.flatMap((selectedTag) => {
            const association = findTagAssociation(
              index,
              selectedTag.key,
              candidateTag.key,
            );
            if (
              !association ||
              association.count < associationMinimumSupport
            ) {
              return [];
            }
            const selectedWeight =
              activeTagWeights.get(selectedTag.key) ?? 1;
            return [{
              selectedTag,
              candidateTag,
              associationWeight: association.weight,
              normalizedAssociationWeight: association.normalizedWeight,
              sourceUnitCount: association.count,
              selectedTagSourceUnitCount: association.tagSourceUnitCount,
              candidateTagSourceUnitCount:
                association.associatedTagSourceUnitCount,
              totalSourceUnitCount: association.totalSourceUnitCount,
              selectedWeight,
              contribution: association.normalizedWeight * selectedWeight,
            }];
          }),
        );
        const associationWeight = associatedMatches.reduce(
          (total, match) => total + match.rawWeight,
          0,
        );
        const normalizedAssociationWeight = associationMatches.reduce(
          (total, match) => total + match.normalizedAssociationWeight,
          0,
        );
        const unionSize = new Set([
          ...activeKeys,
          ...reference.tags.map((tag) => tag.key),
        ]).size;
        const directTagWeight = matchedTags.reduce(
          (total, tag) => total + 2 * (activeTagWeights.get(tag.key) ?? 1),
          0,
        );
        const appliedAssociationWeight = getDiminishingAssociationWeight(
          normalizedAssociationWeight,
          totalActiveWeight,
        );
        const linkEvidence = getLinkEvidence(
          activeFile,
          activeFilePath,
          file,
          reference.links,
          reference.title,
        );
        const lexicalEvidence = getLexicalWeight(
          lexicalModel,
          reference.title,
          reference.rawContent,
          lexicalModel &&
            getCachedLexicalTerms(index, reference.title, reference.rawContent),
        );
        const recencyWeight = getRecencyWeight(
          getRelevantDate(file),
          options.recencyHalfLifeDays,
          options.now,
        );
        const relevanceScore = Math.round(
          Math.min(
            1,
            (directTagWeight +
              appliedAssociationWeight +
              linkEvidence.entryWeight +
              linkEvidence.fileWeight +
              lexicalEvidence.weight +
              recencyWeight) /
              Math.max(1, totalActiveWeight * 2),
          ) * 100,
        );
        const specificityPenalty =
          reference.sectionId &&
          matchedTags.length > 0 &&
          hasMoreSpecificMatchingDescendant(
            reference.sectionId,
            matchingSections,
            matchedTags,
            sectionsById,
          )
            ? 0.05
            : 0;
        const referenceRelevanceScore = Math.max(
          0,
          relevanceScore - Math.round(specificityPenalty * 100),
        );
        const excerpt = reference.section
          ? createSectionExcerpt(
              reference.section,
              file.sections,
              reference.title,
              lexicalEvidence.terms.slice(0, 3).map((term) => term.term),
            )
          : undefined;
        return {
          ...(reference.parked ? { parked: true as const } : {}),
          ...(excerpt ? { excerpt } : {}),
          sectionId: reference.sectionId,
          filePath,
          title: reference.title,
          fileName: getFileName(filePath) ?? filePath,
          sourceLine: reference.sourceLine,
          headingPath: reference.headingPath,
          dailyDate: reference.dailyDate,
          titleTags: reference.titleTags,
          updatedAt: reference.updatedAt,
          matchedTags,
          matchCount: matchedTags.reduce(
            (total, tag) => total + (activeTagWeights.get(tag.key) ?? 1),
            0,
          ),
          totalTagCount: activeTags.length,
          overlap:
            unionSize > 0 ? referenceRelevanceScore / 100 : 0,
          relevanceScore: referenceRelevanceScore,
          associationWeight,
          associationMatches,
          relevanceEvidence: {
            directTagWeight,
            associationWeight,
            normalizedAssociationWeight,
            appliedAssociationWeight,
            entryLinkWeight: linkEvidence.entryWeight,
            fileLinkWeight: linkEvidence.fileWeight,
            lexicalWeight: lexicalEvidence.weight,
            recencyWeight,
            specificityPenalty,
            lexicalTerms: lexicalEvidence.terms,
          },
          reasons: [
            ...(matchedTags.length > 0
              ? [
                  `Shared: ${matchedTags.map((tag) => tag.label).join(', ')}`,
                ]
              : []),
            ...(associatedMatches.length > 0
              ? [
                  `Associated: ${associatedMatches
                    .map((match) => match.tag.label)
                    .join(', ')}`,
                ]
              : []),
            ...(linkEvidence.entryWeight > 0 ? ['Direct entry link'] : []),
            ...(linkEvidence.fileWeight > 0 ? ['Linked note'] : []),
            ...(lexicalEvidence.terms.length > 0
              ? [
                  `Similar terms: ${lexicalEvidence.terms
                    .slice(0, 3)
                    .map((term) => term.term)
                    .join(', ')}`,
                ]
              : []),
            ...(recencyWeight > 0
              ? [`Recent ${getRelevantDate(file)?.source ?? 'note'}`]
              : []),
            ...(specificityPenalty > 0
              ? ['Broader match contains a more specific entry']
              : []),
          ],
        };
      }),
    );
  });

  return notes.sort(compareRelatedNotes);
}

/**
 * Lets stronger association evidence keep improving relevance without allowing
 * repeated indirect evidence to overwhelm a complete direct-tag match.
 */
function getDiminishingAssociationWeight(
  rawAssociationWeight: number,
  totalActiveWeight: number,
): number {
  if (rawAssociationWeight <= 0 || totalActiveWeight <= 0) {
    return 0;
  }
  return (
    totalActiveWeight *
    (rawAssociationWeight / (rawAssociationWeight + totalActiveWeight))
  );
}

function hasMoreSpecificMatchingDescendant(
  sectionId: string,
  matchingSections: Section[],
  matchedTags: TagReference[],
  sectionsById: ReadonlyMap<string, Section>,
): boolean {
  return matchingSections.some((candidate) => {
    if (
      candidate.id === sectionId ||
      !matchedTags.every((tag) => candidate.tags.includes(tag.key))
    ) {
      return false;
    }

    let parentId = candidate.parentSectionId;
    while (parentId) {
      if (parentId === sectionId) {
        return true;
      }
      parentId = sectionsById.get(parentId)?.parentSectionId;
    }
    return false;
  });
}

/**
 * Applies the selected Related Notes ordering while preserving deterministic
 * relevance and source-location fallbacks for tied values.
 */
export function sortRelatedNotes(
  notes: RankedNote[],
  sortMode: RelatedNotesSortMode,
  sectionAccessCounts: Record<string, number> = {},
): RankedNote[] {
  return [...notes].sort((left, right) => {
    // Parked notes, listed only beside a parked note, come after the rest.
    const parkedOrder = Number(left.parked === true) - Number(right.parked === true);
    if (parkedOrder !== 0) {
      return parkedOrder;
    }
    if (sortMode === 'newest' || sortMode === 'oldest') {
      const dateOrder = compareRelatedNoteDates(
        left.updatedAt,
        right.updatedAt,
        sortMode,
      );
      if (dateOrder !== 0) {
        return dateOrder;
      }
    }

    if (sortMode === 'access') {
      const leftAccess = left.sectionId
        ? (sectionAccessCounts[left.sectionId] ?? 0)
        : 0;
      const rightAccess = right.sectionId
        ? (sectionAccessCounts[right.sectionId] ?? 0)
        : 0;
      if (leftAccess !== rightAccess) {
        return rightAccess - leftAccess;
      }
    }

    return compareRelatedNotes(left, right);
  });
}

function compareRelatedNoteDates(
  left: number | undefined,
  right: number | undefined,
  sortMode: 'newest' | 'oldest',
): number {
  if (left === undefined || right === undefined) {
    if (left === right) {
      return 0;
    }
    return left === undefined ? 1 : -1;
  }
  return sortMode === 'newest' ? right - left : left - right;
}

function compareRelatedNotes(left: RankedNote, right: RankedNote): number {
  return (
    right.relevanceScore - left.relevanceScore ||
    right.matchCount - left.matchCount ||
    (right.associationWeight ?? 0) - (left.associationWeight ?? 0) ||
    right.overlap - left.overlap ||
    (right.reasons?.length ?? 0) - (left.reasons?.length ?? 0) ||
    left.filePath.localeCompare(right.filePath) ||
    left.sourceLine - right.sourceLine ||
    left.title.localeCompare(right.title)
  );
}

function getLinkEvidence(
  activeFile: ParsedFile,
  activeFilePath: string | undefined,
  candidateFile: ParsedFile,
  candidateLinks: string[],
  candidateTitle: string,
): { entryWeight: number; fileWeight: number } {
  const activeEntryTitle =
    activeFile.sections[0]?.heading ?? activeFile.tasks[0]?.title;
  const candidateMatchesActive = candidateLinks.some((link) =>
    activeEntryTitle !== undefined &&
    linkTargetsEntry(
      link,
      activeFilePath ?? activeFile.filePath,
      activeEntryTitle,
      activeFile.aliases,
    ),
  );
  const activeMatchesCandidate = activeFile.links.some((link) =>
    linkTargetsEntry(link, candidateFile.filePath, candidateTitle, candidateFile.aliases),
  );
  if (candidateMatchesActive || activeMatchesCandidate) {
    return { entryWeight: 0.5, fileWeight: 0 };
  }
  return filesAreLinked(activeFile, candidateFile)
    ? { entryWeight: 0, fileWeight: 0.1 }
    : { entryWeight: 0, fileWeight: 0 };
}

function filesAreLinked(left: ParsedFile, right: ParsedFile): boolean {
  const leftNames = getLinkNames(left.filePath, left.aliases);
  const rightNames = getLinkNames(right.filePath, right.aliases);
  return (
    left.links.some((link) => rightNames.has(getLinkFileTarget(link))) ||
    right.links.some((link) => leftNames.has(getLinkFileTarget(link)))
  );
}

function linkTargetsEntry(
  link: string,
  filePath: string,
  title: string,
  aliases?: readonly string[],
): boolean {
  const [fileTarget, headingTarget] = link.split('#', 2);
  if (!getLinkNames(filePath, aliases).has(normalizeLink(fileTarget))) {
    return false;
  }
  return !headingTarget || normalizeHeadingTarget(headingTarget) ===
    normalizeHeadingTarget(title);
}

/**
 * The names a link can use for a note, by path. Ranking asks for them for
 * every entry it scores, so each path's names are worked out once.
 */
const linkNamesByPath = new Map<string, Set<string>>();

function getLinkNames(
  filePath: string,
  aliases?: readonly string[],
): Set<string> {
  let names = linkNamesByPath.get(filePath);
  if (!names) {
    const fileName = filePath.split('/').pop() ?? filePath;
    names = new Set([
      normalizeLink(filePath),
      normalizeLink(fileName),
      normalizeLink(fileName.replace(/\.md$/i, '')),
    ]);
    // Paths only accumulate through renames; a bound keeps that in check.
    if (linkNamesByPath.size > 50_000) {
      linkNamesByPath.clear();
    }
    linkNamesByPath.set(filePath, names);
  }
  // Aliases can change without the path changing, so they are not cached.
  return aliases?.length
    ? new Set([...names, ...aliases.map(normalizeLink)])
    : names;
}

function getLinkFileTarget(link: string): string {
  return normalizeLink(link.split('#', 1)[0]);
}

function normalizeLink(value: string): string {
  return value.trim().replace(/\.md$/i, '').toLocaleLowerCase();
}

function normalizeHeadingTarget(value: string): string {
  return stripTags(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getTaskHeadingPath(
  task: Task,
  sectionsById: ReadonlyMap<string, Section>,
): string[] {
  const section = task.sectionId ? sectionsById.get(task.sectionId) : undefined;
  return section
    ? [...getHeadingPath(section, sectionsById), stripTags(task.title)]
    : [stripTags(task.title)];
}

function getDailyNoteDate(file: ParsedFile): string | undefined {
  return findDailyNoteDate(
    file.filePath,
    file.sections
      .filter((section) => section.headingLevel === 1)
      .map((section) => section.heading),
  );
}

function getRelevantDate(
  file: ParsedFile,
): { at: number; source: string } | undefined {
  const frontmatterBlock = file.content.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/,
  )?.[1];
  const frontmatter = frontmatterBlock?.match(
    /^(?:date|created|updated):\s*["']?(\d{4}-\d{2}-\d{2})/im,
  )?.[1];
  const dailyDate = getDailyNoteDate(file);
  const date = frontmatter ?? dailyDate;
  if (date) {
    const at = new Date(`${date}T00:00:00`).getTime();
    if (!Number.isNaN(at)) {
      return { at, source: frontmatter ? 'dated note' : `daily note ${date}` };
    }
  }
  return file.updatedAt === undefined
    ? undefined
    : { at: file.updatedAt, source: 'updated note' };
}

/**
 * A small boost for a recently dated note, halving every `halfLifeDays` of
 * age counted to `now`, or 0 when the decay is off or the note has no date.
 */
function getRecencyWeight(
  date: { at: number } | undefined,
  halfLifeDays: number | undefined,
  now: number,
): number {
  if (!date || !halfLifeDays || halfLifeDays <= 0) {
    return 0;
  }
  const ageDays = Math.max(0, (now - date.at) / 86_400_000);
  return 0.1 * 2 ** (-ageDays / halfLifeDays);
}
