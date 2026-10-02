/**
 * What Related Notes offers a note with no tags: the entries worded like it,
 * listed apart and marked weak, and the tags those entries use, as
 * suggestions for it.
 */
import { isParkedFile, isParkedSection, isParkedTask } from '../index/parked';
import { isPeriodicNoteFile, isPersonTag } from '../markdown/parser';
import { countTagMatches } from '../query/queryEvaluator';
import {
  ParsedFile,
  RankedNote,
  Section,
  SuggestedTag,
  TagReference,
  TagTitleDisplayMode,
  Task,
  WorkspaceIndex,
} from '../model';
import { getFileName } from '../../shared/paths';
import { createSectionExcerpt } from './entryExcerpt';
import {
  getDailyNoteDate,
  getHeadingPath,
  getInlineSource,
  getNoteTitle,
  getTagReferences,
  getTaskHeadingPath,
  getTitleTags,
} from './entryLabels';
import {
  createMoreLikeThisModel,
  getEntryTerms,
  getLexicalWeight,
  getSectionLexicalContent,
  getTermPostings,
  LexicalEvidence,
  LexicalModel,
} from './wordSimilarity';
import type { RelatedNotesRankingOptions } from './relatedNotesContext';

/** What a wording-only result needs: two shared terms, or one rare one. */
const WORDING_MIN_TERMS = 2;
const WORDING_RARE_TERM = 1.5;
/** At most this many results from one note, and in all. */
const WORDING_PER_FILE = 2;
const WORDING_LIMIT = 10;
/** A wording-only score is never more than weak. */
const WORDING_MAX_SCORE = 30;

/** An entry worded like the note, with its BM25 sum and the tags it uses. */
export interface SimilarEntry {
  note: RankedNote;
  rawWeight: number;
  tags: TagReference[];
}

/** The note whose wording is matched, and what is already listed beside it. */
export interface WordingSubject {
  filePath: string | undefined;
  file: ParsedFile;
  /** `inline` unless given. */
  tagTitleDisplayMode?: TagTitleDisplayMode;
  /** Entries already listed as related, which are left out. */
  listed?: readonly RankedNote[];
}

/** An entry that shares enough wording with the note to be listed. */
interface WordingCandidate {
  entry: Section | Task;
  file: ParsedFile;
  isSection: boolean;
  evidence: LexicalEvidence;
}

/** Which entries a wording search may list, beside the note being read. */
interface WordingFilter {
  /** Parked entries are listed only beside a parked note. */
  keepParked: boolean;
  hidePeriodicNotes?: boolean;
}

/**
 * The entries worded like a note that has no tags: up to ten, two per note,
 * each needing two shared terms or one rare one, ordered by their BM25 sum
 * and scored weak at most. Entries already listed as related are left out.
 */
export function rankSimilarWording(
  index: WorkspaceIndex,
  subject: WordingSubject,
  options: RelatedNotesRankingOptions = {},
): SimilarEntry[] {
  const { filePath: activeFilePath, file: activeFile } = subject;
  const { tagTitleDisplayMode = 'inline', listed = [] } = subject;
  const model = createMoreLikeThisModel(index, activeFile);
  if (model.queryTerms.size === 0) {
    return [];
  }
  const filter: WordingFilter = {
    keepParked: activeFilePath !== undefined && isParkedFile(index, activeFilePath),
    hidePeriodicNotes: options.hidePeriodicNotes,
  };
  const already = new Set(listed.map((note) => `${note.filePath}:${note.sourceLine}`));
  const scored = [...findWordingCandidates(index, model, subject)].flatMap((entry) =>
    scoreWordingCandidate(index, model, entry, filter),
  );
  return selectWordingResults(scored, already)
    .map((item) => toSimilarEntry(item, tagTitleDisplayMode));
}

/** Every entry outside the note holding one of the model's terms. */
function findWordingCandidates(
  index: WorkspaceIndex,
  model: LexicalModel,
  subject: WordingSubject,
): Set<Section | Task> {
  const postings = getTermPostings(index);
  const candidates = new Set<Section | Task>();
  model.queryTerms.forEach((term) =>
    (postings.get(term) ?? []).forEach((entry) => {
      if (entry.filePath !== subject.filePath && entry.filePath !== subject.file.filePath) {
        candidates.add(entry);
      }
    }),
  );
  return candidates;
}

/**
 * An entry with its wording evidence, or nothing when it may not be listed
 * or shares too little: fewer than two terms and none of them rare.
 */
function scoreWordingCandidate(
  index: WorkspaceIndex,
  model: LexicalModel,
  entry: Section | Task,
  filter: WordingFilter,
): WordingCandidate[] {
  const file = index.files.get(entry.filePath);
  if (!file) {
    return [];
  }
  const isSection = 'heading' in entry;
  const parked = isSection ? isParkedSection(index, entry.id) : isParkedTask(index, entry.id);
  if ((!filter.keepParked && (parked || isParkedFile(index, entry.filePath))) ||
    (filter.hidePeriodicNotes && isPeriodicNoteFile(file))) {
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
}

/**
 * The strongest candidates, at most two from a note and ten in all, leaving
 * out what is already listed. A task under a section that is a candidate
 * too is seen through that section.
 */
function selectWordingResults(
  scored: WordingCandidate[],
  already: ReadonlySet<string>,
): WordingCandidate[] {
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
    .slice(0, WORDING_LIMIT);
}

/** A candidate as Related Notes lists it: a weak card, with why and its tags. */
function toSimilarEntry(
  { entry, file, isSection, evidence }: WordingCandidate,
  tagTitleDisplayMode: TagTitleDisplayMode,
): SimilarEntry {
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
export function findSimilarWording(
  index: WorkspaceIndex,
  subject: WordingSubject,
  options: RelatedNotesRankingOptions = {},
): { notes: RankedNote[]; tags: SuggestedTag[] } {
  const similar = rankSimilarWording(index, subject, options);
  return {
    notes: similar.map((item) => item.note),
    tags: suggestTagsFromSimilar(index, similar, options),
  };
}
