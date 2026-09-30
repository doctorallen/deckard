/**
 * The notes graph as the page receives it. The graph itself is built in
 * `src/domain/graph`, and re-exported from here so its importers compile as
 * before; what stays is the trimming only the page reads.
 */
import {
  NotesGraphNode,
  NotesGraphSnapshot,
  NotesGraphWireSnapshot,
} from '../../core/types';

export { graphInputsChanged, graphSignature } from '../../domain/graph/graphChanges';
export { createNotesGraphConnections } from '../../domain/graph/graphConnections';
export {
  createLocalGraphSnapshot,
  findNoteNodeIds,
  MAXIMUM_LOCAL_GRAPH_DEPTH,
} from '../../domain/graph/localGraph';
export { createNotesGraphSnapshot } from '../../domain/graph/notesGraph';

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
  const shown = (kind: NotesGraphNode['kind']) =>
    kind === 'note' ? kinds.notes : kind === 'task' ? kinds.tasks : true;
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
