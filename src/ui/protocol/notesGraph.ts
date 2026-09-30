/**
 * The notes graph's protocol: the graph the host builds, the trimmed form
 * the page receives, the selection the sidebar lists, and the messages the
 * page sends.
 */

import type {
  NotesGraphConnection,
  NotesGraphEdge,
  NotesGraphNode,
  NotesGraphSnapshot,
} from '../../domain/model/graph';

export type {
  NotesGraphConnection,
  NotesGraphEdge,
  NotesGraphEdgeType,
  NotesGraphFocus,
  NotesGraphLinkCounts,
  NotesGraphNode,
  NotesGraphNodeKind,
  NotesGraphSnapshot,
} from '../../domain/model/graph';

/**
 * An edge as the page receives it: without its id, which is its two ends and
 * which the page puts back, since at 5,000 notes the ids alone were about a
 * fifth of the message.
 */
export type NotesGraphWireEdge = Omit<NotesGraphEdge, 'id'> & { id?: string };

/** The graph as the page receives it: only the kinds of node it shows. */
export interface NotesGraphWireSnapshot extends Omit<NotesGraphSnapshot, 'edges'> {
  edges: NotesGraphWireEdge[];
  /** Notes and tasks left out because the page hides their kind. */
  hiddenNodeCount?: number;
  /** How many edges the graph holds before any were left out. */
  edgeCount?: number;
}

/**
 * The graph's selected node and what it is joined to, as the sidebar lists
 * them.
 */
export interface SidebarGraphContext {
  selectedNode?: NotesGraphNode;
  connections: NotesGraphConnection[];
}

/** Opens a graph node's note at its line. */
export interface NotesGraphOpenSourceMessage {
  type: 'openSource';
  filePath: string;
  line: number;
  /** Alt-click: open beside the graph. */
  beside?: boolean;
  pin?: boolean;
}

/** Opens the page of a tag node. */
export interface NotesGraphOpenTagMessage {
  type: 'openTag';
  tagKey: string;
}

/** Selects a node, so the sidebar lists what it is joined to. */
export interface NotesGraphSelectNodeMessage {
  type: 'selectNode';
  nodeId: string;
}

/** Clears the graph's selection. */
export interface NotesGraphClearSelectionMessage {
  type: 'clearSelection';
}

/** Draw the whole workspace, or the neighborhood of the note in the editor. */
export interface NotesGraphSetScopeMessage {
  type: 'setGraphScope';
  local: boolean;
  depth: number;
  /** Pass through daily and periodic notes rather than drawing them. */
  skipPeriodic?: boolean;
}

/** Which kinds of node the page shows, so the host sends only those. */
export interface NotesGraphSetFilterMessage {
  type: 'setGraphFilter';
  showNotes: boolean;
  showTasks: boolean;
}

/** Messages from the notes graph page. */
export type NotesGraphMessage =
  | NotesGraphOpenSourceMessage
  | NotesGraphOpenTagMessage
  | NotesGraphSelectNodeMessage
  | NotesGraphClearSelectionMessage
  | NotesGraphSetScopeMessage
  | NotesGraphSetFilterMessage;
