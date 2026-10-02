/**
 * The graph the page draws, built from the host's snapshot and the
 * reader's settings: the nodes and edges shown, headings folded into their
 * files when zoomed out, the links each note keeps, its groups and their
 * names, and where each node starts.
 *
 * A typed port of the page script's `rebuildView` and its helpers, line
 * for line, writing the graph state as the script wrote its closure.
 */
import {
  buildCommunities,
  choosePrimaryTags,
  type CommunityEdge,
  selectSalientEdges,
  type TagMembership,
} from '../../domain/graph/communities';
import type { NotesGraphEdgeType } from '../../ui/protocol/notesGraph';
import type { Camera } from './canvas';
import {
  EDGE_HEADING,
  EDGE_JOINED,
  EDGE_TAG,
  EDGE_WIKI,
  type GraphSettings,
  type GraphState,
  nodeDegree,
  type ViewNode,
} from './model';

/** An edge between node ids, as the host sent it with its id put back, or as a fold joined it. */
export interface SourceEdge extends CommunityEdge {
  readonly types: NotesGraphEdgeType[];
}

/** Where a node was, and how it was moving, before a rebuild. */
interface Kept {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The golden angle, in radians, by which spirals of nodes are laid out. */
const GOLDEN_ANGLE = 2.39996322972865332;
/** Zoom past Label fade zoom by this much before headings fold or unfold. */
const FOLD_HYSTERESIS = 0.15;
/** A community is named once it holds this many notes and tasks. */
const GROUP_MINIMUM_SIZE = 4;

/** What a rebuild leaves for the page to finish with. */
export interface Rebuilt {
  /** Whether the group the reader picked is no longer there, and was let go. */
  readonly groupGone: boolean;
  /** Whether any note or task kept the place it had. */
  readonly reusedAny: boolean;
  /** The folds before the rebuild, so a selected file can move to its first heading. */
  readonly previousFoldMembers: Record<string, string[]>;
}

/**
 * An edge is drawn as its strongest kind: a wiki link, then a heading, then
 * a tag, then an edge a focused graph joins through a daily note.
 */
export function edgeKind(types: readonly string[]): number {
  if (types.indexOf('wiki-link') !== -1) {
    return EDGE_WIKI;
  }
  if (types.indexOf('heading') !== -1) {
    return EDGE_HEADING;
  }
  if (types.length === 0) {
    return EDGE_JOINED;
  }
  return EDGE_TAG;
}

/**
 * Rebuilds the graph drawn from the last snapshot: what is shown, its
 * edges, groups, and names, and where each node starts. A node shown before
 * keeps its place and momentum, unless `repositionCommunities` lays the
 * whole graph out afresh.
 */
export function buildView(state: GraphState, settings: GraphSettings, camera: Camera, repositionCommunities?: boolean): Rebuilt {
  const previous: Record<string, Kept> = {};
  if (!repositionCommunities) {
    for (let p = 0; p < state.nodes.length; p += 1) {
      previous[state.nodes[p].id] = { x: state.px[p], y: state.py[p], vx: state.vx[p], vy: state.vy[p] };
    }
  }
  const shown = chooseShown(state, settings, camera, { previous, repositionCommunities: Boolean(repositionCommunities) });
  const groupGone = clusterView(state, settings, shown.allCandidateEdges);
  const reusedAny = placeNodes(state, settings, previous, Boolean(repositionCommunities));
  return { groupGone, reusedAny, previousFoldMembers: shown.previousFoldMembers };
}

/** What `chooseShown` keeps from before a rebuild. */
interface Before {
  readonly previous: Record<string, Kept>;
  readonly repositionCommunities: boolean;
}

/**
 * Chooses the nodes and edges shown: by kind and parked, headings folded,
 * each note's strongest links or every link, Only links I wrote, tags only
 * where a link is drawn, and orphans; then sizes the graph state for them.
 */
function chooseShown(
  state: GraphState,
  settings: GraphSettings,
  camera: Camera,
  before: Before,
): { allCandidateEdges: SourceEdge[]; previousFoldMembers: Record<string, string[]> } {
  const snapshot = state.snapshot as NonNullable<GraphState['snapshot']>;
  const focusPath = snapshot.focus && snapshot.focus.local ? snapshot.focus.filePath : undefined;
  let candidate: ViewNode[] = snapshot.nodes.filter((node) => {
    if (node.kind === 'note' && !settings.showNotes) {
      return false;
    }
    if (node.kind === 'task' && !settings.showTasks) {
      return false;
    }
    // The note the graph is drawn around is drawn, parked or not.
    return !(node.parked && !settings.showParked && !(focusPath && node.filePath === focusPath));
  });
  // Zoomed out, a file's headings are one node: the workspace draws as its
  // files, and zooming in opens each into its headings.
  const previousFoldMembers = state.foldMembers;
  const previousFoldedInto = state.foldedInto;
  state.headingsFolded = shouldFoldHeadings(state, settings, camera);
  let graphEdges = snapshot.edges as SourceEdge[];
  state.foldedInto = {};
  state.foldMembers = {};
  if (state.headingsFolded) {
    const folded = foldHeadings(state, candidate, snapshot.edges as SourceEdge[]);
    candidate = folded.nodes;
    graphEdges = folded.edges;
  }
  // Where a node was before a fold or an unfold: a file starts at the
  // middle of its headings, and a heading around its file.
  if (!before.repositionCommunities) {
    carryFoldPositions(state, candidate, before.previous, { previousFoldMembers, previousFoldedInto });
  }
  const candidateIndex = indexById(candidate);
  const allCandidateEdges = graphEdges.filter((edge) =>
    candidateIndex[edge.source] !== undefined && candidateIndex[edge.target] !== undefined);
  const candidateEdges = settings.showAllLinks
    ? allCandidateEdges
    : selectSalientEdges(candidate, allCandidateEdges, {
      density: settings.linkDensity,
      specificity: settings.tagSpecificity,
      bridgeStrength: settings.bridgeStrength,
    });
  finishShown(state, settings, { candidate, candidateEdges, allCandidateEdges });
  return { allCandidateEdges, previousFoldMembers };
}

/** The nodes and edges a rebuild is choosing among. */
interface Candidates {
  readonly candidate: ViewNode[];
  readonly candidateEdges: SourceEdge[];
  readonly allCandidateEdges: SourceEdge[];
}

/**
 * Only links I wrote, tags without a drawn link, and orphans; then the
 * nodes and edges shown, and the graph state sized for them.
 */
function finishShown(state: GraphState, settings: GraphSettings, candidates: Candidates): void {
  let { candidate, candidateEdges } = candidates;
  const { allCandidateEdges } = candidates;
  // Only links I wrote draws every wiki link, past the budget that keeps a
  // hub's twentieth link off screen, and nothing else. The other edges
  // stay in the view undrawn, so each note is placed where it was.
  const onlyWritten = Boolean(settings.onlyWrittenLinks);
  const writtenConnected: Record<string, true> = {};
  if (onlyWritten) {
    const included: Record<string, true> = {};
    candidateEdges.forEach((edge) => {
      included[edge.id] = true;
    });
    allCandidateEdges.forEach((edge) => {
      if (edge.types.indexOf('wiki-link') === -1) {
        return;
      }
      writtenConnected[edge.source] = true;
      writtenConnected[edge.target] = true;
      if (!included[edge.id]) {
        candidateEdges.push(edge);
      }
    });
  }

  const connected: Record<string, true> = {};
  candidateEdges.forEach((edge) => {
    connected[edge.source] = true;
    connected[edge.target] = true;
  });
  candidate = candidate.filter((node) => node.kind !== 'tag' || connected[node.id]);
  let candidateIndex = indexById(candidate);
  candidateEdges = candidateEdges.filter((edge) =>
    candidateIndex[edge.source] !== undefined && candidateIndex[edge.target] !== undefined);

  if (!settings.showOrphans) {
    candidate = candidate.filter((node) => (onlyWritten && node.kind !== 'tag'
      ? writtenConnected[node.id]
      : connected[node.id]));
    candidateIndex = indexById(candidate);
    candidateEdges = candidateEdges.filter((edge) =>
      candidateIndex[edge.source] !== undefined && candidateIndex[edge.target] !== undefined);
  }

  state.nodes = candidate;
  state.nodeIndexById = candidateIndex;
  state.edges = candidateEdges.map((edge) => {
    const kind = edgeKind(edge.types);
    return {
      a: candidateIndex[edge.source],
      b: candidateIndex[edge.target],
      weight: edge.weight,
      types: edge.types,
      kind,
      drawn: !onlyWritten || kind === EDGE_WIKI,
    };
  });
  state.hasJoinedEdges = (state.snapshot as NonNullable<GraphState['snapshot']>).edges.some((edge) => edge.types.length === 0);
  sizeState(state);
}

/** Each node's index, by id; a later node of the same id wins. */
function indexById(nodes: readonly ViewNode[]): Record<string, number> {
  const index: Record<string, number> = {};
  nodes.forEach((node, at) => {
    index[node.id] = at;
  });
  return index;
}

/** Fresh arrays for the nodes shown, with each node's degree and neighbors along drawn edges. */
function sizeState(state: GraphState): void {
  const count = state.nodes.length;
  state.px = new Float32Array(count);
  state.py = new Float32Array(count);
  state.vx = new Float32Array(count);
  state.vy = new Float32Array(count);
  state.degrees = new Float32Array(count);
  state.adjacency = [];
  for (let a = 0; a < count; a += 1) {
    state.adjacency.push([]);
  }
  state.edges.forEach((edge) => {
    state.degrees[edge.a] += 1;
    state.degrees[edge.b] += 1;
    // A neighbor is what a drawn line leads to, so an undrawn edge is
    // not highlighted with the node it touches.
    if (!edge.drawn) {
      return;
    }
    state.adjacency[edge.a].push(edge.b);
    state.adjacency[edge.b].push(edge.a);
  });
}

/**
 * Groups the nodes shown, by every edge between them, drawn or not, and
 * names the groups. Lets go of a picked group that is no longer there, and
 * says whether it did.
 */
function clusterView(state: GraphState, settings: GraphSettings, allCandidateEdges: readonly SourceEdge[]): boolean {
  const { nodes, nodeIndexById: candidateIndex } = state;
  const count = nodes.length;
  const memberships: TagMembership[][] = [];
  const membershipCount = new Uint32Array(count);
  const clusteringEdges = allCandidateEdges.filter((edge) =>
    candidateIndex[edge.source] !== undefined && candidateIndex[edge.target] !== undefined);
  for (let pTag = 0; pTag < count; pTag += 1) {
    memberships.push([]);
  }
  clusteringEdges.forEach((edge) => {
    const clusterA = candidateIndex[edge.source];
    const clusterB = candidateIndex[edge.target];
    if (edge.types.indexOf('tag-membership') === -1) {
      return;
    }
    const noteIndex = nodes[clusterA].kind === 'tag' ? clusterB : clusterA;
    const tagIndex = nodes[clusterA].kind === 'tag' ? clusterA : clusterB;
    memberships[noteIndex].push({ tagIndex, weight: edge.weight });
    membershipCount[tagIndex] += 1;
  });
  const primary = choosePrimaryTags(nodes, memberships, membershipCount);
  state.primaryTag = primary.primaryTag;
  state.primaryClusterSize = primary.primaryClusterSize;
  const communityData = buildCommunities({
    nodes,
    edges: clusteringEdges,
    memberships,
    membershipCount,
    primaryTags: state.primaryTag,
    tagSpecificity: settings.tagSpecificity,
  });
  state.communityId = communityData.ids;
  state.communitySizes = communityData.sizes;
  state.communityEdges = communityData.edges;
  state.communityCount = state.communitySizes.length;
  nameGroups(state);
  if (settings.group && state.groupKeyIndex[settings.group] === undefined) {
    settings.group = '';
    state.groupNotice = 'Group no longer there — showing all';
    return true;
  }
  state.groupNotice = '';
  return false;
}

/**
 * Where each node starts: a group's anchor where its members were, or on a
 * spiral by group; a tag at its anchor; a node shown before where it was;
 * any other note or task around its primary tag, or on a spiral of its own.
 * Says whether any node kept its place.
 */
function placeNodes(state: GraphState, settings: GraphSettings, previous: Record<string, Kept>, repositionCommunities: boolean): boolean {
  const count = state.nodes.length;
  const { communityCount } = state;
  state.communityAnchorX = new Float32Array(communityCount);
  state.communityAnchorY = new Float32Array(communityCount);
  state.communityVx = new Float32Array(communityCount);
  state.communityVy = new Float32Array(communityCount);
  state.tagOffsetX = new Float32Array(count);
  state.tagOffsetY = new Float32Array(count);
  placeAnchors(state, settings, previous, repositionCommunities);
  const retained: Record<number, true> = {};
  const reusedAny = placeMembers(state, previous, retained);
  placeLoose(state, retained);
  return reusedAny;
}

/** Each group's anchor: the middle of where its members were, or a spiral spaced by Community spacing. */
function placeAnchors(state: GraphState, settings: GraphSettings, previous: Record<string, Kept>, repositionCommunities: boolean): void {
  const { communityCount, communityId, nodes } = state;
  const previousCommunityCenters: { x: number; y: number }[] = [];
  const previousCommunityCounts: number[] = [];
  for (let previousCommunity = 0; previousCommunity < communityCount; previousCommunity += 1) {
    previousCommunityCenters.push({ x: 0, y: 0 });
    previousCommunityCounts.push(0);
  }
  if (!repositionCommunities) {
    for (let previousNode = 0; previousNode < nodes.length; previousNode += 1) {
      const previousPosition = previous[nodes[previousNode].id];
      const previousCommunityId = communityId[previousNode];
      if (!previousPosition || previousCommunityId < 0) {
        continue;
      }
      previousCommunityCenters[previousCommunityId].x += previousPosition.x;
      previousCommunityCenters[previousCommunityId].y += previousPosition.y;
      previousCommunityCounts[previousCommunityId] += 1;
    }
  }
  for (let community = 0; community < communityCount; community += 1) {
    if (previousCommunityCounts[community] > 0) {
      state.communityAnchorX[community] =
        previousCommunityCenters[community].x / previousCommunityCounts[community];
      state.communityAnchorY[community] =
        previousCommunityCenters[community].y / previousCommunityCounts[community];
      continue;
    }
    const communityRadius = 150 * settings.communitySpacing *
      Math.sqrt(community + 1);
    const communityAngle = community * GOLDEN_ANGLE;
    state.communityAnchorX[community] = communityRadius * Math.cos(communityAngle);
    state.communityAnchorY[community] = communityRadius * Math.sin(communityAngle);
  }
}

/**
 * Tags at their group's anchor on a spiral of their own; nodes shown before
 * where they were, with their momentum; other members of a group on a
 * spiral around its anchor; the rest on a spiral around the middle.
 */
function placeMembers(state: GraphState, previous: Record<string, Kept>, retained: Record<number, true>): boolean {
  const { communityCount, communityId, nodes, px, py, vx, vy } = state;
  let reusedAny = false;
  const communityMemberOrdinal: number[] = [];
  const communityTagOrdinal: number[] = [];
  for (let communityOrdinal = 0; communityOrdinal < communityCount; communityOrdinal += 1) {
    communityMemberOrdinal.push(0);
    communityTagOrdinal.push(0);
  }
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].kind === 'tag') {
      placeTag(state, i, communityTagOrdinal);
      continue;
    }
    const kept = previous[nodes[i].id];
    if (kept) {
      px[i] = kept.x;
      py[i] = kept.y;
      vx[i] = kept.vx;
      vy[i] = kept.vy;
      retained[i] = true;
      reusedAny = true;
      continue;
    }
    const nodeCommunity = communityId[i];
    if (nodeCommunity >= 0) {
      const localOrdinal = communityMemberOrdinal[nodeCommunity]++;
      const localAngle = localOrdinal * GOLDEN_ANGLE;
      const localRadius = 14 + 4 * Math.sqrt(localOrdinal + 1);
      px[i] = state.communityAnchorX[nodeCommunity] +
        localRadius * Math.cos(localAngle);
      py[i] = state.communityAnchorY[nodeCommunity] +
        localRadius * Math.sin(localAngle);
    } else {
      const orphanRadius = 30 * Math.sqrt(i + 1);
      const orphanAngle = i * GOLDEN_ANGLE;
      px[i] = orphanRadius * Math.cos(orphanAngle);
      py[i] = orphanRadius * Math.sin(orphanAngle);
    }
    vx[i] = 0;
    vy[i] = 0;
  }
  return reusedAny;
}

