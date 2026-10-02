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
  const lines = text.split(/\r?\n/);
  const fenced = findFencedLines(lines);
  lines.forEach((lineText, line) => {
    if (fenced.has(line) || !lineText.includes('[[')) {
      return;
    }
    // Only the code spans: a link's own range would hide the link itself.
    const code = findCodeAndLinkRanges(lineText).filter((range) => lineText[range.start] === '`');
    for (const match of lineText.matchAll(WIKI_LINK_ON_LINE)) {
      const startColumn = match.index ?? 0;
      if (!isInRanges(code, startColumn)) {
        spans.push({ line, startColumn, endColumn: startColumn + match[0].length, target: match[1] });
      }
    }
  });
  return spans;
}
