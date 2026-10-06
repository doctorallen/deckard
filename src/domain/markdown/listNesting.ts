import { findFencedLines, isHeadingLine, isTaskLineOf, STATUS_MARKS, TaskLineShape } from './lineShapes';

/**
 * Which list item each list item is written under, read from indentation
 * alone: the one rule the parser, Break into Steps…, completion, and
 * rollover share, so a step is the same step wherever Deckard looks.
 *
 * A heading, a fenced block, or an unindented line that is not a list item
 * ends a list; a blank line does not, and an indented line that is not a
 * list item (a continuation of the item above) keeps it open.
 */

const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/;
/** A step's checkbox: indented by spaces and tabs only, with a gap after it. */
const TASK_ITEM: TaskLineShape = { indent: 'spaces-and-tabs', marks: STATUS_MARKS, after: 'gap' };

/** How far a line's whitespace reaches, with a tab counted to the next multiple of 4. */
export function measureIndent(whitespace: string): number {
  let width = 0;
  for (const character of whitespace) {
    if (character === '\t') {
      width += 4 - (width % 4);
    } else if (character === ' ') {
      width += 1;
    } else {
      break;
    }
  }
  return width;
}

/** The width of a line's leading whitespace, as `measureIndent` counts it. */
export function lineIndent(line: string): number {
  return measureIndent(line.match(/^[ \t]*/)?.[0] ?? '');
}

/** Whether a line is a list item, bulleted or numbered. */
export function isListItemLine(line: string): boolean {
  return LIST_ITEM.test(line);
}

/** Whether a line is a checkbox task, as the parser reads one. */
export function isTaskItemLine(line: string): boolean {
  return isTaskLineOf(line, TASK_ITEM);
}

/**
 * For every list item line, the line index of the list item it is written
 * under, or `undefined` for an item at the top of its list. Lines that are
 * not list items are not in the map. Line indexes are 0-based.
 */
export function findListParents(
  lines: readonly string[],
  fencedLines?: ReadonlySet<number>,
): Map<number, number | undefined> {
  const parents = new Map<number, number | undefined>();
  const stack: Array<{ width: number; line: number }> = [];
  const fenced = fencedLines ?? findFencedLines(lines);
  lines.forEach((line, index) => {
    if (fenced.has(index) || isHeadingLine(line)) {
      stack.length = 0;
      return;
    }
    if (line.trim() === '') {
      return;
    }
    const item = line.match(LIST_ITEM);
    if (!item) {
      if (lineIndent(line) === 0) {
        stack.length = 0;
      }
      return;
    }
    const width = measureIndent(item[1]);
    while (stack.length > 0 && stack[stack.length - 1].width >= width) {
      stack.pop();
    }
    parents.set(index, stack[stack.length - 1]?.line);
    stack.push({ width, line: index });
  });
  return parents;
}

/**
 * The task a task line is a step of: the line index of the checkbox it is
 * written directly under, or `undefined` when its list parent is not a
 * task, or it has none.
 */
export function findParentTaskLine(
  lines: readonly string[],
  parents: ReadonlyMap<number, number | undefined>,
  lineIndex: number,
): number | undefined {
  const parent = parents.get(lineIndex);
  return parent !== undefined && isTaskItemLine(lines[parent]) ? parent : undefined;
}