/** A tag at its group's anchor, at its place on the group's spiral of tags, at rest; a tag in no group at the middle. */
function placeTag(state: GraphState, i: number, communityTagOrdinal: number[]): void {
  const tagCommunity = state.communityId[i];
  if (tagCommunity >= 0) {
    const tagOrdinal = communityTagOrdinal[tagCommunity]++;
    const tagRadius = 18 + 5 * Math.sqrt(tagOrdinal + 1);
    const tagAngle = tagOrdinal * GOLDEN_ANGLE;
    state.tagOffsetX[i] = tagRadius * Math.cos(tagAngle);
    state.tagOffsetY[i] = tagRadius * Math.sin(tagAngle);
    state.px[i] = state.communityAnchorX[tagCommunity] + state.tagOffsetX[i];
    state.py[i] = state.communityAnchorY[tagCommunity] + state.tagOffsetY[i];
  } else {
    state.px[i] = 0;
    state.py[i] = 0;
  }
  state.vx[i] = 0;
  state.vy[i] = 0;
}

/**
 * Every note and task not kept from before is placed again, around its
 * primary tag, or on a spiral of its own, at rest.
 */
function placeLoose(state: GraphState, retained: Record<number, true>): void {
  const { nodes, primaryTag, px, py, vx, vy } = state;
  for (let sourceIndex = 0; sourceIndex < nodes.length; sourceIndex += 1) {
    if (retained[sourceIndex] || nodes[sourceIndex].kind === 'tag') {
      continue;
    }
    const anchorIndex = primaryTag[sourceIndex];
    const localAngle = sourceIndex * GOLDEN_ANGLE;
    const localRadius = 12 + 5 * Math.sqrt((sourceIndex % 23) + 1);
    if (anchorIndex >= 0) {
      px[sourceIndex] = px[anchorIndex] + localRadius * Math.cos(localAngle);
      py[sourceIndex] = py[anchorIndex] + localRadius * Math.sin(localAngle);
    } else {
      const orphanRadius = 30 * Math.sqrt(sourceIndex + 1);
      px[sourceIndex] = orphanRadius * Math.cos(localAngle);
      py[sourceIndex] = orphanRadius * Math.sin(localAngle);
    }
    vx[sourceIndex] = 0;
    vy[sourceIndex] = 0;
  }
}

