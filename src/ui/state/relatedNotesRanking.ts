/**
 * Related Notes: which entries in other notes relate to the one being read,
 * how strongly, and why. An entry qualifies by sharing a tag, an associated
 * tag, or a Wiki link with it; shared wording and recency then adjust its
 * score, and a more specific entry outranks the broad heading it sits under.
 */

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
  WorkspaceIndex,
} from '../../core/types';
import {
  extractWikiLinks,
  findDailyNoteDate,
  stripTags,
} from '../../core/markdown/parser';
import {
  findTagAssociation,
  getFileName,
  getHeadingPath,
  getInlineSource,
  getNoteTitle,
  getTitleTags,
} from './dashboardState';
import {
  createLexicalModel,
  getCachedLexicalTerms,
  getLexicalWeight,
  getSectionLexicalContent,
} from './wordSimilarity';

/**
 * Chooses between tag-overview context and the active Markdown editor context.
 */
export function createSidebarSnapshot(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile | undefined,
  enableKeywordLinks = true,
  relatedNotesSortMode: RelatedNotesSortMode = 'tags',
  sectionAccessCounts: Record<string, number> = {},
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  activeEntryTitle?: string,
  activeTagWeights?: ReadonlyMap<string, number>,
  rankingOptions?: RelatedNotesRankingOptions,
): SidebarNotesSnapshot {
  if (!activeFile) {
    return {
      activeTags: [],
      notes: [],
      relatedNotesSortMode,
      tagOverviewFilters: [],
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
  const weightedActiveTags: SidebarTag[] = activeTags.map((tag) => ({
    ...tag,
    weight: activeTagWeights?.get(tag.key) ?? 1,
  }));
  const notes = rankRelatedNotes(
    index,
    activeFilePath,
    activeFile,
    activeTags,
    enableKeywordLinks,
    tagTitleDisplayMode,
    activeTagWeights,
    rankingOptions,
  );
  return {
    activeFileName: getFileName(activeFilePath),
    activeEntryTitle,
    activeTags: weightedActiveTags,
    notes: sortRelatedNotes(notes, relatedNotesSortMode, sectionAccessCounts),
    relatedNotesSortMode,
    tagOverviewFilters: [],
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
}

export function rankRelatedNotes(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile,
  activeTags: TagReference[],
  enableKeywordLinks = true,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  activeTagWeights: ReadonlyMap<string, number> = new Map(),
  options: RelatedNotesRankingOptions = {},
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

  index.files.forEach((file, filePath) => {
    if (filePath === activeFilePath) {
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
    }> = matchingSections.map((section) => ({
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
        return {
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
    linkTargetsEntry(link, activeFilePath ?? activeFile.filePath, activeEntryTitle),
  );
  const activeMatchesCandidate = activeFile.links.some((link) =>
    linkTargetsEntry(link, candidateFile.filePath, candidateTitle),
  );
  if (candidateMatchesActive || activeMatchesCandidate) {
    return { entryWeight: 0.5, fileWeight: 0 };
  }
  return filesAreLinked(activeFile, candidateFile)
    ? { entryWeight: 0, fileWeight: 0.1 }
    : { entryWeight: 0, fileWeight: 0 };
}

function filesAreLinked(left: ParsedFile, right: ParsedFile): boolean {
  const leftNames = getLinkNames(left.filePath);
  const rightNames = getLinkNames(right.filePath);
  return (
    left.links.some((link) => rightNames.has(getLinkFileTarget(link))) ||
    right.links.some((link) => leftNames.has(getLinkFileTarget(link)))
  );
}

function linkTargetsEntry(
  link: string,
  filePath: string,
  title: string,
): boolean {
  const [fileTarget, headingTarget] = link.split('#', 2);
  if (!getLinkNames(filePath).has(normalizeLink(fileTarget))) {
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

function getLinkNames(filePath: string): Set<string> {
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
  return names;
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

function getRecencyWeight(
  date: { at: number } | undefined,
  halfLifeDays: number | undefined,
): number {
  if (!date || !halfLifeDays || halfLifeDays <= 0) {
    return 0;
  }
  const ageDays = Math.max(0, (Date.now() - date.at) / 86_400_000);
  return 0.1 * 2 ** (-ageDays / halfLifeDays);
}
