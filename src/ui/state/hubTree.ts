import {
  createNoteTitleMap,
  noteTitle,
  parseWikiTarget,
  resolveWikiTarget,
} from '../../domain/index/backlinks';
import { findFrontmatterEnd, splitFrontmatterValues } from '../../domain/markdown/frontmatter';
import { stripTags } from '../../domain/markdown/parser';
import { formatKeyWords, readTagNamespace } from '../../domain/markdown/tagKeys';
import { collectTagProgress } from '../../domain/tasks/tagProgress';
import { ParsedFile, WorkspaceIndex } from '../../domain/model';

/**
 * Notes under their hubs, as Notion's sidebar keeps pages under the pages
 * they belong to: each tag namespace with a hub note, each hub under it,
 * and under each hub the notes about its tag.
 *
 * A note is about a tag when its front matter or its first heading carries
 * the tag: what the whole note is about, not a line that mentions it in
 * passing. A note can name its parent outright with `up: "[[Atlas]]"` in
 * its front matter, which places it there alone, whatever its tags.
 */

/** One row of the tree: a namespace, or a note. */
export interface HubTreeNode {
  /** Unique in the tree: the path of notes from its root. */
  id: string;
  kind: 'namespace' | 'note';
  label: string;
  /** Said beside the label: a hub's progress. */
  description?: string;
  /** For a note, its index path. */
  filePath?: string;
  /** For a hub, the tag it describes, whose page it can open. */
  tagKey?: string;
  children: HubTreeNode[];
}

/** How notes hang together: each note's parents, and the hubs by note. */
export interface HubGraph {
  /** Each note's parents, by index path: `up:` targets, else the hubs of the tags it is about. */
  parents: ReadonlyMap<string, readonly string[]>;
  /** Each hub note's first described tag that leads to it. */
  hubTags: ReadonlyMap<string, string>;
}

/** How many levels of notes the tree goes down before it stops, so no chain runs away. */
const MAX_DEPTH = 8;

/** How many paths a note's breadcrumbs give at most. */
const MAX_PATHS = 3;

const graphs = new WeakMap<WorkspaceIndex, HubGraph>();

