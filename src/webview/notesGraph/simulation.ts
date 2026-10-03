/**
 * The Notes Graph's physics: a hand-rolled velocity-Verlet loop with
 * Barnes-Hut repulsion, run a tick at a time by the page's frame loop.
 *
 * A typed port of the page script's `tick`, `applyRepulsion`, and
 * `tickCommunityAnchors`, line for line: every expression is computed in
 * the order the script computed it, into the same Float32Arrays, so the
 * graph comes to rest where it always did.
 */
import type { GraphSettings, SimulationState } from './model';

/** How much of the remaining heat each tick takes away. */
const ALPHA_DECAY = 0.0228;
/** Under this, the simulation stops. */
const ALPHA_MIN = 0.005;
/** How much of its velocity a node keeps from one tick to the next. */
const VELOCITY_DECAY = 0.6;

/**
 * Whether a node is moved and pushed by the physics: notes and tasks are,
 * and tags, which sit at their group's anchor, are not.
 */
export function isPhysicalNode(state: SimulationState, index: number): boolean {
  return state.nodes[index].kind !== 'tag';
}

/**
 * One step of the simulation: the group anchors move, each drawn link pulls
 * its ends together, nodes push apart, each note and task is drawn to its
 * group, and untagged ones to the middle; then every node moves by its
 * velocity, but the one being dragged, and the heat falls. A graph with no
 * nodes has nothing to move, so it is at rest at once.
 */
export function tick(state: SimulationState, settings: GraphSettings): void {
  const count = state.nodes.length;
  if (count === 0) {
    // The frame loop runs while the graph is hot, and only a tick cools it.
    state.alpha = 0;
    return;
  }

  tickCommunityAnchors(state, settings);
  applyLinkSprings(state, settings);
  applyRepulsion(state, settings);
  applyClusterGravity(state, settings);
  moveNodes(state, settings);

  state.alpha += (0 - state.alpha) * ALPHA_DECAY;
  if (state.alpha < ALPHA_MIN) {
    state.alpha = 0;
  }
}

/**
 * Moves the group anchors: groups joined by links pull toward a distance
 * apart, nearby groups push apart, and every anchor is drawn gently to the
 * middle. Each tag then sits at its group's anchor, at its own offset.
 */
export function tickCommunityAnchors(state: SimulationState, settings: GraphSettings): void {
  if (state.communityCount === 0) {
    return;
  }
  const { alpha, communityAnchorX, communityAnchorY, communityVx, communityVy } = state;
  const macroStrength = Math.max(0.25, settings.linkStrength) *
    0.035 * alpha;
  const macroDistance = settings.linkDistance *
    (3 + settings.communitySpacing);
  state.communityEdges.forEach((edge) => {
    const dx = communityAnchorX[edge.b] - communityAnchorX[edge.a];
    const dy = communityAnchorY[edge.b] - communityAnchorY[edge.a];
    const distance = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const strength = macroStrength * Math.min(1, edge.weight / 6);
    const delta = (distance - macroDistance) / distance * strength;
    communityVx[edge.b] -= dx * delta;
    communityVy[edge.b] -= dy * delta;
    communityVx[edge.a] += dx * delta;
    communityVy[edge.a] += dy * delta;
  });

  // Community anchors are few compared with graph nodes. A bounded
  // pairwise pass keeps nearby communities separated while large graphs
  // retain their deterministic spiral spacing without an O(n^2) fallback.
  if (state.communityCount <= 384) {
    separateCommunities(state, settings);
  }

  const center = settings.centerStrength * 0.0008 * alpha;
  for (let community = 0; community < state.communityCount; community += 1) {
    communityVx[community] -= communityAnchorX[community] * center;
    communityVy[community] -= communityAnchorY[community] * center;
    communityVx[community] *= 0.75;
    communityVy[community] *= 0.75;
    communityAnchorX[community] += communityVx[community];
    communityAnchorY[community] += communityVy[community];
  }
  placeTags(state);
}

