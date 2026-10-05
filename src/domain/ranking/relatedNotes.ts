/**
 * Related Notes: which entries in other notes relate to the one being read,
 * how strongly, and why. An entry qualifies by sharing a tag, an associated
 * tag, or a Wiki link with it; shared wording and recency then adjust its
 * score, and a more specific entry outranks the broad heading it sits under.
 */
import { isParkedFile, isParkedSection, isParkedTask } from '../index/parked';
import { extractNoteLinks, isPeriodicNoteFile } from '../markdown/parser';
import {
  ParsedFile,
  RankedNote,
  Section,
  TagReference,
  TagTitleDisplayMode,
  Task,
  WorkspaceIndex,
} from '../model';
import {
  getDailyNoteDate,
  getHeadingPath,
  getInlineSource,
  getNoteTitle,
  getTagReferences,
  getTaskHeadingPath,
  getTitleTags,
} from './entryLabels';
import { createLinkNames, getLinkEvidence } from './linkEvidence';
import {
  EntryReference,
  FileScope,
  RankingContext,
  RelatedNotesRankingAt,
} from './relatedNotesContext';
import { compareRelatedNotes } from './relatedNotesOrder';
import { scoreReference } from './relatedNotesScore';
import { createAssociationMatcher, TagAssociationMatches } from './tagAssociations';
import { createLexicalModel, getSectionLexicalContent } from './wordSimilarity';
import { entryIdOf, isEntrySection } from '../markdown/noteEntries';

