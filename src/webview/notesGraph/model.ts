/**
 * The Notes Graph as the page holds it: the settings the reader tunes, and
 * the graph drawn from the host's snapshot with them, which the simulation
 * moves and the canvas draws. One mutable state, as the page script held it
 * in its closure, so the simulation and the drawing read and write it in
 * the order they always did.
 */
import type { CommunityLink } from '../../domain/graph/communities';
import type { NotesGraphEdgeType, NotesGraphNode, NotesGraphWireSnapshot } from '../../ui/protocol/notesGraph';

/**
 * What the reader tunes, kept with `setState`. Typed as written, but read
 * back as saved, of whatever type an older page saved (row 23 of the
 * persisted-formats inventory), so arithmetic on a setting coerces as the
 * script's did.
 */
export interface GraphSettings {
  showNotes: boolean;
  showTasks: boolean;
  showTags: boolean;
  showOrphans: boolean;
  showParked: boolean;
  onlyWrittenLinks: boolean;
  selectedTags: string[];
  group: string;
  search: string;
  nodeSize: number;
  linkThickness: number;
  linkDensity: number;
  tagSpecificity: number;
  bridgeStrength: number;
  showAllLinks: boolean;
  headings: string;
  labelThreshold: number;
  centerStrength: number;
  clusterCohesion: number;
  communitySpacing: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
}

/** A node as the page draws it: one the host sent, or a file its headings are folded into. */
export interface ViewNode extends NotesGraphNode {
  /** On a folded file: how many headings it stands for. */
  headingCount?: number;
  /** On a folded file: its first heading, which is how the host knows it. */
  selectId?: string;
}

/** An edge drawn as a wiki link, the strongest kind. */
export const EDGE_WIKI = 0;
/** An edge drawn as a heading. */
export const EDGE_HEADING = 1;
/** An edge drawn as a tag. */
export const EDGE_TAG = 2;
/** An edge a focused graph joins through a daily note. */
export const EDGE_JOINED = 3;

/** An edge as the page draws it, by its ends' indices. */
export interface ViewEdge {
  a: number;
  b: number;
  weight: number;
  types: readonly NotesGraphEdgeType[];
  /** `EDGE_WIKI`, `EDGE_HEADING`, `EDGE_TAG`, or `EDGE_JOINED`. */
  kind: number;
  /** False for an edge Only links I wrote keeps in the layout but does not draw. */
  drawn: boolean;
}

/** A named group: its key, the name drawn over it, and its notes and tasks. */
export interface GraphGroup {
  key: string;
  name: string;
  size: number;
}

/** A group's center and spread in the last frame, in world units. */
export interface GroupCenter {
  x: number;
  y: number;
  r: number;
}

/** A group name drawn in the last frame, in screen pixels, which a click picks out. */
export interface LabelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  key?: string;
}

/** A set of node indices. */
export type IndexSet = Record<number, true>;

/** What the simulation moves. */
export interface SimulationState {
  nodes: ViewNode[];
  edges: ViewEdge[];
  px: Float32Array;
  py: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Each node's drawn and undrawn edges in the view. */
  degrees: Float32Array;
  /** Each note's or task's primary tag, by node index, or -1. */
  primaryTag: Int32Array;
  /** How many notes and tasks each tag is primary for, by node index. */
  primaryClusterSize: Uint32Array;
  /** Each node's group, or -1. */
  communityId: Int32Array;
  communitySizes: number[];
  communityAnchorX: Float32Array;
  communityAnchorY: Float32Array;
  communityVx: Float32Array;
  communityVy: Float32Array;
  /** Where each tag sits from its group's anchor. */
  tagOffsetX: Float32Array;
  tagOffsetY: Float32Array;
  communityEdges: CommunityLink[];
  communityCount: number;
  /** How hot the simulation is; 0 at rest. */
  alpha: number;
  /** The node the pointer is dragging, which holds still, or -1. */
  dragIndex: number;
}

