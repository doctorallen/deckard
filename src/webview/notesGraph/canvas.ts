/**
 * Draws the Notes Graph into its canvas: the faint disc under each named
 * group, the edges batched by kind, the nodes by kind, the halos, and the
 * labels.
 *
 * A typed port of the page script's `draw`, line for line: the same calls
 * on the context, with the same arguments, in the same order, so a frame
 * is painted as it always was. It reads the graph and writes back only
 * where the group names and centers were drawn, which a click reads.
 */
import {
  type GraphGroup,
  type GraphSettings,
  type GraphState,
  type LabelRect,
  isDimmed,
  isRendered,
  nodeDegree,
  nodeRadius,
  type ViewEdge,
} from './model';

/** The colors the canvas paints with, read from the theme, or the system's under forced colors. */
export interface GraphColors {
  background: string;
  note: string;
  task: string;
  tag: string;
  edge: string;
  edgeHighlight: string;
  label: string;
  halo: string;
  group: string;
}

/** Where the view looks: its pan in screen pixels, and its zoom. */
export interface Camera {
  x: number;
  y: number;
  k: number;
}

/** What one frame is drawn from. */
export interface Frame {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly state: GraphState;
  readonly settings: GraphSettings;
  readonly camera: Camera;
  /** The device pixel ratio the canvas was last sized for. */
  readonly dpr: number;
  readonly colors: GraphColors;
  /** Whether forced colors are on, when the group discs are outlined but not filled. */
  readonly forcedColors: boolean;
  /** The type steps labels and group names are set in, in pixels, such as `11px`. */
  readonly labelFontSize: string;
  readonly groupFontSize: string;
  /** The theme's monospace font now, which may be empty. */
  readonly monoFont: () => string;
}

/** How many of the best-connected notes on screen are named at rest. */
const HUB_LABELS_AT_REST = 8;
/** How many groups are named at rest, largest first. */
const GROUP_LABELS_AT_REST = 16;
/**
 * Past this many lines in one frame the dashes are left off and the kinds
 * are told apart by alpha alone: a dashed stroke over thousands of
 * segments costs far more than a solid one.
 */
const MAXIMUM_DASHED_EDGES = 3000;
/** Dash patterns in screen pixels, and each kind's alpha against the base: wiki link, heading, tag, through a daily note. */
const EDGE_STYLES: readonly { dash: number[]; alpha: number; cap: CanvasLineCap }[] = [
  { dash: [], alpha: 1.6, cap: 'butt' },
  { dash: [5, 3], alpha: 1, cap: 'butt' },
  { dash: [1, 3], alpha: 0.8, cap: 'round' },
  { dash: [8, 3, 1, 3], alpha: 1, cap: 'butt' },
];
/** The kinds of node, in the order they are painted. */
const KINDS = ['note', 'task', 'tag'] as const;

/** What the parts of one frame share: its size, its zoom, and what is in view. */
interface FrameView {
  readonly width: number;
  readonly height: number;
  readonly k: number;
  /** Whether a node is inside the visible world rectangle, with a margin for culling. */
  readonly inView: (index: number) => boolean;
  /** Whether a node is drawn at all. */
  readonly rendered: (index: number) => boolean;
  /** The node hovered, or else the one selected, or -1. */
  readonly focusIndex: number;
  /** How faint the group discs and names are, from 1 well zoomed out to 0 at Label fade zoom. */
  readonly restFade: number;
  /** Whether the groups are drawn at rest. */
  readonly showGroups: boolean;
}

/**
 * Paints one frame. With no nodes, the background alone, and the group
 * names and centers of the last frame stay as they were.
 */