/** The note ranked against, and how its tags and titles count. */
export interface RelatedNotesSubject {
  /** Its path, or undefined for a note not saved in the workspace. */
  filePath: string | undefined;
  file: ParsedFile;
  /** The tags it is ranked by, usually every tag it carries. */
  tags: TagReference[];
  /** Whether shared wording adjusts scores; on unless false. */
  enableKeywordLinks?: boolean;
  /** `inline` unless given. */
  tagTitleDisplayMode?: TagTitleDisplayMode;
  /** How much each tag counts; 1 for a tag not in it. */
  tagWeights?: ReadonlyMap<string, number>;
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

/**
 * The notes related to the active one, by shared tags, the tags learned to
 * go with them, links, and wording, each scored in `options`; a dated note's
 * recency is counted to `options.now`.
 *
 * Other notes are ranked by shared tags, and their matching sections and
 * tasks are exposed as source references, without duplicating a task already
 * represented by its section.
 */
export function rankRelatedNotes(
  index: WorkspaceIndex,
  subject: RelatedNotesSubject,
  options: RelatedNotesRankingAt,
): RankedNote[] {
  const context = createRankingContext(index, subject, options);
  const notes: RankedNote[] = [];
  index.files.forEach((file, filePath) => {
    if (isRankedFile(context, file, filePath)) {
      notes.push(...rankFile(context, file, filePath));
    }
  });
  return notes.sort(compareRelatedNotes);
}

/**
 * What one ranking reads for every entry it scores, worked out once: the
 * note being read and its tags with their weights, the association
 * matcher, the link names, and, when keyword links are on, the lexical
 * model. The association support is at least one, whatever was asked.
 */
function createRankingContext(
  index: WorkspaceIndex,
  subject: RelatedNotesSubject,
  options: RelatedNotesRankingAt,
): RankingContext {
  const { filePath: activeFilePath, file: activeFile, tags: activeTags } = subject;
  const { enableKeywordLinks = true, tagTitleDisplayMode = 'inline' } = subject;
  const { tagWeights: weights = new Map<string, number>() } = subject;
  const minimumSupport = Math.max(
    1,
    Math.floor(options.associationMinimumSupport ?? 1),
  );
  return {
    index,
    active: { file: activeFile, filePath: activeFilePath },
    activeTags,
    activeKeys: new Set(activeTags.map((tag) => tag.key)),
    weights,
    totalActiveWeight: activeTags.reduce(
      (total, tag) => total + (weights.get(tag.key) ?? 1),
      0,
    ),
    matchAssociations: createAssociationMatcher(index, { activeTags, weights, minimumSupport }),
    linkNames: createLinkNames(),
    lexicalModel: enableKeywordLinks
      ? createLexicalModel(index, activeFile)
      : undefined,
    tagTitleDisplayMode,
    // Parked notes are left out, unless the note being read is parked itself;
    // then they are ranked, after the rest.
    keepParked: activeFilePath !== undefined && isParkedFile(index, activeFilePath),
    options,
  };
}

/** Whether a note is ranked at all: not the note itself, parked, or hidden. */
function isRankedFile(context: RankingContext, file: ParsedFile, filePath: string): boolean {
  if (filePath === context.active.filePath) {
    return false;
  }
  if (!context.keepParked && isParkedFile(context.index, filePath)) {
    return false;
  }
  return !(context.options.hidePeriodicNotes && isPeriodicNoteFile(file));
}

/** A note's qualifying sections, then its tasks not under one, each scored. */
function rankFile(context: RankingContext, file: ParsedFile, filePath: string): RankedNote[] {
  const sectionMatches = findMatchingSections(context, file);
  const matchingSections = sectionMatches.map(({ entry }) => entry);
  const matchingSectionIds = new Set(
    matchingSections.map((section) => section.id),
  );
  const sectionsById = new Map(
    file.sections.map((section) => [section.id, section]),
  );
  const scope: FileScope = { file, filePath, sectionsById, matchingSections };
  const references = sectionMatches.map((match) => toSectionReference(context, scope, match));
  // A task under a matching section is already visible through that section;
  // include only standalone matches to keep sidebar entries distinct.
  findMatchingTasks(context, file, matchingSectionIds).forEach((match) => {
    references.push(toTaskReference(context, scope, match));
  });
  return references.map((reference) => scoreReference(context, scope, reference));
}

/** An entry that qualified, with its tags and what their associations say. */
interface EntryMatch<T> {
  entry: T;
  tags: TagReference[];
  associations: TagAssociationMatches;
}

/** A section that shares a tag, an association, or a link with the note. */
function findMatchingSections(
  context: RankingContext,
  file: ParsedFile,
): Array<EntryMatch<Section>> {
  return file.sections.flatMap((section) => {
    // An untagged heading under a tagged one is part of that note, read with
    // it (entryLexicalContent), never a row of its own.
    if (!isEntrySection(section) && !entryIdOf(section).startsWith('file:')) {
      return [];
    }
    if (!context.keepParked && isParkedSection(context.index, section.id)) {
      return [];
    }
    const tags = getTagReferences(section.tags, section.tagLabels);
    const associations = context.matchAssociations(tags);
    const linkEvidence = getLinkEvidence(context.linkNames, context.active, {
      file,
      links: extractNoteLinks(
        entryLexicalContent(section, file.sections),
        file.filePath,
      ),
      title: section.heading,
    });
    // Shared wording only adjusts the score of an entry that shares a tag,
    // an association, or a link. On its own it would make nearly every
    // entry in the workspace "related".
    const qualifies =
      tags.some((tag) => context.activeKeys.has(tag.key)) ||
      associations.associated.length > 0 ||
      linkEvidence.entryWeight > 0 ||
      linkEvidence.fileWeight > 0;
    return qualifies ? [{ entry: section, tags, associations }] : [];
  });
}

/**
 * A note's own text and its untagged headings' (noteEntries.ts), each
 * heading's read as Related Notes reads it; a section that owns nothing
 * reads as itself.
 */
function entryLexicalContent(section: Section, fileSections: Section[]): string {
  const owned = fileSections.filter((part) => part !== section && entryIdOf(part) === section.id);
  if (owned.length === 0) {
    return getSectionLexicalContent(section, fileSections);
  }
  return [section, ...owned]
    .sort((left, right) => left.startLine - right.startLine)
    .map((part) => getSectionLexicalContent(part, fileSections))
    .join('\n');
}

/** A task that qualifies as a section does, and is not under one that did. */
function findMatchingTasks(
  context: RankingContext,
  file: ParsedFile,
  matchingSectionIds: ReadonlySet<string>,
): Array<EntryMatch<Task>> {
  return file.tasks.flatMap((task) => {
    if (!context.keepParked && isParkedTask(context.index, task.id)) {
      return [];
    }
    const tags = getTagReferences(task.tags, task.tagLabels);
    const associations = context.matchAssociations(tags);
    const linkEvidence = getLinkEvidence(context.linkNames, context.active, {
      file,
      links: extractNoteLinks(task.sourceLineText, task.filePath),
      title: task.title,
    });
    const qualifies =
      (tags.some((tag) => context.activeKeys.has(tag.key)) ||
        associations.associated.length > 0 ||
        linkEvidence.entryWeight > 0 ||
        linkEvidence.fileWeight > 0) &&
      (!task.sectionId || !matchingSectionIds.has(task.entryId ?? task.sectionId));
    return qualifies ? [{ entry: task, tags, associations }] : [];
  });
}

/** A matched section as the entry the ranking scores and the page shows. */
function toSectionReference(
  context: RankingContext,
  { file, sectionsById }: FileScope,
  { entry: section, tags, associations }: EntryMatch<Section>,
): EntryReference {
  return {
    parked: isParkedSection(context.index, section.id),
    section,
    sectionId: section.id,
    title: getNoteTitle(section.heading, context.tagTitleDisplayMode),
    sourceLine: section.startLine,
    titleTags: getTitleTags(
      section.tags,
      section.tagLabels,
      getInlineSource(section),
    ),
    updatedAt: file.updatedAt ?? section.updatedAt,
    tags,
    associations,
    rawContent: entryLexicalContent(section, file.sections),
    links: extractNoteLinks(
      entryLexicalContent(section, file.sections),
      file.filePath,
    ),
    headingPath: getHeadingPath(section, sectionsById),
    dailyDate: getDailyNoteDate(file),
  };
}

/** A matched task as the entry the ranking scores and the page shows. */
function toTaskReference(
  context: RankingContext,
  { file, sectionsById }: FileScope,
  { entry: task, tags, associations }: EntryMatch<Task>,
): EntryReference {
  return {
    parked: isParkedTask(context.index, task.id),
    sectionId: task.sectionId,
    title: getNoteTitle(task.title, context.tagTitleDisplayMode),
    sourceLine: task.lineNumber,
    titleTags: getTitleTags(task.tags, task.tagLabels, task.title),
    updatedAt: file.updatedAt ?? task.updatedAt,
    tags,
    associations,
    rawContent: task.sourceLineText,
    links: extractNoteLinks(task.sourceLineText, task.filePath),
    headingPath: getTaskHeadingPath(task, sectionsById),
    dailyDate: getDailyNoteDate(file),
  };
}
