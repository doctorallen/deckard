import { findCodeAndLinkRanges, isInRanges } from './inlineRanges';
import { findFencedLines } from './lineShapes';

/** A `[[target]]` or `[[target|display text]]` link, the target as group 1. */
const WIKI_LINK_ON_LINE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/** One `[[link]]` written in a note's text, and where it sits. */
export interface WikiLinkSpan {
  /** Zero-based line, and the columns of the whole `[[…]]`. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** What the brackets hold before any `|`, as written. */
  target: string;
}

/**
 * The `[[links]]` of a note's text, line by line, leaving out each one in a
 * fenced code block or an inline code span, where `[[…]]` is an example of
 * how to write a link rather than a link.
 *
 * Every reader of a note's links reads them through this: the parser's
 * links, which the Notes Graph and Related Notes follow, Linked from, the
 * missing-note list, and the editor's link warnings. So a link one counts is
 * a link they all count.
 */
export function findWikiLinkSpans(text: string): WikiLinkSpan[] {
  const spans: WikiLinkSpan[] = [];
  if (!text.includes('[[')) {
    return spans;
  }
  // A fence is a run of three backticks or tildes. Text with neither has no
  // fenced line, so only the lines holding a `[[` need reading.
  if (!text.includes('```') && !text.includes('~~~')) {
    readUnfencedLinks(text, spans);
    return spans;
  }
  const lines = text.split(/\r?\n/);
  const fenced = findFencedLines(lines);
  lines.forEach((lineText, line) => {
    if (!fenced.has(line) && lineText.includes('[[')) {
      readLineLinks(lineText, line, spans);
    }
  });
  return spans;
}

/**
 * Adds the links of text with no fence to `spans`, visiting only the lines
 * that hold a `[[`, each read as `text.split(/\r?\n/)` gives it.
 */
function readUnfencedLinks(text: string, spans: WikiLinkSpan[]): void {
  let line = 0;
  let lineStart = 0;
  let next = text.indexOf('[[');
  while (next >= 0) {
    let lineEnd = text.indexOf('\n', lineStart);
    while (lineEnd >= 0 && lineEnd < next) {
      line += 1;
      lineStart = lineEnd + 1;
      lineEnd = text.indexOf('\n', lineStart);
    }
    readLineLinks(text.slice(lineStart, lineContentEnd(text, lineStart, lineEnd)), line, spans);
    next = lineEnd < 0 ? -1 : text.indexOf('[[', lineEnd + 1);
  }
}

/**
 * Where the text of the line from `lineStart` ends, given the `\n` that
 * ends it, or -1 for the last line: a line ending `\r\n` is read without
 * its `\r`.
 */
function lineContentEnd(text: string, lineStart: number, lineEnd: number): number {
  if (lineEnd < 0) {
    return text.length;
  }
  return lineEnd > lineStart && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
}

/** Adds the links of one line outside fenced code to `spans`, leaving out those in an inline code span. */
function readLineLinks(lineText: string, line: number, spans: WikiLinkSpan[]): void {
  // Only the code spans: a link's own range would hide the link itself. A
  // line without a backtick has none.
  const code = lineText.includes('`')
    ? findCodeAndLinkRanges(lineText).filter((range) => lineText[range.start] === '`')
    : [];
  for (const match of lineText.matchAll(WIKI_LINK_ON_LINE)) {
    const startColumn = match.index ?? 0;
    if (!isInRanges(code, startColumn)) {
      spans.push({ line, startColumn, endColumn: startColumn + match[0].length, target: match[1] });
    }
  }
}