export function drawGraph(frame: Frame): void {
  const { canvas, ctx, state, settings, camera, dpr } = frame;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = frame.colors.background;
  ctx.fillRect(0, 0, width, height);
  if (state.nodes.length === 0) {
    return;
  }

  const k = camera.k;
  ctx.setTransform(k * dpr, 0, 0, k * dpr, camera.x * dpr, camera.y * dpr);

  // Visible world rectangle with margin for culling.
  const margin = 80 / k;
  const worldLeft = -camera.x / k - margin;
  const worldTop = -camera.y / k - margin;
  const worldRight = (width - camera.x) / k + margin;
  const worldBottom = (height - camera.y) / k + margin;
  const { px, py } = state;
  const inView = (index: number): boolean =>
    px[index] >= worldLeft && px[index] <= worldRight &&
    py[index] >= worldTop && py[index] <= worldBottom;

  const hovering = state.hoverIndex >= 0;
  const focusIndex = hovering ? state.hoverIndex : state.selectedIndex;
  // Groups, at rest: a faint disc under each named group, fading out as
  // the zoom nears the point where every node is named.
  const restFade = k < settings.labelThreshold
    ? Math.min(1, (settings.labelThreshold - k) / 0.4)
    : 0;
  const view: FrameView = {
    width,
    height,
    k,
    inView,
    rendered: (index) => isRendered(state, settings, index),
    focusIndex,
    restFade,
    showGroups: state.namedGroupCount >= 2 && restFade > 0,
  };
  drawGroupDiscs(frame, view);
  drawEdges(frame, view);
  drawNodes(frame, view);
  drawHalos(frame, view);
  drawLabels(frame, view);
}

/**
 * One pass to find each named group's center and spread, one path, one
 * fill, one stroke. The centers are kept for the names drawn over them.
 */
function drawGroupDiscs(frame: Frame, view: FrameView): void {
  const { ctx, state, colors } = frame;
  state.groupCenters = [];
  if (!view.showGroups) {
    return;
  }
  const { communityCount, communityId, groups, nodes, px, py } = state;
  const sumX = new Float64Array(communityCount);
  const sumY = new Float64Array(communityCount);
  const sumSquares = new Float64Array(communityCount);
  const members = new Uint32Array(communityCount);
  for (let m = 0; m < nodes.length; m += 1) {
    const memberGroup = communityId[m];
    if (memberGroup < 0 || !groups[memberGroup] || nodes[m].kind === 'tag') {
      continue;
    }
    sumX[memberGroup] += px[m];
    sumY[memberGroup] += py[m];
    sumSquares[memberGroup] += px[m] * px[m] + py[m] * py[m];
    members[memberGroup] += 1;
  }
  ctx.beginPath();
  for (let g = 0; g < communityCount; g += 1) {
    if (!groups[g] || !members[g]) {
      continue;
    }
    const centerX = sumX[g] / members[g];
    const centerY = sumY[g] / members[g];
    const spread = Math.max(0, sumSquares[g] / members[g] - centerX * centerX - centerY * centerY);
    const discRadius = Math.max(12, 1.5 * Math.sqrt(spread));
    state.groupCenters[g] = { x: centerX, y: centerY, r: discRadius };
    ctx.moveTo(centerX + discRadius, centerY);
    ctx.arc(centerX, centerY, discRadius, 0, 6.2832);
  }
  if (!frame.forcedColors) {
    ctx.fillStyle = colors.group;
    ctx.globalAlpha = 0.07 * view.restFade;
    ctx.fill();
  }
  ctx.strokeStyle = colors.group;
  ctx.globalAlpha = 0.22 * view.restFade;
  ctx.lineWidth = 1 / view.k;
  ctx.stroke();
}

/** The edges a frame draws: by kind, and those of the node in focus apart. */
interface SortedEdges {
  readonly byKind: ViewEdge[][];
  readonly highlighted: ViewEdge[];
  readonly shownEdges: number;
}

/**
 * The edges in view whose ends are both drawn: those of the node hovered or
 * selected apart, as one highlight, and the rest by kind.
 */
