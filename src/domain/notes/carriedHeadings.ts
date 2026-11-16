import { findFrontmatterEnd } from '../markdown/frontmatter';
import { findFencedLines, readHeading } from '../markdown/lineShapes';
import { extractTags } from '../markdown/parser';
import { formatNoteLink, type NoteLinkStyle, resolveMarkdownLinkTarget } from '../markdown/wikiLinks';
import { formatSectionLink } from './moveSection';

/**
 * A carried task keeps its meeting (docs/implementation/49-meetings-and-types.md).
 *
 * A task written under a heading of a daily note, `## Vendor sync
 * #project/borealis @dana`, was said somewhere, and carried flat under
 * Carried over it loses both the heading's tags and the meeting. So it is
 * carried under that heading, written again one level below Carried over,
 * with a line that links to the heading it was first written under:
 *
 *     ## Carried over
 *
 *     ### Vendor sync #project/borealis `@dana`
 *     ([[2026-11-13#Vendor sync]])
 *     - [ ] Send the quote
 *
 * Carried again the next day, it goes under the same heading with the same
 * link, so however long it waits it still leads to the meeting. Pure, so
 * the rules can be read and tested apart from the editor.
 */

/** The heading carried tasks go under, in today's note. */
export const CARRIED_OVER_HEADING = 'Carried over';

/** The heading a carried task is written under in today's note, and the link under it. */
export interface CarriedHeading {
  /** The heading's words and tags as written, with the tags of the headings above it that it lacks. */
  heading: string;
  /** The line under it: a link, in brackets, to the heading the task was first written under. */
  link: string;
  /**
   * For a heading that is itself under Carried over, in a note the task
   * was carried into before: the zero-based lines its section runs over,
   * which a move takes out once nothing is left under it.
   */
  carried?: { first: number; last: number };
}

/** Where a carried heading's link is written, and how. */
export interface CarriedLinkOptions {
  /** The note the task is in. */
  filePath: string;
  /** Today's note, which the link is written in. */
  todayPath: string;
  style: NoteLinkStyle;
}

/** A heading above a line: the zero-based line it is on, its level, and its words. */
interface HeadingAbove {
  line: number;
  level: number;
  text: string;
}

/** Whether a heading is Carried over, as the rollover names the one it writes. */
export function isCarriedOver(heading: string): boolean {
  return heading.toLowerCase() === CARRIED_OVER_HEADING.toLowerCase();
}

/**
 * The heading a task on a zero-based line is carried under, or undefined
 * for one that goes under Carried over itself: a task under no heading,
 * under the note's top-level heading alone, or straight under Carried over.
 *
 * Of the headings the line is under, it is the nearest with tags of its
 * own, since that is the one that says what the task is about; with none
 * tagged, the outermost below the top level, which is the meeting rather
 * than a part of it.
 */
export function findCarriedHeading(
  lines: readonly string[],
  lineIndex: number,
  options: CarriedLinkOptions,
): CarriedHeading | undefined {
  const above = headingsAbove(lines, lineIndex);
  const carriedOver = above.findIndex((heading) => isCarriedOver(heading.text));
  const inside = carriedOver >= 0 ? above.slice(0, carriedOver) : above.filter((heading) => heading.level > 1);
  const chosen = inside.find((heading) => extractTags(heading.text).length > 0) ?? inside[inside.length - 1];
  if (!chosen) {
    return undefined;
  }
  const outer = above.slice(above.indexOf(chosen) + 1).filter((heading) => !isCarriedOver(heading.text));
  const heading = withInheritedTags(chosen.text, outer);
  if (carriedOver < 0) {
    return { heading, link: `(${linkTo(chosen.text, options)})` };
  }
  const last = sectionEnd(lines, chosen);
  return {
    heading,
    link: carriedLink(lines, chosen.line, options) ?? `(${linkTo(chosen.text, options)})`,
    carried: { first: chosen.line, last },
  };
}

/** The line a carried heading's link is on, when the line under the heading is one: a link alone, in brackets. */
export function findCarriedLinkLine(lines: readonly string[], headingLine: number): number | undefined {
  for (let at = headingLine + 1; at < lines.length; at += 1) {
    if (lines[at].trim() !== '') {
      return LINK_LINE.test(lines[at].trim()) ? at : undefined;
    }
  }
  return undefined;
}

/** A line that is one link in brackets: `([[2026-11-13#Vendor sync]])`, or `([text](note.md#heading))`. */
const LINK_LINE = /^\((?:\[\[[^\]\n]+\]\]|\[([^\]\n]*)\]\(([^)\n]+)\))\)$/;

/** The headings a zero-based line is under, nearest first, each of a higher level than the one before. */
function headingsAbove(lines: readonly string[], lineIndex: number): HeadingAbove[] {
  const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
  const fenced = findFencedLines(lines);
  const above: HeadingAbove[] = [];
  let level = 7;
  for (let line = lineIndex - 1; line > frontmatterEnd && level > 1; line -= 1) {
    const heading = fenced.has(line) ? undefined : readHeading(lines[line] ?? '');
    if (heading && heading.level < level) {
      above.push({ line, level: heading.level, text: heading.text });
      level = heading.level;
    }
  }
  return above;
}

/** The last line with text in a heading's section: before the next heading at its level or above, or the note's end. */
function sectionEnd(lines: readonly string[], heading: HeadingAbove): number {
  const fenced = findFencedLines(lines);
  let end = lines.length - 1;
  for (let line = heading.line + 1; line < lines.length; line += 1) {
    const next = fenced.has(line) ? undefined : readHeading(lines[line]);
    if (next && next.level <= heading.level) {
      end = line - 1;
      break;
    }
  }
  while (end > heading.line && lines[end].trim() === '') {
    end -= 1;
  }
  return end;
}

