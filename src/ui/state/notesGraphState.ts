/**
 * The notes graph as the page receives it. The graph itself is built in
 * `src/domain/graph`; what is here is the trimming only the page reads.
 */
import { NotesGraphWireSnapshot } from '../protocol/notesGraph';
import { NotesGraphNode, NotesGraphSnapshot } from '../../domain/model';

/** Which kinds of node the page shows. Tags are always sent. */
export interface NotesGraphKinds {
  notes: boolean;
  tasks: boolean;
}

/**
 * The graph as it is sent to the page: without the notes or tasks the page
 * hides and every edge touching one, and without edge ids, which the page
 * works out from each edge's ends. The counts the page reports are sent
 * alongside, so they still describe the whole graph.
 */
export function toWire(
  snapshot: NotesGraphSnapshot,
  kinds: NotesGraphKinds,
): NotesGraphWireSnapshot {
  const shown = (kind: NotesGraphNode['kind']): boolean => {
    if (kind === 'note') {
      return kinds.notes;
    }
    if (kind === 'task') {
      return kinds.tasks;
    }
    return true;
  };
  const nodes = snapshot.nodes.filter((node) => shown(node.kind));
  const hiddenNodeCount = snapshot.nodes.length - nodes.length;
  const kept = hiddenNodeCount > 0 ? new Set(nodes.map((node) => node.id)) : undefined;
  const edges = snapshot.edges
    .filter((edge) => !kept || (kept.has(edge.source) && kept.has(edge.target)))
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      types: edge.types,
    }));
  return {
    ...snapshot,
    nodes,
    edges,
    hiddenNodeCount,
    edgeCount: snapshot.edges.length,
  };
}
