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
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])[ \t]/;
const BLOCK_ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/;

function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/** Blanks a stretch of a line to spaces, so its columns are kept. */
function blankRange(line: string, start: number, end: number): string {
  return line.slice(0, start) + ' '.repeat(Math.max(0, end - start)) + line.slice(end);
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
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, at) => at > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) {
      for (let at = 0; at <= end; at += 1) {
        masked[at] = blank(masked[at]);
      }
      start = end + 1;
    }
  }
  const fenced = findFencedLines([...lines]);
  let inComment = false;
  let inIndentedCode = false;
  let lastText: string | undefined;
  for (let at = start; at < masked.length; at += 1) {
    let line = masked[at];
    if (fenced.has(at)) {
      masked[at] = blank(line);
      continue;
    }
    // Indented code: four spaces in, after a blank line, and not under a list.
    const indented = /^(?: {4}|\t)/.test(line) && line.trim() !== '';
    const previousBlank = at === 0 || lines[at - 1].trim() === '';
    if (indented && (inIndentedCode || (previousBlank && !(lastText !== undefined && (LIST_ITEM.test(lastText) || /^(?: {4}|\t)/.test(lastText)))))) {
      inIndentedCode = true;
      masked[at] = blank(line);
      continue;
    }
    if (line.trim() !== '') {
      inIndentedCode = false;
      lastText = line;
    }

    // HTML comments, which may run over several lines.
    let cursor = 0;
    while (cursor < line.length) {
      if (inComment) {
        const close = line.indexOf('-->', cursor);
        const end = close < 0 ? line.length : close + 3;
        line = blankRange(line, cursor, end);
        inComment = close < 0;
        cursor = end;
      } else {
        const open = line.indexOf('<!--', cursor);
        if (open < 0) {
          break;
        }
        inComment = true;
        cursor = open;
      }
    }

    line = line.replace(/`+[^`]*?`+/g, blank);
    line = line.replace(/<https?:\/\/[^>]*>/g, blank);
    line = line.replace(/(\[[^\]]*\])(\([^)]*\))/g, (_whole, text: string, target: string) => text + blank(target));
    line = line.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (whole, target: string, alias: string) =>
      `  ${blank(target)} ${alias}  `.slice(0, whole.length),
    );
    const task = matchTaskLine(line, TASK_LINE);
    if (task) {
      const offset = task.head.length;
      let body = line.slice(offset);
      for (const span of findTaskMetadataSpans(body)) {
        body = blankRange(body, span.start, span.end);
      }
      line = blank(task.head) + body;
    } else {
      line = line.replace(BLOCK_ID, blank);
    }
    masked[at] = line;
  }
  return masked;
}

let segmenter: Intl.Segmenter | undefined;

/** The words in some text, as the language's own word breaker finds them. */
export function countWords(text: string): number {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  let count = 0;
  for (const segment of segmenter.segment(text)) {
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
