/**
 * Every line the notes hold, by the uncommon words it uses: what Questions
 * (an answer offered under a question) and You've written this before (an
 * older line like the one being written) both rank lines with
 * (docs/implementation/38-questions.md, 39-written-before.md).
 *
 * A line is weighed as Related Notes weighs an entry, by BM25 over its
 * terms (wordSimilarity.ts), with every line of the workspace as the
 * corpus. It is built on first use, and after that each index brings only
 * the notes that changed: a note's lines are read once per parsed note,
 * which the index keeps until the note changes.
 */
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { findFencedLines, isHeading } from '../markdown/lineShapes';
import { extractTags, findFileDailyNoteDate } from '../markdown/parser';
import { parseIsoDate } from '../markdown/calendar';
import type { ParsedFile, Section, WorkspaceIndex } from '../model';
import { getLineTerms } from './wordSimilarity';

/** What a line is, besides words: a task's line, a question's, or neither. */
export type IndexedLineKind = 'text' | 'task' | 'question';

/** One line of a note, as the line index keeps it. */
export interface IndexedLine {
  readonly filePath: string;
  /** One-based. */
  readonly line: number;
  /** The line as it is written. */
  readonly text: string;
  readonly kind: IndexedLineKind;
  /** Its terms, as ranking compares them, each as often as it is written. */
  readonly terms: readonly string[];
  /** The tags it carries: its own, and those of the entry it is written in. */
  readonly tags: readonly string[];
  /** The entry it is written in, a heading's or a tagged line's. */
  readonly sectionId?: string;
  /**
   * When it was written, as near as the note says: a daily note's day,
   * else when the note last changed. Undefined when the note says neither.
   */
  readonly at?: number;
}

/** The lines and what BM25 weighs them by: how many lines hold each term, and how long a line is. */
export interface LineIndex {
  /** Every line holding each term, by note. */
  readonly postings: ReadonlyMap<string, ReadonlyMap<string, readonly IndexedLine[]>>;
  readonly documentFrequency: ReadonlyMap<string, number>;
  /** How many lines there are, at least one. */
  readonly documentCount: number;
  /** How many terms a line holds on average, at least one. */
  readonly averageLength: number;
  /** A note's lines, in order, by path. */
  linesOf(filePath: string): readonly IndexedLine[];
}

/** One line's match: its BM25 score, and the uncommon terms it shares, the weightiest first. */
export interface LineMatch {
  readonly line: IndexedLine;
  readonly score: number;
  readonly shared: readonly string[];
}

/**
 * Words every workspace of notes writes often, whatever it is about, so two
 * lines sharing them are no more alike: `today`, `meeting`, `notes`. A
 * stop word never becomes a term at all; these do, and count for little.
 */
const NOTE_WORDS = new Set([
  'today', 'tomorrow', 'yesterday', 'week', 'weeks', 'month', 'day', 'days',
  'meeting', 'meetings', 'call', 'calls', 'sync', 'standup', 'notes', 'note',
  'update', 'updates', 'thing', 'things', 'need', 'needs', 'think', 'good',
  'new', 'next', 'last', 'time', 'see', 'said', 'says', 'want', 'wants',
  'going', 'work', 'working', 'team', 'people', 'check', 'look', 'let',
]);

/** A term held by more than this share of lines is common, in a workspace of enough lines to tell. */
const COMMON_SHARE = 0.02;
/** Below this many lines, every term but a note word is uncommon. */
const FEW_LINES = 50;
/**
 * A term held by this many lines or fewer is uncommon however few lines
 * there are: a line and the one it is like hold it, and one more.
 */
const FEW_HOLDERS = 5;

/** A note's lines, and how many of them hold each term, read once per parsed note. */
interface FileLines {
  readonly lines: readonly IndexedLine[];
  readonly termLines: ReadonlyMap<string, number>;
  readonly length: number;
}

const linesByFile = new WeakMap<ParsedFile, FileLines>();

/**
 * The line index, kept from one index to the next: it is changed in place
 * by the notes that differ, so building it costs one pass over every note
 * once, and a save costs only its note.
 */
class LineIndexState implements LineIndex {
  public readonly postings = new Map<string, Map<string, IndexedLine[]>>();
  public readonly documentFrequency = new Map<string, number>();
  private readonly files = new Map<string, ParsedFile>();
  private readonly read = new Map<string, FileLines>();
  private lineCount = 0;
  private termCount = 0;
  /** The index the lines are those of. */
  public index: WorkspaceIndex | undefined;

