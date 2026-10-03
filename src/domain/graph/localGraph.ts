/**
 * The neighborhood of one note in the notes graph: what it is actually
 * attached to, within a few hops, rather than the whole workspace.
 */
import { NotesGraphEdge, NotesGraphNode, NotesGraphSnapshot } from '../model';

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

/** Whether a node is walked through without being drawn. */
type Hidden = (id: string) => boolean;

/**
 * The neighborhood of a note: the nodes it holds, everything within `depth`
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
  /**
   * Nodes that carry hops but are not drawn, such as daily notes: a daily
   * note links to everything written that day, so drawn, it ties the whole
   * neighborhood into one knot; left out entirely, it cuts off what it leads
   * to. Passed through, what lies beyond it is drawn joined to what came
   * before it.
   */
  passThrough?: (node: NotesGraphNode) => boolean,
): NotesGraphSnapshot {
  const reach = Math.max(1, Math.min(MAXIMUM_LOCAL_GRAPH_DEPTH, Math.floor(depth)));
  const known = new Set(snapshot.nodes.map((node) => node.id));
  const kept = new Set(focusIds.filter((id) => known.has(id)));
  if (kept.size === 0) {
    return { ...snapshot, nodes: [], edges: [], tags: [], totalNoteCount: 0, totalTaskCount: 0 };
  }

  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const focus = new Set(kept);
  const hidden: Hidden = (id) => {
    const node = byId.get(id);
    return Boolean(passThrough && node && !focus.has(id) && passThrough(node));
  };
  const cameFrom = walkNeighborhood(findNeighbors(snapshot.edges), kept, reach, hidden);

  const nodes = snapshot.nodes.filter((node) => kept.has(node.id) && !hidden(node.id));
  const drawn = new Set(nodes.map((node) => node.id));
  const edges = snapshot.edges.filter(
    (edge) => drawn.has(edge.source) && drawn.has(edge.target),
  );
  joinPassedThrough(snapshot.edges, { edges, drawn }, cameFrom, hidden);
  const tagKeys = new Set(
    nodes
      .filter((node) => node.kind === 'tag')
      .map((node) => node.id.slice('tag:'.length)),
  );
  return {
    ...snapshot,
    nodes,
    edges,
    // The checklist offers the tags this neighborhood actually holds, so
    // filtering it cannot empty the graph by naming a tag that is not here.
    tags: snapshot.tags.filter(([key]) => tagKeys.has(key)),
    totalNoteCount: nodes.filter((node) => node.kind === 'note').length,
    totalTaskCount: nodes.filter((node) => node.kind === 'task').length,
  };
}

/** Each node's neighbors, in the order the edges list them. */
function findNeighbors(edges: readonly NotesGraphEdge[]): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  edges.forEach((edge) => {
    neighbors.set(edge.source, [
      ...(neighbors.get(edge.source) ?? []),
      edge.target,
    ]);
    neighbors.set(edge.target, [
      ...(neighbors.get(edge.target) ?? []),
      edge.source,
    ]);
  });
  return neighbors;
}

/**
 * Walks `reach` hops out from the nodes in `kept`, adding each node reached
 * to it, and returns the drawn node each was first reached from, past
 * hidden ones.
 */
function walkNeighborhood(
  neighbors: ReadonlyMap<string, string[]>,
  kept: Set<string>,
  reach: number,
  hidden: Hidden,
): Map<string, string> {
  const cameFrom = new Map<string, string>();
  let frontier = [...kept];
  for (let hop = 0; hop < reach; hop += 1) {
    const next: string[] = [];
    frontier.forEach((id) => {
      (neighbors.get(id) ?? []).forEach((neighbor) => {
        if (kept.has(neighbor)) {
          return;
        }
        kept.add(neighbor);
        next.push(neighbor);
        cameFrom.set(neighbor, hidden(id) ? cameFrom.get(id) ?? id : id);
      });
    });
    if (next.length === 0) {
      break;
    }
    frontier = next;
  }
  return cameFrom;
}

/** A node reached through a hidden one is joined to where that path began. */
function joinPassedThrough(
  allEdges: readonly NotesGraphEdge[],
  local: { edges: NotesGraphEdge[]; drawn: ReadonlySet<string> },
  cameFrom: ReadonlyMap<string, string>,
  hidden: Hidden,
): void {
  const { edges, drawn } = local;
  const joined = new Set(edges.map((edge) => edge.id));
  cameFrom.forEach((from, id) => {
    const via = allEdges.some(
      (edge) => (edge.source === id || edge.target === id) && hidden(edge.source === id ? edge.target : edge.source),
    );
    if (!via || !drawn.has(id) || !drawn.has(from) || from === id) {
      return;
    }
    const [source, target] = [from, id].sort();
    const edgeId = `${source}::${target}`;
    if (joined.has(edgeId)) {
      return;
    }
    joined.add(edgeId);
    edges.push({ id: edgeId, source, target, weight: 0.5, types: [] });
  });
}