/** A heading's words with the tags of the headings above it that it does not write itself, after its own. */
function withInheritedTags(heading: string, outer: readonly HeadingAbove[]): string {
  const written = new Set(extractTags(heading).map((tag) => tag.key));
  const inherited: string[] = [];
  for (const above of outer) {
    for (const tag of extractTags(above.text)) {
      if (!written.has(tag.key)) {
        written.add(tag.key);
        inherited.push(tag.label);
      }
    }
  }
  return [heading, ...inherited].join(' ');
}

/** A link from today's note to a heading of the note the task is in. */
function linkTo(heading: string, { filePath, todayPath, style }: CarriedLinkOptions): string {
  return formatSectionLink({ heading, sourcePath: todayPath, targetPath: filePath, style });
}

/**
 * The link line under a heading carried before, as today's note writes it:
 * a `[[wiki link]]` as it is, since it names its note wherever it is
 * written, and a Markdown link with its path worked out again from today's
 * note. Undefined when the heading has no such line, or its link names no
 * note, and the task then links to the heading it is carried from.
 */
function carriedLink(lines: readonly string[], headingLine: number, options: CarriedLinkOptions): string | undefined {
  const at = findCarriedLinkLine(lines, headingLine);
  const written = at === undefined ? undefined : lines[at].trim();
  const match = written === undefined ? undefined : LINK_LINE.exec(written);
  if (!written || !match) {
    return undefined;
  }
  if (match[2] === undefined) {
    return written;
  }
  const target = resolveMarkdownLinkTarget(match[2], options.filePath);
  if (target === undefined) {
    return undefined;
  }
  const hash = target.indexOf('#');
  const path = hash >= 0 ? target.slice(0, hash) : target;
  const link = formatNoteLink(match[1], options.todayPath, path, 'markdown');
  return `(${hash >= 0 ? `${link.slice(0, -1)}#${encodeURI(target.slice(hash + 1))})` : link})`;
}

/** Tasks carried together: under Carried over itself, or under one heading below it. */
export interface CarriedGroup {
  /** The heading they go under and its link line; absent for tasks that go under Carried over itself. */
  under?: Pick<CarriedHeading, 'heading' | 'link'>;
  /** The lines written, outdented, block after block. */
  lines: string[];
}

/**
 * What is under Carried over with the carried groups added: tasks with no
 * heading after the lines Carried over holds itself, above any heading
 * under it, and each group under its heading, after what a heading of the
 * same words and link already holds, or under a new one at the end, one
 * level below Carried over. `body` is the lines after the Carried over
 * heading, to the end of its section; blank lines at its end stay there.
 */
export function mergeCarriedOver(body: readonly string[], level: number, groups: readonly CarriedGroup[]): string[] {
  let end = body.length;
  while (end > 0 && body[end - 1].trim() === '') {
    end -= 1;
  }
  const trailing = body.slice(end);
  const fenced = findFencedLines(body);
  const firstHeading = body.findIndex((line, at) => at < end && !fenced.has(at) && readHeading(line) !== undefined);
  const split = firstHeading < 0 ? end : firstHeading;
  const loose = groups.filter((group) => !group.under).flatMap((group) => group.lines);
  let own = appendLines(body.slice(0, split), loose);
  let below = body.slice(split, end);
  if (below.length > 0 && loose.length > 0 && own[own.length - 1]?.trim() !== '') {
    own = [...own, ''];
  }
  const marks = '#'.repeat(Math.min(level + 1, 6));
  for (const group of groups) {
    if (!group.under) {
      continue;
    }
    const held = findHeldSection(below, group.under);
    below = held
      ? [...appendLines(below.slice(0, held.end), group.lines), ...below.slice(held.end)]
      : [...below, '', `${marks} ${group.under.heading}`, group.under.link, ...group.lines];
  }
  return [...own, ...below, ...trailing];
}

/**
 * Lines with more added after their last text: straight after a list item,
 * after a blank line otherwise, as a captured line is placed; the blank
 * lines that ended them come after what was added.
 */
function appendLines(lines: readonly string[], added: readonly string[]): string[] {
  if (added.length === 0) {
    return [...lines];
  }
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') {
    end -= 1;
  }
  const gap = end > 0 && LIST_ITEM.test(lines[end - 1]) ? [] : [''];
  return [...lines.slice(0, end), ...gap, ...added, ...lines.slice(end)];
}

/** A list item's line, as a carried task is. */
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;

/**
 * Where, in the lines under Carried over's own, a heading of the same
 * words whose link line is the same ends: the index after its last line,
 * before the next heading at its level or above.
 */
function findHeldSection(
  below: readonly string[],
  under: Pick<CarriedHeading, 'heading' | 'link'>,
): { end: number } | undefined {
  const fenced = findFencedLines(below);
  const headings = below.map((line, at) => (fenced.has(at) ? undefined : readHeading(line)));
  for (let at = 0; at < below.length; at += 1) {
    const heading = headings[at];
    if (!heading || sameWords(heading.text) !== sameWords(under.heading)) {
      continue;
    }
    const link = findCarriedLinkLine(below, at);
    if (link === undefined || below[link].trim() !== under.link) {
      continue;
    }
    let end = below.length;
    for (let next = at + 1; next < below.length; next += 1) {
      if ((headings[next]?.level ?? 7) <= heading.level) {
        end = next;
        break;
      }
    }
    return { end };
  }
  return undefined;
}

/** A heading's words for comparing: any case, any run of spaces as one. */
function sameWords(heading: string): string {
  return heading.replace(/\s+/g, ' ').trim().toLowerCase();
}