/** Whether headings are folded into files, by the Headings choice and the zoom. */
export function shouldFoldHeadings(state: GraphState, settings: GraphSettings, camera: Camera): boolean {
  if (settings.headings === 'always') {
    return false;
  }
  if (settings.headings === 'never') {
    return true;
  }
  const threshold = settings.labelThreshold;
  if (state.headingsFolded === null) {
    return camera.k < threshold;
  }
  return state.headingsFolded
    ? camera.k <= threshold + FOLD_HYSTERESIS
    : camera.k < threshold - FOLD_HYSTERESIS;
}

/**
 * Folds each file drawn as two or more headings into one node: its id is
 * the file's, its size the sum of its headings', its tags theirs. Edges
 * inside a file go; edges out of it join, their kinds unioned. A file with
 * one heading keeps it, so its node and a selection of it stay put.
 */
export function foldHeadings(
  state: GraphState,
  candidateNodes: readonly ViewNode[],
  graphEdges: readonly SourceEdge[],
): { nodes: ViewNode[]; edges: SourceEdge[] } {
  const byFile: Record<string, ViewNode[]> = {};
  candidateNodes.forEach((node) => {
    if (node.kind !== 'note' || node.id.indexOf('section:') !== 0 || !node.filePath) {
      return;
    }
    (byFile[node.filePath] || (byFile[node.filePath] = [])).push(node);
  });
  const fileNodes: Record<string, ViewNode> = {};
  Object.keys(byFile).forEach((filePath) => {
    const members = byFile[filePath];
    if (members.length < 2) {
      return;
    }
    fileNodes['file:' + filePath] = foldFile(state, filePath, members);
  });
  const nodesOut: ViewNode[] = [];
  const emitted: Record<string, true> = {};
  candidateNodes.forEach((node) => {
    const into = state.foldedInto[node.id];
    if (!into) {
      nodesOut.push(node);
      return;
    }
    if (emitted[into]) {
      return;
    }
    emitted[into] = true;
    nodesOut.push(fileNodes[into]);
  });
  return { nodes: nodesOut, edges: joinFoldedEdges(state, graphEdges) };
}

