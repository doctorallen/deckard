import { ParsedFile, WorkspaceIndex } from '../types';
import {
  createNoteTitleMap,
  getBacklinkIndex,
  normalizeHeading,
  parseWikiTarget,
} from '../workspace/backlinks';

/**
 * What a search's `link` condition reads: every `[[link]]` in the workspace,
 * each given to the entries that own its line.
 *
 * The links are the ones Linked from lists (front matter included, code
 * fences excluded), so `link = [[Atlas]]` and Atlas's Linked from always
 * agree. A line is owned the way a tag written on it is: by the task on it,
 * else by the tagged lines that cover it, else by the heading whose own lines
 * hold it (not that heading's parents), so one link is one result. A link no entry
 * owns, such as one in front matter or above the first heading, answers for
 * its note as a whole.
 */
export interface UnitLink {
  sourcePath: string;
  /** The note the link opens, when exactly one note has its name. */
  targetPath?: string;
  /** The name as written, lowercased; empty for `[[#Heading]]`. */
  name: string;
  /** The heading after `#`, normalized as links match headings. */
  heading?: string;
  block?: string;
}

export interface LinkState {
  /** Keyed `section:<id>`, `task:<id>`, or `file:<path>`. */
  byUnit: ReadonlyMap<string, readonly UnitLink[]>;
  /** Notes with a link no entry of theirs owns. */
  looseFiles: ReadonlySet<string>;
}

/** What one `link` value asks for. */
export interface LinkQuery {
  /** Every note the name means, by title or alias. */
  paths: ReadonlySet<string>;
  /** The name, lowercased, for links that open no note. */
  name: string;
  heading?: string;
  block?: string;
}

const linkStates = new WeakMap<WorkspaceIndex, LinkState>();

export function getQueryLinkState(index: WorkspaceIndex): LinkState {
  const cached = linkStates.get(index);
  if (cached) {
    return cached;
  }
  const byUnit = new Map<string, UnitLink[]>();
  const looseFiles = new Set<string>();
  const add = (key: string, link: UnitLink): void => {
    const links = byUnit.get(key);
    if (links) {
      links.push(link);
    } else {
      byUnit.set(key, [link]);
    }
  };
  const bySource = new Map<string, UnitLink[][]>();
  getBacklinkIndex(index).occurrences.forEach((occurrence) => {
    const link: UnitLink = {
      sourcePath: occurrence.sourcePath,
      ...(occurrence.targetPath ? { targetPath: occurrence.targetPath } : {}),
      name: occurrence.note.toLocaleLowerCase(),
      ...(occurrence.heading !== undefined
        ? { heading: normalizeHeading(occurrence.heading) }
        : {}),
      ...(occurrence.block ? { block: occurrence.block } : {}),
    };
    let lines = bySource.get(occurrence.sourcePath);
    if (!lines) {
      lines = [];
      bySource.set(occurrence.sourcePath, lines);
    }
    // One-based, as sections and tasks count lines.
    const line = occurrence.line + 1;
    (lines[line] ??= []).push(link);
  });
  bySource.forEach((lines, filePath) => {
    const file = index.files.get(filePath);
    if (!file) {
      return;
    }
    lines.forEach((links, line) => {
      const owners = findLineOwners(file, line);
      if (owners.length === 0) {
        looseFiles.add(filePath);
        links.forEach((link) => add(`file:${filePath}`, link));
        return;
      }
      owners.forEach((owner) => links.forEach((link) => add(owner, link)));
    });
  });
  const state = { byUnit, looseFiles };
  linkStates.set(index, state);
  return state;
}

/**
 * The entries that own a one-based line of a note, as a tag written there
 * would: the task on it; failing that, each tagged line that covers it;
 * failing that, the heading whose own lines hold it.
 */
function findLineOwners(file: ParsedFile, line: number): string[] {
  const task = file.tasks.find((candidate) => candidate.lineNumber === line);
  if (task) {
    return [`task:${task.id}`];
  }
  const inline = file.sections.filter(
    (section) => section.isInline && section.startLine <= line && section.endLine >= line,
  );
  if (inline.length > 0) {
    return inline.map((section) => `section:${section.id}`);
  }
  const heading = file.sections.find(
    (section) => !section.isInline && section.startLine <= line && section.bodyEndLine >= line,
  );
  return heading ? [`section:${heading.id}`] : [];
}

/** Reads a `link` condition's value against the index's note names. */
export function resolveLinkQuery(index: WorkspaceIndex, value: string): LinkQuery {
  const target = parseWikiTarget(value);
  const name = target.note.toLocaleLowerCase();
  return {
    paths: new Set(createNoteTitleMap(index).get(name) ?? []),
    name,
    ...(target.heading ? { heading: normalizeHeading(target.heading) } : {}),
    ...(target.block ? { block: target.block } : {}),
  };
}

/** Whether one link answers a `link` condition. */
export function matchesLink(link: UnitLink, query: LinkQuery): boolean {
  if (query.heading !== undefined && link.heading !== query.heading) {
    return false;
  }
  if (query.block !== undefined && link.block !== query.block) {
    return false;
  }
  if (link.targetPath) {
    if (!query.paths.has(link.targetPath)) {
      return false;
    }
    // A note naming itself is not a link to it, as Linked from leaves it
    // out; a link to one of its own headings or lines is.
    return (
      query.heading !== undefined ||
      query.block !== undefined ||
      link.sourcePath !== link.targetPath
    );
  }
  // A name no note or several notes carry: the links that write it.
  return link.name !== '' && link.name === query.name;
}

/** Whether any of an entry's links answers a `link` condition. */
export function matchesLinkQuery(
  links: readonly UnitLink[] | undefined,
  query: LinkQuery,
): boolean {
  return links?.some((link) => matchesLink(link, query)) ?? false;
}

/**
 * How many of a search's results link to each note, most first: the notes a
 * Links to facet offers. A note's links to itself do not count.
 */
export function countLinkTargets(
  index: WorkspaceIndex,
  unitKeys: readonly string[],
): Array<{ targetPath: string; count: number }> {
  const state = getQueryLinkState(index);
  const counts = new Map<string, number>();
  unitKeys.forEach((key) => {
    const targets = new Set(
      (state.byUnit.get(key) ?? [])
        .filter((link) => link.targetPath && link.targetPath !== link.sourcePath)
        .map((link) => link.targetPath as string),
    );
    targets.forEach((target) => counts.set(target, (counts.get(target) ?? 0) + 1));
  });
  return [...counts.entries()]
    .map(([targetPath, count]) => ({ targetPath, count }))
    .sort((left, right) => right.count - left.count || left.targetPath.localeCompare(right.targetPath));
}

/**
 * The note a `link` value names, as the AST keeps it: without brackets or an
 * alias after `|`, such as `Atlas`, `Atlas#Decision`, or `Atlas#^q3`. Empty
 * when no note is named, as in `[[#Decision]]`.
 */
export function readLinkValue(value: string): string {
  let inner = value.trim();
  if (inner.startsWith('[[')) {
    inner = inner.slice(2);
  }
  if (inner.endsWith(']]')) {
    inner = inner.slice(0, -2);
  }
  const bar = inner.indexOf('|');
  if (bar >= 0) {
    inner = inner.slice(0, bar);
  }
  const target = parseWikiTarget(inner);
  if (!target.note) {
    return '';
  }
  if (target.block) {
    return `${target.note}#^${target.block}`;
  }
  return target.heading ? `${target.note}#${target.heading}` : target.note;
}