function sortEdges(frame: Frame, view: FrameView): SortedEdges {
  const { state } = frame;
  const { focusIndex } = view;
  const byKind: ViewEdge[][] = [[], [], [], []];
  const highlighted: ViewEdge[] = [];
  let shownEdges = 0;
  for (let e = 0; e < state.edges.length; e += 1) {
    const edge = state.edges[e];
    if (!edge.drawn || !view.rendered(edge.a) || !view.rendered(edge.b)) {
      continue;
    }
    if (!view.inView(edge.a) && !view.inView(edge.b)) {
      continue;
    }
    if (focusIndex >= 0 && (edge.a === focusIndex || edge.b === focusIndex)) {
      highlighted.push(edge);
      continue;
    }
    byKind[edge.kind].push(edge);
    shownEdges += 1;
  }
  return { byKind, highlighted, shownEdges };
}

/**
 * Edges: one batched path per kind, each with its own dash pattern, and
 * one more, solid, for a selected node's links, so they read as a single
 * highlight. Up to five strokes a frame.
 */
function drawEdges(frame: Frame, view: FrameView): void {
  const { ctx, state, settings, colors } = frame;
  const { k, focusIndex } = view;
  const edgeAlpha = Math.min(0.45, 0.1 + 0.18 * k);
  const { byKind, highlighted, shownEdges } = sortEdges(frame, view);
  const dimmingActive = focusIndex >= 0 || state.matchSet !== null || state.tagMatchSet !== null || state.groupMatch !== null;
  const dashed = shownEdges <= MAXIMUM_DASHED_EDGES;
  ctx.lineWidth = settings.linkThickness / k;
  ctx.strokeStyle = colors.edge;
  for (let kindIndex = 0; kindIndex < byKind.length; kindIndex += 1) {
    const kindEdges = byKind[kindIndex];
    if (kindEdges.length === 0) {
      continue;
    }
    const style = EDGE_STYLES[kindIndex];
    const kindAlpha = Math.min(0.7, edgeAlpha * style.alpha);
    ctx.globalAlpha = dimmingActive ? kindAlpha * 0.25 : kindAlpha;
    ctx.setLineDash(dashed ? style.dash.map((length) => length / k) : []);
    ctx.lineCap = dashed ? style.cap : 'butt';
    strokeEdges(frame, kindEdges);
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  if (highlighted.length === 0) {
    return;
  }
  ctx.strokeStyle = colors.edgeHighlight;
  ctx.globalAlpha = Math.min(0.9, edgeAlpha * 3);
  strokeEdges(frame, highlighted);
}

/** One path of lines, one stroke. */
function strokeEdges(frame: Frame, edges: readonly ViewEdge[]): void {
  const { ctx } = frame;
  const { px, py } = frame.state;
  ctx.beginPath();
  for (let e = 0; e < edges.length; e += 1) {
    ctx.moveTo(px[edges[e].a], py[edges[e].a]);
    ctx.lineTo(px[edges[e].b], py[edges[e].b]);
  }
  ctx.stroke();
}

/** Nodes retain their established kind colors: bright ones first, then faint ones, one fill per kind each. */
function drawNodes(frame: Frame, view: FrameView): void {
  const { ctx, colors } = frame;
  const kindColors = { note: colors.note, task: colors.task, tag: colors.tag };
  for (let pass = 0; pass < 2; pass += 1) {
    const dimPass = pass === 1;
    ctx.globalAlpha = dimPass ? 0.15 : 1;
    for (let c = 0; c < KINDS.length; c += 1) {
      const kind = KINDS[c];
      ctx.fillStyle = kindColors[kind];
      ctx.beginPath();
      pathNodes(frame, view, kind, dimPass);
      ctx.fill();
    }
  }
}

/** Adds a circle to the path for each node of a kind drawn in view, faint or bright as asked. */
function pathNodes(frame: Frame, view: FrameView, kind: string, dimPass: boolean): void {
  const { ctx, state, settings } = frame;
  const { nodes, px, py } = state;
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].kind !== kind || !view.rendered(i) || !view.inView(i) || isDimmed(state, i) !== dimPass) {
      continue;
    }
    const radius = nodeRadius(state, settings, i);
    ctx.moveTo(px[i] + radius, py[i]);
    ctx.arc(px[i], py[i], radius, 0, 6.2832);
  }
}