/** One file's node for its headings, which are noted as folded into it. */
function foldFile(state: GraphState, filePath: string, members: ViewNode[]): ViewNode {
  members.sort((left, right) => (left.line || 0) - (right.line || 0));
  const id = 'file:' + filePath;
  const tagKeys: Record<string, true> = {};
  const links: Record<string, number> = {};
  let degree = 0;
  members.forEach((member) => {
    state.foldedInto[member.id] = id;
    degree += member.degree || 0;
    (member.tagKeys || []).forEach((key) => {
      tagKeys[key] = true;
    });
    const memberLinks = (member.links || {}) as Record<string, number>;
    Object.keys(memberLinks).forEach((kind) => {
      links[kind] = (links[kind] || 0) + memberLinks[kind];
    });
  });
  state.foldMembers[id] = members.map((member) => member.id);
  return {
    id,
    kind: 'note',
    title: (filePath.split('/').pop() as string).replace(/\.md$/i, ''),
    filePath,
    line: members[0].line,
    tagKeys: Object.keys(tagKeys),
    degree,
    links,
    headingCount: members.length,
    selectId: members[0].id,
  };
}

/**
 * Edges keyed by their ends once folded. One that no fold touched is
 * passed on as it is; one made of several, or re-ended, is a new object,
 * so the snapshot's own edges are never changed.
 */
