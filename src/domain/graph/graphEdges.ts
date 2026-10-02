/**
 * The edges of the notes graph, one builder for each reason two nodes are
 * joined, all adding to one map so an edge of several kinds is one edge
 * whose weight sums each kind once.
 */
import { stripTags } from '../markdown/parser';
import { NotesGraphEdge, NotesGraphEdgeType, NotesGraphNode, WorkspaceIndex } from '../model';
import { GraphSource } from './graphSources';

/** Association edges connect only tag nodes, limited per source tag. */
const maximumAssociationsPerTag = 5;

/** An edge while it is being built: its ends, its weight so far, and its kinds. */
export interface EdgeAccumulator {
  source: string;
  target: string;
  weight: number;
  types: Set<NotesGraphEdgeType>;
}

/** The edges built so far, by `<source>::<target>` with the ends sorted. */
export type EdgeMap = Map<string, EdgeAccumulator>;

/**
 * An edge from every node to the note, entry, or task each of its Wiki
 * links opens, weighted 2.
 */
export function addWikiLinkEdges(
  sources: GraphSource[],
  edgeMap: EdgeMap,
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
        addEdge(edgeMap, [source.node.id, target.node.id], 'wiki-link', 2);
      }
    });
  });
}

/** An edge from every entry to the heading it sits under, weighted 1. */
export function addHeadingEdges(
  sources: GraphSource[],
  sourceById: Map<string, GraphSource>,
  edgeMap: EdgeMap,
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
      addEdge(edgeMap, [source.node.id, parentNodeId], 'heading', 1);
    }
  });
}

/**
 * An edge between two tags the index learned go together, weighted by the
 * association's normalized weight, for each tag's five strongest only.
 */
export function addAssociationEdges(
  index: WorkspaceIndex,
  tagNodes: Map<string, NotesGraphNode>,
  edgeMap: EdgeMap,
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
          [`tag:${sourceTagKey}`, `tag:${association.associatedTag.key}`],
          'associated-tag',
          association.normalizedWeight,
        );
      });
  });
}

/**
 * An edge from every node to each tag it carries, weighted by how few
 * nodes carry that tag, which is what draws a tag's notes into a cluster.
 */
export function addTagMembershipEdges(
  sources: GraphSource[],
  tagNodes: Map<string, NotesGraphNode>,
  edgeMap: EdgeMap,
): void {
  const memberCountByTag = new Map<string, number>();
  sources.forEach((source) => {
    source.node.tagKeys.forEach((tagKey) => {
      memberCountByTag.set(tagKey, (memberCountByTag.get(tagKey) ?? 0) + 1);
    });
  });
  sources.forEach((source) => {
    source.node.tagKeys.forEach((tagKey) => {
      if (!tagNodes.has(tagKey)) {
        return;
      }
      const memberCount = memberCountByTag.get(tagKey) ?? 1;
      // Specific tags pull harder than ubiquitous tags, producing distinct
      // communities without letting one workspace-wide tag form a sun.
      const weight =
        memberCount === 1
          ? 0.15
          : Math.max(0.2, Math.min(1, 2 / Math.sqrt(memberCount)));
      addEdge(
        edgeMap,
        [source.node.id, `tag:${tagKey}`],
        'tag-membership',
        weight,
      );
    });
  });
}

/**
 * Adds one reason to join two nodes. An edge of a kind it already has keeps
 * its weight, so a note that links to another twice is joined as strongly
 * as one that links once.
 */
function addEdge(
  edgeMap: EdgeMap,
  ends: readonly [string, string],
  type: NotesGraphEdgeType,
  weight: number,
): void {
  const [source, target] = [...ends].sort();
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

/** A finished edge: its weight rounded to three places, its kinds in order. */
export function toGraphEdge(edge: EdgeAccumulator): NotesGraphEdge {
  return {
    id: `${edge.source}::${edge.target}`,
    source: edge.source,
    target: edge.target,
    weight: Number(edge.weight.toFixed(3)),
    types: [...edge.types].sort(compareEdgeTypes),
  };
}

/**
 * The node a `[[link]]` written in `source` opens: a node of the named
 * note, or of `source`'s own note for `[[#Heading]]`, matched by path, path
 * without `.md`, or file name, case aside. A `#Heading` picks the node with
 * that title when there is one; otherwise the note's own node comes first,
 * then the first by id. Undefined when no node has the name.
 */
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

/** The names a path is linked by, lowercased: as written, without `.md`, and its file name alone. */
function pathAliases(filePath: string): string[] {
  const normalized = filePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .toLowerCase();
  const withoutExtension = normalized.replace(/\.md$/i, '');
  const fileName = withoutExtension.split('/').pop() ?? withoutExtension;
  return [...new Set([normalized, withoutExtension, fileName])];
}

/** A heading as a link's `#Heading` matches it: without tags, letter case, or extra spaces. */
function normalizeHeading(value: string): string {
  return stripTags(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Orders an edge's kinds as it lists them: links, headings, associated tags, then membership. */
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
