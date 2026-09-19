import {
  NotesGraphEdge,
  NotesGraphEdgeType,
  NotesGraphConnection,
  NotesGraphNode,
  NotesGraphSnapshot,
  Section,
  WorkspaceIndex,
} from '../../core/types';
import { extractWikiLinks, stripTags } from '../../core/markdown/parser';

/** Association edges connect only tag nodes, limited per source tag. */
const maximumAssociationsPerTag = 5;

interface GraphSource {
  node: NotesGraphNode;
  links: string[];
  sectionId?: string;
  parentSectionId?: string;
}

interface EdgeAccumulator {
  source: string;
  target: string;
  weight: number;
  types: Set<NotesGraphEdgeType>;
}

/**
 * Builds the full workspace note graph without a global node cap.
 *
 * Every section, task, metadata-only file, and tag becomes a node so the
 * webview can filter locally. Edge construction is budgeted so a single tag
 * shared by many notes stays linear instead of producing quadratic pairs.
 */
export function createNotesGraphSnapshot(
  index: WorkspaceIndex,
): NotesGraphSnapshot {
  const sources = createGraphSources(index);
  const sourceById = new Map(
    sources.map((source) => [source.node.id, source]),
  );
  const tagNodes = createTagNodes(index);
  const edgeMap = new Map<string, EdgeAccumulator>();

  addWikiLinkEdges(sources, edgeMap, index);
  addHeadingEdges(sources, sourceById, edgeMap);
  addAssociationEdges(index, tagNodes, edgeMap);
  addTagMembershipEdges(sources, tagNodes, edgeMap);

  const edges = [...edgeMap.values()]
    .map(toGraphEdge)
    .sort((left, right) => left.id.localeCompare(right.id));

  applyDegrees(sources, tagNodes, edges);

  const nodes = [
    ...sources.map((source) => source.node),
    ...tagNodes.values(),
  ].sort((left, right) => left.id.localeCompare(right.id));

  return {
    updatedAt: index.updatedAt,
    nodes,
    edges,
    tags: [...index.tags.values()]
      .map((tag): [string, string, number] => [tag.key, tag.label, tag.count])
      .sort((left, right) => left[1].localeCompare(right[1])),
    totalNoteCount: sources.filter((source) => source.node.kind === 'note')
      .length,
    totalTaskCount: sources.filter((source) => source.node.kind === 'task')
      .length,
  };
}

export function createNotesGraphConnections(
  snapshot: NotesGraphSnapshot,
  nodeId: string,
): NotesGraphConnection[] {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  if (!nodesById.has(nodeId)) {
    return [];
  }

  return snapshot.edges
    .flatMap((edge) => {
      const connectedId =
        edge.source === nodeId
          ? edge.target
          : edge.target === nodeId
            ? edge.source
            : undefined;
      const node = connectedId ? nodesById.get(connectedId) : undefined;
      return node
        ? [{ node, weight: edge.weight, types: [...edge.types] }]
        : [];
    })
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        compareNodeKinds(left.node.kind, right.node.kind) ||
        left.node.title.localeCompare(right.node.title) ||
        left.node.id.localeCompare(right.node.id),
    );
}

function createGraphSources(index: WorkspaceIndex): GraphSource[] {
  const sources: GraphSource[] = [];

  for (const section of index.sections.values()) {
    sources.push({
      node: {
        id: `section:${section.id}`,
        kind: 'note',
        title:
          stripTags(section.heading).trim() || getFileName(section.filePath),
        filePath: section.filePath,
        line: section.startLine,
        tagKeys: getGraphTagKeys(
          section.tags,
          section.parentSectionId,
          index.sections,
        ),
        degree: 0,
      },
      links: section.links,
      sectionId: section.id,
      parentSectionId: section.parentSectionId,
    });
  }

  for (const task of index.tasks.values()) {
    sources.push({
      node: {
        id: `task:${task.id}`,
        kind: 'task',
        title: stripTags(task.title).trim() || 'Untitled task',
        filePath: task.filePath,
        line: task.lineNumber,
        tagKeys: getGraphTagKeys(
          task.tags,
          task.sectionId,
          index.sections,
        ),
        degree: 0,
      },
      links: extractWikiLinks(task.sourceLineText),
      parentSectionId: task.sectionId,
    });
  }

  for (const file of index.files.values()) {
    if (
      file.sections.length > 0 ||
      (file.frontmatterTags.length === 0 && file.links.length === 0)
    ) {
      continue;
    }
    sources.push({
      node: {
        id: `file:${file.filePath}`,
        kind: 'note',
        title: getFileName(file.filePath).replace(/\.md$/i, ''),
        filePath: file.filePath,
        line: 1,
        tagKeys: uniqueSorted(file.frontmatterTags.map((tag) => tag.key)),
        degree: 0,
      },
      links: file.links,
    });
  }

  return sources;
}

