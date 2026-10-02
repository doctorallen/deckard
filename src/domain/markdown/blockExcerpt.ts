import {
  asciiTrim,
  BlockLines,
  contentStart,
  getLines,
  isEmptyLine,
  readBlockLines,
  skipChars,
  skipCharsBack,
  skipEmptyLines,
  skipSpaces,
  skipSpacesBack,
} from './blockLines';
import { tokenizeInline } from './inline';
import type { BlockToken, HeadingBlock, ListBlock } from '../model/blocks';
import type { InlineToken } from '../model/inline';
import { isHeadingLine } from './lineShapes';
import { isSpace } from './markdownCharacters';

/**
 * A note excerpt as a block token tree, the way a card shows it: paragraphs,
 * headings, lists, code, quotes, rules, and tables, each holding inline
 * tokens. Like the inline tokens, it is data and never HTML.
 *
 * The block rules are markdown-it's, ported one for one, because a card must
 * break into the same blocks it did when markdown-it drew it, setext
 * headings, lazy quote lines, and loose lists included. Two of markdown-it's
 * rules are left out, since Deckard turned off what they read: HTML blocks
 * (`html: false` showed them as text, which a paragraph does too) and link
 * reference definitions, which notes do not use.
 */

export type {
  BlockToken,
  CodeBlock,
  HeadingBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  RuleBlock,
  TableBlock,
} from '../model/blocks';

/**
 * Reads Markdown, a card's excerpt, into blocks as markdown-it's `render`
 * read it.
 */
export function buildBlockExcerpt(markdown: string): BlockToken[] {
  const src = markdown.replace(/\r\n?/g, '\n').replace(/\0/g, String.fromCharCode(0xfffd));
  if (src === '') {
    return [];
  }
  const state: BlockState = {
    ...readBlockLines(src),
    blockIndent: 0,
    line: 0,
    tight: false,
    listIndent: -1,
    parent: 'root',
    out: [],
  };
  return collectBlocks(state, 0, state.lineMax);
}

/** The block being read when a rule is asked whether it would end it. */
type ParentBlock = 'root' | 'paragraph' | 'list' | 'blockquote' | 'table';

/** The lines, and where the reader is among them. */
interface BlockState extends BlockLines {
  /** The indent a line needs to belong to the container being read. */
  blockIndent: number;
  /** The line the last rule stopped before. */
  line: number;
  /** Whether the container just read had no blank line between its blocks. */
  tight: boolean;
  /** The indent of the list being read, or -1. */
  listIndent: number;
  parent: ParentBlock;
  /** Where blocks are written. */
  out: BlockToken[];
}

/**
 * A block rule reads the block starting at `startLine` and moves
 * `state.line` past it. Silent, it only says whether it would, which is how
 * a paragraph asks whether a line ends it.
 */
type BlockRule = (state: BlockState, startLine: number, endLine: number, silent: boolean) => boolean;

/** Reads lines `startLine` to `endLine` into blocks of their own. */
function collectBlocks(state: BlockState, startLine: number, endLine: number): BlockToken[] {
  const outer = state.out;
  const blocks: BlockToken[] = [];
  state.out = blocks;
  tokenizeBlocks(state, startLine, endLine);
  state.out = outer;
  return blocks;
}

/**
 * Reads blocks until the lines run out or one is indented less than the
 * container needs. Records in `state.tight` whether a blank line separated
 * any two of them, which makes a list loose.
 */
function tokenizeBlocks(state: BlockState, startLine: number, endLine: number): void {
  let line = startLine;
  let hasEmptyLines = false;
  while (line < endLine) {
    line = skipEmptyLines(state, line);
    state.line = line;
    if (line >= endLine || state.indent[line] < state.blockIndent) {
      break;
    }
    BLOCK_RULES.some((rule) => rule(state, line, endLine, false));
    state.tight = !hasEmptyLines;
    if (isEmptyLine(state, state.line - 1)) {
      hasEmptyLines = true;
    }
    line = state.line;
    if (line < endLine && isEmptyLine(state, line)) {
      hasEmptyLines = true;
      line += 1;
      state.line = line;
    }
  }
}

/** Whether any of `rules` would start a block at `line`, ending the one being read. */
function terminates(state: BlockState, rules: readonly BlockRule[], line: number, endLine: number): boolean {
  return rules.some((rule) => rule(state, line, endLine, true));
}

