/**
 * The notes graph's protocol: the graph the host builds, the trimmed form
 * the page receives, the selection the sidebar lists, and the messages the
 * page sends.
 */

import type {
  NotesGraphConnection,
  NotesGraphEdge,
  NotesGraphFocus,
  NotesGraphNode,
  NotesGraphSnapshot,
} from '../../domain/model/graph';
import type { MessageOf, StateMessage } from './messaging';
import type {
  ChooseThemeMessage,
  GoToPageMessage,
  ListGoToMessage,
  OpenGoToMessage,
  OpenHelpMessage,
  SetZenModeMessage,
} from './shared';

export type { NotesGraphEdgeType, NotesGraphNode } from '../../domain/model/graph';

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

/**
 * The node the host has selected, after each snapshot and when Related
 * Notes picks one, which the page selects too if it draws it.
 */
export interface NotesGraphSelectedNodeMessage {
  type: 'selectNode';
  nodeId: string;
}

/**
 * The node Related Notes is hovering, which the page highlights; without
 * an id, the highlight ends.
 */
export interface NotesGraphHighlightNodeMessage {
  type: 'highlightNode';
  nodeId?: string;
}

/**
 * The note the graph would be drawn around, and the scope, when they
 * change without changing what is drawn, as when the editor moves to
 * another note with Around this note off: the page's focus line follows
 * without the whole graph being sent again.
 */
export interface NotesGraphFocusMessage {
  type: 'focus';
  focus: NotesGraphFocus;
}

/**
 * A filter turned on for a reader who came to see it, such as Stats' Wiki
 * links total turning on Only links I wrote.
 */
export interface NotesGraphApplyFiltersMessage {
  type: 'applyFilters';
  onlyWrittenLinks: true;
}

/**
 * What the notes graph page sends its host, by type. The host checks each
 * node, line, and tag against the index as it is now.
 */
export interface NotesGraphPageToHost {
  openSource: NotesGraphOpenSourceMessage;
  openTag: NotesGraphOpenTagMessage;
  selectNode: NotesGraphSelectNodeMessage;
  clearSelection: NotesGraphClearSelectionMessage;
  setGraphScope: NotesGraphSetScopeMessage;
  setGraphFilter: NotesGraphSetFilterMessage;
  setZenMode: SetZenModeMessage;
  chooseTheme: ChooseThemeMessage;
  openHelp: OpenHelpMessage;
  openGoTo: OpenGoToMessage;
  listGoTo: ListGoToMessage;
  goToPage: GoToPageMessage;
}

/** What the host sends the notes graph page, by type. */
export interface NotesGraphHostToPage {
  state: StateMessage<NotesGraphWireSnapshot>;
  selectNode: NotesGraphSelectedNodeMessage;
  highlightNode: NotesGraphHighlightNodeMessage;
  applyFilters: NotesGraphApplyFiltersMessage;
  focus: NotesGraphFocusMessage;
}

/** Messages from the notes graph page. */
export type NotesGraphMessage = MessageOf<NotesGraphPageToHost>;
