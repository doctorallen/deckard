import { findFencedLines, stripTags } from '../markdown/parser';
import { ParsedFile, Section, WorkspaceIndex } from '../types';

/**
 * Wiki links between notes, found once per index so the editor can count and
 * list them without rescanning the workspace on every keystroke.
 *
 * A link names a note by its file name and, after `#`, optionally a heading:
 * `[[Launch plan]]`, `[[Launch plan#Decision|the call]]`, or `[[#Decision]]`
 * for a heading in the same note. Names resolve the way Cmd/Ctrl-click does:
 * an exact, case-insensitive match that exactly one note carries.
 */

/** One `[[link]]` written in a note. */
export interface WikiLinkOccurrence {
  /** The note the link is written in. */
  sourcePath: string;
  /** Zero-based line, and the columns of the whole `[[…]]`. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The note it points at, when exactly one note has that name. */
  targetPath?: string;
  /** The heading after `#`, as written. */
  heading?: string;
}

/** What a link names: a note, and optionally one of its headings. */
export interface WikiLinkTarget {
  /** Empty for `[[#Heading]]`, which names the note the link is in. */
  note: string;
  heading?: string;
}

const WIKI_LINK = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function parseWikiTarget(text: string): WikiLinkTarget {
  const hash = text.indexOf('#');
  if (hash < 0) {
    return { note: text.trim() };
  }
  const heading = text.slice(hash + 1).trim();
  return { note: text.slice(0, hash).trim(), heading: heading || undefined };
}

/** A note's title: its file name without the `.md` extension. */
export function noteTitle(filePath: string): string {
  return (filePath.split('/').pop() ?? filePath).replace(/\.md$/i, '');
}

/**
 * The names each index's notes go by. Links are resolved after every edit and
 * on every hover, so the names are gathered once per index.
 */
const titleMaps = new WeakMap<WorkspaceIndex, Map<string, string[]>>();

/**
 * Note names, lowercased, each with every file that carries it: a note's
 * title, and the aliases its front matter gives it.
 */
export function createNoteTitleMap(
  index: WorkspaceIndex,
): ReadonlyMap<string, readonly string[]> {
  const cached = titleMaps.get(index);
  if (cached) {
    return cached;
  }
  const titles = new Map<string, string[]>();
  const add = (name: string, filePath: string) => {
    const key = name.trim().toLocaleLowerCase();
    const paths = titles.get(key);
    if (!paths) {
      titles.set(key, [filePath]);
    } else if (!paths.includes(filePath)) {
      paths.push(filePath);
    }
  };
  index.files.forEach((file, filePath) => {
    add(noteTitle(filePath), filePath);
    file.aliases?.forEach((alias) => add(alias, filePath));
  });
  titleMaps.set(index, titles);
  return titles;
}

/**
 * Every note a link's name could mean. An empty name means the note the link
 * is written in.
 */
export function findWikiTargetPaths(
  titles: ReadonlyMap<string, readonly string[]>,
  note: string,
  sourcePath: string,
): readonly string[] {
  return note ? (titles.get(note.toLocaleLowerCase()) ?? []) : [sourcePath];
}

/** The note a link means, or undefined when no note or several match. */
export function resolveWikiTarget(
  titles: ReadonlyMap<string, readonly string[]>,
  note: string,
  sourcePath: string,
): string | undefined {
  const paths = findWikiTargetPaths(titles, note, sourcePath);
  return paths.length === 1 ? paths[0] : undefined;
}

/** Finds the `[[link]]` under a column of one line. */
export function findWikiLinkAt(
  lineText: string,
  character: number,
): { target: WikiLinkTarget; startColumn: number; endColumn: number } | undefined {
  for (const match of lineText.matchAll(WIKI_LINK)) {
    const startColumn = match.index ?? 0;
    const endColumn = startColumn + match[0].length;
    if (character >= startColumn && character < endColumn) {
      return { target: parseWikiTarget(match[1]), startColumn, endColumn };
    }
  }
  return undefined;
}

/** A heading as a link matches it: without tags, letter case, or extra spaces. */
export function normalizeHeading(text: string): string {
  return stripTags(text).replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/** The heading section a link's `#Heading` names in a note. */
export function findLinkedSection(
  file: ParsedFile,
  heading: string,
): Section | undefined {
  const wanted = normalizeHeading(heading);
  return file.sections.find(
    (section) => !section.isInline && normalizeHeading(section.heading) === wanted,
  );
}

export class BacklinkIndex {
  private readonly byTarget = new Map<string, WikiLinkOccurrence[]>();

  public constructor(public readonly occurrences: readonly WikiLinkOccurrence[]) {
    for (const occurrence of occurrences) {
      if (occurrence.targetPath) {
        const links = this.byTarget.get(occurrence.targetPath) ?? [];
        links.push(occurrence);
        this.byTarget.set(occurrence.targetPath, links);
      }
    }
  }

  /** Links into a note from other notes. */
  public toNote(filePath: string): WikiLinkOccurrence[] {
    return (this.byTarget.get(filePath) ?? []).filter(
      (occurrence) => occurrence.sourcePath !== filePath,
    );
  }

  /** Links to one heading of a note, including `[[#Heading]]` inside it. */
  public toHeading(filePath: string, heading: string): WikiLinkOccurrence[] {
    const wanted = normalizeHeading(heading);
    return (this.byTarget.get(filePath) ?? []).filter(
      (occurrence) =>
        occurrence.heading !== undefined &&
        normalizeHeading(occurrence.heading) === wanted,
    );
  }
}

/**
 * Finds every Wiki link in the workspace's saved notes, front matter
 * included, and code fences excluded.
 */
export function buildBacklinkIndex(index: WorkspaceIndex): BacklinkIndex {
  const titles = createNoteTitleMap(index);
  const occurrences: WikiLinkOccurrence[] = [];
  index.files.forEach((file, sourcePath) => {
    const lines = file.content.split(/\r?\n/);
    const fenced = findFencedLines(lines);
    lines.forEach((text, line) => {
      if (fenced.has(line)) {
        return;
      }
      for (const match of text.matchAll(WIKI_LINK)) {
        const target = parseWikiTarget(match[1]);
        const startColumn = match.index ?? 0;
        occurrences.push({
          sourcePath,
          line,
          startColumn,
          endColumn: startColumn + match[0].length,
          targetPath: resolveWikiTarget(titles, target.note, sourcePath),
          heading: target.heading,
        });
      }
    });
  });
  return new BacklinkIndex(occurrences);
}