function createTagNodes(
  index: WorkspaceIndex,
): Map<string, NotesGraphNode> {
  const nodes = new Map<string, NotesGraphNode>();
  for (const tag of index.tags.values()) {
    nodes.set(tag.key, {
      id: `tag:${tag.key}`,
      kind: 'tag',
      title: tag.label,
      tagKeys: [],
      degree: 0,
    });
  }
  return nodes;
}

function addWikiLinkEdges(
  sources: GraphSource[],
  edgeMap: Map<string, EdgeAccumulator>,
  index: WorkspaceIndex,
): void {
  const nodesByAlias = new Map<string, GraphSource[]>();
  sources.forEach((source) => {
    if (!source.node.filePath) {
      return;
    }
    // A note answers to its path, its file name, and its front-matter aliases.
    const names = [
      ...pathAliases(source.node.filePath),
      ...(index.files.get(source.node.filePath)?.aliases ?? []).map((alias) =>
        alias.trim().toLowerCase(),
      ),
    ];
    for (const alias of new Set(names)) {
      const candidates = nodesByAlias.get(alias) ?? [];
      candidates.push(source);
      nodesByAlias.set(alias, candidates);
    }
  });

  sources.forEach((source) => {
    source.links.forEach((link) => {
      const target = resolveLinkTarget(link, source, nodesByAlias);
      if (target && target.node.id !== source.node.id) {
        addEdge(edgeMap, source.node.id, target.node.id, 'wiki-link', 2);
      }
    });
  });
}

function addHeadingEdges(
  sources: GraphSource[],
  sourceById: Map<string, GraphSource>,
  edgeMap: Map<string, EdgeAccumulator>,
): void {
  const nodeIdBySectionId = new Map<string, string>();
  sources.forEach((source) => {
    if (source.sectionId) {
      nodeIdBySectionId.set(source.sectionId, source.node.id);
    }
  });

  sources.forEach((source) => {
    if (!source.parentSectionId) {
      return;
    }
    const parentNodeId = nodeIdBySectionId.get(source.parentSectionId);
    if (parentNodeId && sourceById.has(parentNodeId)) {
      addEdge(edgeMap, source.node.id, parentNodeId, 'heading', 1);
    }
  });
}

function addAssociationEdges(
  index: WorkspaceIndex,
  tagNodes: Map<string, NotesGraphNode>,
  edgeMap: Map<string, EdgeAccumulator>,
): void {
  index.tagAssociations?.forEach((associations, sourceTagKey) => {
    if (!tagNodes.has(sourceTagKey)) {
      return;
    }
    [...associations]
      .filter((association) => association.normalizedWeight > 0)
      .sort((left, right) => right.normalizedWeight - left.normalizedWeight)
      .slice(0, maximumAssociationsPerTag)
      .forEach((association) => {
        if (!tagNodes.has(association.associatedTag.key)) {
          return;
        }
        addEdge(
          edgeMap,
          `tag:${sourceTagKey}`,
          `tag:${association.associatedTag.key}`,
          'associated-tag',
          association.normalizedWeight,
        );
      });
  });
}

