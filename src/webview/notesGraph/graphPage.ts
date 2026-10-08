/**
 * The Notes Graph page's running state and what changes it: the frame loop
 * that ticks the simulation and draws the canvas, the rebuild from a
 * snapshot or a setting, the camera, the selection, the group picked, and
 * Reset with its Undo.
 *
 * What the controls show is kept in `ui` and drawn by `redraw`, which
 * renders the controls with Preact at once (decision 0014); each change
 * here sets what the template's script wrote to the DOM at the same point.
 */
import type { NotesGraphMessage } from '../../ui/protocol/notesGraph';
import { post } from '../shared/vscode';
import { centerCamera, type ClientPoint, fitCamera, zoomCamera } from './camera';
import { type Camera, drawGraph, type GraphColors } from './canvas';
import { type ControlRefs, type ControlsState, OPEN_A_NOTE } from './controls';
import { type GraphSettings, type GraphState, isRendered, nodeRadius } from './model';
import { persist, resetSettings, SETTING_KEYS } from './settings';
import { tick } from './simulation';
import { describeStatus } from './status';
import {
  buildView,
  findNodeIndex,
  recomputeGroupMatch,
  recomputeSearchMatches,
  recomputeTagMatches,
  setHoverIndex,
  setSelectedIndex,
  shouldFoldHeadings,
} from './view';

/** How the canvas paints, read once from the theme when the page starts. */
export interface GraphLook {
  readonly colors: GraphColors;
  readonly forcedColors: boolean;
  readonly labelFontSize: string;
  readonly groupFontSize: string;
  /** The root's computed style, read again for the monospace font at each frame. */
  readonly rootStyles: CSSStyleDeclaration;
}

/** What the reader had arranged before a reset, so Undo can put it back. */
export interface ResetSnapshot {
  readonly settings: Record<string, unknown>;
  readonly camera: Camera;
  readonly tagSearch: string;
}

/** The Notes Graph page as it runs. */
export interface GraphPage {
  readonly state: GraphState;
  readonly settings: GraphSettings;
  camera: Camera;
  /** The device pixel ratio the canvas was last sized for. */
  dpr: number;
  readonly look: GraphLook;
  /** Set once the controls are first drawn. */
  canvas: HTMLCanvasElement;
  /**
   * The canvas's 2D context, taken with the canvas. A webview always gives
   * a fresh canvas one, and so does the page harness the tests open.
   */
  ctx: CanvasRenderingContext2D;
  /** Whether the next frame draws even if the simulation is at rest. */
  needsDraw: boolean;
  /** Whether a frame is asked for. */
  frameQueued: boolean;
  ui: ControlsState;
  readonly refs: ControlRefs;
  /** Draws the controls from `ui` and the settings, at once. */
  redraw: () => void;
  resetSnapshot: ResetSnapshot | null;
  resetUndoTimer: number;
  searchTimer: number;
  /** The nodes drawn in the last frame, by 64-unit cell of the world, for hit testing. */
  hitGrid: Record<string, number[]>;
}

/** Sends the host one of the messages the Notes Graph may send. */
export function send(message: NotesGraphMessage): void {
  post(message);
}

/** Keeps the settings and the camera. */
export function keep(page: GraphPage): void {
  persist(page.settings, page.camera);
}

/** Asks for a frame, which draws even if the simulation is at rest. */
export function scheduleFrame(page: GraphPage): void {
  page.needsDraw = true;
  if (page.frameQueued) {
    return;
  }
  page.frameQueued = true;
  requestAnimationFrame(() => frame(page));
}

/**
 * One frame: headings fold or unfold if the zoom crossed Label fade zoom
 * past a little give either way; the simulation ticks for up to 8 ms while
 * it is hot; the canvas is drawn if anything moved or was asked; and
 * another frame is asked for while the simulation is hot.
 */
