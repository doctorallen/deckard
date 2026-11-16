import { findFrontmatterEnd } from '../markdown/frontmatter';
import { findFencedLines, readHeading } from '../markdown/lineShapes';
import { BLOCK_ID_PATTERN } from '../markdown/taskFields';

/**
 * Copy to… (docs/implementation/49-meetings-and-types.md): what Move to…
 * moves, written where the reader chooses and left where it was, so a line
 * said in a meeting can go into the note that keeps such things without
 * leaving the meeting. The copy says where it came from: a link to the
 * heading it was written under, as File this writes one. Pure, so the rules
 * can be read and tested apart from the editor.
 */

/**
 * The nearest heading above a zero-based line, as written, tags kept,
 * outside code and front matter; undefined when the line is under none.
 */
export function headingAbove(lines: readonly string[], lineIndex: number): string | undefined {
  const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
  const fenced = findFencedLines(lines);
  for (let at = lineIndex - 1; at > frontmatterEnd; at -= 1) {
    const heading = fenced.has(at) ? undefined : readHeading(lines[at] ?? '');
    if (heading) {
      return heading.text;
    }
  }
  return undefined;
}

/** A line that a link cannot follow on: one that opens a code block, or a row of a table. */
const NOT_PROSE = /^\s*(?:```|~~~|\|)/;

/**
 * Copied lines with the link to where they came from: after the first
 * line's words, in brackets, `- The gateway is included ([[2026-11-16#Vendor sync]])`,
 * ahead of a block id at its end, as a migrated task's link is. A code
 * block or a table is copied as written, with the link on a line of its
 * own above it.
 */
export function withSourceLink(lines: readonly string[], link: string): string[] {
  const [first = '', ...rest] = lines;
  if (NOT_PROSE.test(first)) {
    return [`(${link})`, '', ...lines];
  }
  const trimmed = first.replace(/[ \t]+$/, '');
  const blockId = BLOCK_ID_PATTERN.exec(trimmed);
  const head = blockId ? trimmed.slice(0, blockId.index) : trimmed;
  const tail = blockId ? trimmed.slice(blockId.index) : '';
  return [`${head} (${link})${tail}`, ...rest];
}

/**
 * A copied section with the link to the one it was copied from: on a line
 * of its own under its heading, so the heading keeps its words and the
 * links that name it.
 */
export function sectionWithSourceLink(lines: readonly string[], link: string): string[] {
  const [heading = '', ...rest] = lines;
  return [heading, `(${link})`, ...rest];
}
