/**
 * The notes graph of the whole workspace: every section, task,
 * metadata-only note, and tag as a node, joined by Wiki links, headings,
 * learned tag associations, and tag membership.
 */
import {
  NotesGraphEdge,
  NotesGraphEdgeType,
  NotesGraphLinkCounts,
  NotesGraphNode,
  NotesGraphSnapshot,
  WorkspaceIndex,
} from '../model';
import {
  addAssociationEdges,
  addHeadingEdges,
  addTagMembershipEdges,
  addWikiLinkEdges,
  EdgeMap,
  toGraphEdge,
} from './graphEdges';
import { createGraphSources, createTagNodes, GraphSource, markParked } from './graphSources';

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
  const edgeMap: EdgeMap = new Map();

  addWikiLinkEdges(sources, edgeMap, index);
  addHeadingEdges(sources, sourceById, edgeMap);
  addAssociationEdges(index, tagNodes, edgeMap);
  addTagMembershipEdges(sources, tagNodes, edgeMap);

  const edges = [...edgeMap.values()]
    .map(toGraphEdge)
    .sort((left, right) => left.id.localeCompare(right.id));

  applyDegrees(sources, tagNodes, edges);
  markParked(index, sources, tagNodes);

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

/**
 * Counts every relationship, and each kind of it. Tag membership is the
 * clustering primitive, so it contributes to both note and tag node
 * prominence. The counts are the workspace's, so a node's size and tooltip
 * say the same whatever the page draws, and a focused graph, which reuses
 * these node objects, keeps them.
 */
function applyDegrees(
  sources: GraphSource[],
  tagNodes: Map<string, NotesGraphNode>,
  edges: NotesGraphEdge[],
): void {
  const degreeById = new Map<string, number>();
  const linksById = new Map<string, NotesGraphLinkCounts>();
  const count = (id: string, kind: keyof NotesGraphLinkCounts): void => {
    const links = linksById.get(id) ?? {};
    links[kind] = (links[kind] ?? 0) + 1;
    linksById.set(id, links);
  };

  edges.forEach((edge) => {
    [edge.source, edge.target].forEach((id) => {
      degreeById.set(id, (degreeById.get(id) ?? 0) + 1);
      edge.types.forEach((type) => {
        count(id, LINK_KIND[type]);
      });
    });
  });

  const apply = (node: NotesGraphNode): void => {
    node.degree = degreeById.get(node.id) ?? 0;
    const links = linksById.get(node.id);
    if (links) {
      node.links = links;
    } else {
      delete node.links;
    }
  };
  sources.forEach((source) => apply(source.node));
  tagNodes.forEach(apply);
}

/** Which count each kind of edge adds to. */
const LINK_KIND: Record<NotesGraphEdgeType, keyof NotesGraphLinkCounts> = {
  'wiki-link': 'wiki',
  heading: 'heading',
  'tag-membership': 'tag',
  'associated-tag': 'related',
};