/** Pushes apart each pair of group anchors closer than their sizes and Community spacing allow. */
function separateCommunities(state: SimulationState, settings: GraphSettings): void {
  const { alpha, communityAnchorX, communityAnchorY, communityVx, communityVy, communitySizes } = state;
  for (let left = 0; left < state.communityCount; left += 1) {
    for (let right = left + 1; right < state.communityCount; right += 1) {
      const separationX = communityAnchorX[right] - communityAnchorX[left];
      const separationY = communityAnchorY[right] - communityAnchorY[left];
      const separation = Math.sqrt(
        separationX * separationX + separationY * separationY,
      ) || 1e-6;
      const desiredSeparation = 90 * settings.communitySpacing +
        3 * (
          Math.sqrt(communitySizes[left]) +
          Math.sqrt(communitySizes[right])
        );
      if (separation >= desiredSeparation) {
        continue;
      }
      const separationForce = (desiredSeparation - separation) /
        separation * 0.025 * alpha;
      communityVx[right] += separationX * separationForce;
      communityVy[right] += separationY * separationForce;
      communityVx[left] -= separationX * separationForce;
      communityVy[left] -= separationY * separationForce;
    }
  }
}

/** Puts each tag at its group's anchor and offset, at rest; a tag in no group stays where it is. */
function placeTags(state: SimulationState): void {
  const { nodes, communityId, px, py, vx, vy } = state;
  for (let tag = 0; tag < nodes.length; tag += 1) {
    if (nodes[tag].kind !== 'tag') {
      continue;
    }
    const tagCommunity = communityId[tag];
    if (tagCommunity >= 0) {
      px[tag] = state.communityAnchorX[tagCommunity] + state.tagOffsetX[tag];
      py[tag] = state.communityAnchorY[tagCommunity] + state.tagOffsetY[tag];
    }
    vx[tag] = 0;
    vy[tag] = 0;
  }
}

/**
 * Link springs, degree-biased like d3-force so hubs move less. A tag's
 * links pull only while tags are shown: a primary tag's hard and close, the
 * others' faintly; an association between tags faintly and far.
 */
function applyLinkSprings(state: SimulationState, settings: GraphSettings): void {
  const { nodes, edges, px, py, vx, vy, degrees, primaryTag, alpha } = state;
  const linkDistance = settings.linkDistance;
  for (let e = 0; e < edges.length; e += 1) {
    const edge = edges[e];
    const isMembership = edge.types.indexOf('tag-membership') !== -1;
    const isAssociation = edge.types.indexOf('associated-tag') !== -1;
    if (!settings.showTags && (isMembership || isAssociation)) {
      continue;
    }
    const dx = (px[edge.b] + vx[edge.b]) - (px[edge.a] + vx[edge.a]);
    const dy = (py[edge.b] + vy[edge.b]) - (py[edge.a] + vy[edge.a]);
    const distance = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const minDegree = Math.min(degrees[edge.a], degrees[edge.b]) || 1;
    let strength = settings.linkStrength * Math.min(1, edge.weight) / minDegree;
    let desiredDistance = linkDistance;
    if (isMembership) {
      const membershipNote = nodes[edge.a].kind === 'tag' ? edge.b : edge.a;
      const membershipTag = nodes[edge.a].kind === 'tag' ? edge.a : edge.b;
      const isPrimaryMembership = primaryTag[membershipNote] === membershipTag;
      strength *= isPrimaryMembership ? 3 : 0.08;
      desiredDistance *= isPrimaryMembership ? 0.8 : 1.6;
    } else if (isAssociation) {
      // Associations influence neighboring communities without collapsing
      // every tag anchor into one dense central component.
      strength *= 0.2;
      desiredDistance *= 1.8;
    }
    const delta = (distance - desiredDistance) / distance * alpha * strength;
    const bias = degrees[edge.a] / (degrees[edge.a] + degrees[edge.b] || 1);
    vx[edge.b] -= dx * delta * bias;
    vy[edge.b] -= dy * delta * bias;
    vx[edge.a] += dx * delta * (1 - bias);
    vy[edge.a] += dy * delta * (1 - bias);
  }
}

/**
 * Virtual community anchors keep hidden tags from becoming high-mass
 * particles while still pulling each note and task into a compact island.
 * The node being dragged is not pulled.
 */
function applyClusterGravity(state: SimulationState, settings: GraphSettings): void {
  const { nodes, communityId, px, py, vx, vy } = state;
  const clusterGravity = Math.max(0.25, settings.linkStrength) *
    settings.clusterCohesion * 0.035 * state.alpha;
  for (let clustered = 0; clustered < nodes.length; clustered += 1) {
    if (nodes[clustered].kind === 'tag' || clustered === state.dragIndex) {
      continue;
    }
    const community = communityId[clustered];
    if (community < 0) {
      continue;
    }
    const clusterDx = state.communityAnchorX[community] - px[clustered];
    const clusterDy = state.communityAnchorY[community] - py[clustered];
    vx[clustered] += clusterDx * clusterGravity;
    vy[clustered] += clusterDy * clusterGravity;
  }
}