/** Everything the page knows of the graph it draws. */
export interface GraphState extends SimulationState {
  /** The last graph the host sent. */
  snapshot: NotesGraphWireSnapshot | null;
  nodeIndexById: Record<string, number>;
  /** Each node's neighbors along drawn edges. */
  adjacency: number[][];
  /** By group: its name, or null for a group too small to name. */
  groups: (GraphGroup | null)[];
  namedGroupCount: number;
  groupKeyIndex: Record<string, number>;
  /** The group picked out, by node index, or null for all. */
  groupMatch: Uint8Array | null;
  /** Said in the status line when a kept group is gone. */
  groupNotice: string;
  /** Said in the status line when a new graph let tags picked go, until the next graph or pick. */
  tagNotice: string;
  groupCenters: GroupCenter[];
  labelRects: LabelRect[];
  tagLabelByKey: Record<string, string>;
  /** Whether each file's headings are folded into one node now; null before the first draw. */
  headingsFolded: boolean | null;
  /** Each folded heading's file node. */
  foldedInto: Record<string, string>;
  /** Each folded file's headings. */
  foldMembers: Record<string, string[]>;
  hasJoinedEdges: boolean;
  /** Whether the view has been framed since it was reset. */
  hasFramed: boolean;
  hoverIndex: number;
  hoverNeighbors: IndexSet;
  /** The node Related Notes is hovering. */
  externalHoverNodeId: string | null;
  /** Null when everything matches the search. */
  matchSet: IndexSet | null;
  /** Null when no tag is picked. */
  tagMatchSet: IndexSet | null;
  /** The selection, which survives a rebuild by its id. */
  selectedId: string | null;
  selectedIndex: number;
  selectedNeighbors: IndexSet;
}

/** The graph before the host has sent one. */
export function emptyGraphState(): GraphState {
  return {
    snapshot: null,
    nodes: [],
    edges: [],
    nodeIndexById: {},
    adjacency: [],
    px: new Float32Array(0),
    py: new Float32Array(0),
    vx: new Float32Array(0),
    vy: new Float32Array(0),
    degrees: new Float32Array(0),
    groups: [],
    namedGroupCount: 0,
    groupKeyIndex: {},
    groupMatch: null,
    groupNotice: '',
    tagNotice: '',
    groupCenters: [],
    labelRects: [],
    tagLabelByKey: {},
    headingsFolded: null,
    foldedInto: {},
    foldMembers: {},
    primaryTag: new Int32Array(0),
    primaryClusterSize: new Uint32Array(0),
    communityId: new Int32Array(0),
    communitySizes: [],
    communityAnchorX: new Float32Array(0),
    communityAnchorY: new Float32Array(0),
    communityVx: new Float32Array(0),
    communityVy: new Float32Array(0),
    tagOffsetX: new Float32Array(0),
    tagOffsetY: new Float32Array(0),
    communityEdges: [],
    communityCount: 0,
    alpha: 0,
    hasFramed: false,
    hasJoinedEdges: false,
    hoverIndex: -1,
    dragIndex: -1,
    hoverNeighbors: {},
    externalHoverNodeId: null,
    matchSet: null,
    tagMatchSet: null,
    selectedId: null,
    selectedIndex: -1,
    selectedNeighbors: {},
  };
}

/** A node's degree: everything it is joined to in the index, or its edges in the view without one. */
export function nodeDegree(state: GraphState, index: number): number {
  const degree = state.nodes[index].degree;
  return typeof degree === 'number' && degree >= 0 ? degree : state.degrees[index];
}

/**
 * A node's radius, in world units. Sized by everything the node is joined
 * to in the index, not by the links drawn, so a note keeps its size as
 * Links per note moves. The cap keeps a tag carried by hundreds of entries
 * from covering its group.
 */
export function nodeRadius(state: GraphState, settings: GraphSettings, index: number): number {
  return (2 + Math.sqrt(Math.min(nodeDegree(state, index), 100))) * settings.nodeSize;
}

/** Whether a node is drawn: tags only with Show tags, or while selected, hovered, or beside the selection. */
export function isRendered(state: GraphState, settings: GraphSettings, index: number): boolean {
  return Boolean(state.nodes[index].kind !== 'tag' ||
    settings.showTags ||
    index === state.selectedIndex ||
    index === state.hoverIndex ||
    state.selectedNeighbors[index]);
}

/**
 * Whether a node is drawn faint: away from the node hovered, or outside
 * the search, the tags picked, the group picked, or the selection.
 */
export function isDimmed(state: GraphState, index: number): boolean {
  if (state.hoverIndex >= 0) {
    return index !== state.hoverIndex && !state.hoverNeighbors[index];
  }
  if (state.matchSet && !state.matchSet[index]) {
    return true;
  }
  if (state.tagMatchSet && !state.tagMatchSet[index]) {
    return true;
  }
  if (state.groupMatch && !state.groupMatch[index]) {
    return true;
  }
  if (state.selectedIndex >= 0) {
    return index !== state.selectedIndex && !state.selectedNeighbors[index];
  }
  return false;
}

/** Splits a name into the characters a reader sees, an emoji and its joiners as one. */
const CHARACTERS = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * A name cut to `limit` characters with an ellipsis in the last, or as it
 * is when it fits. It counts and cuts the characters a reader sees, so an
 * emoji is never cut in half and drawn as a broken glyph.
 */
export function shortenName(name: string, limit: number): string {
  if (name.length <= limit) {
    return name;
  }
  const characters = Array.from(CHARACTERS.segment(name), (part) => part.segment);
  return characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : name;
}
