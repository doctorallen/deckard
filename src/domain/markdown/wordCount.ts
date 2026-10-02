import { findFrontmatterEnd } from './frontmatter';
import { findFencedLines, matchTaskLine, TaskLineShape } from './lineShapes';
import { findTaskMetadataSpans } from './taskMetadata';

/**
 * Counting a note's words the way a reader would: the sentences, not the
 * Markdown and metadata around them.
 */

/** Words a minute an adult reads silently, on average. */
export const READING_WORDS_PER_MINUTE = 238;

/** A task line whose checkbox and metadata are masked: any mark but `[>]`. */
const TASK_LINE: TaskLineShape = { indent: 'whitespace', marks: ' xX' };
/** A list item's marker, after which an indented line continues the item rather than starting code. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])[ \t]/;
/** A `^block-id` at the end of a line, which Markdown hides from a reader. */
const BLOCK_ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/;
/** Four spaces or a tab in: the indentation of an indented code block. */
const CODE_INDENT = /^(?: {4}|\t)/;

/** Every character of some text but its line breaks, as a space. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/** Blanks a stretch of a line to spaces, so its columns are kept. */
function blankRange(line: string, start: number, end: number): string {
  return line.slice(0, start) + ' '.repeat(Math.max(0, end - start)) + line.slice(end);
}

/** What masking carries from one line to the next. */
interface MaskState {
  /** Whether an HTML comment opened above is still open. */
  inComment: boolean;
  /** Whether the line above was indented code. */
  inIndentedCode: boolean;
  /** The last line with anything on it, as written. */
  lastText: string | undefined;
}

/**
 * Each line with what a reader would not count blanked to spaces, so every
 * word keeps its column: front matter, fenced and indented code, inline code,
 * HTML comments, task metadata and checkboxes, block ids, and a link's
 * address. A `[[target|alias]]` keeps its alias, or its target when it has
 * none.
 */
export function maskNoteForWords(lines: readonly string[]): string[] {
  const masked = [...lines];
  const start = maskFrontmatter(lines, masked);
  const fenced = findFencedLines([...lines]);
  const state: MaskState = { inComment: false, inIndentedCode: false, lastText: undefined };
  for (let at = start; at < masked.length; at += 1) {
    masked[at] = maskLine(lines, at, fenced, state);
  }
  return masked;
}

/** Blanks the front matter in `masked`, and says the first line after it. */
function maskFrontmatter(lines: readonly string[], masked: string[]): number {
  const frontmatterEnd = findFrontmatterEnd(lines, 'dashes-or-dots');
  if (frontmatterEnd === undefined) {
    return 0;
  }
  for (let at = 0; at <= frontmatterEnd; at += 1) {
    masked[at] = blank(masked[at]);
  }
  return frontmatterEnd + 1;
}

/** One line after the front matter, masked, with `state` carried on to the next. */
function maskLine(lines: readonly string[], at: number, fenced: ReadonlySet<number>, state: MaskState): string {
  const line = lines[at];
  if (fenced.has(at)) {
    return blank(line);
  }
  if (isIndentedCode(lines, at, state)) {
    state.inIndentedCode = true;
    return blank(line);
  }
  if (line.trim() !== '') {
    state.inIndentedCode = false;
    state.lastText = line;
  }
  return maskInline(maskComments(line, state));
}

/**
 * Whether a line is indented code: four spaces or a tab in, and either
 * under more indented code or after a blank line. After a blank line, a
 * line indented under a list item or under another indented line continues
 * that text, as Markdown reads it, rather than starting code.
 */
function isIndentedCode(lines: readonly string[], at: number, state: MaskState): boolean {
  const line = lines[at];
  if (!CODE_INDENT.test(line) || line.trim() === '') {
    return false;
  }
  if (state.inIndentedCode) {
    return true;
  }
  const previousBlank = at === 0 || lines[at - 1].trim() === '';
  return previousBlank && opensCodeAfter(state.lastText);
}

