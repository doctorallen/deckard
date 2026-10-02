import { stripTags } from '../markdown/parser';
import { ParsedFile, Section, WorkspaceIndex } from '../model';
import { findFencedLines } from '../markdown/lineShapes';

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
  /** The note's name as the link writes it, trimmed; empty for `[[#Heading]]`. */
  note: string;
  /** The note it points at, when exactly one note has that name. */
  targetPath?: string;
  /** The heading after `#`, as written. */
  heading?: string;
  /** The `^id` after `#`, without its caret. */
  block?: string;
}

/**
 * What a link names: a note, and optionally one of its headings or one of
 * its `^block-id` lines.
 */
export interface WikiLinkTarget {
  /** Empty for `[[#Heading]]`, which names the note the link is in. */
  note: string;
  heading?: string;
  /** The `^id` after `#`, without its caret, for `[[Note#^id]]`. */
  block?: string;
}

/**
 * A `[[target]]` or `[[target|display text]]` link, with the target as group
 * 1 and the display text not captured. It is global and shared, so use it
 * only with `matchAll` or `replace`, which leave its `lastIndex` alone;
 * `exec` or `test` on it would move where the next caller starts.
 */
export const WIKI_LINK = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * The same link with its display text captured as group 2, for a rewrite
 * that must keep what the link shows. Shared like `WIKI_LINK`.
 */
export const WIKI_LINK_WITH_TEXT = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Splits what sits between a link's brackets, display text already removed,
 * into the note and the heading or `^id` after the first `#`. Each part is
 * trimmed; an empty heading or `^id` is left out rather than kept as `''`.
 */
export function parseWikiTarget(text: string): WikiLinkTarget {
  const hash = text.indexOf('#');
  if (hash < 0) {
    return { note: text.trim() };
  }
  const note = text.slice(0, hash).trim();
  const fragment = text.slice(hash + 1).trim();
  // A fragment that opens with a caret names a line rather than a heading.
  // Obsidian writes it that way, and a heading cannot begin with one.
  if (fragment.startsWith('^')) {
    const block = fragment.slice(1).trim();
    return { note, ...(block ? { block } : {}) };
  }
  return { note, heading: fragment || undefined };
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

/**
 * The one-based line a link's `#^id` names in a note, or undefined when the
 * note marks no such block. Only the note's own ids count: the id is the
 * link's text, and `^constructor` must not find what every object inherits.
 */
export function findLinkedBlock(
  file: ParsedFile,
  block: string,
): number | undefined {
  const blockIds = file.blockIds;
  return blockIds && Object.hasOwn(blockIds, block) ? blockIds[block] : undefined;
}

/**
 * The links of one index grouped by the note they open, so a note's, a
 * heading's, or a line's backlinks are a lookup rather than a scan. A link
 * whose name opens no note, or several, is kept in `occurrences` but
 * answers none of the lookups.
 */
export class BacklinkIndex {
  private readonly byTarget = new Map<string, WikiLinkOccurrence[]>();

  /** Groups the links by target, keeping the order they were found in. */
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

  /** Links to one `^block-id` line of a note, including from within it. */
  public toBlock(filePath: string, block: string): WikiLinkOccurrence[] {
    return (this.byTarget.get(filePath) ?? []).filter(
      (occurrence) => occurrence.block === block,
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

const backlinkIndexes = new WeakMap<WorkspaceIndex, BacklinkIndex>();

/**
 * The backlink index of one workspace index, built once and shared by every
 * surface that reads links: Linked from, orphans, and a search's `link`.
 */
export function getBacklinkIndex(index: WorkspaceIndex): BacklinkIndex {
  let backlinks = backlinkIndexes.get(index);
  if (!backlinks) {
    backlinks = buildBacklinkIndex(index);
    backlinkIndexes.set(index, backlinks);
  }
  return backlinks;
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
          note: target.note,
          targetPath: resolveWikiTarget(titles, target.note, sourcePath),
          heading: target.heading,
          block: target.block,
        });
      }
    });
  });
  return new BacklinkIndex(occurrences);
}

/** A name links write that no note carries. */
export interface MissingLinkTarget {
  /** The name as the first link found writes it. */
  name: string;
  /** Lowercased, as names are matched. */
  key: string;
  /** How many links write it. */
  count: number;
  /** The notes the links are in, each once, in the order found. */
  sourcePaths: string[];
}

/**
 * Every name a link writes that opens no note, most linked first. A name
 * two notes share is not missing: it opens a choice, which the editor
 * warns about where it is written.
 */
export function findMissingLinkTargets(index: WorkspaceIndex): MissingLinkTarget[] {
  const titles = createNoteTitleMap(index);
  const missing = new Map<string, MissingLinkTarget>();
  getBacklinkIndex(index).occurrences.forEach((occurrence) => {
    if (!occurrence.note || findWikiTargetPaths(titles, occurrence.note, occurrence.sourcePath).length > 0) {
      return;
    }
    const key = occurrence.note.toLocaleLowerCase();
    const found = missing.get(key) ?? { name: occurrence.note, key, count: 0, sourcePaths: [] };
    found.count += 1;
    if (!found.sourcePaths.includes(occurrence.sourcePath)) {
      found.sourcePaths.push(occurrence.sourcePath);
    }
    missing.set(key, found);
  });
  return [...missing.values()].sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name),
  );
}
