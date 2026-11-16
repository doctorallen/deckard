import {
  createNoteTitleMap,
  noteTitle,
  parseWikiTarget,
  resolveWikiTarget,
} from '../../domain/index/backlinks';
import { findFrontmatterEnd, splitFrontmatterValues } from '../../domain/markdown/frontmatter';
import { stripTags } from '../../domain/markdown/parser';
import { formatKeyWords, readTagNamespace } from '../../domain/markdown/tagKeys';
import { ParsedFile, WorkspaceIndex } from '../../domain/model';

/**
 * How notes hang under their hubs, which a note's breadcrumbs walk and
 * Home's Types tab reads its hub notes from: each hub note by the tag it
 * describes, and each note's parents.
 *
 * A note is about a tag when its front matter or its first heading carries
 * the tag: what the whole note is about, not a line that mentions it in
 * passing. A note can name its parent outright with `up: "[[Atlas]]"` in
 * its front matter, which places it there alone, whatever its tags.
 *
 * A hub note goes under another only by `up:`. The tags in a hub's front
 * matter are its properties, such as a team's regulars or a person's team,
 * which describe it rather than file it; read as parents, a team listing a
 * person and the person naming the team would each sit under the other.
 */

/** How notes hang together: each note's parents, and the hubs by note. */
export interface HubGraph {
  /** Each note's parents, by index path: `up:` targets, else the hubs of the tags it is about. */
  parents: ReadonlyMap<string, readonly string[]>;
  /** Each hub note's first described tag that leads to it. */
  hubTags: ReadonlyMap<string, string>;
}

/** How many levels of notes a breadcrumb goes up before it stops, so no chain runs away. */
const MAX_DEPTH = 8;

/** How many paths a note's breadcrumbs give at most. */
const MAX_PATHS = 3;

const graphs = new WeakMap<WorkspaceIndex, HubGraph>();

/** The graph of one index, built once and shared by the breadcrumbs and the Types tab. */
export function getHubGraph(index: WorkspaceIndex): HubGraph {
  let graph = graphs.get(index);
  if (!graph) {
    graph = buildHubGraph(index);
    graphs.set(index, graph);
  }
  return graph;
}

/** Works out every note's parents. */
export function buildHubGraph(index: WorkspaceIndex): HubGraph {
  // A tag's hub is the first note by path that describes it, as its page shows.
  const hubByTag = new Map<string, string>();
  const hubTags = new Map<string, string>();
  for (const tag of index.tags.values()) {
    const hub = tag.hubFilePaths?.[0];
    if (hub) {
      hubByTag.set(tag.key, hub);
    }
  }
  // A parked note is left out of the graph, as a search leaves it out: no
  // hub, no parent, and filed under nothing.
  const parked = (filePath: string): boolean => index.parked?.files.has(filePath) ?? false;
  for (const [filePath, file] of index.files) {
    if (parked(filePath)) {
      continue;
    }
    const described = file.hub?.describes.find((tag) => hubByTag.get(tag.key) === filePath);
    if (described) {
      hubTags.set(filePath, described.key);
    }
  }
  const titles = createNoteTitleMap(index);
  const parents = new Map<string, string[]>();
  for (const [filePath, file] of index.files) {
    if (parked(filePath)) {
      continue;
    }
    const up = readUpTargets(file.content)
      .map((name) => resolveWikiTarget(titles, parseWikiTarget(name).note, filePath))
      .filter((target): target is string => target !== undefined && target !== filePath && !parked(target));
    const found = up.length || hubTags.has(filePath)
      ? up
      : noteTagKeys(file)
          .map((key) => (hubTags.has(hubByTag.get(key) ?? '') ? hubByTag.get(key) : undefined))
          .filter((hub): hub is string => hub !== undefined && hub !== filePath);
    if (found.length) {
      parents.set(filePath, [...new Set(found)]);
    }
  }
  return { parents, hubTags };
}

/**
 * The tags a note is about: those in its front matter, and those on its
 * first heading.
 */
export function noteTagKeys(file: ParsedFile): string[] {
  const heading = file.sections.find((section) => !section.isInline);
  return [...new Set([...file.frontmatterTags.map((tag) => tag.key), ...(heading?.headingTags ?? []).map((tag) => tag.key)])];
}

/**
 * The notes a note's `up:` front matter names, as written: `up: "[[Atlas]]"`,
 * `up: Atlas`, `up: ["[[Atlas]]", "[[Borealis]]"]`, or a YAML list under it,
 * its items indented or not, a blank line or a comment among them skipped.
 */
