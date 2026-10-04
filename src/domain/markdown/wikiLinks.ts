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
  // The shared pattern from the line's start, rather than matchAll's copy of
  // it for each line; nothing else uses it between these calls.
  WIKI_LINK_ON_LINE.lastIndex = 0;
  for (let match = WIKI_LINK_ON_LINE.exec(lineText); match; match = WIKI_LINK_ON_LINE.exec(lineText)) {
    const startColumn = match.index;
    if (!isInRanges(code, startColumn)) {
      spans.push({ line, startColumn, endColumn: startColumn + match[0].length, target: match[1] });
    }
  }
}

/**
 * A `[text](target)` link that is not an image, with the target as group 1,
 * bare or in angle brackets, and any title after it left out.
 */
const MARKDOWN_LINK_ON_LINE =
  /(?<!!)\[(?:[^\]\\\n]|\\.)*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

/** One link to a note written in a note's text: a `[[link]]`, or a `[text](note.md)`. */
export interface NoteLinkSpan extends WikiLinkSpan {
  /**
   * How it is written. A Markdown link's target is the note's path, as the
   * index keys it, resolved against the note it is written in, with any
   * `#fragment` after it, so every reader resolves both kinds alike.
   */
  kind: 'wiki' | 'markdown';
}

/**
 * The note a `[text](target)` link opens, as `folder/Note.md#fragment`, with
 * the path resolved against `sourcePath`'s folder and decoded; undefined for
 * a link that names no note: a web or mail address, a path from the root, a
 * `#fragment` alone, a path above the workspace, or a file that is not `.md`.
 */
export function resolveMarkdownLinkTarget(written: string, sourcePath: string): string | undefined {
  let target = written.trim();
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  }
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('#')) {
    return undefined;
  }
  const hash = target.indexOf('#');
  const pathPart = decodeLinkPart(hash >= 0 ? target.slice(0, hash) : target).replace(/\\/g, '/');
  const fragment = hash >= 0 ? decodeLinkPart(target.slice(hash + 1)).trim() : '';
  const path = /\.md$/i.test(pathPart) ? joinRelativePath(sourcePath, pathPart) : undefined;
  return path === undefined ? undefined : `${path}${fragment ? `#${fragment}` : ''}`;
}

/** `relative` read from the folder `sourcePath` is in, or undefined when it climbs above the top. */
function joinRelativePath(sourcePath: string, relative: string): string | undefined {
  const segments = sourcePath.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
    } else if (part !== '' && part !== '.') {
      segments.push(part);
    }
  }
  return segments.join('/');
}

/** A link's path or fragment with `%20` and the like decoded, or as written when it is not valid encoding. */
function decodeLinkPart(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Every link to a note in a note's text, `[[links]]` and relative
 * `[text](note.md)` links alike, in the order they are written, leaving out
 * those in fenced code or an inline code span. A Markdown link's target is
 * resolved against `sourcePath`, the note the text is in.
 *
 * Everything that counts links reads them through this: the parser's links,
 * which the Notes Graph and Related Notes follow, Linked from, Stats, and
 * the editor's link warnings. A rewrite, such as a rename's or Copy as
 * Plain Markdown's, reads `[[links]]` alone through findWikiLinkSpans.
 */
export function findNoteLinkSpans(text: string, sourcePath: string): NoteLinkSpan[] {
  const wiki: NoteLinkSpan[] = findWikiLinkSpans(text).map((span) => ({ ...span, kind: 'wiki' }));
  if (!text.includes('](')) {
    return wiki;
  }
  const markdown: NoteLinkSpan[] = [];
  const lines = text.split(/\r?\n/);
  const fenced = text.includes('```') || text.includes('~~~') ? findFencedLines(lines) : new Set<number>();
  lines.forEach((lineText, line) => {
    if (!fenced.has(line) && lineText.includes('](')) {
      readMarkdownLinks(lineText, line, sourcePath, markdown);
    }
  });
  return [...wiki, ...markdown].sort(
    (left, right) => left.line - right.line || left.startColumn - right.startColumn,
  );
}

/** Adds the `[text](note.md)` links of one line outside fenced code to `spans`, leaving out those in an inline code span. */
function readMarkdownLinks(lineText: string, line: number, sourcePath: string, spans: NoteLinkSpan[]): void {
  const code = lineText.includes('`')
    ? findCodeAndLinkRanges(lineText).filter((range) => lineText[range.start] === '`')
    : [];
  MARKDOWN_LINK_ON_LINE.lastIndex = 0;
  for (let match = MARKDOWN_LINK_ON_LINE.exec(lineText); match; match = MARKDOWN_LINK_ON_LINE.exec(lineText)) {
    const startColumn = match.index;
    const target = resolveMarkdownLinkTarget(match[1], sourcePath);
    if (target && !isInRanges(code, startColumn)) {
      spans.push({ line, startColumn, endColumn: startColumn + match[0].length, target, kind: 'markdown' });
    }
  }
}

/**
 * A heading as GitHub and most Markdown renderers write it after `#` in a
 * link: lowercased, punctuation dropped, spaces as hyphens, so
 * `[x](plan.md#decision-record)` finds `## Decision record`.
 */
export function headingSlug(heading: string): string {
  return heading
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** How Deckard writes a link it makes: `[[Name]]`, or `[Name](path.md)` that GitHub and MkDocs render. */
export type NoteLinkStyle = 'wiki' | 'markdown';

/**
 * The link Deckard writes in `sourcePath` to the note at `targetPath`,
 * showing `text`: `[[text]]`, or `[text](relative/path.md)` with the path
 * from the source note's folder, spaces and other unsafe characters encoded.
 */
export function formatNoteLink(text: string, sourcePath: string, targetPath: string, style: NoteLinkStyle): string {
  if (style === 'wiki') {
    return `[[${text}]]`;
  }
  const from = sourcePath.split('/').slice(0, -1);
  const to = targetPath.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) {
    shared += 1;
  }
  const relative = [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/');
  return `[${text}](${encodeURI(relative).replace(/[()]/g, (bracket) => (bracket === '(' ? '%28' : '%29'))})`;
}