function joinFoldedEdges(state: GraphState, graphEdges: readonly SourceEdge[]): SourceEdge[] {
  const merged: Record<string, { original: SourceEdge | null; edge: SourceEdge & { weight: number }; parts: number }> = {};
  const order: string[] = [];
  graphEdges.forEach((edge) => {
    const source = state.foldedInto[edge.source] || edge.source;
    const target = state.foldedInto[edge.target] || edge.target;
    if (source === target) {
      return;
    }
    const ends = source < target ? [source, target] : [target, source];
    const id = ends[0] + '::' + ends[1];
    const entry = merged[id];
    if (!entry) {
      merged[id] = {
        original: source === edge.source && target === edge.target ? edge : null,
        edge: { id, source: ends[0], target: ends[1], weight: edge.weight, types: edge.types.slice() },
        parts: 1,
      };
      order.push(id);
      return;
    }
    entry.parts += 1;
    entry.edge.weight = Math.max(entry.edge.weight, edge.weight);
    edge.types.forEach((type) => {
      if (entry.edge.types.indexOf(type) === -1) {
        entry.edge.types.push(type);
      }
    });
  });
  return order.map((id) => {
    const entry = merged[id];
    return entry.parts === 1 && entry.original ? entry.original : entry.edge;
  });
}

/** The folds of the view before a rebuild. */
interface PreviousFolds {
  readonly previousFoldMembers: Record<string, string[]>;
  readonly previousFoldedInto: Record<string, string>;
}