export function readUpTargets(content: string): string[] {
  const lines = content.split(/\r?\n/, 200);
  const end = findFrontmatterEnd(lines);
  if (end === undefined) {
    return [];
  }
  const at = lines.slice(1, end).findIndex((line) => /^up\s*:/i.test(line));
  if (at < 0) {
    return [];
  }
  const first = lines[at + 1].replace(/^up\s*:/i, '');
  const items = [first];
  for (let line = at + 2; line < end; line += 1) {
    const text = lines[line];
    if (/^\s*(#.*)?$/.test(text)) {
      continue;
    }
    if (!/^\s*-\s/.test(text)) {
      break;
    }
    items.push(text.replace(/^\s*-\s+/, ''));
  }
  return items.flatMap((item) => {
    const links = [...item.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((match) => match[1].trim());
    return links.length ? links : splitFrontmatterValues(item);
  });
}

/**
 * The tag a note is the hub of: the first its `describes:` names whose hub
 * note it is. Undefined for a note that is no tag's hub, including one that
 * describes a tag another note is the hub of.
 */
export function findHubTagKey(index: WorkspaceIndex, filePath: string): string | undefined {
  const describes = index.files.get(filePath)?.hub?.describes ?? [];
  return describes.find((tag) => index.tags.get(tag.key)?.hubFilePaths?.[0] === filePath)?.key;
}

/** A note's name in a breadcrumb or a list of hub notes: its first heading without tags, or its file name. */
export function hubNoteLabel(index: WorkspaceIndex, filePath: string): string {
  const heading = index.files.get(filePath)?.sections.find((section) => !section.isInline);
  return (heading ? stripTags(heading.heading).trim() : '') || noteTitle(filePath);
}

/**
 * A namespace as a breadcrumb and the Types tab name it: its words, made plural unless they
 * already are, People for person.
 */
export function namespaceLabel(namespace: string): string {
  if (namespace === 'person' || namespace === 'people') {
    return 'People';
  }
  const words = formatKeyWords(namespace);
  if (/[^aeiou]y$/i.test(words)) {
    return `${words.slice(0, -1)}ies`;
  }
  if (/s$/i.test(words) && !/(ss|us|is)$/i.test(words)) {
    return words;
  }
  return /(s|x|ch|sh)$/i.test(words) ? `${words}es` : `${words}s`;
}

/** The namespace a hub's tag files it under: `person` for an `@` tag, and none for a tag without one. */
function namespaceOf(tagKey: string): string | undefined {
  if (tagKey.startsWith('@')) {
    return 'person';
  }
  return readTagNamespace(tagKey)?.toLowerCase();
}

/**
 * A note's breadcrumbs: from the namespace of its top hub down to the note
 * itself, by each of its parents, at most three ways, shortest first, with
 * the note each step is. A note with no parent has none, a hub at the top of
 * its namespace too.
 */
export function findBreadcrumbs(
  index: WorkspaceIndex,
  filePath: string,
): Array<{ labels: string[]; parent: string; notes: string[] }> {
  const graph = getHubGraph(index);
  const paths: string[][] = [];
  const walk = (current: string, below: string[]): void => {
    if (paths.length >= MAX_PATHS * 3 || below.length > MAX_DEPTH) {
      return;
    }
    const parents = (graph.parents.get(current) ?? []).filter((parent) => !below.includes(parent) && parent !== filePath);
    if (!parents.length) {
      paths.push([current, ...below]);
      return;
    }
    parents.forEach((parent) => walk(parent, [current, ...below]));
  };
  if (!graph.parents.has(filePath)) {
    return [];
  }
  walk(filePath, []);
  return paths
    .filter((path) => path.length > 1)
    .sort((left, right) => left.length - right.length)
    .slice(0, MAX_PATHS)
    .map((path) => {
      const top = graph.hubTags.get(path[0]);
      const namespace = top ? namespaceOf(top) : undefined;
      return {
        labels: [
          ...(namespace ? [namespaceLabel(namespace)] : []),
          ...path.map((note) => hubNoteLabel(index, note)),
        ],
        parent: path[path.length - 2],
        // The note each step after the namespace is, by path, the note itself last.
        notes: path,
      };
    });
}

/** The tags no hub note describes yet, the most used first, which Create Hub Note for Tag… offers. */
export function listTagsWithoutHub(index: WorkspaceIndex): Array<{ key: string; label: string; count: number }> {
  const described = new Set<string>();
  index.files.forEach((file) => file.hub?.describes.forEach((tag) => described.add(tag.key)));
  return [...index.tags.values()]
    .filter((tag) => !described.has(tag.key))
    .map((tag) => ({ key: tag.key, label: tag.label, count: tag.count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
