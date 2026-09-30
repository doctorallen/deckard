/**
 * The notes graph's protocol: the graph the host builds, the trimmed form
 * the page receives, the selection the sidebar lists, and the messages the
 * page sends.
 */

/** What a node of the notes graph stands for. */
export type NotesGraphNodeKind = 'note' | 'task' | 'tag';

/** Why two nodes of the notes graph are joined. */
export type NotesGraphEdgeType =
  | 'wiki-link'
  | 'heading'
  | 'associated-tag'
  | 'tag-membership';

/** One node of the notes graph: a note, a task, or a tag. */
export interface NotesGraphNode {
  /** 'section:<id>' | 'task:<id>' | 'file:<path>' | 'tag:<key>' */
  id: string;
  kind: NotesGraphNodeKind;
  /** Heading or task text with tags stripped, or the tag label. */
  title: string;
  filePath?: string;
  line?: number;
  /** Canonical tag keys carried by this node; empty for tag nodes. */
  tagKeys: string[];
  /**
   * Every indexed edge the node has, whatever the page draws, so its size
   * and tooltip do not change with how many links are shown.
   */
  degree: number;
  /** Its edges by kind, workspace-wide; kinds with none are left out. */
  links?: NotesGraphLinkCounts;
  /** Parked, or a tag only parked notes carry: hidden unless Show parked is on. */
  parked?: true;
}

/**
 * A node's edges by kind: wiki links, heading-and-sub-heading edges, the
 * tags a note or task carries (or, on a tag, the notes and tasks carrying
 * it), and on a tag the tags written with it. An edge of two kinds counts
 * once in each.
 */
export interface NotesGraphLinkCounts {
  wiki?: number;
  heading?: number;
  tag?: number;
  related?: number;
}

/** One edge of the notes graph, with every reason its two ends are joined. */
export interface NotesGraphEdge {
  /** '<sourceId>::<targetId>' with the two ids sorted. */
  id: string;
  source: string;
  target: string;
  /** Combined evidence weight, used for spring strength. */
  weight: number;
  types: NotesGraphEdgeType[];
}

/** The notes graph as the host builds it, before it is trimmed for the page. */
export interface NotesGraphSnapshot {
  updatedAt: number;
  nodes: NotesGraphNode[];
  edges: NotesGraphEdge[];
  /** All indexed tags for the filter list: [key, label, count]. */
  tags: [string, string, number][];
  totalNoteCount: number;
  totalTaskCount: number;
  /** The note the graph is drawn around, when it is drawn around one. */
  focus?: NotesGraphFocus;
}

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
 * What a local graph is centered on: the note last open in an editor, how far
 * out it reaches, and whether the graph on screen is that neighborhood or
 * the whole workspace.
 */
export interface NotesGraphFocus {
  /** On, and drawn around the note; off, and the whole workspace is drawn. */
  local: boolean;
  /** How many hops out from the note the local graph reaches. */
  depth: number;
  /** Whether daily and periodic notes are passed through rather than drawn. */
  skipPeriodic?: boolean;
  /** The note it is drawn around, when one is open. */
  filePath?: string;
  title?: string;
  /** How many nodes and edges the whole workspace holds, for the readout. */
  workspaceNodeCount: number;
}

/** A node joined to the selected one, with the weight and kinds of the edge. */
export interface NotesGraphConnection {
  node: NotesGraphNode;
  weight: number;
  types: NotesGraphEdgeType[];
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