/** Whether a line is indented four or more columns past the container: code, or text. */
function isCodeIndented(state: BlockState, line: number): boolean {
  return state.indent[line] - state.blockIndent >= 4;
}

/**
 * A table: a header row, a delimiter row of dashes and colons, and body
 * rows, until a blank line or another block.
 */
function tableRule(state: BlockState, startLine: number, endLine: number, silent: boolean): boolean {
  if (startLine + 2 > endLine) {
    return false;
  }
  const columnCount = readTableHead(state, startLine);
  if (columnCount === undefined) {
    return false;
  }
  if (silent) {
    return true;
  }
  const oldParent = state.parent;
  state.parent = 'table';
  const rows: InlineToken[][][] = [splitTableRow(lineText(state, startLine)).map((cell) => tokenizeInline(cell.trim()))];
  let nextLine = startLine + 2;
  for (; nextLine < endLine; nextLine += 1) {
    const text = lineText(state, nextLine).trim();
    if (state.indent[nextLine] < state.blockIndent || terminates(state, BLOCKQUOTE_TERMINATORS, nextLine, endLine)) {
      break;
    }
    if (!text || isCodeIndented(state, nextLine)) {
      break;
    }
    const cells = splitTableRow(text);
    rows.push(Array.from({ length: columnCount }, (_, index) => tokenizeInline((cells[index] ?? '').trim())));
  }
  state.out.push({ kind: 'table', rows });
  state.parent = oldParent;
  state.line = nextLine;
  return true;
}

/** A line's content, from its content start to its end. */
function lineText(state: BlockState, line: number): string {
  return state.src.slice(contentStart(state, line), state.lineEnd[line]);
}

const DELIMITER_ROW_CHARACTERS = /^[|\-: \t]*$/;

/**
 * The number of columns when `startLine` and the line after it open a table:
 * a header row with a pipe, and a delimiter row whose cells are dashes with
 * optional colons, as many as the header has cells.
 */
function readTableHead(state: BlockState, startLine: number): number | undefined {
  const delimiterLine = startLine + 1;
  if (state.indent[delimiterLine] < state.blockIndent || isCodeIndented(state, delimiterLine)) {
    return undefined;
  }
  const delimiter = lineText(state, delimiterLine);
  const [first, second] = delimiter;
  if (first === undefined || second === undefined || !'|-:'.includes(first) || !/[|\-: \t]/.test(second)) {
    return undefined;
  }
  if ((first === '-' && /[ \t]/.test(second)) || !DELIMITER_ROW_CHARACTERS.test(delimiter)) {
    return undefined;
  }
  const aligns = readAligns(delimiter);
  const header = lineText(state, startLine).trim();
  if (aligns === undefined || !header.includes('|') || isCodeIndented(state, startLine)) {
    return undefined;
  }
  const columns = splitTableRow(header).length;
  return columns > 0 && columns === aligns ? columns : undefined;
}

/** How many columns a delimiter row declares, or undefined when a cell is not `:?-+:?`. */
function readAligns(delimiter: string): number | undefined {
  const columns = delimiter.split('|');
  let count = 0;
  for (let index = 0; index < columns.length; index += 1) {
    const cell = columns[index].trim();
    if (!cell && (index === 0 || index === columns.length - 1)) {
      continue;
    }
    if (!/^:?-+:?$/.test(cell)) {
      return undefined;
    }
    count += 1;
  }
  return count;
}

/**
 * A table row's cells, split at pipes that are not escaped; an escaped pipe
 * is a pipe in the cell. The empty cells outside a leading and a trailing
 * pipe are dropped.
 */
