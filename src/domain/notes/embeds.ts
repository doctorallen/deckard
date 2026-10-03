import { parseMarkdown } from '../markdown/parser';
import { createPreviewSourceHref } from '../markdown/sourceLinks';
import { ParsedFile, WorkspaceIndex } from '../model';
import {
  createNoteTitleMap,
  findLinkedBlock,
  findLinkedSection,
  noteTitle,
  parseWikiTarget,
  resolveWikiTarget,
} from '../index/backlinks';
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { ATTACHMENT } from '../markdown/noteNames';
import { findFencedLines } from '../markdown/lineShapes';
import { BLOCK_ID_PATTERN } from '../markdown/taskFields';

/**
 * What a `![[Note]]`, `![[Note#Heading]]`, or `![[Note#^id]]` embed names:
 * which lines of a note are embeds, and the note, section, or marked line
 * each one reads. The preview draws them (`ui/preview/noteEmbeds.ts`) and
 * the editor's lenses report the ones that name nothing; both read them here.
 */

/** An embed alone on its line, as `![[Target]]`, with the target captured. */
export const EMBED_LINE = /^ {0,3}!\[\[([^\]]+)\]\][ \t]*$/;

/**
 * The embeds in a note's source, the lines the preview would draw as one:
 * alone on their line, outside code fences, and naming a note rather than an
 * attachment.
 */
export function findEmbedLines(
  content: string,
): { line: number; target: string }[] {
  const lines = content.split(/\r?\n/);
  const fenced = findFencedLines(lines);
  return lines.flatMap((text, line) => {
    const match = fenced.has(line) ? null : EMBED_LINE.exec(text);
    return match && !ATTACHMENT.test(parseWikiTarget(match[1]).note)
      ? [{ line, target: match[1] }]
      : [];
  });
}

/** What an embed reads as: the note, section, or line it names, or why it names none. */
export type ResolvedEmbed =
  | { kind: 'note'; title: string; content: string; href?: string }
  | { kind: 'missing'; reason: string; href?: string };

/**
 * What an embed draws: a whole note, one of its sections, or one marked
 * line. An embed with no note name reads the note it is written in, which is
 * the source the preview is rendering.
 */
export function resolveEmbed(
  target: string,
  documentSource: string,
  index: WorkspaceIndex | undefined,
  /** How the note written in is read: a caller that resolves many embeds passes one parser for all. */
  parseSource: SourceParser = createSourceParser(),
): ResolvedEmbed {
  const { note, heading, block } = parseWikiTarget(target);
  if (!note && !heading && !block) {
    return { kind: 'missing', reason: 'This embed names nothing.' };
  }

  if (!note) {
    // The note embedding itself: its source is what the preview is drawing,
    // so it is read from there rather than from the index, which may be one
    // save behind.
    const file = parseSource(documentSource);
    return readFrom({ file, filePath: '', heading, block, target });
  }

  if (!index) {
    return { kind: 'missing', reason: 'Deckard is indexing the workspace…' };
  }
  const titles = createNoteTitleMap(index);
  const filePath = resolveWikiTarget(titles, note, '');
  const file = filePath ? index.files.get(filePath) : undefined;
  if (!file || !filePath) {
    const names = titles.get(note.trim().toLocaleLowerCase())?.length ?? 0;
    return {
      kind: 'missing',
      reason:
        names > 1
          ? `"${note}" names ${names} notes, so this embed reads none.`
          : `No note is named "${note}" yet.`,
    };
  }
  return readFrom({ file, filePath, heading, block, target });
}

/** What one embed reads, once the note it names is found. */
interface EmbedRead {
  /** The note, parsed. */
  file: ParsedFile;
  /** Its workspace path; '' for the note the embed is written in. */
  filePath: string;
  heading: string | undefined;
  block: string | undefined;
  /** The embed's target as written, the title when nothing better names it. */
  target: string;
}

/** One note, section, or marked line of a parsed note. */
function readFrom(read: EmbedRead): ResolvedEmbed {
  const title = read.filePath ? noteTitle(read.filePath) : '';
  if (read.block) {
    return readBlock(read, read.block, title);
  }
  if (read.heading) {
    return readSection(read, read.heading, title);
  }
  const source = sourceHref(read.filePath, 1);
  return {
    kind: 'note',
    title: title || read.target,
    content: withoutFrontmatter(read.file.content),
    ...(source ? { href: source } : {}),
  };
}

/** The preview link to a line of a note; none for the note written in. */
function sourceHref(filePath: string, line: number): string | undefined {
  return filePath ? createPreviewSourceHref(filePath, line) : undefined;
}

/** The one line marked `^block`, without its marker. */
function readBlock(read: EmbedRead, block: string, title: string): ResolvedEmbed {
  const line = findLinkedBlock(read.file, block);
  const text =
    line === undefined ? undefined : read.file.content.split(/\r?\n/)[line - 1];
  if (text === undefined || line === undefined) {
    return {
      kind: 'missing',
      reason: `Nothing in ${title || 'this note'} is marked ^${block}.`,
    };
  }
  const source = sourceHref(read.filePath, line);
  return {
    kind: 'note',
    title: `${title}#^${block}`.replace(/^#/, ''),
    content: text.replace(BLOCK_ID_PATTERN, '').trim(),
    ...(source ? { href: source } : {}),
  };
}

/** The section a heading names, and everything nested under it. */
function readSection(read: EmbedRead, heading: string, title: string): ResolvedEmbed {
  const section = findLinkedSection(read.file, heading);
  if (!section) {
    return {
      kind: 'missing',
      reason: `${title || 'This note'} has no heading "${heading}".`,
    };
  }
  const source = sourceHref(read.filePath, section.startLine);
  return {
    kind: 'note',
    title: `${title ? `${title} › ` : ''}${section.heading.trim()}`,
    // The section and everything nested under it, which is what a
    // reader following the link would have found there.
    content: section.rawContent,
    ...(source ? { href: source } : {}),
  };
}

/** The body of a note, without the front matter a reader does not need. */
export function withoutFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/);
  const end = findFrontmatterEnd(lines);
  return end === undefined ? content : lines.slice(end + 1).join('\n').replace(/^\n+/, '');
}

/** Reads the note an embed is written in, as `resolveEmbed` needs it. */
export type SourceParser = (content: string) => ParsedFile;

/**
 * A parser that keeps the last note it read, so a note holding several
 * embeds of itself is parsed once for all of them, and the preview, which
 * redraws from the top each time, parses it again only once it changes.
 * Each preview engine has its own, so two previews of different notes do
 * not take turns replacing one cache.
 */
export function createSourceParser(): SourceParser {
  let last: { content: string; file: ParsedFile } | undefined;
  return (content) => {
    if (last?.content !== content) {
      last = { content, file: parseMarkdown('', content) };
    }
    return last.file;
  };
}