/**
 * Tags are cluster anchors. Center only those anchors (plus truly untagged
 * nodes) so tagged notes orbit their communities instead of collapsing into
 * one global sun. Then each note and task moves by its velocity, decayed,
 * but the one being dragged.
 */
function moveNodes(state: SimulationState, settings: GraphSettings): void {
  const { nodes, communityId, px, py, vx, vy } = state;
  const center = settings.centerStrength * 0.006 * state.alpha;
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].kind === 'tag') {
      const tagCommunity = communityId[i];
      if (tagCommunity >= 0) {
        px[i] = state.communityAnchorX[tagCommunity] + state.tagOffsetX[i];
        py[i] = state.communityAnchorY[tagCommunity] + state.tagOffsetY[i];
      }
      vx[i] = 0;
      vy[i] = 0;
      continue;
    }
    const centerScale = nodes[i].tagKeys.length === 0 ? 0.2 : 0;
    vx[i] -= px[i] * center * centerScale;
    vy[i] -= py[i] * center * centerScale;
    vx[i] *= VELOCITY_DECAY;
    vy[i] *= VELOCITY_DECAY;
    if (i !== state.dragIndex) {
      px[i] += vx[i];
      py[i] += vy[i];
    }
  }
}

/** A cell of the Barnes-Hut quadtree: its square, its mass and center of mass, and its one node or its four children. */
interface Cell {
  x0: number;
  y0: number;
  extent: number;
  mass: number;
  cx: number;
  cy: number;
  nodeIndex: number;
  children: (Cell | null)[] | null;
}

/** An empty cell. */
function makeCell(x0: number, y0: number, extent: number): Cell {
  return { x0, y0, extent, mass: 0, cx: 0, cy: 0, nodeIndex: -1, children: null };
}

/**
 * Barnes-Hut approximation: build a quadtree each tick and treat far cells
 * as single point charges (theta = 0.9). Only notes and tasks push and are
 * pushed; a tag weighs more the more nodes it is primary for.
 */
export function applyRepulsion(state: SimulationState, settings: GraphSettings): void {
  const physicalIndices: number[] = [];
  for (let physical = 0; physical < state.nodes.length; physical += 1) {
    if (isPhysicalNode(state, physical)) {
      physicalIndices.push(physical);
    }
  }
  if (physicalIndices.length < 2) {
    return;
  }
  const root = boundingCell(state, physicalIndices);
  const tree = new QuadTree(state);
  for (let n = 0; n < physicalIndices.length; n += 1) {
    tree.insert(root, physicalIndices[n]);
  }
  const push = new Repulsion(state, settings.repelStrength);
  for (let target = 0; target < physicalIndices.length; target += 1) {
    push.apply(root, physicalIndices[target]);
  }
}

/** The square cell that holds every node given, from their smallest x and y. */
function boundingCell(state: SimulationState, physicalIndices: readonly number[]): Cell {
  const { px, py } = state;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < physicalIndices.length; i += 1) {
    const physicalIndex = physicalIndices[i];
    if (px[physicalIndex] < minX) {
      minX = px[physicalIndex];
    }
    if (px[physicalIndex] > maxX) {
      maxX = px[physicalIndex];
    }
    if (py[physicalIndex] < minY) {
      minY = py[physicalIndex];
    }
    if (py[physicalIndex] > maxY) {
      maxY = py[physicalIndex];
    }
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  return makeCell(minX, minY, size);
}

/** Inserts nodes into a quadtree by their positions, summing mass and center of mass on the way down. */
class QuadTree {
  /** Reads the nodes' kinds, positions, and primary cluster sizes from `state`. */
  public constructor(private readonly state: SimulationState) {}

  /** A node's mass: 1 for a note or task; a tag weighs by what it is primary for. */
  private nodeMass(index: number): number {
    if (this.state.nodes[index].kind !== 'tag') {
      return 1;
    }
    const clusterSize = this.state.primaryClusterSize[index];
    return clusterSize > 0
      ? 2 + Math.min(4, Math.sqrt(clusterSize))
      : 0.35;
  }

