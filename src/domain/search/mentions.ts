/**
 * The places other notes name a note in plain prose without linking to it,
 * which the editor's lens and Related Notes offer to make links.
 */
import { createNoteTitleMap, noteTitle } from '../index/backlinks';
import { findCodeAndLinkRanges } from '../markdown/inlineRanges';
import { ParsedFile, WorkspaceIndex } from '../model';
import { escapeRegExp } from '../../shared/text';
import { findFencedLines, isHeading } from '../markdown/lineShapes';
import { findFrontmatterEnd } from '../markdown/frontmatter';

/** A note's name written in another note's prose, where a link could go. */
export interface UnlinkedMention {
  filePath: string;
  /** Zero-based line, and the columns of the name as written. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The name as written, which the link keeps. */
  text: string;
}

/** A name shorter than this is too likely to be an ordinary word. */
const MIN_MENTION_LENGTH = 3;
/**
 * What a mention is never found inside, besides the code and link ranges
 * every tag reader skips: a Markdown link's words, a bare URL, and a `#tag`
 * or `@person`.
 */
const NOT_PROSE =
  /!?\[[^\]]*\]\([^)]*\)|<?https?:\/\/[^\s>]+>?|[#@][\p{L}\p{N}_/-]+/gu;

const mentionCache = new WeakMap<WorkspaceIndex, Map<string, UnlinkedMention[]>>();

/**
 * The places other notes write a note's title or one of its aliases as plain
 * prose, not linked: the names a `[[link]]` could be made of.
 *
 * A mention is whole words, matched without regard to case, outside front
 * matter, headings, code fences, and anything `NOT_PROSE` names. Headings are
 * left alone because a heading's text is what links into it name. A name
 * shorter than three characters is not looked for, nor a name another note
 * also goes by, since a link made of it would not open this note. Where two
 * names overlap, such as a title and a longer alias that contains it, the
 * longer is the mention.
 *
 * The workspace is read once per index for each note, so asking again after
 * every keystroke costs a lookup.
 */
export function findUnlinkedMentions(
  file: ParsedFile,
  index: WorkspaceIndex,
): UnlinkedMention[] {
  const titles = createNoteTitleMap(index);
  const names = [noteTitle(file.filePath), ...(file.aliases ?? [])]
    .map((name) => name.trim())
    .filter((name, position, all) => {
      const key = name.toLocaleLowerCase();
      const owners = titles.get(key) ?? [];
      return (
        name.length >= MIN_MENTION_LENGTH &&
        owners.every((owner) => owner === file.filePath) &&
        all.findIndex((other) => other.toLocaleLowerCase() === key) === position
      );
    })
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) {
    return [];
  }

  const key = [file.filePath, ...names].join('\u0000');
  let cached = mentionCache.get(index);
  if (!cached) {
    cached = new Map();
    mentionCache.set(index, cached);
  }
  const known = cached.get(key);
  if (known) {
    return known;
  }

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
    'giu',
  );
  const mentions: UnlinkedMention[] = [];
  index.files.forEach((other, filePath) => {
    if (filePath === file.filePath) {
      return;
    }
    const lines = other.content.split(/\r?\n/);
    const fenced = findFencedLines(lines);
    const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
    lines.forEach((text, line) => {
      if (line <= frontmatterEnd || fenced.has(line) || isHeading(text)) {
        return;
      }
      // Blank out what is not prose, keeping every column where it was.
      const prose = blankRanges(
        text.replace(NOT_PROSE, (match) => ' '.repeat(match.length)),
        text,
      );
      for (const match of prose.matchAll(pattern)) {
        const startColumn = match.index ?? 0;
        mentions.push({
          filePath,
          line,
          startColumn,
          endColumn: startColumn + match[0].length,
          text: text.slice(startColumn, startColumn + match[0].length),
        });
      }
    });
  });
  mentions.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line ||
      left.startColumn - right.startColumn,
  );
  cached.set(key, mentions);
  return mentions;
}

/** `text` with the inline code and links of `line` blanked, columns kept. */
function blankRanges(text: string, line: string): string {
  let blanked = text;
  findCodeAndLinkRanges(line).forEach(({ start, end }) => {
    blanked = blanked.slice(0, start) + ' '.repeat(end - start) + blanked.slice(end);
  });
  return blanked;
}

