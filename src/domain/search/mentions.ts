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
 * What a mention is never found inside on a line, besides the code and
 * link ranges every tag reader skips, since a link written there would
 * break it or never show: a Markdown link's words and a reference link's,
 * a reference's definition, a footnote's label, a bare URL or email
 * address, an autolink, an HTML tag and its attributes, inline math, a
 * file path or file name, and a `#tag` or `@person`.
 */
const NOT_PROSE = new RegExp(
  [
    String.raw`^ {0,3}\[(?!\^)[^\]]+\]:.*$`,
    String.raw`!?\[[^\]]*\]\([^)]*\)`,
    String.raw`!?\[[^\]]*\]\[[^\]]*\]`,
    String.raw`\[\^[^\]]*\]`,
    String.raw`<[A-Za-z][A-Za-z0-9+.-]*:[^\s>]*>`,
    String.raw`<\/?[A-Za-z][^>]*>`,
    String.raw`<?https?:\/\/[^\s>]+>?`,
    String.raw`[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+`,
    String.raw`\$[^\s$](?:[^$]*[^\s$])?\$(?!\d)`,
    String.raw`(?<![\p{L}\p{N}_])(?:~|\.{1,2})?\/\S*`,
    String.raw`\b[A-Za-z]:\\\S*`,
    String.raw`\S*\.(?:md|markdown|txt|pdf|png|jpe?g|gif|svg|webp|csv|json|ya?ml|html?|docx?|xlsx?|pptx?|zip)(?![\p{L}\p{N}_])`,
    String.raw`[#@][\p{L}\p{N}_/-]+`,
  ].join('|'),
  'gmu',
);
/**
 * What a mention is never found inside across lines: an Obsidian
 * `%%comment%%`, an HTML `<!-- comment -->`, and `$$` display math, each of
 * which may span several lines.
 */
const NOT_PROSE_BLOCKS = /%%[\s\S]*?%%|<!--[\s\S]*?-->|\$\$[\s\S]*?\$\$/g;

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
    const prose = findProse(lines);
    lines.forEach((text, line) => {
      if (prose[line] === undefined) {
        return;
      }
      for (const match of prose[line].matchAll(pattern)) {
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

/**
 * Each line's prose, with everything a mention is never found inside
 * blanked and every column where it was; undefined for a line that is not
 * prose at all: front matter, a heading, or fenced code. Each line is
 * blanked before blocks are looked for, so a `%%` or `$$` inside code or a
 * URL opens nothing.
 */
function findProse(lines: readonly string[]): (string | undefined)[] {
  const fenced = findFencedLines(lines);
  const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
  const prose = lines.map((text, line) =>
    line <= frontmatterEnd || fenced.has(line) || isHeading(text)
      ? undefined
      : blankRanges(text.replace(NOT_PROSE, blank), text),
  );
  // Blocks are found across the prose joined again; a line that is not
  // prose is blank there, so nothing in it opens or closes one.
  const joined = prose
    .map((text, line) => text ?? ' '.repeat(lines[line].length))
    .join('\n')
    .replace(NOT_PROSE_BLOCKS, blank);
  return joined.split('\n').map((text, line) => (prose[line] === undefined ? undefined : text));
}

/** A match as spaces, line breaks kept, so every column stays where it was. */
function blank(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

/** `text` with the inline code and links of `line` blanked, columns kept. */
function blankRanges(text: string, line: string): string {
  let blanked = text;
  findCodeAndLinkRanges(line).forEach(({ start, end }) => {
    blanked = blanked.slice(0, start) + ' '.repeat(end - start) + blanked.slice(end);
  });
  return blanked;
}