function splitTableRow(text: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '|' && text[index - 1] === '\\') {
      current = `${current.slice(0, -1)}|`;
    } else if (character === '|') {
      cells.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current);
  if (cells.length > 0 && cells[0] === '') {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

/**
 * Code indented four columns past its container, through the last such
 * line, with blank lines inside it kept.
 */
function codeRule(state: BlockState, startLine: number, endLine: number): boolean {
  if (!isCodeIndented(state, startLine)) {
    return false;
  }
  let nextLine = startLine + 1;
  let last = nextLine;
  while (nextLine < endLine) {
    if (isEmptyLine(state, nextLine)) {
      nextLine += 1;
      continue;
    }
    if (!isCodeIndented(state, nextLine)) {
      break;
    }
    nextLine += 1;
    last = nextLine;
  }
  state.line = last;
  const text = getLines(state, { begin: startLine, end: last }, 4 + state.blockIndent, false);
  state.out.push({ kind: 'code', text: `${text}\n` });
  return true;
}

/**
 * Fenced code: three or more backticks or tildes, through a closing fence of
 * the same character at least as long, or the end of the container.
 */
function fenceRule(state: BlockState, startLine: number, endLine: number, silent: boolean): boolean {
  const start = contentStart(state, startLine);
  const max = state.lineEnd[startLine];
  const marker = state.src[start];
  if (isCodeIndented(state, startLine) || start + 3 > max || (marker !== '~' && marker !== '`')) {
    return false;
  }
  const length = skipChars(state, start, marker) - start;
  // A backtick fence's info string may not hold a backtick, or ``` `code` ``` would open one.
  if (length < 3 || (marker === '`' && state.src.slice(start + length, max).includes('`'))) {
    return false;
  }
  if (silent) {
    return true;
  }
  const close = findClosingFence(state, { startLine, endLine }, marker, length);
  state.line = close.line + (close.found ? 1 : 0);
  const text = getLines(state, { begin: startLine + 1, end: close.line }, state.indent[startLine], true);
  state.out.push({ kind: 'code', text });
  return true;
}

/** The line a fence closes on, or the line its container ends before. */
function findClosingFence(
  state: BlockState,
  range: { startLine: number; endLine: number },
  marker: string,
  length: number,
): { line: number; found: boolean } {
  for (let line = range.startLine + 1; line < range.endLine; line += 1) {
    const start = contentStart(state, line);
    const max = state.lineEnd[line];
    if (start < max && state.indent[line] < state.blockIndent) {
      return { line, found: false };
    }
    if (state.src[start] !== marker || isCodeIndented(state, line)) {
      continue;
    }
    const end = skipChars(state, start, marker);
    if (end - start >= length && skipSpaces(state, end) >= max) {
      return { line, found: true };
    }
  }
  return { line: range.endLine, found: false };
}

/** A line's markers and indent, saved while a quote reads it as its own. */
interface SavedLine {
  lineStart: number;
  baseIndent: number;
  indent: number;
  contentShift: number;
}

/** A line's markers and indent, before a quote changes them. */
function saveLine(state: BlockState, line: number): SavedLine {
  return {
    lineStart: state.lineStart[line],
    baseIndent: state.baseIndent[line],
    indent: state.indent[line],
    contentShift: state.contentShift[line],
  };
}

/**
 * A block quote: lines starting with `>`, and lines after them that continue
 * the paragraph inside lazily, without the `>`.
 */
function blockquoteRule(state: BlockState, startLine: number, endLine: number, silent: boolean): boolean {
  if (isCodeIndented(state, startLine) || state.src[contentStart(state, startLine)] !== '>') {
    return false;
  }
  if (silent) {
    return true;
  }
  const saved: SavedLine[] = [];
  const oldLineMax = state.lineMax;
  const oldParent = state.parent;
  state.parent = 'blockquote';
  const nextLine = collectQuoteLines(state, { startLine, endLine }, saved);
  const oldIndent = state.blockIndent;
  state.blockIndent = 0;
  const children = collectBlocks(state, startLine, nextLine);
  state.out.push({ kind: 'quote', children });
  state.lineMax = oldLineMax;
  state.parent = oldParent;
  saved.forEach((line, index) => {
    state.lineStart[startLine + index] = line.lineStart;
    state.baseIndent[startLine + index] = line.baseIndent;
    state.indent[startLine + index] = line.indent;
    state.contentShift[startLine + index] = line.contentShift;
  });
  state.blockIndent = oldIndent;
  return true;
}

/**
 * Marks the lines a quote holds, moving each one's content start past its
 * `>`, and returns the line the quote ends before: a blank line, a line
 * that starts another block, or a lazy line after an empty `>` line.
 */
function collectQuoteLines(state: BlockState, range: { startLine: number; endLine: number }, saved: SavedLine[]): number {
  let lastLineEmpty = false;
  let nextLine = range.startLine;
  for (; nextLine < range.endLine; nextLine += 1) {
    const start = contentStart(state, nextLine);
    if (start >= state.lineEnd[nextLine]) {
      break;
    }
    if (state.src[start] === '>' && state.indent[nextLine] >= state.blockIndent) {
      saved.push(saveLine(state, nextLine));
      lastLineEmpty = stripQuoteMarker(state, nextLine);
      continue;
    }
    if (lastLineEmpty) {
      break;
    }
    if (terminates(state, BLOCKQUOTE_TERMINATORS, nextLine, range.endLine)) {
      state.lineMax = nextLine;
      if (state.blockIndent !== 0) {
        saved.push(saveLine(state, nextLine));
        state.indent[nextLine] -= state.blockIndent;
      }
      break;
    }
    saved.push(saveLine(state, nextLine));
    state.indent[nextLine] = -1;
  }
  return nextLine;
}

/**
 * Moves a quoted line's content start past its `>` and one optional space
 * (or the part of a tab that stands for one).
 * @returns Whether nothing follows the marker.
 */
function stripQuoteMarker(state: BlockState, line: number): boolean {
  const { src } = state;
  const max = state.lineEnd[line];
  let position = contentStart(state, line) + 1;
  let initial = state.indent[line] + 1;
  const spaceAfterMarker = src[position] === ' ' || src[position] === '\t';
  let adjustTab = false;
  if (src[position] === ' ' || (src[position] === '\t' && (state.baseIndent[line] + initial) % 4 === 3)) {
    position += 1;
    initial += 1;
  } else if (src[position] === '\t') {
    adjustTab = true;
  }
  let offset = initial;
  state.lineStart[line] = position;
  while (position < max && isSpace(src.charCodeAt(position))) {
    offset += src[position] === '\t' ? 4 - ((offset + state.baseIndent[line] + (adjustTab ? 1 : 0)) % 4) : 1;
    position += 1;
  }
  state.baseIndent[line] = state.indent[line] + 1 + (spaceAfterMarker ? 1 : 0);
  state.indent[line] = offset - initial;
  state.contentShift[line] = position - state.lineStart[line];
  return position >= max;
}

/** A thematic break: three or more of `*`, `-`, or `_`, with nothing else but spaces. */
function hrRule(state: BlockState, startLine: number, _endLine: number, silent: boolean): boolean {
  if (isCodeIndented(state, startLine)) {
    return false;
  }
  const text = lineText(state, startLine);
  const marker = text[0];
  if (marker !== '*' && marker !== '-' && marker !== '_') {
    return false;
  }
  if (!/^[ \t]*$/.test(text.split(marker).join('')) || text.split(marker).length - 1 < 3) {
    return false;
  }
  if (!silent) {
    state.line = startLine + 1;
    state.out.push({ kind: 'rule' });
  }
  return true;
}

/** A list marker: where the content may start, and the number of a numbered one. */
interface ListMarker {
  ordered: boolean;
  /** The index just past the marker. */
  after: number;
  value: number;
}

/** The index just past a bullet (`-`, `*`, `+`) followed by a space or the line's end, or -1. */
function skipBulletMarker(state: BlockState, line: number): number {
  const position = contentStart(state, line);
  const max = state.lineEnd[line];
  if (!'*-+'.includes(state.src[position] ?? 'x') || position >= max) {
    return -1;
  }
  return position + 1 < max && !isSpace(state.src.charCodeAt(position + 1)) ? -1 : position + 1;
}

/** The index just past a number of up to nine digits and `.` or `)`, followed by a space or the line's end, or -1. */
function skipOrderedMarker(state: BlockState, line: number): number {
  const start = contentStart(state, line);
  const max = state.lineEnd[line];
  const match = /^\d{1,9}[.)]/.exec(state.src.slice(start, max));
  if (!match || start + 1 >= max) {
    return -1;
  }
  const after = start + match[0].length;
  return after < max && !isSpace(state.src.charCodeAt(after)) ? -1 : after;
}