function frame(page: GraphPage): void {
  page.frameQueued = false;
  const { state, settings } = page;
  if (state.snapshot && settings.headings === 'zoom' && state.headingsFolded !== null &&
      shouldFoldHeadings(state, settings, page.camera) !== state.headingsFolded) {
    rebuildView(page);
    page.redraw();
  }
  const start = performance.now();
  let ticked = false;
  while (state.alpha > 0 && performance.now() - start < 8) {
    tick(state, settings);
    ticked = true;
  }
  if (ticked || page.needsDraw) {
    page.needsDraw = false;
    draw(page);
    rebuildHitGrid(page);
  }
  (page.refs.simNote.current as HTMLElement).hidden = state.alpha <= 0;
  if (state.alpha <= 0) {
    return;
  }
  page.frameQueued = true;
  requestAnimationFrame(() => frame(page));
}

/** Draws the canvas, then says the zoom. */
function draw(page: GraphPage): void {
  const { look } = page;
  drawGraph({
    canvas: page.canvas,
    ctx: page.ctx,
    state: page.state,
    settings: page.settings,
    camera: page.camera,
    dpr: page.dpr,
    colors: look.colors,
    forcedColors: look.forcedColors,
    labelFontSize: look.labelFontSize,
    groupFontSize: look.groupFontSize,
    monoFont: () => look.rootStyles.getPropertyValue('--font-mono'),
  });
  (page.refs.zoomReadout.current as HTMLElement).textContent = Math.round(page.camera.k * 100) + '%';
}

/** The size of a hit-testing cell, in world units. */
const HIT_CELL = 64;

/** Files each node drawn by the cell it is in. */
function rebuildHitGrid(page: GraphPage): void {
  const { state, settings } = page;
  page.hitGrid = {};
  for (let i = 0; i < state.nodes.length; i += 1) {
    if (!isRendered(state, settings, i)) {
      continue;
    }
    const key = Math.floor(state.px[i] / HIT_CELL) + ':' + Math.floor(state.py[i] / HIT_CELL);
    (page.hitGrid[key] || (page.hitGrid[key] = [])).push(i);
  }
}

/** The node under a point of the world, the nearest within its reach, or -1. */
export function nodeAt(page: GraphPage, worldX: number, worldY: number): number {
  const cellX = Math.floor(worldX / HIT_CELL);
  const cellY = Math.floor(worldY / HIT_CELL);
  const nearest = { index: -1, dist: Infinity };
  for (let gx = cellX - 1; gx <= cellX + 1; gx += 1) {
    for (let gy = cellY - 1; gy <= cellY + 1; gy += 1) {
      nearestIn(page, page.hitGrid[gx + ':' + gy], { x: worldX, y: worldY }, nearest);
    }
  }
  return nearest.index;
}

/**
 * Takes the node of one cell nearest a point, within its radius or 8 screen
 * pixels, whichever reaches farther, and 2 more, if it is nearer than the
 * nearest so far.
 */
function nearestIn(
  page: GraphPage,
  bucket: readonly number[] | undefined,
  point: { x: number; y: number },
  nearest: { index: number; dist: number },
): void {
  if (!bucket) {
    return;
  }
  const { state, settings, camera } = page;
  for (let b = 0; b < bucket.length; b += 1) {
    const index = bucket[b];
    const dx = state.px[index] - point.x;
    const dy = state.py[index] - point.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const reach = Math.max(nodeRadius(state, settings, index), 8 / camera.k) + 2 / camera.k;
    if (dist <= reach && dist < nearest.dist) {
      nearest.index = index;
      nearest.dist = dist;
    }
  }
}

/** Heats the simulation to at least `target`, and asks for a frame. */
export function reheat(page: GraphPage, target: number): void {
  page.state.alpha = Math.max(page.state.alpha, target);
  scheduleFrame(page);
}

/** Sizes the canvas to its box at the device's pixel ratio, and asks for a frame. */
export function resizeCanvas(page: GraphPage): void {
  const { canvas } = page;
  page.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * page.dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * page.dpr));
  scheduleFrame(page);
}

/**
 * Rebuilds the graph drawn from the last snapshot, then finds the hover
 * and the selection again, a file's selection moving to its first heading
 * when it unfolds, and the host told when the selection is gone; heats the simulation, gently when nodes kept their
 * places; says the status; and frames the graph the first time.
 */
