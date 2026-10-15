/**
 * You've written this before: the older lines a line being written is
 * like, ranked as Related Notes ranks wording, by BM25 over the uncommon
 * words they share (docs/implementation/39-written-before.md).
 */
import { DAY_MS } from '../markdown/calendar';
import type { WorkspaceIndex } from '../model';
import { findLinesLike, getLineIndex, hashLine, lineWords } from './lineIndex';
import { getLineTerms } from './wordSimilarity';

/** How many words a line must have before it is compared at all. */
export const WRITTEN_BEFORE_MIN_WORDS = 6;
/** How many uncommon words an older line must share with it. */
export const WRITTEN_BEFORE_MIN_SHARED = 3;
/**
 * The BM25 score an older line must reach over the words it shares: three
 * words that a line in forty writes clear it, and three that a line in
 * twelve writes do not (src/test/written-before.test.ts).
 */
export const WRITTEN_BEFORE_MIN_SCORE = 8;
/** How many older lines are offered at most. */
export const WRITTEN_BEFORE_LIMIT = 2;
/** Lines written this recently are too fresh to be "before". */
export const WRITTEN_BEFORE_RECENT_MS = 2 * DAY_MS;
/** How much more an older line counts when it shares a tag with the line being written. */
const SHARED_TAG_BONUS = 1.25;

/** The line being written: its words, its note, and its tags, its own and its heading's. */
export interface WrittenLine {
  text: string;
  filePath: string;
  tags: readonly string[];
}

/** An older line like it. */
export interface WrittenBeforeMatch {
  filePath: string;
  /** One-based. */
  line: number;
  /** The older line's words, without its bullet or box. */
  text: string;
  /** When it was written, as near as its note says. */
  at?: number;
  /** The entry it is written in. */
  sectionId?: string;
  /** The uncommon words both lines hold, the weightiest first. */
  shared: readonly string[];
  /** The tags both lines carry. */
  sharedTags: readonly string[];
  score: number;
  /** What Not the same keeps the pair by. */
  key: string;
}

/** What finding older lines reads besides the index. */
export interface WrittenBeforeOptions {
  now: number;
  /** The pairs set aside with Not the same, each `notSameKey(line, match)`. */
  rejected: ReadonlySet<string>;
}

/** The words a line says, as the six-word rule counts them: each with a letter or digit, tags and links aside. */
export function countLineWords(text: string): number {
  return lineWords(text)
    .replace(/\[\[[^\]]*\]\]|https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word) && !/^[#@]/.test(word)).length;
}

/** The key a line and an older line set aside with Not the same are kept by: both lines' words. */
export function notSameKey(text: string, match: Pick<WrittenBeforeMatch, 'text'>): string {
  return `${hashLine(text)}\u0000${hashLine(match.text)}`;
}

/**
 * The older lines like `line`, at most two, best first: lines of other
 * notes, written more than two days before `now`, that share at least three
 * of its uncommon words, scoring at least WRITTEN_BEFORE_MIN_SCORE over
 * them; one that shares one of its tags ranks a little higher. A pair set
 * aside with Not the same is never offered again. Nothing for a line of
 * fewer than six words.
 */
export function findWrittenBefore(index: WorkspaceIndex, line: WrittenLine, options: WrittenBeforeOptions): WrittenBeforeMatch[] {
  if (countLineWords(line.text) < WRITTEN_BEFORE_MIN_WORDS) {
    return [];
  }
  const tags = new Set(line.tags.map((tag) => tag.toLowerCase()));
  const recent = options.now - WRITTEN_BEFORE_RECENT_MS;
  return findLinesLike(getLineIndex(index), getLineTerms(line.text), {
    minShared: WRITTEN_BEFORE_MIN_SHARED,
    accept: (candidate) => candidate.filePath !== line.filePath && (candidate.at === undefined || candidate.at <= recent),
  })
    .filter((match) => match.score >= WRITTEN_BEFORE_MIN_SCORE)
    .map((match) => {
      const text = lineWords(match.line.text);
      const sharedTags = match.line.tags.filter((tag) => tags.has(tag));
      return {
        filePath: match.line.filePath,
        line: match.line.line,
        text,
        ...(match.line.at === undefined ? {} : { at: match.line.at }),
        ...(match.line.sectionId ? { sectionId: match.line.sectionId } : {}),
        shared: match.shared,
        sharedTags,
        score: sharedTags.length > 0 ? match.score * SHARED_TAG_BONUS : match.score,
        key: notSameKey(line.text, { text }),
      };
    })
    .filter((match) => !options.rejected.has(match.key))
    .sort((left, right) => right.score - left.score)
    .slice(0, WRITTEN_BEFORE_LIMIT);
}

/** How long the hint after a line may run, its date included. */
const HINT_LENGTH = 60;

/**
 * The hint after the cursor's line: `↺ 12 Mar: same lag, fixed by
 * restarting the curve loader`, the older line cut to fit; under Zen, the
 * `↺` alone.
 */
export function describeWrittenBeforeHint(match: Pick<WrittenBeforeMatch, 'text'>, day: string | undefined, zen = false): string {
  if (zen) {
    return '↺';
  }
  const lead = day ? `↺ ${day}: ` : '↺ ';
  const room = Math.max(10, HINT_LENGTH - lead.length);
  const words = match.text.replace(/\s+/g, ' ').trim();
  return `${lead}${words.length > room ? `${words.slice(0, room - 1).trimEnd()}…` : words}`;
}

/** Link it here's line: the line, then ` (see [[2026-03-12#Rates desk standup]])`. */
export function linkItHere(text: string, link: string): string {
  return `${text.replace(/\s+$/, '')} (see ${link})`;
}
