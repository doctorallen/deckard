import { stripTags } from '../markdown/parser';
import { WorkspaceIndex } from '../model';
import {
  createNoteTitleMap,
  findLinkedSection,
  normalizeHeading,
  noteTitle,
  resolveWikiTarget,
  WIKI_LINK_WITH_TEXT,
} from '../index/backlinks';
import { findWikiLinkSpans } from '../markdown/wikiLinks';

/**
 * Keeps `[[links]]` pointing where they pointed before a note or a heading was
 * renamed.
 *
 * A link names its target by text, so renaming a note breaks every link to it
 * and renaming a heading breaks every link into that heading. Link diagnostics
 * report the breakage afterwards; these rewrites prevent it, in the same undo
 * step as the rename that would have caused it.
 */

/** One `[[link]]` to rewrite, in the note that writes it. */
export interface LinkRewrite {
  /** The note holding the link. */
  filePath: string;
  /** Zero-based line, and the columns of the whole `[[…]]`. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The whole `[[…]]` as it is written now. */
  from: string;
  /** The whole `[[…]]` as it should read. */
  text: string;
}

/**
 * A heading being renamed: the note it is in, the one-based line it is on,
 * its text now, and its new text.
 */
export interface HeadingRename {
  filePath: string;
  startLine: number;
  from: string;
  to: string;
}

/** A note's text by its index path, or undefined when it cannot be read. */
export type NoteContent = (filePath: string) => string | undefined;

/**
 * What a link is made of, so a rewrite can change the note it names and leave
 * everything the author wrote around it alone.
 */
interface LinkParts {
  /** The note name, as written. */
  note: string;
  /** The `#Heading` or `#^id` after the name, as written, caret included. */
  fragment?: string;
  /** The text after `|`, as written. */
  display?: string;
}

/**
 * Rewrites every link that names a note by the title it is losing, so the
 * links follow it to its new name.
 *
 * Only links that resolve to the renamed note are touched, so a link to
 * another note that happens to share the name, or one written through an
 * alias the note keeps, is left as it is.
 */
export function planNoteRenameRewrites(
  index: WorkspaceIndex,
  fromPath: string,
  toTitle: string,
  contentOf: NoteContent = (filePath) => index.files.get(filePath)?.content,
): LinkRewrite[] {
  const fromTitle = noteTitle(fromPath).toLocaleLowerCase();
  if (!fromTitle || noteTitle(fromPath) === toTitle) {
    return [];
  }
  const titles = createNoteTitleMap(index);
  return findRewrites(index, contentOf, (parts, sourcePath) => {
    if (parts.note.trim().toLocaleLowerCase() !== fromTitle) {
      return undefined;
    }
    return resolveWikiTarget(titles, parts.note, sourcePath) === fromPath
      ? { ...parts, note: toTitle }
      : undefined;
  });
}

/**
 * Rewrites every link that names one heading of one note, so the links follow
 * the heading's new text. A link to the note itself, without a `#`, already
 * points where it should and is left alone.
 *
 * A link names a heading by its words, and opens the first heading in the
 * note with them. When the heading renamed is a later one with the same
 * words, no link opens it, and none is rewritten: each still opens the
 * first.
 */
export function planHeadingRenameRewrites(
  index: WorkspaceIndex,
  rename: HeadingRename,
  contentOf: NoteContent = (path) => index.files.get(path)?.content,
): LinkRewrite[] {
  const wanted = normalizeHeading(rename.from);
  const next = stripTags(rename.to).replace(/\s+/g, ' ').trim();
  if (!wanted || !next || wanted === normalizeHeading(rename.to)) {
    return [];
  }
  const file = index.files.get(rename.filePath);
  if (file && findLinkedSection(file, rename.from)?.startLine !== rename.startLine) {
    return [];
  }
  const titles = createNoteTitleMap(index);
  return findRewrites(index, contentOf, (parts, sourcePath) => {
    const fragment = parts.fragment;
    if (
      !fragment ||
      fragment.startsWith('^') ||
      normalizeHeading(fragment) !== wanted
    ) {
      return undefined;
    }
    const target = parts.note
      ? resolveWikiTarget(titles, parts.note, sourcePath)
      : sourcePath;
    return target === rename.filePath ? { ...parts, fragment: next } : undefined;
  });
}

