/**
 * What the Notes Graph keeps across a reload with `setState`: the 12
 * settings the reader sets and the camera (row 23 of the persisted-formats
 * inventory, which kept 23 until the layout's were fixed).
 *
 * Read back as the page script read them: any saved value but `undefined`
 * is taken as it is, of whatever type, and the default stands for the rest;
 * a camera is taken when its zoom is a finite number. Kept as the script
 * kept them: every setting in the order of the defaults, then the camera.
 * A layout value an older page kept, such as `repelStrength`, is not read:
 * the layout is fixed, so nothing of it migrates.
 */
import type { Camera } from './canvas';
import type { GraphLayout, GraphSettings, ReaderGraphSettings } from './model';
import { vscodeApi } from '../shared/vscode';

/** Each setting as a new page starts, in the order the page keeps them. */
export const DEFAULT_SETTINGS: Readonly<ReaderGraphSettings> = {
  showNotes: true,
  showTasks: true,
  showTags: false,
  showOrphans: true,
  showParked: false,
  onlyWrittenLinks: false,
  selectedTags: [],
  group: '',
  search: '',
  nodeSize: 1,
  linkDensity: 0.3,
  headings: 'zoom',
};

/** The layout every graph is drawn with: the defaults its controls had. */
export const GRAPH_LAYOUT: Readonly<GraphLayout> = {
  linkThickness: 1,
  tagSpecificity: 0.9,
  bridgeStrength: 0.15,
  showAllLinks: false,
  labelThreshold: 1.4,
  centerStrength: 0.4,
  clusterCohesion: 1.5,
  communitySpacing: 1.2,
  repelStrength: 220,
  linkStrength: 1,
  linkDistance: 32,
};

/** The names of the settings the reader sets, in the order the page keeps them. */
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof ReaderGraphSettings)[];

/** What VS Code kept for the page, or an empty record when it kept nothing; read field by field, of any type. */
export function readKept(): Record<string, unknown> {
  return (vscodeApi().getState() || {}) as Record<string, unknown>;
}

/** The settings kept, each as it was saved unless it was not saved at all, with the fixed layout. */
export function readSettings(saved: Record<string, unknown>): GraphSettings {
  const settings = {} as Record<string, unknown>;
  SETTING_KEYS.forEach((key) => {
    settings[key] = saved[key] === undefined ? DEFAULT_SETTINGS[key] : saved[key];
  });
  return { ...(settings as unknown as ReaderGraphSettings), ...GRAPH_LAYOUT };
}

/** The camera kept, when it has a finite zoom; else the view at the origin, unzoomed. */
export function readCamera(saved: Record<string, unknown>): Camera {
  const savedCamera = saved.camera as Camera | undefined;
  return savedCamera && isFinite(savedCamera.k)
    ? { x: savedCamera.x, y: savedCamera.y, k: savedCamera.k }
    : { x: 0, y: 0, k: 1 };
}

/** Keeps every setting the reader sets and the camera, replacing whatever was kept before. */
export function persist(settings: GraphSettings, camera: Camera): void {
  const state: Record<string, unknown> = {};
  SETTING_KEYS.forEach((key) => {
    state[key] = settings[key];
  });
  state.camera = { x: camera.x, y: camera.y, k: camera.k };
  vscodeApi().setState(state);
}

/** Every setting the reader sets back to its default; the picked tags as a new list. */
export function resetSettings(settings: GraphSettings): void {
  const target = settings as unknown as Record<string, unknown>;
  SETTING_KEYS.forEach((key) => {
    const value = DEFAULT_SETTINGS[key];
    target[key] = Array.isArray(value) ? value.slice() : value;
  });
}
