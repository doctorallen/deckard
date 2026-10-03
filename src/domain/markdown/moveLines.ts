import { findFrontmatterEnd } from './frontmatter';
import {
  findFencedLines,
  isHeading,
  isTaskLineOf,
  matchTaskLine,
  TaskLineMatch,
  TaskLineShape,
} from './lineShapes';
import { findListItemEndLine, listItemIndentation } from './parser';
import { markMigrated } from './taskLineEdits';

/**
 * What Move to… takes out of a note, and what it leaves behind: pure, so
 * the rules can be read and tested apart from the editor.
 *
 * Lines are zero-based and `end` is inclusive.
 */
export interface MoveBlock {
  start: number;
  end: number;
  /** The lines as written. */
  lines: string[];
  /** Whether the block starts with a list item. */
  listItem: boolean;
  /**
   * The block's top-level items when every one is an open task, each with
   * its line and the column of its checkbox; otherwise undefined.
   */
  openTasks?: Array<{ line: number; checkboxColumn: number }>;
}

/**
 * Why a move takes nothing: the block holds a heading, the cursor is on a
 * blank line, the block reaches into front matter, or it would cut a code
 * fence in two.
 */
export type MoveRefusalReason = 'heading' | 'blank' | 'frontMatter' | 'splitFence';

/** A move that takes nothing, and why. */
export interface MoveRefusal {
  refused: MoveRefusalReason;
}

/** Where the cursor or selection is, as an editor has it, zero-based. */
export interface MoveSelection {
  start: { line: number; character: number };
  end: { line: number; character: number };
  isEmpty: boolean;
}

/** An open task, which a move can leave behind marked `[>]`. */
const OPEN_TASK: TaskLineShape = { indent: 'whitespace', marks: ' ' };
/** A task of any kind: open, done, or migrated. */
const ANY_TASK: TaskLineShape = { indent: 'whitespace', marks: ' xX>' };

/**
 * The block a move takes: the selected lines, or with nothing selected the
 * item under the cursor and its children, or the line of prose. A selection
 * that ends at the start of a line leaves that line alone, and one whose
 * last item has children takes them too, so a child is never left under the
 * item above.
 */
export function readMoveBlock(lines: readonly string[], selection: MoveSelection): MoveBlock | MoveRefusal {
  const start = selection.start.line;
  let end = selection.end.line;
  if (!selection.isEmpty && end > start && selection.end.character === 0) {
    end -= 1;
  }
  const atCursor = selection.isEmpty ? refuseAtCursor(lines[start] ?? '') : undefined;
  if (atCursor) {
    return atCursor;
  }
  const frontMatterEnd = findFrontmatterEnd(lines);
  if (frontMatterEnd !== undefined && start <= frontMatterEnd) {
    return { refused: 'frontMatter' };
  }
  const indents = rangeOf(start, end)
    .filter((line) => (lines[line] ?? '').trim())
    .map((line) => leading(lines[line]));
  const base = Math.min(...indents);
  end = trimTrailingBlanks(lines, start, extendToChildren(lines, start, end, base));
  const refused = refuseBlock(lines, start, end);
  if (refused) {
    return refused;
  }

  const topLevel = rangeOf(start, end).filter(
    (line) => (lines[line] ?? '').trim() && leading(lines[line]) === base,
  );
  const openTasks = readOpenTasks(lines, topLevel);
  return {
    start,
    end,
    lines: rangeOf(start, end).map((line) => lines[line]),
    listItem: listItemIndentation(lines[start] ?? '') !== undefined,
    ...(openTasks && openTasks.length > 0 ? { openTasks } : {}),
  };
}

/** Why the line under a cursor cannot be moved alone: a heading, or a blank line. */
function refuseAtCursor(text: string): MoveRefusal | undefined {
  if (isHeading(text)) {
    return { refused: 'heading' };
  }
  if (!text.trim()) {
    return { refused: 'blank' };
  }
  return undefined;
}

/**
 * The block's last line once the last top-level item brings its children
 * with it: the nearest item at the block's own indentation, looking up from
 * the end, extends the block to its last child. A line of prose at or left
 * of that indentation stops the look.
 */
function extendToChildren(lines: readonly string[], start: number, end: number, base: number): number {
  for (let line = end; line >= start; line -= 1) {
    const indentation = listItemIndentation(lines[line] ?? '');
    if (indentation !== undefined && indentation === base) {
      return Math.max(end, findListItemEndLine([...lines], line, indentation) - 1);
    }
    if ((lines[line] ?? '').trim() && leading(lines[line]) <= base) {
      return end;
    }
  }
  return end;
}