/** Selection halo persists; hover halo follows the pointer. */
function drawHalos(frame: Frame, view: FrameView): void {
  const { selectedIndex, hoverIndex } = frame.state;
  if (selectedIndex >= 0 && view.rendered(selectedIndex)) {
    drawHalo(frame, selectedIndex, 4 / view.k);
  }
  if (hoverIndex < 0 || !view.rendered(hoverIndex) || hoverIndex === selectedIndex) {
    return;
  }
  drawHalo(frame, hoverIndex, 3 / view.k);
}

/** A ring around a node, `gap` out from its edge, two screen pixels wide. */
function drawHalo(frame: Frame, index: number, gap: number): void {
  const { ctx, state, settings, colors, camera } = frame;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.halo;
  ctx.lineWidth = 2 / camera.k;
  ctx.beginPath();
  ctx.arc(state.px[index], state.py[index], nodeRadius(state, settings, index) + gap, 0, 6.2832);
  ctx.stroke();
}

/** The labels placed so far in a frame, so no two overlap: group names first, then hubs. */
class PlacedLabels {
  private readonly placed: LabelRect[] = [];

  /** Whether a label would overlap one placed before it. */
  public overlaps(rect: LabelRect): boolean {
    for (let r = 0; r < this.placed.length; r += 1) {
      const other = this.placed[r];
      if (rect.x0 < other.x1 && rect.x1 > other.x0 && rect.y0 < other.y1 && rect.y1 > other.y0) {
        return true;
      }
    }
    return false;
  }

  /** Keeps a label's place. */
  public place(rect: LabelRect): void {
    this.placed.push(rect);
  }
}

/**
 * Labels in screen space. Zoomed in past the threshold every node that is
 * big enough is named; at rest the few best-connected nodes on screen are,
 * so an overview reads as places rather than as density alone.
 */
function drawLabels(frame: Frame, view: FrameView): void {
  const { ctx, state, settings, dpr } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  const monoFont = frame.monoFont() || 'monospace';
  const placed = new PlacedLabels();
  state.labelRects = [];
  if (view.showGroups) {
    drawGroupLabels(frame, view, placed, monoFont);
  }
  if (view.k < settings.labelThreshold) {
    drawHubLabels(frame, view, placed, monoFont);
  }
  if (view.k >= settings.labelThreshold) {
    drawNodeLabels(frame, view);
  }
}

