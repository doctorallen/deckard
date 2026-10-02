/**
 * The Notes Graph's canvas under the pointer and the keyboard: zoom with
 * the wheel, drag a node or pan the view, hover for a node's tooltip,
 * click a node to select it or a group's name to pick it out, and walk the
 * nodes with the arrows. Listened to outside Preact, on the one canvas
 * element it draws.
 */
import { toWorld } from './camera';
import {
  centerOnNode,
  type GraphPage,
  hideTooltip,
  keep,
  nodeAt,
  openNode,
  reheat,
  scheduleFrame,
  selectNode,
  send,
  setGroup,
  zoomAt,
} from './graphPage';
import { isRendered } from './model';
import { describeNode } from './status';
import { findNodeIndex, setHoverIndex, setSelectedIndex } from './view';

/** The pointer pressed on the canvas, from its press to its release. */
interface PointerPress {
  id: number;
  downAt: { x: number; y: number } | null;
  moved: boolean;
  panning: boolean;
  /** The group whose name it was pressed on, which a click picks out. */
  label: string;
}

/** Listens to the canvas for the pointer, the wheel, and the keyboard. */
export function listenToCanvas(page: GraphPage): void {
  const { canvas } = page;
  const press: PointerPress = { id: -1, downAt: null, moved: false, panning: false, label: '' };
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(page, event, Math.exp(-event.deltaY * 0.002));
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => pressPointer(page, press, event));
  canvas.addEventListener('pointermove', (event) => movePointer(page, press, event));
  canvas.addEventListener('keydown', (event) => onKey(page, event));
  canvas.addEventListener('pointerup', (event) => endPointer(page, press, event));
  canvas.addEventListener('pointercancel', (event) => endPointer(page, press, event));
  canvas.addEventListener('pointerleave', () => {
    if (press.id !== -1 || page.state.hoverIndex === -1) {
      return;
    }
    setHoverIndex(page.state, findNodeIndex(page.state, page.state.externalHoverNodeId));
    canvas.classList.remove('is-pointing');
    hideTooltip(page);
    scheduleFrame(page);
  });
}

/**
 * A press on a group's name, tested before the nodes under it, will pick
 * the group out on a click and pan on a drag; a press on a node drags it;
 * a press anywhere else pans.
 */
function pressPointer(page: GraphPage, press: PointerPress, event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }
  const { canvas, state } = page;
  press.id = event.pointerId;
  press.downAt = { x: event.clientX, y: event.clientY };
  press.moved = false;
  press.label = groupLabelAt(page, event);
  const world = toWorld(canvas, page.camera, event);
  const hit = press.label ? -1 : nodeAt(page, world.x, world.y);
  if (hit >= 0) {
    state.dragIndex = hit;
    state.vx[hit] = 0;
    state.vy[hit] = 0;
  } else {
    press.panning = true;
    canvas.classList.add('is-panning');
  }
  canvas.setPointerCapture(event.pointerId);
}

/** Pans or drags while pressed; otherwise hovers the node under the pointer and shows its tooltip. */
function movePointer(page: GraphPage, press: PointerPress, event: PointerEvent): void {
  const { canvas, state } = page;
  if (press.id === event.pointerId && press.downAt && dragOrPan(page, press, event)) {
    return;
  }
  const hoverWorld = toWorld(canvas, page.camera, event);
  const hovered = nodeAt(page, hoverWorld.x, hoverWorld.y);
  if (hovered !== state.hoverIndex) {
    setHoverIndex(state, hovered);
    canvas.classList.toggle('is-pointing', hovered >= 0);
    scheduleFrame(page);
  }
  if (hovered >= 0) {
    showTooltip(page, hovered, event);
  } else {
    hideTooltip(page);
  }
}

/** Pans the view, or moves the node dragged, heating the graph; says whether the pointer did either. */
function dragOrPan(page: GraphPage, press: PointerPress, event: PointerEvent): boolean {
  const { state } = page;
  const downAt = press.downAt as { x: number; y: number };
  const movedX = event.clientX - downAt.x;
  const movedY = event.clientY - downAt.y;
  if (Math.abs(movedX) + Math.abs(movedY) > 3) {
    press.moved = true;
  }
  if (press.panning) {
    page.camera.x += event.movementX;
    page.camera.y += event.movementY;
    scheduleFrame(page);
    return true;
  }
  if (state.dragIndex < 0) {
    return false;
  }
  const world = toWorld(page.canvas, page.camera, event);
  state.px[state.dragIndex] = world.x;
  state.py[state.dragIndex] = world.y;
  state.vx[state.dragIndex] = 0;
  state.vy[state.dragIndex] = 0;
  reheat(page, 0.3);
  return true;
}