/** Seeds the position of a node a fold or an unfold made from where its parts were. */
function carryFoldPositions(
  state: GraphState,
  candidateNodes: readonly ViewNode[],
  previous: Record<string, Kept>,
  folds: PreviousFolds,
): void {
  const { previousFoldMembers, previousFoldedInto } = folds;
  candidateNodes.forEach((node) => {
    if (previous[node.id]) {
      return;
    }
    const members = state.foldMembers[node.id];
    if (members) {
      let x = 0;
      let y = 0;
      let found = 0;
      members.forEach((memberId) => {
        const at = previous[memberId];
        if (!at) {
          return;
        }
        x += at.x;
        y += at.y;
        found += 1;
      });
      if (found) {
        previous[node.id] = { x: x / found, y: y / found, vx: 0, vy: 0 };
      }
      return;
    }
    const into = previousFoldedInto[node.id];
    const file = into && previous[into];
    if (!file) {
      return;
    }
    const ordinal = previousFoldMembers[into].indexOf(node.id);
    const angle = ordinal * GOLDEN_ANGLE;
    const radius = 6 + 4 * Math.sqrt(ordinal + 1);
    previous[node.id] = { x: file.x + radius * Math.cos(angle), y: file.y + radius * Math.sin(angle), vx: 0, vy: 0 };
  });
}