export function rebuildView(page: GraphPage, repositionCommunities?: boolean): void {
  const { state, settings } = page;
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }
  // A node held under the pointer is held by id: the new graph may number
  // it differently, or no longer hold it.
  const draggedId = state.dragIndex >= 0 && state.nodes[state.dragIndex] ? state.nodes[state.dragIndex].id : null;
  const rebuilt = buildView(state, settings, page.camera, repositionCommunities);
  state.dragIndex = findNodeIndex(state, draggedId);
  if (rebuilt.groupGone) {
    keep(page);
  }
  recomputeSearchMatches(state, settings);
  recomputeTagMatches(state, settings);
  recomputeGroupMatch(state, settings);
  renderGroupList(page);
  setHoverIndex(state, findNodeIndex(state, state.externalHoverNodeId));
  hideTooltip(page);
  restoreSelection(state, rebuilt.previousFoldMembers);
  state.alpha = rebuilt.reusedAny && state.hasFramed ? 0.3 : 1;
  updateStatus(page);
  page.ui = { ...page.ui, emptyDisplay: snapshot.nodes.length + (snapshot.hiddenNodeCount || 0) === 0 ? 'grid' : 'none', emptyNote: describeEmpty(snapshot) };
  if (!state.hasFramed && state.nodes.length > 0) {
    fitToView(page);
    state.hasFramed = true;
  }
  scheduleFrame(page);
}

/**
 * Finds the selection again in a rebuilt graph, a file's selection moving
 * to its first heading when it unfolds. A selection the graph left out,
 * by a filter or a new graph, is let go, and the host is told, so Related
 * Notes, which lists what it is joined to, lets it go too.
 */
function restoreSelection(state: GraphState, previousFoldMembers: Record<string, string[]>): void {
  const selectedId = state.selectedId;
  let restored = findNodeIndex(state, selectedId);
  if (restored < 0 && selectedId && previousFoldMembers[selectedId]) {
    restored = findNodeIndex(state, previousFoldMembers[selectedId][0]);
  }
  setSelectedIndex(state, restored);
  if (selectedId !== null && restored < 0) {
    send({ type: 'clearSelection' });
  }
}

/**
 * What the empty graph says when it is drawn around a note the graph holds
 * nothing of, such as a new, empty one, in a workspace that has notes;
 * otherwise undefined, and it says the workspace has none.
 */
function describeEmpty(snapshot: NonNullable<GraphState['snapshot']>): string | undefined {
  const focus = snapshot.focus;
  if (!focus || !focus.local || !focus.title || !focus.workspaceNodeCount) {
    return undefined;
  }
  return 'Nothing in ' + focus.title + ' to draw yet — write in it and save, or turn off Around this note to see the whole workspace.';
}

/**
 * Lets go of the tags picked that a new graph's checklist does not offer,
 * such as a neighborhood without them: kept, they would dim every node,
 * with no box in the list to uncheck. The status line names them, by the
 * labels the last graph gave them.
 */
export function dropMissingTags(page: GraphPage, snapshot: { readonly tags: readonly (readonly [string, string, number])[] }, labels: Record<string, string>): void {
  const offered = new Set(snapshot.tags.map(([key]) => key));
  const { settings, state } = page;
  const gone = settings.selectedTags.filter((key) => !offered.has(key));
  if (!gone.length) {
    state.tagNotice = '';
    return;
  }
  settings.selectedTags = settings.selectedTags.filter((key) => offered.has(key));
  keep(page);
  state.tagNotice = (gone.length === 1 ? 'Tag ' : 'Tags ') + gone.map((key) => labels[key] || key).join(', ') +
    ' no longer there — let go';
}

/** The Group list takes the group picked; its options are the groups named now. */
export function renderGroupList(page: GraphPage): void {
  page.ui = { ...page.ui, groupValue: page.settings.group || '' };
}

/** The status line and the legend, once there is a graph. */
export function updateStatus(page: GraphPage): void {
  if (!page.state.snapshot) {
    return;
  }
  page.ui = { ...page.ui, status: { text: describeStatus(page.state, page.settings), joinedShown: page.state.hasJoinedEdges } };
}

/** The tag checklist, under the tag filter as it reads now, once there is a graph. */
export function renderTagList(page: GraphPage): void {
  const snapshot = page.state.snapshot;
  if (!snapshot) {
    return;
  }
  const filter = (page.refs.tagSearch.current as HTMLInputElement).value;
  page.ui = { ...page.ui, tagList: { tags: [...snapshot.tags], filter } };
}