  /** Puts a node in a cell, splitting the cell when it already holds one. */
  public insert(cell: Cell, index: number): void {
    const { px, py } = this.state;
    const insertedMass = this.nodeMass(index);
    if (cell.mass === 0 && cell.nodeIndex === -1 && cell.children === null) {
      cell.nodeIndex = index;
      cell.mass = insertedMass;
      cell.cx = px[index];
      cell.cy = py[index];
      return;
    }
    if (cell.children === null) {
      const existing = cell.nodeIndex;
      cell.nodeIndex = -1;
      cell.children = [null, null, null, null];
      if (existing !== -1) {
        this.placeInChild(cell, existing);
      }
    }
    this.placeInChild(cell, index);
    cell.cx = (cell.cx * cell.mass + px[index] * insertedMass) /
      (cell.mass + insertedMass);
    cell.cy = (cell.cy * cell.mass + py[index] * insertedMass) /
      (cell.mass + insertedMass);
    cell.mass += insertedMass;
  }

  /** Puts a node in the quarter of a split cell it falls in; coincident points merge as extra mass. */
  private placeInChild(cell: Cell, index: number): void {
    const { px, py } = this.state;
    const children = cell.children as (Cell | null)[];
    const half = cell.extent / 2;
    const right = px[index] >= cell.x0 + half ? 1 : 0;
    const bottom = py[index] >= cell.y0 + half ? 1 : 0;
    const slot = bottom * 2 + right;
    if (children[slot] === null) {
      children[slot] = makeCell(
        cell.x0 + right * half,
        cell.y0 + bottom * half,
        half,
      );
    }
    const child = children[slot] as Cell;
    if (child.extent < 1e-4) {
      // Coincident points: merge into the child as extra mass.
      const insertedMass = this.nodeMass(index);
      child.cx = (child.cx * child.mass + px[index] * insertedMass) /
        (child.mass + insertedMass);
      child.cy = (child.cy * child.mass + py[index] * insertedMass) /
        (child.mass + insertedMass);
      child.mass += insertedMass;
      return;
    }
    this.insert(child, index);
  }
}

/** The push a quadtree's cells give one node, by Repel strength and the heat. */
class Repulsion {
  /** Pushes the nodes of `state` with `repel`, the Repel strength. */
  public constructor(private readonly state: SimulationState, private readonly repel: number) {}

  /** Pushes a node away from each cell far enough to count as one charge, or from each of its children. */
  public apply(cell: Cell | null, index: number): void {
    if (cell === null || cell.mass === 0) {
      return;
    }
    const { px, py } = this.state;
    const dx = cell.cx - px[index];
    const dy = cell.cy - py[index];
    const dist2 = dx * dx + dy * dy;
    const farEnough = cell.extent * cell.extent / dist2 < 0.81;
    if (cell.children === null || farEnough) {
      this.push(cell, index, { dx, dy, dist2 });
      return;
    }
    this.apply(cell.children[0], index);
    this.apply(cell.children[1], index);
    this.apply(cell.children[2], index);
    this.apply(cell.children[3], index);
  }

  /**
   * Pushes a node from one cell's center of mass, not from itself; two at
   * the same point are nudged apart by their indices, and nothing pushes
   * harder than from 4 units away.
   */
  private push(cell: Cell, index: number, offset: { dx: number; dy: number; dist2: number }): void {
    if (cell.nodeIndex === index) {
      return;
    }
    const { nodes, primaryClusterSize, vx, vy } = this.state;
    let { dx, dy, dist2 } = offset;
    if (dist2 < 1e-6) {
      dx = (index % 7 - 3) * 0.01 || 0.01;
      dy = (index % 5 - 2) * 0.01 || 0.01;
      dist2 = dx * dx + dy * dy;
    }
    if (dist2 < 16) {
      dist2 = 16;
    }
    let targetCharge = 1;
    if (nodes[index].kind === 'tag') {
      targetCharge = primaryClusterSize[index] > 0 ? 1.5 : 0.5;
    }
    const force = this.repel * cell.mass * targetCharge * this.state.alpha / dist2;
    const dist = Math.sqrt(dist2);
    vx[index] -= dx / dist * force;
    vy[index] -= dy / dist * force;
  }
}