/** The nodes whose title or path holds the search, or null when nothing is searched for. */
export function recomputeSearchMatches(state: GraphState, settings: GraphSettings): void {
  const query = settings.search.trim().toLowerCase();
  if (!query) {
    state.matchSet = null;
    return;
  }
  const matchSet: Record<number, true> = {};
  state.matchSet = matchSet;
  state.nodes.forEach((node, index) => {
    let haystack = node.title.toLowerCase();
    if (node.filePath) {
      haystack += ' ' + node.filePath.toLowerCase();
    }
    if (haystack.indexOf(query) !== -1) {
      matchSet[index] = true;
    }
  });
}

/** The nodes carrying a tag picked in the list, the tags themselves among them, or null when none is picked. */
export function recomputeTagMatches(state: GraphState, settings: GraphSettings): void {
  if (!settings.selectedTags.length) {
    state.tagMatchSet = null;
    return;
  }
  const selected: Record<string, true> = {};
  settings.selectedTags.forEach((key) => {
    selected[key] = true;
  });
  const tagMatchSet: Record<number, true> = {};
  state.tagMatchSet = tagMatchSet;
  state.nodes.forEach((node, index) => {
    if (node.kind === 'tag') {
      const tagKey = node.id.slice(4);
      if (selected[tagKey]) {
        tagMatchSet[index] = true;
      }
      return;
    }

    for (let t = 0; t < node.tagKeys.length; t += 1) {
      if (selected[node.tagKeys[t]]) {
        tagMatchSet[index] = true;
        return;
      }
    }
  });
}

/**
 * Names each group after the tags its notes and tasks carry more than the
 * rest of the graph does: a tag scores its count in the group, squared,
 * over its count anywhere, so a tag on every note names nothing. A second
 * tag joins the name when it scores half the first. A group with no tags
 * is named after its best-connected note. Once per rebuild, not a frame.
 */
export function nameGroups(state: GraphState): void {
  const { communityCount, communityId, nodes } = state;
  state.groups = [];
  state.groupKeyIndex = {};
  state.namedGroupCount = 0;
  const carried: Record<string, number> = {};
  const inGroup: Record<string, number>[] = [];
  const best: number[] = [];
  for (let c = 0; c < communityCount; c += 1) {
    state.groups.push(null);
    inGroup.push({});
    best.push(-1);
  }
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].kind === 'tag') {
      continue;
    }
    const community = communityId[i];
    const keys = nodes[i].tagKeys || [];
    for (let t = 0; t < keys.length; t += 1) {
      carried[keys[t]] = (carried[keys[t]] || 0) + 1;
      if (community >= 0) {
        inGroup[community][keys[t]] = (inGroup[community][keys[t]] || 0) + 1;
      }
    }
    if (community >= 0 && (best[community] < 0 || nodeDegree(state, i) > nodeDegree(state, best[community]))) {
      best[community] = i;
    }
  }
  for (let g = 0; g < communityCount; g += 1) {
    if (state.communitySizes[g] < GROUP_MINIMUM_SIZE || best[g] < 0) {
      continue;
    }
    nameGroup(state, g, { counts: inGroup[g], carried, best: best[g] });
  }
}