/** Says which note the graph is drawn around, and what that costs. */
export function updateFocus(page: GraphPage): void {
  const snapshot = page.state.snapshot;
  const focus = snapshot && snapshot.focus;
  if (!focus) {
    return;
  }
  const graph = snapshot as NonNullable<typeof snapshot>;
  const depth = String(focus.depth || 1);
  let note = OPEN_A_NOTE;
  if (focus.title) {
    note = focus.local
      ? focus.title + ' · ' + (graph.nodes.length + (graph.hiddenNodeCount || 0)) +
        ' of ' + focus.workspaceNodeCount + ' nodes'
      : 'Around ' + focus.title + ', when this is on.';
  }
  page.ui = {
    ...page.ui,
    focus: { local: Boolean(focus.local), skipPeriodic: focus.skipPeriodic !== false, skipDisabled: !focus.local, depth, note },
  };
}

/** Puts the tooltip away. */
export function hideTooltip(page: GraphPage): void {
  (page.refs.tooltip.current as HTMLElement).style.display = 'none';
}

/** Picks one group out, or every group back with an empty key, and frames it. */
export function setGroup(page: GraphPage, key: string): void {
  const { state, settings } = page;
  settings.group = state.groupKeyIndex[key] === undefined ? '' : key;
  state.groupNotice = '';
  keep(page);
  recomputeGroupMatch(state, settings);
  renderGroupList(page);
  updateStatus(page);
  if (state.groupMatch) {
    const members: number[] = [];
    for (let i = 0; i < state.nodes.length; i += 1) {
      if (state.groupMatch[i] && state.nodes[i].kind !== 'tag') {
        members.push(i);
      }
    }
    fitToView(page, members);
  } else {
    scheduleFrame(page);
  }
}

/** Zooms about a point on the page, and keeps the camera. */
export function zoomAt(page: GraphPage, point: ClientPoint, factor: number): void {
  zoomCamera(page.canvas, page.camera, point, factor);
  keep(page);
  scheduleFrame(page);
}

/** Frames the whole graph, or only the nodes at the indices given, and keeps the camera. */
export function fitToView(page: GraphPage, indices?: readonly number[]): void {
  if (!fitCamera(page.canvas, page.camera, page.state, indices)) {
    return;
  }
  keep(page);
  scheduleFrame(page);
}

/** Brings a node into view, keeping the current zoom. */
export function centerOnNode(page: GraphPage, index: number): void {
  centerCamera(page.canvas, page.camera, page.state, index);
  keep(page);
  scheduleFrame(page);
}

/** Selects a node and tells the host; a folded file is known to the host by its first heading. */
export function selectNode(page: GraphPage, index: number): void {
  setSelectedIndex(page.state, index);
  scheduleFrame(page);
  const node = page.state.nodes[index];
  if (node) {
    send({ type: 'selectNode', nodeId: node.selectId || node.id });
  }
}

/**
 * Opens a tag node's page, or a note or task node at its line, beside the
 * graph when asked, and where `deckard.openNotesIn` does not when Shift was held.
 */
export function openNode(page: GraphPage, index: number, beside: boolean, opposite = false): void {
  const node = page.state.nodes[index];
  if (!node) {
    return;
  }
  if (node.kind === 'tag') {
    send({ type: 'openTag', tagKey: node.id.slice(4) });
    return;
  }
  if (!node.filePath || !node.line) {
    return;
  }
  send({
    type: 'openSource',
    filePath: node.filePath,
    line: node.line,
    ...(beside ? { beside: true } : {}),
    ...(opposite ? { opposite: true } : {}),
  });
}

/**
 * The host sends only the kinds of node shown, so it is told which. The
 * page still filters by kind itself, which covers the moment between a
 * toggle and the graph the host sends back.
 */
export function sendFilter(page: GraphPage): void {
  send({
    type: 'setGraphFilter',
    showNotes: Boolean(page.settings.showNotes),
    showTasks: Boolean(page.settings.showTasks),
  });
}

/** Puts the controls the settings do not draw in step with them, after a reset or an undo. */
function applySettingsToControls(page: GraphPage): void {
  (page.refs.search.current as HTMLInputElement).value = page.settings.search;
  page.ui = { ...page.ui, groupValue: page.settings.group || '' };
}

