import { createNoteTitleMap, noteTitle, normalizeHeading, parseWikiTarget, resolveWikiTarget } from '../index/backlinks';
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { findFencedLines, readHeading } from '../markdown/lineShapes';
import type { MoveBlock, MoveSelection } from '../markdown/moveLines';
import { extractNoteLinks, extractTags, stripTags, type EntityNamespaceAliases } from '../markdown/parser';
import { formatNoteLink, headingSlug, type NoteLinkStyle } from '../markdown/wikiLinks';
import type { Section, WorkspaceIndex } from '../model';

/**
 * Move to… on a heading (docs/implementation/47-move-section.md): the
 * heading and everything under it, moved under another note's heading, to
 * the end of a note, or into a new note, with one link to its new place
 * left where it was. Pure, so the rules can be read and tested apart from
 * the editor; the picker and the write are the command's and MoveService's.
 *
 * Lines are zero-based and `end` is inclusive, as in moveLines.ts.
 */

/** The deepest heading Markdown writes, `######`. */
const DEEPEST_HEADING = 6;

/** How many places the picker's Mentioned in this section group lists. */
export const MAX_MENTIONED_PLACES = 10;

/**
 * The section a cursor or selection takes when it starts on a heading line:
 * the heading and every line until the next heading at its level or above,
 * or the end of the note, with the blank lines at its end left behind.
 * Whatever the selection's end, it is the heading's section that moves.
 * Undefined when the first line is not a heading, or is one only in looks,
 * inside front matter or a code block.
 */
export function readSectionBlock(lines: readonly string[], selection: MoveSelection): MoveBlock | undefined {
  const start = selection.start.line;
  const heading = readHeading(lines[start] ?? '');
  if (!heading) {
    return undefined;
  }
  const frontMatterEnd = findFrontmatterEnd(lines);
  const fenced = findFencedLines(lines);
  if ((frontMatterEnd !== undefined && start <= frontMatterEnd) || fenced.has(start)) {
    return undefined;
  }
  let end = lines.length - 1;
  for (let line = start + 1; line < lines.length; line += 1) {
    const next = fenced.has(line) ? undefined : readHeading(lines[line]);
    if (next && next.level <= heading.level) {
      end = line - 1;
      break;
    }
  }
  while (end > start && !(lines[end] ?? '').trim()) {
    end -= 1;
  }
  return {
    start,
    end,
    lines: lines.slice(start, end + 1),
    listItem: false,
    section: { level: heading.level, heading: heading.text },
  };
}

/**
 * How many levels a section's headings move when it goes under a heading
 * at `destinationLevel`: its own heading becomes one level deeper than the
 * destination's (D2), so it nests under it rather than ending it.
 */
export function nestingShift(sectionLevel: number, destinationLevel: number): number {
  return destinationLevel + 1 - sectionLevel;
}

/**
 * The section's lines with every heading, outside code, `shift` levels
 * deeper, or shallower for a negative shift, none deeper than `######` nor
 * shallower than `#`. The rest of each line is kept as written.
 */
export function shiftHeadings(lines: readonly string[], shift: number): string[] {
  if (shift === 0) {
    return [...lines];
  }
  const fenced = findFencedLines(lines);
  return lines.map((line, index) =>
    fenced.has(index) || !readHeading(line)
      ? line
      : line.replace(/^( {0,3})(#{1,6})/, (_, indent: string, hashes: string) => {
          const level = Math.min(DEEPEST_HEADING, Math.max(1, hashes.length + shift));
          return `${indent}${'#'.repeat(level)}`;
        }),
  );
}

/** Where a moved section goes in a note, as moveService's Insertion is read. */
export interface SectionInsertion {
  line: number;
  character: number;
  text: string;
  /** The zero-based line the moved heading is on once the text is inserted. */
  taskLine: number;
}