/** The list marker a line starts with, numbered ones first. */
function readListMarker(state: BlockState, line: number): ListMarker | undefined {
  const ordered = skipOrderedMarker(state, line);
  if (ordered >= 0) {
    const value = Number(state.src.slice(contentStart(state, line), ordered - 1));
    return { ordered: true, after: ordered, value };
  }
  const bullet = skipBulletMarker(state, line);
  return bullet >= 0 ? { ordered: false, after: bullet, value: 0 } : undefined;
}

/**
 * Whether a list may start at a line. Inside a list, a line indented four
 * past the outer list is that list's text. A list that would interrupt a
 * paragraph must start at 1 if numbered, and its first item must hold words.
 */
function canStartList(state: BlockState, line: number, silent: boolean, marker: ListMarker): boolean {
  if (isCodeIndented(state, line)) {
    return false;
  }
  const outerIndent = state.indent[line] - state.listIndent;
  if (state.listIndent >= 0 && outerIndent >= 4 && state.indent[line] < state.blockIndent) {
    return false;
  }
  const interrupts = silent && state.parent === 'paragraph' && state.indent[line] >= state.blockIndent;
  if (!interrupts) {
    return true;
  }
  return (!marker.ordered || marker.value === 1) && skipSpaces(state, marker.after) < state.lineEnd[line];
}

