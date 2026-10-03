/**
 * Where the Notes Graph's view looks, worked out from the graph and the
 * canvas: a zoom about a point, framing nodes, and centering one. Each
 * changes the camera it is given in place, as the page script's did.
 */
import type { Camera } from './canvas';
import type { GraphState } from './model';

/** The closest the view zooms in. */
const MAXIMUM_ZOOM = 8;
/** The farthest it zooms out. */
const MINIMUM_ZOOM = 0.02;

/** A point on the page, in the coordinates pointer events carry. */
export interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/** A point on the page as the world under it, at the camera's pan and zoom. */
export function toWorld(canvas: HTMLCanvasElement, camera: Camera, point: ClientPoint): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (point.clientX - rect.left - camera.x) / camera.k,
    y: (point.clientY - rect.top - camera.y) / camera.k,
  };
}

/** Zooms by `factor` about a point on the page, which stays where it is, within the zoom's limits. */
export function zoomCamera(canvas: HTMLCanvasElement, camera: Camera, point: ClientPoint, factor: number): void {
  const rect = canvas.getBoundingClientRect();
  const mx = point.clientX - rect.left;
  const my = point.clientY - rect.top;
  const next = Math.min(MAXIMUM_ZOOM, Math.max(MINIMUM_ZOOM, camera.k * factor));
  camera.x = mx - (mx - camera.x) * (next / camera.k);
  camera.y = my - (my - camera.y) * (next / camera.k);
  camera.k = next;
}

/**
 * Frames the whole graph, or only the nodes at the indices given, with 40
 * pixels around them. Says whether there was anything to frame.
 */
export function fitCamera(canvas: HTMLCanvasElement, camera: Camera, state: GraphState, indices?: readonly number[]): boolean {
  if (state.nodes.length === 0) {
    return false;
  }
  const { px, py } = state;
  const subset = Array.isArray(indices) && indices.length ? indices : null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let f = 0; f < (subset ? subset.length : state.nodes.length); f += 1) {
    const i = subset ? subset[f] : f;
    if (px[i] < minX) {
      minX = px[i];
    }
    if (px[i] > maxX) {
      maxX = px[i];
    }
    if (py[i] < minY) {
      minY = py[i];
    }
    if (py[i] > maxY) {
      maxY = py[i];
    }
  }
  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 600;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const k = Math.min(MAXIMUM_ZOOM, Math.max(MINIMUM_ZOOM, Math.min(
    (width - 80) / spanX,
    (height - 80) / spanY,
  )));
  camera.k = k;
  camera.x = width / 2 - (minX + spanX / 2) * k;
  camera.y = height / 2 - (minY + spanY / 2) * k;
  return true;
}

/** Brings a node to the middle of the view, keeping the current zoom. */
export function centerCamera(canvas: HTMLCanvasElement, camera: Camera, state: GraphState, index: number): void {
  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 600;
  camera.x = width / 2 - state.px[index] * camera.k;
  camera.y = height / 2 - state.py[index] * camera.k;
}