/**
 * Places a moved section, `moved`, in `content`: at the end of `section`,
 * a heading's lines with everything nested under it (one-based), or at the
 * end of the note, after its last text and a blank line. A blank line is
 * kept between it and a heading that follows straight after. A note with
 * no text gets the section on its first line.
 */
export function placeSection(
  content: string,
  moved: string,
  section?: { startLine: number; endLine: number },
): SectionInsertion {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const first = section ? section.startLine - 1 : 0;
  let end = section ? Math.min(section.endLine, lines.length) - 1 : lines.length - 1;
  while (end >= first && lines[end].trim() === '') {
    end -= 1;
  }
  if (end < first) {
    return { line: 0, character: 0, text: `${moved}${eol}`, taskLine: 0 };
  }
  if (end + 1 < lines.length) {
    const after = lines[end + 1].trim() === '' ? '' : eol;
    return { line: end + 1, character: 0, text: `${eol}${moved}${eol}${after}`, taskLine: end + 2 };
  }
  // The last text ends the note without a line break.
  return { line: end, character: lines[end].length, text: `${eol}${eol}${moved}`, taskLine: end + 2 };
}

/**
 * The line a moved section leaves where it was: a link to the heading in
 * the note it went to, in Deckard's link style (D3). `[[Ledger
 * migration#Ledger cutover plan]]`, or in the Markdown style
 * `[Ledger migration#Ledger cutover plan](Ledger%20migration.md#ledger-cutover-plan)`,
 * whose anchor is the heading's slug. The note alone when the heading has
 * no words, tags aside, or is named as the note is.
 */
export function formatSectionLink({
  heading,
  sourcePath,
  targetPath,
  style,
}: {
  heading: string;
  sourcePath: string;
  targetPath: string;
  style: NoteLinkStyle;
}): string {
  const title = noteTitle(targetPath);
  const words = stripTags(heading).replace(/\s+/g, ' ').trim();
  const named = words && normalizeHeading(words) !== normalizeHeading(title) ? words : undefined;
  const link = formatNoteLink(named ? `${title}#${named}` : title, sourcePath, targetPath, style);
  return style === 'markdown' && named ? `${link.slice(0, -1)}#${encodeURI(headingSlug(named))})` : link;
}

/** A place the Mentioned in this section group offers: a heading of a note, or the end of the note. */
export interface MentionedPlace {
  filePath: string;
  /** The heading; absent for the end of the note. */
  section?: Section;
}

/**
 * The places a section names (D1): the hub notes of its tags and people, in
 * the order first written, then the notes its links name, each note once;
 * each note's headings in order and then the note itself, at its end. Never
 * the section's own note, so a section is not offered a place inside
 * itself; at most {@link MAX_MENTIONED_PLACES}.
 */
export function listMentionedPlaces(
  index: WorkspaceIndex,
  lines: readonly string[],
  { sourcePath, aliases }: { sourcePath: string; aliases?: EntityNamespaceAliases },
): MentionedPlace[] {
  const fenced = findFencedLines(lines);
  const hubs = lines.flatMap((line, lineIndex) =>
    fenced.has(lineIndex)
      ? []
      : extractTags(line, aliases).flatMap((tag) => index.tags.get(tag.key)?.hubFilePaths?.[0] ?? []),
  );
  const titles = createNoteTitleMap(index);
  const linked = extractNoteLinks(lines.join('\n'), sourcePath).flatMap(
    (target) => resolveWikiTarget(titles, parseWikiTarget(target).note, sourcePath) ?? [],
  );
  const notes = [...new Set([...hubs, ...linked])].filter(
    (filePath) => filePath !== sourcePath && index.files.has(filePath),
  );
  const places = notes.flatMap((filePath): MentionedPlace[] => [
    ...(index.files.get(filePath)?.sections ?? [])
      .filter((section) => !section.isInline)
      .sort((left, right) => left.startLine - right.startLine)
      .map((section) => ({ filePath, section })),
    { filePath },
  ]);
  return places.slice(0, MAX_MENTIONED_PLACES);
}
