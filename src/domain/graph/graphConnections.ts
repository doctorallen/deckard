/**
 * What one node of the notes graph is joined to, as the sidebar lists it
 * for the node selected on the page.
 */
import { NotesGraphConnection, NotesGraphEdge, NotesGraphNode, NotesGraphSnapshot } from '../model';

/**
 * The nodes joined to `nodeId`, strongest edge first, then notes before
 * tasks before tags, then by title; none for a node the graph lacks.
 */
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
      const connectedId = otherEnd(edge, nodeId);
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

/** The end of an edge that is not `nodeId`, or undefined when neither is. */
function otherEnd(edge: NotesGraphEdge, nodeId: string): string | undefined {
  if (edge.source === nodeId) {
    return edge.target;
  }
  return edge.target === nodeId ? edge.source : undefined;
}

/** Orders node kinds as connections list them: notes, then tasks, then tags. */
function compareNodeKinds(
  left: NotesGraphNode['kind'],
  right: NotesGraphNode['kind'],
): number {
  const order: NotesGraphNode['kind'][] = ['note', 'task', 'tag'];
  return order.indexOf(left) - order.indexOf(right);
}
