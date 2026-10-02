import { findFrontmatterEnd } from './frontmatter';
import { findFencedLines, matchHeading } from './lineShapes';
import { stripTags } from './parser';

/**
 * Where a tag offered to an untagged note is written: the heading or line
 * the cursor is on, or the heading above it, worked out from the note as it
 * is when Add is pressed.
 */
export interface TagTarget {
  /** 1-based. */
  line: number;
  kind: 'heading' | 'line';
  /** The heading's words, or `line 12`. */
  label: string;
}

/** A list item's marker, bullet or numbered, which makes the line itself a target. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])[ \t]+/;

/** The lines of the note's front matter, 0-based, if it opens with some. */
function findFrontMatter(lines: readonly string[]): Set<number> {
  const held = new Set<number>();
  const end = findFrontmatterEnd(lines);
  if (end === undefined) {
    return held;
  }
  for (let index = 0; index <= end; index += 1) {
    held.add(index);
  }
  return held;
}

/** The heading on a line, labeled by its words without tags, or undefined for any other line. */
function headingTarget(lines: readonly string[], index: number): TagTarget | undefined {
  const match = matchHeading(lines[index], 'dropped');
  return match
    ? { line: index + 1, kind: 'heading', label: stripTags(match.text) || match.text }
    : undefined;
}

/** A line itself as the target, 0-based in, labeled by its 1-based number. */
function lineTarget(index: number): TagTarget {
  return { line: index + 1, kind: 'line', label: `line ${index + 1}` };
}

/**
 * The first heading met walking from `from` by `step` (1 down, -1 up) to
 * the note's edge, past the skipped lines.
 */
function firstHeading(
  lines: readonly string[],
  skipped: ReadonlySet<number>,
  from: number,
  step: 1 | -1,
): TagTarget | undefined {
  for (let index = from; index >= 0 && index < lines.length; index += step) {
    if (skipped.has(index)) {
      continue;
    }
    const heading = headingTarget(lines, index);
    if (heading) {
      return heading;
    }
  }
  return undefined;
}

/**
 * The target a cursor on a line outside front matter and code finds
 * without looking below it: the heading it is on, the list item it is on,
 * the nearest heading above, or the line of prose it is on.
 */
function targetAtCursor(
  lines: readonly string[],
  skipped: ReadonlySet<number>,
  cursor: number,
): TagTarget | undefined {
  const onHeading = headingTarget(lines, cursor);
  if (onHeading) {
    return onHeading;
  }
  if (LIST_ITEM.test(lines[cursor])) {
    return lineTarget(cursor);
  }
  const above = firstHeading(lines, skipped, cursor - 1, -1);
  if (above) {
    return above;
  }
  return lines[cursor].trim() === '' ? undefined : lineTarget(cursor);
}

/**
 * The heading or line a tag goes on, for a cursor on `cursorLine` (1-based):
 * the heading it is on; the task or list item it is on; else the nearest
 * heading above, which tags the whole section; else, with no heading above,
 * the prose line it is on; else the first heading below, or the first line
 * with anything on it. A cursor in front matter or a code block counts from
 * the nearest line above that is outside them. Nothing, in an empty note.
 */
export function findTagTarget(lines: readonly string[], cursorLine: number): TagTarget | undefined {
  const skipped = new Set([...findFrontMatter(lines), ...findFencedLines([...lines])]);
  let cursor = Math.min(Math.max(cursorLine - 1, 0), lines.length - 1);
  while (cursor >= 0 && skipped.has(cursor)) {
    cursor -= 1;
  }
  const atCursor = cursor >= 0 ? targetAtCursor(lines, skipped, cursor) : undefined;
  if (atCursor) {
    return atCursor;
  }
  const below = firstHeading(lines, skipped, Math.max(cursor, 0), 1);
  if (below) {
    return below;
  }
  const first = lines.findIndex((line, index) => !skipped.has(index) && line.trim() !== '');
  return first < 0 ? undefined : lineTarget(first);
}