/**
 * A list: items with the same kind of marker (the same bullet, or numbers
 * with the same `.` or `)`), each holding the lines indented to its content.
 */
function listRule(state: BlockState, startLine: number, endLine: number, silent: boolean): boolean {
  const marker = readListMarker(state, startLine);
  if (!marker || !canStartList(state, startLine, silent, marker)) {
    return false;
  }
  if (silent) {
    return true;
  }
  const list: ListBlock = {
    kind: 'list',
    ordered: marker.ordered,
    ...(marker.ordered && marker.value !== 1 ? { start: marker.value } : {}),
    tight: true,
    items: [],
  };
  const markerCharacter = state.src[marker.after - 1];
  const oldParent = state.parent;
  state.parent = 'list';
  let nextLine = startLine;
  let after = marker.after;
  let prevEmptyEnd = false;
  for (;;) {
    const item = readListItem(state, nextLine, endLine, after);
    list.items.push(item.blocks);
    list.tight = list.tight && item.tight && !prevEmptyEnd;
    prevEmptyEnd = state.line - nextLine > 1 && isEmptyLine(state, state.line - 1);
    nextLine = state.line;
    after = nextItemMarker(state, { line: nextLine, endLine }, marker.ordered, markerCharacter);
    if (after < 0) {
      break;
    }
  }
  state.out.push(list);
  state.line = nextLine;
  state.parent = oldParent;
  return true;
}

/** Where the next item's marker ends, or -1 when the list ends before `at.line`. */
function nextItemMarker(state: BlockState, at: { line: number; endLine: number }, ordered: boolean, markerCharacter: string): number {
  const { line, endLine } = at;
  if (line >= endLine || state.indent[line] < state.blockIndent || isCodeIndented(state, line)) {
    return -1;
  }
  if (terminates(state, LIST_TERMINATORS, line, endLine)) {
    return -1;
  }
  const after = ordered ? skipOrderedMarker(state, line) : skipBulletMarker(state, line);
  return after >= 0 && state.src[after - 1] === markerCharacter ? after : -1;
}

/**
 * One list item: its content starts after the marker and up to four spaces
 * (one, when there are more, since the rest is indented code), and its
 * blocks are the lines indented that far.
 */
function readListItem(state: BlockState, line: number, endLine: number, after: number): { blocks: BlockToken[]; tight: boolean } {
  const max = state.lineEnd[line];
  const initial = state.indent[line] + after - contentStart(state, line);
  let offset = initial;
  let position = after;
  while (position < max && isSpace(state.src.charCodeAt(position))) {
    offset += state.src[position] === '\t' ? 4 - ((offset + state.baseIndent[line]) % 4) : 1;
    position += 1;
  }
  const gap = position >= max ? 1 : offset - initial;
  const saved = { tight: state.tight, shift: state.contentShift[line], indent: state.indent[line], listIndent: state.listIndent };
  state.listIndent = state.blockIndent;
  state.blockIndent = initial + (gap > 4 ? 1 : gap);
  state.tight = true;
  state.contentShift[line] = position - state.lineStart[line];
  state.indent[line] = offset;
  let blocks: BlockToken[] = [];
  if (position >= max && isEmptyLine(state, line + 1)) {
    // An empty item followed by a blank line is over: an item cannot start
    // with two blank lines.
    state.line = Math.min(state.line + 2, endLine);
  } else {
    blocks = collectBlocks(state, line, endLine);
  }
  const tight = state.tight;
  state.blockIndent = state.listIndent;
  state.listIndent = saved.listIndent;
  state.contentShift[line] = saved.shift;
  state.indent[line] = saved.indent;
  state.tight = saved.tight;
  return { blocks, tight };
}