/**
 * Restores every control and filter, clears node momentum, and reframes
 * the graph, with Undo offered for a few seconds.
 */
export function resetGraphSettings(page: GraphPage): void {
  const { state } = page;
  const tagSearch = page.refs.tagSearch.current as HTMLInputElement;
  // What the reader had arranged, so the reset can be taken back.
  const previous: ResetSnapshot = {
    settings: JSON.parse(JSON.stringify(page.settings)) as Record<string, unknown>,
    camera: { x: page.camera.x, y: page.camera.y, k: page.camera.k },
    tagSearch: tagSearch.value,
  };
  resetSettings(page.settings);
  applySettingsToControls(page);
  sendFilter(page);
  tagSearch.value = '';
  window.clearTimeout(page.searchTimer);
  page.camera = { x: 0, y: 0, k: 1 };
  state.hasFramed = false;
  keep(page);
  renderTagList(page);
  rebuildView(page, true);
  state.vx.fill(0);
  state.vy.fill(0);
  reheat(page, 1);
  showResetUndo(page, previous);
}

/** How long Reset's Undo is offered. */
const RESET_UNDO_MS = 8000;
/** How long "Graph settings restored." is said. */
const RESTORED_MS = 3000;

/**
 * Withdraws Reset's offer of Undo, or the word that it was taken, and draws
 * the controls without it unless `draw` is false. Undo, taken or run out
 * while it has the focus, would leave the focus nowhere when it goes, so
 * the focus goes back to Reset graph, where the reset was asked for.
 */
export function clearResetUndo(page: GraphPage, draw = true): void {
  window.clearTimeout(page.resetUndoTimer);
  page.resetSnapshot = null;
  page.ui = { ...page.ui, resetUndo: 'none' };
  if (!draw) {
    return;
  }
  const hadFocus = (page.refs.resetUndo.current as HTMLElement).contains(document.activeElement);
  page.redraw();
  if (hadFocus) {
    (document.getElementById('reset-graph-settings') as HTMLElement).focus();
  }
}

/**
 * A reset discards an arrangement that may have taken a while, so Undo is
 * offered beside it for a few seconds, with the focus on it.
 */
function showResetUndo(page: GraphPage, previous: ResetSnapshot): void {
  window.clearTimeout(page.resetUndoTimer);
  page.resetSnapshot = previous;
  page.ui = { ...page.ui, resetUndo: 'offer' };
  page.redraw();
  ((page.refs.resetUndo.current as HTMLElement).querySelector('button') as HTMLElement).focus();
  page.resetUndoTimer = window.setTimeout(() => clearResetUndo(page), RESET_UNDO_MS);
}

/** Puts back what the reader had arranged before the reset, and says so. */
export function undoGraphReset(page: GraphPage): void {
  const previous = page.resetSnapshot;
  if (!previous) {
    return;
  }
  clearResetUndo(page);
  const settings = page.settings as unknown as Record<string, unknown>;
  SETTING_KEYS.forEach((key) => {
    settings[key] = previous.settings[key];
  });
  applySettingsToControls(page);
  sendFilter(page);
  (page.refs.tagSearch.current as HTMLInputElement).value = previous.tagSearch;
  page.camera = { x: previous.camera.x, y: previous.camera.y, k: previous.camera.k };
  page.state.hasFramed = true;
  keep(page);
  renderTagList(page);
  rebuildView(page, true);
  reheat(page, 1);
  page.ui = { ...page.ui, resetUndo: 'restored' };
  page.redraw();
  page.resetUndoTimer = window.setTimeout(() => clearResetUndo(page), RESTORED_MS);
}

/**
 * Any later change makes the reset's snapshot stale, so the offer goes. It
 * is heard before the control that changed, as the template heard it, and
 * is drawn by that control's handler, or after it: a draw before the
 * handler would put the control back to the setting it is changing.
 */
export function dismissResetUndo(page: GraphPage, event: Event): void {
  if (page.resetSnapshot && !(page.refs.resetUndo.current as HTMLElement).contains(event.target as Node)) {
    clearResetUndo(page, false);
  }
}