  public get documentCount(): number {
    return Math.max(1, this.lineCount);
  }

  public get averageLength(): number {
    return Math.max(1, this.termCount / Math.max(1, this.lineCount));
  }

  public linesOf(filePath: string): readonly IndexedLine[] {
    return this.read.get(filePath)?.lines ?? [];
  }

  /** Brings the lines to `index`: the notes it no longer has go, and the ones that changed are read again. */
  public update(index: WorkspaceIndex): void {
    this.files.forEach((file, filePath) => {
      if (index.files.get(filePath) !== file) {
        this.remove(filePath);
      }
    });
    index.files.forEach((file, filePath) => {
      if (this.files.get(filePath) !== file) {
        this.add(file);
      }
    });
    this.index = index;
  }

  private add(file: ParsedFile): void {
    const read = readFileLines(file);
    this.files.set(file.filePath, file);
    this.read.set(file.filePath, read);
    this.lineCount += read.lines.length;
    this.termCount += read.length;
    read.termLines.forEach((count, term) => this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + count));
    read.lines.forEach((line) =>
      new Set(line.terms).forEach((term) => {
        let byFile = this.postings.get(term);
        if (!byFile) {
          byFile = new Map();
          this.postings.set(term, byFile);
        }
        const lines = byFile.get(file.filePath);
        if (lines) {
          lines.push(line);
        } else {
          byFile.set(file.filePath, [line]);
        }
      }),
    );
  }

  private remove(filePath: string): void {
    const read = this.read.get(filePath);
    this.files.delete(filePath);
    this.read.delete(filePath);
    if (!read) {
      return;
    }
    this.lineCount -= read.lines.length;
    this.termCount -= read.length;
    read.termLines.forEach((count, term) => {
      const left = (this.documentFrequency.get(term) ?? 0) - count;
      const byFile = this.postings.get(term);
      byFile?.delete(filePath);
      if (left > 0) {
        this.documentFrequency.set(term, left);
      } else {
        this.documentFrequency.delete(term);
        this.postings.delete(term);
      }
    });
  }
}

/** The one line index, brought up to each index it is asked for. */
let current: LineIndexState | undefined;

/**
 * The line index of `index`, built the first time it is asked for and then
 * brought up to each index by the notes that changed.
 */
export function getLineIndex(index: WorkspaceIndex): LineIndex {
  current ??= new LineIndexState();
  if (current.index !== index) {
    current.update(index);
  }
  return current;
}

/**
 * A note's lines as the index keeps them: every line with words, leaving
 * out its front matter, code, and headings, each with its terms, tags, and
 * the day it was written, as near as the note says.
 */
function readFileLines(file: ParsedFile): FileLines {
  const cached = linesByFile.get(file);
  if (cached) {
    return cached;
  }
  const texts = file.content.split(/\r?\n/);
  const skipped = findFencedLines(texts);
  const frontmatterEnd = findFrontmatterEnd(texts) ?? -1;
  const taskLines = new Set(file.tasks.map((task) => task.lineNumber));
  const questionLines = new Set((file.questions ?? []).map((question) => question.lineNumber));
  const at = noteDay(file);
  const lines: IndexedLine[] = [];
  const termLines = new Map<string, number>();
  let length = 0;
  texts.forEach((text, lineIndex) => {
    if (lineIndex <= frontmatterEnd || skipped.has(lineIndex) || !text.trim() || isHeading(text)) {
      return;
    }
    const terms = getLineTerms(text);
    if (terms.length === 0) {
      return;
    }
    const line = lineIndex + 1;
    const section = findLineSection(file.sections, line);
    const own = extractTags(text).map((tag) => tag.key.toLowerCase());
    lines.push({
      filePath: file.filePath,
      line,
      text,
      kind: lineKind(line, taskLines, questionLines),
      terms,
      tags: [...new Set([...own, ...(section?.tags ?? []).map((tag) => tag.toLowerCase())])],
      ...(section ? { sectionId: section.id } : {}),
      ...(at === undefined ? {} : { at }),
    });
    length += terms.length;
    new Set(terms).forEach((term) => termLines.set(term, (termLines.get(term) ?? 0) + 1));
  });
  const read = { lines, termLines, length };
  linesByFile.set(file, read);
  return read;
}

