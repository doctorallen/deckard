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
 *
 * A hub note goes under another only by `up:`. The tags in a hub's front
 * matter are its properties, such as a team's regulars or a person's team,
 * which describe it rather than file it; read as parents, a team listing a
 * person and the person naming the team would each sit under the other.
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
  // A parked note is left out of the tree, as a search leaves it out: no
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

/** A note's name in the tree: its first heading without tags, or its file name. */
export function hubNoteLabel(index: WorkspaceIndex, filePath: string): string {
  const heading = index.files.get(filePath)?.sections.find((section) => !section.isInline);
  return (heading ? stripTags(heading.heading).trim() : '') || noteTitle(filePath);
}

/**
 * A namespace as the tree heads it: its words, made plural unless they
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
 * The group a note at the top goes in, by the tag it is the hub of: its
 * namespace, Other tags for a tag with none, or Other notes for no hub. The
 * ids of the last two start `group:`, which no namespace can.
 */
function groupOf(tagKey: string | undefined): [id: string, heading: string] {
  if (!tagKey) {
    return ['group:other-notes', 'Other notes'];
  }
  const namespace = namespaceOf(tagKey);
  return namespace ? [`namespace:${namespace}`, namespaceLabel(namespace)] : ['group:other-tags', 'Other tags'];
}

/** One group at the top of the tree: its id, which no namespace can collide with, its heading, and its notes. */
interface HubGroup {
  id: string;
  heading: string;
  notes: string[];
}

/** Each note's children, by path: the notes whose parents name it. */
function listChildren(graph: HubGraph): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const [child, parents] of graph.parents) {
    for (const parent of parents) {
      const list = children.get(parent);
      if (list) {
        list.push(child);
      } else {
        children.set(parent, [child]);
      }
    }
  }
  return children;
}

/** A note's label, read once for each note, since sorting asks for it again and again. */
function labelReader(index: WorkspaceIndex): (filePath: string) => string {
  const labels = new Map<string, string>();
  return (filePath) => {
    let found = labels.get(filePath);
    if (found === undefined) {
      found = hubNoteLabel(index, filePath);
      labels.set(filePath, found);
    }
    return found;
  };
}

/**
 * The tree: each namespace with a hub at the top, its hubs that have no
 * parent of their own, and under every note the notes whose parent it is.
 * A note that is the parent of others but is no hub and has no parent is
 * listed under Other notes. A note the tree would otherwise never reach, in
 * a loop of `up:` or below a chain deeper than it draws, is listed at the
 * top too: a hub in its namespace, any other note under Other notes. Each
 * level is alphabetical.
 */
export function buildHubTree(index: WorkspaceIndex, now: number): HubTreeNode[] {
  const graph = getHubGraph(index);
  const children = listChildren(graph);
  const progress = collectTagProgress(index, now, new Set(graph.hubTags.values()));
  const label = labelReader(index);
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  const byLabel = (left: string, right: string): number => collator.compare(label(left), label(right)) || left.localeCompare(right);
  const reached = new Set<string>();

  const buildNote = (filePath: string, path: readonly string[]): HubTreeNode => {
    reached.add(filePath);
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

  const groups = new Map<string, HubGroup>();
  const groupFor = (filePath: string): HubGroup => {
    const [id, heading] = groupOf(graph.hubTags.get(filePath));
    let group = groups.get(id);
    if (!group) {
      group = { id, heading, notes: [] };
      groups.set(id, group);
    }
    return group;
  };
  const tops: string[] = [
    ...[...graph.hubTags.keys()].filter((filePath) => !graph.parents.has(filePath)),
    ...[...children.keys()].filter((filePath) => index.files.has(filePath) && !graph.hubTags.has(filePath) && !graph.parents.has(filePath)),
  ];
  const built = new Map<string, HubTreeNode>();
  const place = (filePath: string): void => {
    groupFor(filePath).notes.push(filePath);
    built.set(filePath, buildNote(filePath, [groupFor(filePath).id]));
  };
  [...tops].sort(byLabel).forEach(place);
  // What no top reaches is listed at the top as well, hubs first, until every
  // note the tree files is somewhere.
  const filed = [...new Set([...graph.hubTags.keys(), ...graph.parents.keys()])].filter((filePath) => index.files.has(filePath));
  for (let missing = filed.filter((filePath) => !reached.has(filePath)); missing.length; missing = missing.filter((filePath) => !reached.has(filePath))) {
    const next = [...missing].sort((left, right) => Number(!graph.hubTags.has(left)) - Number(!graph.hubTags.has(right)) || byLabel(left, right))[0];
    place(next);
  }
  const order = (group: HubGroup): [number, string] => {
    if (group.id === 'group:other-notes') {
      return [2, ''];
    }
    return group.id === 'group:other-tags' ? [1, ''] : [0, group.heading];
  };
  return [...groups.values()]
    .sort((left, right) => order(left)[0] - order(right)[0] || collator.compare(order(left)[1], order(right)[1]))
    .map((group) => ({
      id: group.id,
      kind: 'namespace' as const,
      label: group.heading,
      children: [...group.notes].sort(byLabel).map((filePath) => built.get(filePath) as HubTreeNode),
    }));
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