/** The graph of one index, built once and shared by the tree and the breadcrumbs. */
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
  for (const [filePath, file] of index.files) {
    const described = file.hub?.describes.find((tag) => hubByTag.get(tag.key) === filePath);
    if (described) {
      hubTags.set(filePath, described.key);
    }
  }
  const titles = createNoteTitleMap(index);
  const parents = new Map<string, string[]>();
  for (const [filePath, file] of index.files) {
    const up = readUpTargets(file.content)
      .map((name) => resolveWikiTarget(titles, parseWikiTarget(name).note, filePath))
      .filter((target): target is string => target !== undefined && target !== filePath);
    const found = up.length
      ? up
      : noteTagKeys(file)
          .map((key) => hubByTag.get(key))
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
 * `up: Atlas`, `up: ["[[Atlas]]", "[[Borealis]]"]`, or a YAML list under it.
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
  for (let line = at + 2; line < end && /^\s+-\s/.test(lines[line]); line += 1) {
    items.push(lines[line].replace(/^\s+-\s+/, ''));
  }
  return items.flatMap((item) => {
    const links = [...item.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((match) => match[1].trim());
    return links.length ? links : splitFrontmatterValues(item);
  });
}

/** A note's name in the tree: its first heading without tags, or its file name. */
export function hubNoteLabel(index: WorkspaceIndex, filePath: string): string {
  const heading = index.files.get(filePath)?.sections.find((section) => !section.isInline);
  return (heading ? stripTags(heading.heading).trim() : '') || noteTitle(filePath);
}

/** A namespace as the tree heads it: its words, made plural, People for person. */
export function namespaceLabel(namespace: string): string {
  if (namespace === 'person') {
    return 'People';
  }
  const words = formatKeyWords(namespace);
  if (/[^aeiou]y$/i.test(words)) {
    return `${words.slice(0, -1)}ies`;
  }
  return /(s|x|ch|sh)$/i.test(words) ? `${words}es` : `${words}s`;
}

/** The namespace a hub's tag files it under: `person` for an `@` tag, `other` for a tag with none. */
function namespaceOf(tagKey: string): string {
  if (tagKey.startsWith('@')) {
    return 'person';
  }
  return readTagNamespace(tagKey)?.toLowerCase() ?? 'other';
}

/**
 * The tree: each namespace with a hub at the top, its hubs that have no
 * parent of their own, and under every note the notes whose parent it is.
 * A note that is the parent of others but is no hub and has no parent is
 * listed under Other notes. Each level is alphabetical.
 */
export function buildHubTree(index: WorkspaceIndex, now: number): HubTreeNode[] {
  const graph = getHubGraph(index);
  const children = new Map<string, string[]>();
  for (const [child, parents] of graph.parents) {
    for (const parent of parents) {
      children.set(parent, [...(children.get(parent) ?? []), child]);
    }
  }
  const progress = collectTagProgress(index, now, new Set(graph.hubTags.values()));
  const label = (filePath: string): string => hubNoteLabel(index, filePath);
  const byLabel = (left: string, right: string): number =>
    label(left).localeCompare(label(right), undefined, { sensitivity: 'base' }) || left.localeCompare(right);

  const buildNote = (filePath: string, path: readonly string[]): HubTreeNode => {
    const id = [...path, filePath].join('\u0000');
    const tagKey = graph.hubTags.get(filePath);
    const counted = tagKey ? progress.get(tagKey) : undefined;
    const below =
      path.length >= MAX_DEPTH || path.includes(filePath)
        ? []
        : (children.get(filePath) ?? []).filter((child) => !path.includes(child)).sort(byLabel);
    return {
      id,
      kind: 'note',
      label: label(filePath),
      filePath,
      ...(tagKey ? { tagKey } : {}),
      ...(counted ? { description: `${counted.done} of ${counted.total} done` } : {}),
      children: below.map((child) => buildNote(child, [...path, filePath])),
    };
  };

  const namespaces = new Map<string, string[]>();
  for (const [filePath, tagKey] of graph.hubTags) {
    if (graph.parents.has(filePath)) {
      continue;
    }
    const namespace = namespaceOf(tagKey);
    namespaces.set(namespace, [...(namespaces.get(namespace) ?? []), filePath]);
  }
  const loose = [...children.keys()].filter(
    (filePath) => index.files.has(filePath) && !graph.hubTags.has(filePath) && !graph.parents.has(filePath),
  );
  const groups: Array<[string, string, string[]]> = [
    ...[...namespaces]
      .filter(([namespace]) => namespace !== 'other')
      .map(([namespace, hubs]): [string, string, string[]] => [namespace, namespaceLabel(namespace), hubs])
      .sort((left, right) => left[1].localeCompare(right[1])),
    ...(namespaces.has('other') ? [['other', 'Other tags', namespaces.get('other') ?? []] as [string, string, string[]]] : []),
    ...(loose.length ? [['loose', 'Other notes', loose] as [string, string, string[]]] : []),
  ];
  return groups.map(([namespace, heading, hubs]) => ({
    id: `namespace:${namespace}`,
    kind: 'namespace' as const,
    label: heading,
    children: [...hubs].sort(byLabel).map((hub) => buildNote(hub, [`namespace:${namespace}`])),
  }));
}

/**
 * A note's breadcrumbs: from the namespace of its top hub down to the note
 * itself, by each of its parents, at most three ways, shortest first. A
 * note with no parent has none, a hub at the top of its namespace too.
 */
export function findBreadcrumbs(index: WorkspaceIndex, filePath: string): Array<{ labels: string[]; parent: string }> {
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
          ...(namespace && namespace !== 'other' ? [namespaceLabel(namespace)] : []),
          ...path.map((note) => hubNoteLabel(index, note)),
        ],
        parent: path[path.length - 2],
      };
    });
}