/** An ATX heading, `#` to `######` and a space, with closing hashes dropped. */
function headingRule(state: BlockState, startLine: number, _endLine: number, silent: boolean): boolean {
  const start = contentStart(state, startLine);
  let max = state.lineEnd[startLine];
  const text = state.src.slice(start, max);
  if (isCodeIndented(state, startLine) || !isHeadingLine(text, { allowBare: true })) {
    return false;
  }
  if (silent) {
    return true;
  }
  const level = skipChars(state, start, '#') - start;
  max = skipSpacesBack(state, max, start + level);
  const closing = skipCharsBack(state, max, '#', start + level);
  if (closing > start + level && isSpace(state.src.charCodeAt(closing - 1))) {
    max = closing;
  }
  state.line = startLine + 1;
  pushHeading(state, level, asciiTrim(state.src.slice(start + level, max)));
  return true;
}

/** Writes a heading of the given level. */
function pushHeading(state: BlockState, level: number, text: string): void {
  state.out.push({ kind: 'heading', level: level as HeadingBlock['level'], children: tokenizeInline(text) });
}

/** The level a setext underline gives, `=` for 1 and `-` for 2, or 0 when the line is not one. */
function setextLevel(state: BlockState, line: number): number {
  if (state.indent[line] < state.blockIndent) {
    return 0;
  }
  const start = contentStart(state, line);
  const marker = state.src[start];
  if (start >= state.lineEnd[line] || (marker !== '-' && marker !== '=')) {
    return 0;
  }
  if (skipSpaces(state, skipChars(state, start, marker)) < state.lineEnd[line]) {
    return 0;
  }
  return marker === '=' ? 1 : 2;
}

/**
 * A setext heading: paragraph lines underlined by `===` or `---`. It is read
 * before a paragraph, so `Words` over `---` is a heading and not a rule.
 */
function lheadingRule(state: BlockState, startLine: number, endLine: number): boolean {
  if (isCodeIndented(state, startLine)) {
    return false;
  }
  const oldParent = state.parent;
  state.parent = 'paragraph';
  let level = 0;
  let nextLine = startLine + 1;
  for (; nextLine < endLine && !isEmptyLine(state, nextLine); nextLine += 1) {
    if (state.indent[nextLine] - state.blockIndent > 3) {
      continue;
    }
    level = setextLevel(state, nextLine);
    if (level > 0) {
      break;
    }
    if (state.indent[nextLine] >= 0 && terminates(state, PARAGRAPH_TERMINATORS, nextLine, endLine)) {
      break;
    }
  }
  state.parent = oldParent;
  if (level === 0) {
    return false;
  }
  const text = asciiTrim(getLines(state, { begin: startLine, end: nextLine }, state.blockIndent, false));
  state.line = nextLine + 1;
  pushHeading(state, level, text);
  return true;
}

/**
 * A paragraph: lines up to a blank line or one that starts another block.
 * Lines indented as code, and lazy quote lines, continue it.
 */
function paragraphRule(state: BlockState, startLine: number, endLine: number): boolean {
  const oldParent = state.parent;
  state.parent = 'paragraph';
  let nextLine = startLine + 1;
  for (; nextLine < endLine && !isEmptyLine(state, nextLine); nextLine += 1) {
    if (state.indent[nextLine] - state.blockIndent > 3 || state.indent[nextLine] < 0) {
      continue;
    }
    if (terminates(state, PARAGRAPH_TERMINATORS, nextLine, endLine)) {
      break;
    }
  }
  const text = asciiTrim(getLines(state, { begin: startLine, end: nextLine }, state.blockIndent, false));
  state.line = nextLine;
  state.out.push({ kind: 'paragraph', children: tokenizeInline(text) });
  state.parent = oldParent;
  return true;
}

/** The block rules in markdown-it's order; a paragraph takes whatever the others leave. */
const BLOCK_RULES: readonly BlockRule[] = [
  tableRule,
  codeRule,
  fenceRule,
  blockquoteRule,
  hrRule,
  listRule,
  headingRule,
  lheadingRule,
  paragraphRule,
];

/** What ends a paragraph. */
const PARAGRAPH_TERMINATORS: readonly BlockRule[] = [tableRule, fenceRule, blockquoteRule, hrRule, listRule, headingRule];
/** What ends a quote's lazy lines, or a table's body. */
const BLOCKQUOTE_TERMINATORS: readonly BlockRule[] = [fenceRule, blockquoteRule, hrRule, listRule, headingRule];
/** What ends a list between its items. */
const LIST_TERMINATORS: readonly BlockRule[] = [fenceRule, blockquoteRule, hrRule];