/** The notes a set of rewrites touches, and how many links each one holds. */
export function countRewrittenNotes(rewrites: readonly LinkRewrite[]): number {
  return new Set(rewrites.map((rewrite) => rewrite.filePath)).size;
}

/**
 * Whether a planned rewrite still fits the note as it stands: its line is
 * there and holds the planned link, character for character. Anything else
 * means the note moved on, and rewriting it would undo whoever moved it.
 */
export function rewriteStillFits(
  rewrite: Pick<LinkRewrite, 'line' | 'startColumn' | 'endColumn' | 'from'>,
  lines: readonly string[],
): boolean {
  if (rewrite.line >= lines.length) {
    return false;
  }
  return lines[rewrite.line].slice(rewrite.startColumn, rewrite.endColumn) === rewrite.from;
}

/**
 * The columns of a heading line's text after its `#` marks, which a rename
 * replaces, or undefined when the line is not written as a heading.
 */
export function findHeadingTextColumns(
  lineText: string,
): { startColumn: number; endColumn: number } | undefined {
  const marks = /^\s*(#+)\s*/.exec(lineText);
  if (!marks) {
    return undefined;
  }
  return { startColumn: marks[0].length, endColumn: lineText.length };
}

/**
 * Walks every note's links once and keeps the ones a caller rewrites. Links
 * in fenced code and inline code are examples, not links, and are left
 * alone, as every other reader of a note's links leaves them.
 */
function findRewrites(
  index: WorkspaceIndex,
  contentOf: NoteContent,
  rewrite: (parts: LinkParts, sourcePath: string) => LinkParts | undefined,
): LinkRewrite[] {
  const rewrites: LinkRewrite[] = [];
  index.files.forEach((_file, sourcePath) => {
    const content = contentOf(sourcePath);
    if (content === undefined) {
      return;
    }
    rewrites.push(...findRewritesIn(content, sourcePath, rewrite));
  });
  return rewrites;
}

/** The rewrites one note's text holds, read through findWikiLinkSpans. */
function findRewritesIn(
  content: string,
  sourcePath: string,
  rewrite: (parts: LinkParts, sourcePath: string) => LinkParts | undefined,
): LinkRewrite[] {
  const lines = content.split(/\r?\n/);
  return findWikiLinkSpans(content).flatMap((span): LinkRewrite[] => {
    const from = lines[span.line].slice(span.startColumn, span.endColumn);
    // The span is one whole link, so this reads it again with its display text.
    const [match] = from.matchAll(WIKI_LINK_WITH_TEXT);
    const next = match ? rewrite(readLinkParts(match[1], match[2]), sourcePath) : undefined;
    return next
      ? [{ filePath: sourcePath, line: span.line, startColumn: span.startColumn, endColumn: span.endColumn, from, text: writeLink(next) }]
      : [];
  });
}

/** A link's target and display text, split into the parts a rewrite changes. */
function readLinkParts(target: string, display?: string): LinkParts {
  const hash = target.indexOf('#');
  return {
    note: hash < 0 ? target.trim() : target.slice(0, hash).trim(),
    ...(hash < 0 ? {} : { fragment: target.slice(hash + 1).trim() }),
    ...(display === undefined ? {} : { display }),
  };
}

/** The `[[…]]` a set of parts writes. */
function writeLink(parts: LinkParts): string {
  const fragment = parts.fragment ? `#${parts.fragment}` : '';
  const display = parts.display === undefined ? '' : `|${parts.display}`;
  return `[[${parts.note}${fragment}${display}]]`;
}