/** Names the largest groups on screen over their discs, as many as fit without overlapping, up to 16. */
function drawGroupLabels(frame: Frame, view: FrameView, placed: PlacedLabels, monoFont: string): void {
  const { ctx, state, camera, colors } = frame;
  const { groups, groupCenters, communityCount } = state;
  const groupPixels = parseFloat(frame.groupFontSize) || 12;
  ctx.font = '700 ' + frame.groupFontSize + ' ' + monoFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.background;
  ctx.fillStyle = colors.label;
  ctx.globalAlpha = view.restFade;
  const order: number[] = [];
  for (let og = 0; og < communityCount; og += 1) {
    if (groups[og] && groupCenters[og]) {
      order.push(og);
    }
  }
  order.sort((left, right) => (groups[right] as GraphGroup).size - (groups[left] as GraphGroup).size || left - right);
  let named = 0;
  for (let o = 0; o < order.length && named < GROUP_LABELS_AT_REST; o += 1) {
    const group = groups[order[o]] as GraphGroup;
    const center = groupCenters[order[o]];
    const gx = center.x * view.k + camera.x;
    const gy = center.y * view.k + camera.y;
    if (gx < -40 || gx > view.width + 40 || gy < -20 || gy > view.height + 20) {
      continue;
    }
    const textWidth = ctx.measureText(group.name).width;
    const rect = { x0: gx - textWidth / 2 - 3, y0: gy - groupPixels / 2 - 3, x1: gx + textWidth / 2 + 3, y1: gy + groupPixels / 2 + 3, key: group.key };
    if (placed.overlaps(rect)) {
      continue;
    }
    placed.place(rect);
    state.labelRects.push(rect);
    ctx.strokeText(group.name, gx, gy);
    ctx.fillText(group.name, gx, gy);
    named += 1;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
}

/** A title as a label says it: cut to 28 characters with an ellipsis. */
function labelTitle(title: string): string {
  return title.length > 28 ? title.slice(0, 27) + '…' : title;
}

/** At rest, names the eight best-connected notes and tasks on screen that are drawn bright, where they fit. */
function drawHubLabels(frame: Frame, view: FrameView, placed: PlacedLabels, monoFont: string): void {
  const { ctx, state, settings, camera, colors } = frame;
  const { nodes, px, py } = state;
  const labelPixels = parseFloat(frame.labelFontSize) || 11;
  ctx.fillStyle = colors.label;
  ctx.font = frame.labelFontSize + ' ' + monoFont;
  ctx.textAlign = 'center';
  const hubs: number[] = [];
  for (let h = 0; h < nodes.length; h += 1) {
    if (!view.rendered(h) || !view.inView(h) || isDimmed(state, h) || nodes[h].kind === 'tag') {
      continue;
    }
    if (nodeDegree(state, h) < 2) {
      continue;
    }
    hubs.push(h);
  }
  hubs.sort((a, b) => nodeDegree(state, b) - nodeDegree(state, a));
  ctx.globalAlpha = 0.85;
  let hubsNamed = 0;
  for (let u = 0; u < hubs.length && hubsNamed < HUB_LABELS_AT_REST; u += 1) {
    const hub = hubs[u];
    const hx = px[hub] * view.k + camera.x;
    const hy = py[hub] * view.k + camera.y + nodeRadius(state, settings, hub) * view.k + 11;
    const hubTitle = labelTitle(nodes[hub].title);
    const hubWidth = ctx.measureText(hubTitle).width;
    const hubRect = { x0: hx - hubWidth / 2, y0: hy - labelPixels, x1: hx + hubWidth / 2, y1: hy + 3 };
    if (placed.overlaps(hubRect)) {
      continue;
    }
    placed.place(hubRect);
    ctx.fillText(hubTitle, hx, hy);
    hubsNamed += 1;
  }
  ctx.globalAlpha = 1;
}

/** Zoomed in past Label fade zoom, names up to 300 of the nodes drawn bright and big enough, the best-connected first. */
function drawNodeLabels(frame: Frame, view: FrameView): void {
  const { ctx, state, settings, camera, colors } = frame;
  const { nodes, px, py } = state;
  const { k } = view;
  ctx.fillStyle = colors.label;
  ctx.font = frame.labelFontSize + ' ' + (frame.monoFont() || 'monospace');
  ctx.textAlign = 'center';
  const labeled: number[] = [];
  for (let l = 0; l < nodes.length; l += 1) {
    if (!view.rendered(l) || !view.inView(l) || isDimmed(state, l)) {
      continue;
    }
    if (nodeRadius(state, settings, l) * k <= 8) {
      continue;
    }
    labeled.push(l);
  }
  labeled.sort((a, b) => nodeDegree(state, b) - nodeDegree(state, a));
  const maxLabels = Math.min(labeled.length, 300);
  const fade = Math.min(1, (k - settings.labelThreshold) / 0.5 + 0.35);
  ctx.globalAlpha = fade;
  for (let t = 0; t < maxLabels; t += 1) {
    const index = labeled[t];
    const sx = px[index] * k + camera.x;
    const sy = py[index] * k + camera.y;
    const title = labelTitle(nodes[index].title);
    ctx.fillText(title, sx, sy + nodeRadius(state, settings, index) * k + 11);
  }
  ctx.globalAlpha = 1;
}