function addTagMembershipEdges(
  sources: GraphSource[],
  tagNodes: Map<string, NotesGraphNode>,
  edgeMap: Map<string, EdgeAccumulator>,
): void {
  const memberCountByTag = new Map<string, number>();
  sources.forEach((source) => {
    source.node.tagKeys.forEach((tagKey) => {
      memberCountByTag.set(tagKey, (memberCountByTag.get(tagKey) ?? 0) + 1);
    });
  });
  sources.forEach((source) => {
    source.node.tagKeys.forEach((tagKey) => {
      if (tagNodes.has(tagKey)) {
        const memberCount = memberCountByTag.get(tagKey) ?? 1;
        // Specific tags pull harder than ubiquitous tags, producing distinct
        // communities without letting one workspace-wide tag form a sun.
        const weight =
          memberCount === 1
            ? 0.15
            : Math.max(0.2, Math.min(1, 2 / Math.sqrt(memberCount)));
        addEdge(
          edgeMap,
          source.node.id,
          `tag:${tagKey}`,
          'tag-membership',
          weight,
        );
      }
    });
  });
}

/**
 * Counts every relationship. Tag membership is now the clustering primitive,
 * so it contributes to both note and tag node prominence.
 */
function applyDegrees(
  sources: GraphSource[],
  tagNodes: Map<string, NotesGraphNode>,
  edges: NotesGraphEdge[],
): void {
  const degreeById = new Map<string, number>();
  const increment = (id: string): void => {
    degreeById.set(id, (degreeById.get(id) ?? 0) + 1);
  };

  edges.forEach((edge) => {
    [edge.source, edge.target].forEach((id) => {
      increment(id);
    });
  });

  sources.forEach((source) => {
    source.node.degree = degreeById.get(source.node.id) ?? 0;
  });
  tagNodes.forEach((node) => {
    node.degree = degreeById.get(node.id) ?? 0;
  });
}

function addEdge(
  edgeMap: Map<string, EdgeAccumulator>,
  leftId: string,
  rightId: string,
  type: NotesGraphEdgeType,
  weight: number,
): void {
  const [source, target] = [leftId, rightId].sort();
  if (source === target) {
    return;
  }
  const id = `${source}::${target}`;
  const edge = edgeMap.get(id) ?? {
    source,
    target,
    weight: 0,
    types: new Set<NotesGraphEdgeType>(),
  };
  if (!edge.types.has(type)) {
    edge.weight += weight;
  }
  edge.types.add(type);
  edgeMap.set(id, edge);
}

function toGraphEdge(edge: EdgeAccumulator): NotesGraphEdge {
  return {
    id: `${edge.source}::${edge.target}`,
    source: edge.source,
    target: edge.target,
    weight: Number(edge.weight.toFixed(3)),
    types: [...edge.types].sort(compareEdgeTypes),
  };
}

function resolveLinkTarget(
  link: string,
  source: GraphSource,
  nodesByAlias: Map<string, GraphSource[]>,
): GraphSource | undefined {
  const trimmed = link.trim();
  const hashIndex = trimmed.indexOf('#');
  const pathPart = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const headingPart = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : '';
  const targetPath = pathPart || source.node.filePath || '';
  if (!targetPath) {
    return undefined;
  }

  const candidates = pathAliases(targetPath).flatMap(
    (alias) => nodesByAlias.get(alias) ?? [],
  );
  const uniqueCandidates = [
    ...new Map(
      candidates.map((candidate) => [candidate.node.id, candidate]),
    ).values(),
  ].sort((left, right) => left.node.id.localeCompare(right.node.id));
  if (uniqueCandidates.length === 0) {
    return undefined;
  }
  if (headingPart) {
    const normalizedHeading = normalizeHeading(headingPart);
    const headingMatch = uniqueCandidates.find(
      (candidate) =>
        normalizeHeading(candidate.node.title) === normalizedHeading,
    );
    if (headingMatch) {
      return headingMatch;
    }
  }
  return (
    uniqueCandidates.find((candidate) =>
      candidate.node.id.startsWith('file:'),
    ) ?? uniqueCandidates[0]
  );
}

function pathAliases(filePath: string): string[] {
  const normalized = filePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .toLowerCase();
  const withoutExtension = normalized.replace(/\.md$/i, '');
  const fileName = withoutExtension.split('/').pop() ?? withoutExtension;
  return [...new Set([normalized, withoutExtension, fileName])];
}