/** Whether an indented line after a blank line can start code under this text. */
function opensCodeAfter(lastText: string | undefined): boolean {
  return lastText === undefined || !(LIST_ITEM.test(lastText) || CODE_INDENT.test(lastText));
}

/**
 * The line with its HTML comments blanked. A comment shows nothing in
 * preview, so a reader never sees its words; one opened on a line hides
 * everything until it closes, so whether it is still open is carried to
 * the next line in `state`.
 */
function maskComments(text: string, state: MaskState): string {
  let line = text;
  let cursor = 0;
  while (cursor < line.length) {
    if (state.inComment) {
      const close = line.indexOf('-->', cursor);
      const end = close < 0 ? line.length : close + 3;
      line = blankRange(line, cursor, end);
      state.inComment = close < 0;
      cursor = end;
      continue;
    }
    const open = line.indexOf('<!--', cursor);
    if (open < 0) {
      break;
    }
    state.inComment = true;
    cursor = open;
  }
  return line;
}

/**
 * The line with its inline code, autolinks, link addresses, wiki-link
 * targets that have an alias, and a task's checkbox and metadata or a
 * prose line's block id blanked.
 */
function maskInline(text: string): string {
  let line = text.replace(/`+[^`]*?`+/g, blank);
  line = line.replace(/<https?:\/\/[^>]*>/g, blank);
  line = line.replace(/(\[[^\]]*\])(\([^)]*\))/g, (_whole, linkText: string, target: string) => linkText + blank(target));
  line = line.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (whole, target: string, alias: string) =>
    `  ${blank(target)} ${alias}  `.slice(0, whole.length),
  );
  const task = matchTaskLine(line, TASK_LINE);
  if (!task) {
    return line.replace(BLOCK_ID, blank);
  }
  let body = line.slice(task.head.length);
  for (const span of findTaskMetadataSpans(body)) {
    body = blankRange(body, span.start, span.end);
  }
  return blank(task.head) + body;
}

/**
 * The word breaker for the host's own language, made once: it holds no state
 * between calls, so one serves every count.
 */
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });

/** The words in some text, as the language's own word breaker finds them. */
export function countWords(text: string): number {
  let count = 0;
  for (const segment of WORD_SEGMENTER.segment(text)) {
    if (segment.isWordLike) {
      count += 1;
    }
  }
  return count;
}

/** A stretch of a note, zero-based, as an editor selection gives it. */
export interface WordRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** The words in masked lines, or only in the ranges given. */
export function countNoteWords(masked: readonly string[], ranges?: readonly WordRange[]): number {
  if (!ranges) {
    return countWords(masked.join('\n'));
  }
  let count = 0;
  for (const range of ranges) {
    const parts: string[] = [];
    for (let line = range.start.line; line <= range.end.line && line < masked.length; line += 1) {
      const from = line === range.start.line ? range.start.character : 0;
      const to = line === range.end.line ? range.end.character : masked[line].length;
      parts.push(masked[line].slice(from, to));
    }
    count += countWords(parts.join('\n'));
  }
  return count;
}

/** A count with its noun, `1 word` or `1,234 words`, grouped as US English writes it. */
function words(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'word' : 'words'}`;
}

/** The status bar's text and tooltip for a note, or a selection in it. */
export function describeWordCount(
  total: number,
  selected?: number,
): { text: string; tooltip: string } {
  if (selected !== undefined) {
    return {
      text: `${selected.toLocaleString('en-US')} of ${words(total)}`,
      tooltip: `${words(selected)} selected, of ${total.toLocaleString('en-US')} in this note.`,
    };
  }
  if (total === 0) {
    return { text: '0 words', tooltip: 'No words in this note yet. Front matter, code, and task metadata are not counted.' };
  }
  const minutes = Math.max(1, Math.round(total / READING_WORDS_PER_MINUTE));
  return {
    text: `${words(total)} · ${minutes} min`,
    tooltip: `${words(total)} in this note, about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} to read at ${READING_WORDS_PER_MINUTE} words a minute. Front matter, code, and task metadata are not counted.`,
  };
}
