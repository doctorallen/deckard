import { matchHeading } from './lineShapes';
import { findFencedLines, stripTags } from './parser';

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

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])[ \t]+/;

/** The lines of the note's front matter, 0-based, if it opens with some. */
function findFrontMatter(lines: readonly string[]): Set<number> {
  const held = new Set<number>();
  if (lines[0]?.trim() !== '---') {
    return held;
  }
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0) {
    return held;
  }
  for (let index = 0; index <= end; index += 1) {
    held.add(index);
  }
  return held;
}

function headingTarget(lines: readonly string[], index: number): TagTarget | undefined {
  const match = matchHeading(lines[index], 'dropped');
  return match
    ? { line: index + 1, kind: 'heading', label: stripTags(match.text) || match.text }
    : undefined;
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
  if (cursor >= 0) {
    const onHeading = headingTarget(lines, cursor);
    if (onHeading) {
      return onHeading;
    }
    if (LIST_ITEM.test(lines[cursor])) {
      return { line: cursor + 1, kind: 'line', label: `line ${cursor + 1}` };
    }
    for (let index = cursor - 1; index >= 0; index -= 1) {
      if (!skipped.has(index)) {
        const above = headingTarget(lines, index);
        if (above) {
          return above;
        }
      }
    }
    if (lines[cursor].trim() !== '') {
      return { line: cursor + 1, kind: 'line', label: `line ${cursor + 1}` };
    }
  }
  const start = Math.max(cursor, 0);
  for (let index = start; index < lines.length; index += 1) {
    if (!skipped.has(index)) {
      const below = headingTarget(lines, index);
      if (below) {
        return below;
      }
    }
  }
  const first = lines.findIndex((line, index) => !skipped.has(index) && line.trim() !== '');
  return first < 0 ? undefined : { line: first + 1, kind: 'line', label: `line ${first + 1}` };
}