/** The key of the group whose name is drawn under a point of the page, or ''. */
function groupLabelAt(page: GraphPage, point: { clientX: number; clientY: number }): string {
  const rect = page.canvas.getBoundingClientRect();
  const x = point.clientX - rect.left;
  const y = point.clientY - rect.top;
  for (let r = 0; r < page.state.labelRects.length; r += 1) {
    const label = page.state.labelRects[r];
    if (x >= label.x0 && x <= label.x1 && y >= label.y0 && y <= label.y1) {
      return label.key as string;
    }
  }
  return '';
}

/**
 * The end of a press: a drag heats the graph; a click on a group's name
 * picks it out, or lets it go; a click on a node selects it, and with Cmd
 * or Ctrl opens its source, with Alt beside the graph; a click on nothing
 * clears the selection. The camera is kept either way.
 */
function endPointer(page: GraphPage, press: PointerPress, event: PointerEvent): void {
  const { canvas, state } = page;
  if (press.id !== event.pointerId) {
    return;
  }
  const wasDrag = state.dragIndex;
  const clicked = !press.moved;
  const label = press.label;
  press.label = '';
  state.dragIndex = -1;
  press.panning = false;
  press.id = -1;
  press.downAt = null;
  canvas.classList.remove('is-panning');
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  if (wasDrag >= 0 && !clicked) {
    reheat(page, 0.3);
    keep(page);
    return;
  }
  keep(page);
  if (!clicked) {
    return;
  }
  clickCanvas(page, { label, node: wasDrag, event });
}

/** What a click on the canvas landed on. */
interface CanvasClick {
  readonly label: string;
  readonly node: number;
  readonly event: PointerEvent;
}

/** A click on a group's name, a node, or nothing. */
function clickCanvas(page: GraphPage, click: CanvasClick): void {
  const { label, node, event } = click;
  if (label) {
    setGroup(page, page.settings.group === label ? '' : label);
    page.redraw();
    return;
  }
  if (node >= 0) {
    // Cmd/Ctrl+click opens the source, and Alt+click opens it beside the
    // graph; a plain click selects the node and surfaces direct graph
    // connections in the sidebar.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      openNode(page, node, event.altKey);
    } else {
      selectNode(page, node);
    }
    return;
  }
  if (page.state.selectedIndex < 0) {
    return;
  }
  setSelectedIndex(page.state, -1);
  send({ type: 'clearSelection' });
  scheduleFrame(page);
}

/**
 * Move the selection between nodes without a pointer.
 *
 * The graph is a canvas, so there is nothing for Tab to land on inside it:
 * without this the whole view could be looked at but never used from the
 * keyboard. Nodes are visited in the order they are drawn, and the camera
 * follows the selection so it is never off screen. Escape clears the
 * selection, and Enter or Space opens it, with Alt beside the graph, as
 * Alt does on a click.
 */
function onKey(page: GraphPage, event: KeyboardEvent): void {
  const { state } = page;
  if (event.key === 'Escape') {
    setSelectedIndex(state, -1);
    // Sent even when the page shows no selection, since the host may hold
    // one the page could not find, such as a node it has since left out.
    send({ type: 'clearSelection' });
    scheduleFrame(page);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    if (state.selectedIndex >= 0) {
      event.preventDefault();
      openNode(page, state.selectedIndex, event.altKey);
    }
    return;
  }
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  if (!forward && !backward) {
    return;
  }
  event.preventDefault();
  stepSelection(page, forward);
}

/** Selects the next node drawn, or the one before, from the selection or from either end, and brings it into view. */
function stepSelection(page: GraphPage, forward: boolean): void {
  const { state, settings } = page;
  const visible: number[] = [];
  for (let i = 0; i < state.nodes.length; i += 1) {
    if (isRendered(state, settings, i)) {
      visible.push(i);
    }
  }
  if (!visible.length) {
    return;
  }
  const current = visible.indexOf(state.selectedIndex);
  let next = (current + (forward ? 1 : -1) + visible.length) % visible.length;
  if (current < 0) {
    next = forward ? 0 : visible.length - 1;
  }
  selectNode(page, visible[next]);
  centerOnNode(page, visible[next]);
}

/** Shows a node's title and what it is joined by beside the pointer, kept inside the window. */
function showTooltip(page: GraphPage, index: number, point: { clientX: number; clientY: number }): void {
  const tooltip = page.refs.tooltip.current as HTMLElement;
  const node = page.state.nodes[index];
  tooltip.textContent = '';
  const title = document.createElement('div');
  title.className = 'tooltip-title';
  title.textContent = node.title;
  tooltip.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'tooltip-meta';
  meta.textContent = describeNode(node);
  tooltip.appendChild(meta);
  tooltip.style.display = 'block';
  const offset = 14;
  const maxX = window.innerWidth - tooltip.offsetWidth - 8;
  const maxY = window.innerHeight - tooltip.offsetHeight - 8;
  tooltip.style.left = Math.min(point.clientX + offset, maxX) + 'px';
  tooltip.style.top = Math.min(point.clientY + offset, maxY) + 'px';
}