/** Whether a line is a question's, a task's, or neither. */
function lineKind(line: number, taskLines: ReadonlySet<number>, questionLines: ReadonlySet<number>): IndexedLineKind {
  if (questionLines.has(line)) {
    return 'question';
  }
  return taskLines.has(line) ? 'task' : 'text';
}

/** When a note's lines were written, as near as it says: a daily note's day, else its last change. */
function noteDay(file: ParsedFile): number | undefined {
  return parseIsoDate(findFileDailyNoteDate(file)) ?? file.updatedAt ?? file.createdAt;
}

/** The entry a line is written in: the tagged line it is part of, else the deepest heading over it. */
function findLineSection(sections: readonly Section[], line: number): Section | undefined {
  let found: Section | undefined;
  for (const section of sections) {
    if (section.startLine > line) {
      break;
    }
    if (section.endLine >= line && (!found || section.isInline || section.headingLevel >= found.headingLevel)) {
      found = section;
    }
  }
  return found;
}

/**
 * Whether a term says something about which lines are alike: not a word
 * every note writes, and held by few enough lines, once there are enough
 * lines for few to mean something.
 */
export function isUncommonTerm(lines: Pick<LineIndex, 'documentFrequency' | 'documentCount'>, term: string): boolean {
  if (NOTE_WORDS.has(term)) {
    return false;
  }
  return (
    lines.documentCount < FEW_LINES ||
    (lines.documentFrequency.get(term) ?? 0) <= Math.max(FEW_HOLDERS, lines.documentCount * COMMON_SHARE)
  );
}

/** How much one term weighs in a line it is written in `frequency` times, by BM25 as Related Notes weighs it. */
function weighTerm(lines: LineIndex, term: string, frequency: number, length: number): number {
  const documents = lines.documentFrequency.get(term) ?? 0;
  const inverse = Math.log(1 + (lines.documentCount - documents + 0.5) / (documents + 0.5));
  const lengthFactor = 1.2 * (1 - 0.75 + 0.75 * (length / lines.averageLength));
  return inverse * ((frequency * 2.2) / (frequency + lengthFactor));
}

/** What a search for lines like some words keeps. */
export interface LineSearch {
  /** How many uncommon terms a line must share. */
  minShared: number;
  /** Whether a line may be listed at all; asked only of lines that share enough. */
  accept?: (line: IndexedLine) => boolean;
}

/**
 * The lines that share at least `minShared` of the uncommon terms in
 * `terms`, best first, each scored by BM25 over the uncommon terms it
 * shares. Only the postings of those terms are read, so a search costs the
 * lines that share a word with it, not every line.
 */
export function findLinesLike(lines: LineIndex, terms: readonly string[], search: LineSearch): LineMatch[] {
  const wanted = [...new Set(terms)].filter((term) => isUncommonTerm(lines, term));
  if (wanted.length < search.minShared) {
    return [];
  }
  const sharedBy = new Map<IndexedLine, string[]>();
  wanted.forEach((term) =>
    lines.postings.get(term)?.forEach((found) =>
      found.forEach((line) => {
        const shared = sharedBy.get(line);
        if (shared) {
          shared.push(term);
        } else {
          sharedBy.set(line, [term]);
        }
      }),
    ),
  );
  const matches: LineMatch[] = [];
  sharedBy.forEach((shared, line) => {
    if (shared.length < search.minShared || (search.accept && !search.accept(line))) {
      return;
    }
    const weighed = shared
      .map((term) => ({ term, weight: weighTerm(lines, term, line.terms.filter((each) => each === term).length, line.terms.length) }))
      .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term));
    matches.push({ line, score: weighed.reduce((total, each) => total + each.weight, 0), shared: weighed.map((each) => each.term) });
  });
  return matches.sort((left, right) => right.score - left.score || left.line.filePath.localeCompare(right.line.filePath) || left.line.line - right.line.line);
}

/** A line's words as a list shows them: without its bullet, its box, and its trailing whitespace. */
export function lineWords(text: string): string {
  return text.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[^\]]\]\s+)?/, '').trim();
}

/** A short, stable name for a line's words, which a pair the reader set aside is kept by. */
export function hashLine(text: string): string {
  const words = lineWords(text).replace(/\s+/g, ' ').toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < words.length; index += 1) {
    hash = Math.imul(hash ^ words.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