function normalizeHeading(value: string): string {
  return stripTags(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function getGraphTagKeys(
  directTags: readonly string[],
  parentSectionId: string | undefined,
  sections: ReadonlyMap<string, Section>,
): string[] {
  const keys = new Set(directTags);
  const visited = new Set<string>();
  let currentId = parentSectionId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = sections.get(currentId);
    if (!parent) {
      break;
    }
    parent.headingTags?.forEach((tag) => keys.add(tag.key));
    currentId = parent.parentSectionId;
  }
  return [...keys].sort();
}

function compareEdgeTypes(
  left: NotesGraphEdgeType,
  right: NotesGraphEdgeType,
): number {
  const order: NotesGraphEdgeType[] = [
    'wiki-link',
    'heading',
    'associated-tag',
    'tag-membership',
  ];
  return order.indexOf(left) - order.indexOf(right);
}

function compareNodeKinds(
  left: NotesGraphNode['kind'],
  right: NotesGraphNode['kind'],
): number {
  const order: NotesGraphNode['kind'][] = ['note', 'task', 'tag'];
  return order.indexOf(left) - order.indexOf(right);
}

/** The furthest a local graph reaches from the note it is drawn around. */
export const MAXIMUM_LOCAL_GRAPH_DEPTH = 3;

/** Every node one note puts in the graph: its sections, its tasks, itself. */
export function findNoteNodeIds(
  snapshot: NotesGraphSnapshot,
  filePath: string,
): string[] {
  return snapshot.nodes
    .filter((node) => node.filePath === filePath)
    .map((node) => node.id);
}

/**
 * The neighbourhood of a note: the nodes it holds, everything within `depth`
 * hops of them, and the edges between what is kept.
 *
 * The whole-workspace graph answers what the workspace looks like. This
 * answers a different question — what this note is actually attached to —
 * which a ranked list of related notes cannot, since it says what is most
 * related rather than what is connected to what.
 */
export function createLocalGraphSnapshot(
  snapshot: NotesGraphSnapshot,
  focusIds: readonly string[],
  depth: number,
): NotesGraphSnapshot {
  const reach = Math.max(1, Math.min(MAXIMUM_LOCAL_GRAPH_DEPTH, Math.floor(depth)));
  const known = new Set(snapshot.nodes.map((node) => node.id));
  const kept = new Set(focusIds.filter((id) => known.has(id)));
  if (kept.size === 0) {
    return { ...snapshot, nodes: [], edges: [], tags: [], totalNoteCount: 0, totalTaskCount: 0 };
  }

  const neighbours = new Map<string, string[]>();
  snapshot.edges.forEach((edge) => {
    neighbours.set(edge.source, [
      ...(neighbours.get(edge.source) ?? []),
      edge.target,
    ]);
    neighbours.set(edge.target, [
      ...(neighbours.get(edge.target) ?? []),
      edge.source,
    ]);
  });

  let frontier = [...kept];
  for (let hop = 0; hop < reach; hop += 1) {
    const next: string[] = [];
    frontier.forEach((id) => {
      (neighbours.get(id) ?? []).forEach((neighbour) => {
        if (!kept.has(neighbour)) {
          kept.add(neighbour);
          next.push(neighbour);
        }
      });
    });
    if (next.length === 0) {
      break;
    }
    frontier = next;
  }

  const nodes = snapshot.nodes.filter((node) => kept.has(node.id));
  const edges = snapshot.edges.filter(
    (edge) => kept.has(edge.source) && kept.has(edge.target),
  );
  const tagKeys = new Set(
    nodes
      .filter((node) => node.kind === 'tag')
      .map((node) => node.id.slice('tag:'.length)),
  );
  return {
    ...snapshot,
    nodes,
    edges,
    // The checklist offers the tags this neighbourhood actually holds, so
    // filtering it cannot empty the graph by naming a tag that is not here.
    tags: snapshot.tags.filter(([key]) => tagKeys.has(key)),
    totalNoteCount: nodes.filter((node) => node.kind === 'note').length,
    totalTaskCount: nodes.filter((node) => node.kind === 'task').length,
  };
}