/** The block's last line with the blank lines at its end left behind. */
function trimTrailingBlanks(lines: readonly string[], start: number, end: number): number {
  let last = end;
  while (last > start && !(lines[last] ?? '').trim()) {
    last -= 1;
  }
  return last;
}

/**
 * Why a block cannot move: a heading inside it, or a fence cut in two,
 * where the block starts or ends inside a fence it does not hold whole.
 */
function refuseBlock(lines: readonly string[], start: number, end: number): MoveRefusal | undefined {
  if (rangeOf(start, end).some((line) => isHeading(lines[line] ?? ''))) {
    return { refused: 'heading' };
  }
  const fenced = findFencedLines([...lines]);
  if (
    (fenced.has(start) && fenced.has(start - 1)) ||
    (fenced.has(end) && fenced.has(end + 1))
  ) {
    return { refused: 'splitFence' };
  }
  return undefined;
}

/**
 * The top-level items with their checkbox columns when every one is an open
 * task, which a move can leave behind marked `[>]`; otherwise undefined.
 */
function readOpenTasks(
  lines: readonly string[],
  topLevel: readonly number[],
): MoveBlock['openTasks'] {
  const matches = topLevel.map((line) => matchTaskLine(lines[line], OPEN_TASK));
  if (!matches.every((match) => match !== undefined)) {
    return undefined;
  }
  return topLevel.map((line, index) => ({
    line,
    checkboxColumn: (matches[index] as TaskLineMatch).opening.length,
  }));
}

/** Whether a line is a task of any kind, open, done, or migrated. */
export function isAnyTaskLine(line: string): boolean {
  return isTaskLineOf(line, ANY_TASK);
}

/**
 * The block as it is written where it goes: the first line's exact leading
 * whitespace taken off every line that has it, and the lines otherwise as
 * they were.
 */
export function dedentBlock(lines: readonly string[]): string[] {
  const prefix = /^\s*/.exec(lines[0] ?? '')?.[0] ?? '';
  return lines.map((line) => (prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line));
}

/** What a move leaves where the lines were. */
export type LeaveBehind = 'link' | 'nothing';

/**
 * The lines left behind: nothing; or each open task marked `[>]` with a
 * link to where it went, as rollover's migrate marks it; or, for anything
 * else, one line linking there, a list item when the block began with one.
 */
export function leaveBehind(
  block: MoveBlock,
  allLines: readonly string[],
  target: string,
  mode: LeaveBehind,
): string[] {
  if (mode === 'nothing') {
    return [];
  }
  if (block.openTasks) {
    return block.openTasks.map((task) => markMigrated(allLines[task.line], task.checkboxColumn, target));
  }
  const indent = /^\s*/.exec(block.lines[0] ?? '')?.[0] ?? '';
  return [`${indent}${block.listItem ? '- ' : ''}[[${target}]]`];
}

/** An edit to one note's text, by character offsets. */
export interface TextSplice {
  start: number;
  end: number;
  text: string;
}

/**
 * The splice that takes a block out and puts what is left behind in its
 * place. The block's last line break goes with it; a block that ends the
 * note without one takes the line break before it instead.
 */
export function blockSplice(
  text: string,
  block: Pick<MoveBlock, 'start' | 'end'>,
  replacement: readonly string[],
): TextSplice {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const offsets = lineOffsets(text);
  const start = offsets[block.start];
  const endsNote = block.end + 1 >= offsets.length;
  if (!endsNote) {
    return {
      start,
      end: offsets[block.end + 1],
      text: replacement.map((line) => `${line}${eol}`).join(''),
    };
  }
  if (replacement.length > 0 || block.start === 0) {
    return { start, end: text.length, text: replacement.join(eol) };
  }
  // Nothing left, at the very end: the line break before the block goes.
  return { start: Math.max(0, start - eol.length), end: text.length, text: '' };
}

/**
 * One note's new text after a move within it: the block's splice and the
 * insertion applied together, so the two can never overlap or shift each
 * other.
 */
export function applySplices(text: string, splices: readonly TextSplice[]): string {
  return [...splices]
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce((current, splice) => current.slice(0, splice.start) + splice.text + current.slice(splice.end), text);
}

/** The character offset each line starts at. */
export function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

/** How many whitespace characters a line starts with. */
function leading(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

/** The line numbers from `start` to `end`, both included; none when `end` is before `start`. */
function rangeOf(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => start + offset);
}