/** What one group is named from: its tags' counts in it and anywhere, and its best-connected node. */
interface GroupEvidence {
  readonly counts: Record<string, number>;
  readonly carried: Record<string, number>;
  readonly best: number;
}

/** Names one group, keyed by its first tag, or its best-connected node's id. */
function nameGroup(state: GraphState, g: number, evidence: GroupEvidence): void {
  const { counts, carried, best } = evidence;
  const scored = Object.keys(counts).map((key) => ({ key, score: counts[key] * counts[key] / carried[key] }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  let key: string;
  let name: string;
  if (scored.length) {
    key = scored[0].key;
    name = tagName(state, scored[0].key);
    if (scored[1] && scored[1].score >= scored[0].score / 2) {
      name += ' · ' + tagName(state, scored[1].key);
    }
  } else {
    key = state.nodes[best].id;
    name = 'around ' + state.nodes[best].title;
  }
  if (state.groupKeyIndex[key] !== undefined) {
    key += '@' + state.nodes[best].id;
  }
  if (name.length > 28) {
    name = name.slice(0, 27) + '…';
  }
  state.groups[g] = { key, name, size: state.communitySizes[g] };
  state.groupKeyIndex[key] = g;
  state.namedGroupCount += 1;
}

/** A tag as a group's name says it: its label, without the #. */
function tagName(state: GraphState, key: string): string {
  const label = state.tagLabelByKey[key] || key;
  return label.charAt(0) === '#' ? label.slice(1) : label;
}

/** The members of the group picked, by node index, or null when none is. */
export function recomputeGroupMatch(state: GraphState, settings: GraphSettings): void {
  const community = settings.group ? state.groupKeyIndex[settings.group] : undefined;
  if (community === undefined) {
    state.groupMatch = null;
    return;
  }
  state.groupMatch = new Uint8Array(state.nodes.length);
  for (let i = 0; i < state.nodes.length; i += 1) {
    if (state.communityId[i] === community) {
      state.groupMatch[i] = 1;
    }
  }
}

/**
 * Selects a node, and the neighbors its drawn lines lead to, or nothing
 * with -1 or an index the graph does not hold.
 */
export function setSelectedIndex(state: GraphState, rawIndex: number): void {
  const index = state.nodes[rawIndex] ? rawIndex : -1;
  state.selectedIndex = index;
  state.selectedId = index >= 0 ? state.nodes[index].id : null;
  state.selectedNeighbors = {};
  if (index >= 0) {
    state.adjacency[index].forEach((neighbor) => {
      state.selectedNeighbors[neighbor] = true;
    });
  }
}

/**
 * Hovers a node, and the neighbors its drawn lines lead to, or nothing
 * with -1 or an index the graph does not hold.
 */
export function setHoverIndex(state: GraphState, rawIndex: number): void {
  const index = state.nodes[rawIndex] ? rawIndex : -1;
  state.hoverIndex = index;
  state.hoverNeighbors = {};
  if (index >= 0) {
    state.adjacency[index].forEach((neighbor) => {
      state.hoverNeighbors[neighbor] = true;
    });
  }
}

/** A node by id; a heading folded into its file is found as the file. */
export function findNodeIndex(state: GraphState, nodeId: string | null | undefined): number {
  if (!nodeId) {
    return -1;
  }
  if (state.nodeIndexById[nodeId] !== undefined) {
    return state.nodeIndexById[nodeId];
  }
  const into = state.foldedInto[nodeId];
  return into && state.nodeIndexById[into] !== undefined ? state.nodeIndexById[into] : -1;
}
