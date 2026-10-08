/**
 * The Notes Graph page: a full-viewport Canvas 2D force-directed graph with
 * Obsidian-style Focus, Filters, Display, Forces, and Relationships panels
 * over it.
 *
 * The host sends whole snapshots, and the page does every render and
 * filter itself. The simulation is a hand-rolled velocity-Verlet loop with
 * Barnes-Hut repulsion, time-budgeted per animation frame, so graphs with
 * thousands of nodes stay interactive while they converge. Preact draws
 * the controls into the body; the canvas is drawn by the frame loop
 * outside it.
 *
 * The page is kept running while hidden, so its layout survives a hide
 * (Q1 of docs/implementation/20-webviews.md); its settings and camera are
 * kept with `setState` for a reload.
 */
import { createRef, render } from 'preact';

import type { MessageOf } from '../../ui/protocol/messaging';
import type { NotesGraphHostToPage, NotesGraphWireSnapshot } from '../../ui/protocol/notesGraph';
import { installTip } from '../shared/tip';
import type { GraphColors } from './canvas';
import { type ControlHandlers, type ControlRefs, GraphBody, OPEN_A_NOTE, type SliderKey, type ToggleKey } from './controls';
import {
  clearResetUndo,
  dismissResetUndo,
  dropMissingTags,
  fitToView,
  type GraphLook,
  type GraphPage,
  hideTooltip,
  keep,
  rebuildView,
  reheat,
  renderTagList,
  resetGraphSettings,
  resizeCanvas,
  scheduleFrame,
  send,
  sendFilter,
  setGroup,
  undoGraphReset,
  updateFocus,
  updateStatus,
  zoomAt,
} from './graphPage';
import { emptyGraphState, type GraphSettings } from './model';
import { listenToCanvas } from './pointer';
import { readCamera, readKept, readSettings } from './settings';
import { findNodeIndex, recomputeSearchMatches, recomputeTagMatches, setHoverIndex, setSelectedIndex } from './view';

installTip();

/**
 * A type step in pixels, for the canvas. The step is written as a max()
 * over a calc() so it follows the editor's font size without going under
 * its floor, which a canvas font cannot read; an element set in the step
 * resolves it to the pixels the page draws with.
 */
function tokenFontSize(name: string, fallback: string): string {
  const probe = document.createElement('span');
  probe.style.fontSize = 'var(' + name + ')';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const size = getComputedStyle(probe).fontSize;
  probe.remove();
  return /^\d/.test(size) ? size : fallback;
}

/** A system color as the browser resolves it, for a canvas to paint with. */
function systemColor(name: string): string {
  const probe = document.createElement('span');
  probe.style.color = name;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

/**
 * How the canvas paints. Under forced colors the page's own sheet is
 * repainted in the system's colors, but a canvas is not: it would keep
 * drawing the theme's cyan on black. It paints in the same system colors
 * instead, the selection in Highlight.
 */
function readLook(): GraphLook {
  const rootStyles = getComputedStyle(document.documentElement);
  const labelFontSize = tokenFontSize('--text-xs', '11px');
  const groupFontSize = tokenFontSize('--text-sm', '12px');
  const themeColor = (name: string, fallback: string): string => rootStyles.getPropertyValue(name).trim() || fallback;
  const forcedColors = Boolean(window.matchMedia && window.matchMedia('(forced-colors: active)').matches);
  const colors: GraphColors = forcedColors ? {
    background: systemColor('Canvas'),
    note: systemColor('CanvasText'),
    task: systemColor('CanvasText'),
    tag: systemColor('CanvasText'),
    edge: systemColor('GrayText'),
    edgeHighlight: systemColor('Highlight'),
    label: systemColor('CanvasText'),
    halo: systemColor('Highlight'),
    group: systemColor('GrayText'),
  } : {
    background: themeColor('--bg-dark', '#050608'),
    note: themeColor('--cyan-bright', '#5FE1F0'),
    task: themeColor('--amber-bright', '#FFB000'),
    tag: themeColor('--toxic-green', '#66E066'),
    edge: themeColor('--muted', '#7D8792'),
    edgeHighlight: themeColor('--amber-bright', '#FFB000'),
    label: themeColor('--text', '#D9E0E4'),
    halo: themeColor('--favorite-red', '#E05232'),
    group: themeColor('--line-strong', '#3A4450'),
  };
  return { colors, forcedColors, labelFontSize, groupFontSize, rootStyles };
}

/** How long typing in a search box waits before the graph or the list follows it. */
const TYPING_MS = 150;

/** What each slider does once its setting changes: draw again, rebuild, heat the graph, or lay it out afresh. */
const SLIDER_EFFECTS: Readonly<Record<SliderKey, (page: GraphPage) => void>> = {
  nodeSize: scheduleFrame,
  linkThickness: scheduleFrame,
  linkDensity: (page) => rebuildView(page),
  tagSpecificity: (page) => rebuildView(page),
  bridgeStrength: (page) => rebuildView(page),
  labelThreshold: scheduleFrame,
  centerStrength: (page) => reheat(page, 0.5),
  clusterCohesion: (page) => reheat(page, 0.5),
  communitySpacing: (page) => {
    page.state.hasFramed = false;
    rebuildView(page, true);
  },
  repelStrength: (page) => reheat(page, 0.5),
  linkStrength: (page) => reheat(page, 0.5),
  linkDistance: (page) => reheat(page, 0.5),
};

/**
 * Drawing around the note in the editor is the host's business: it sends
 * the neighborhood rather than the workspace, so the page asks and draws
 * whatever comes back.
 */
function requestScope(page: GraphPage): void {
  const local = document.getElementById('local-graph') as HTMLInputElement;
  const depth = document.getElementById('local-depth') as HTMLInputElement;
  const skipPeriodic = document.getElementById('skip-periodic') as HTMLInputElement;
  page.ui = { ...page.ui, focus: { ...page.ui.focus, local: local.checked, skipPeriodic: skipPeriodic.checked, depth: depth.value } };
  send({
    type: 'setGraphScope',
    local: local.checked,
    depth: Number(depth.value),
    skipPeriodic: skipPeriodic.checked,
  });
}

/** What the scope, kind, and slider controls do. */
function settingHandlers(page: GraphPage): Pick<ControlHandlers, 'scope' | 'depthInput' | 'depthChange' | 'toggle' | 'slider' | 'headings'> {
  const settings = page.settings as unknown as Record<string, unknown>;
  return {
    scope: () => requestScope(page),
    depthInput: (event) => {
      page.ui = { ...page.ui, focus: { ...page.ui.focus, depth: (event.currentTarget as HTMLInputElement).value } };
    },
    depthChange: () => requestScope(page),
    toggle: (key: ToggleKey, event) => {
      settings[key] = (event.currentTarget as HTMLInputElement).checked;
      keep(page);
      rebuildView(page);
      if (key === 'showNotes' || key === 'showTasks') {
        sendFilter(page);
      }
    },
    slider: (key: SliderKey, event) => {
      settings[key] = Number((event.currentTarget as HTMLInputElement).value);
      keep(page);
      SLIDER_EFFECTS[key](page);
    },
    headings: (value) => {
      if (page.resetSnapshot) {
        clearResetUndo(page);
      }
      page.settings.headings = value;
      keep(page);
      rebuildView(page);
    },
  };
}

/** What the search boxes, the tag list, and the group list do. */
function filterHandlers(page: GraphPage): Pick<ControlHandlers, 'searchInput' | 'tagSearchInput' | 'tagToggle' | 'clearTags' | 'groupChange'> {
  let tagSearchTimer = 0;
  return {
    searchInput: () => {
      window.clearTimeout(page.searchTimer);
      page.searchTimer = window.setTimeout(() => {
        page.settings.search = (page.refs.search.current as HTMLInputElement).value;
        keep(page);
        recomputeSearchMatches(page.state, page.settings);
        // The status line counts the matches, and this runs after the
        // input's own draw, so it draws the line again itself.
        updateStatus(page);
        page.redraw();
        scheduleFrame(page);
      }, TYPING_MS);
    },
    tagSearchInput: () => {
      window.clearTimeout(tagSearchTimer);
      tagSearchTimer = window.setTimeout(() => {
        renderTagList(page);
        page.redraw();
      }, TYPING_MS);
    },
    tagToggle: (key, event) => {
      const next = page.settings.selectedTags.filter((item) => item !== key);
      if ((event.currentTarget as HTMLInputElement).checked) {
        next.push(key);
      }
      page.settings.selectedTags = next;
      page.state.tagNotice = '';
      keep(page);
      recomputeTagMatches(page.state, page.settings);
      scheduleFrame(page);
    },
    clearTags: () => {
      page.settings.selectedTags = [];
      page.state.tagNotice = '';
      keep(page);
      recomputeTagMatches(page.state, page.settings);
      renderTagList(page);
      setGroup(page, '');
    },
    groupChange: (event) => setGroup(page, (event.currentTarget as HTMLSelectElement).value),
  };
}

/** What each control does; every change draws the controls again before the handler returns. */
function controlHandlers(page: GraphPage): ControlHandlers {
  const handlers: ControlHandlers = {
    ...settingHandlers(page),
    ...filterHandlers(page),
    zoom: (button, event) => {
      dismissResetUndo(page, event);
      if (button === 'fit') {
        fitToView(page);
        return;
      }
      // About the canvas's middle, as a point on the page, which is what
      // the zoom takes: the canvas need not sit at the page's corner.
      const { canvas } = page;
      const rect = canvas.getBoundingClientRect();
      zoomAt(page, { clientX: rect.left + canvas.clientWidth / 2, clientY: rect.top + canvas.clientHeight / 2 }, button === 'in' ? 1.3 : 1 / 1.3);
    },
    reset: () => resetGraphSettings(page),
    resetUndoClick: (event) => {
      const target = event.target as Element | null;
      if (target && target.closest && target.closest('[data-action="undo-graph-reset"]')) {
        undoGraphReset(page);
      }
    },
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handle]) => [
    name,
    (...args: unknown[]) => {
      (handle as (...rest: unknown[]) => void)(...args);
      page.redraw();
    },
  ])) as unknown as ControlHandlers;
}

/** The page, before its controls are drawn. */
function createPage(): GraphPage {
  const saved = readKept();
  const settings: GraphSettings = readSettings(saved);
  const refs: ControlRefs = {
    canvas: createRef(),
    search: createRef(),
    tagSearch: createRef(),
    zoomReadout: createRef(),
    simNote: createRef(),
    tooltip: createRef(),
    resetUndo: createRef(),
    announce: createRef(),
  };
  return {
    state: emptyGraphState(),
    settings,
    camera: readCamera(saved),
    dpr: window.devicePixelRatio || 1,
    look: readLook(),
    canvas: undefined as unknown as HTMLCanvasElement,
    ctx: undefined as unknown as CanvasRenderingContext2D,
    needsDraw: true,
    frameQueued: false,
    ui: {
      focus: { local: false, skipPeriodic: true, skipDisabled: false, depth: '1', note: OPEN_A_NOTE },
      tagList: null,
      groupValue: undefined,
      status: { text: '', joinedShown: false },
      resetUndo: 'none',
    },
    refs,
    redraw: () => undefined,
    resetSnapshot: null,
    resetUndoTimer: 0,
    searchTimer: 0,
    hitGrid: {},
  };
}

/** A message from the host. */
type HostMessage = MessageOf<NotesGraphHostToPage>;

/**
 * A graph from the host: its tag labels and its edge ids put back, then the
 * graph, the tag list, and the focus drawn.
 */
function receiveGraph(page: GraphPage, snapshot: NotesGraphWireSnapshot): void {
  const { state } = page;
  state.snapshot = snapshot;
  dropMissingTags(page, snapshot, state.tagLabelByKey);
  state.tagLabelByKey = {};
  (snapshot.tags || []).forEach((entry) => {
    state.tagLabelByKey[entry[0]] = entry[1];
  });
  // Edge ids are left out of the message; each is its two ends.
  snapshot.edges.forEach((edge) => {
    if (!edge.id) {
      edge.id = edge.source + '::' + edge.target;
    }
  });
  rebuildView(page);
  renderTagList(page);
  updateFocus(page);
}

/**
 * A graph from the host, drawn by `receiveGraph`. A new focus alone, drawn in
 * the focus line. A filter the host turns on for a reader who came to see
 * it, such as Stats' Wiki links total. A node Related Notes is hovering,
 * or selected there or by the host.
 */
function receive(page: GraphPage, message: HostMessage | undefined): void {
  const { state } = page;
  if (!message) {
    page.redraw();
    return;
  }
  if (message.type === 'state' && message.data) {
    receiveGraph(page, message.data);
  }
  if (message.type === 'focus' && state.snapshot) {
    state.snapshot.focus = message.focus;
    updateFocus(page);
  }
  if (message.type === 'applyFilters' && typeof message.onlyWrittenLinks === 'boolean') {
    page.settings.onlyWrittenLinks = message.onlyWrittenLinks;
    keep(page);
    rebuildView(page);
  }
  if (message.type === 'highlightNode') {
    state.externalHoverNodeId = message.nodeId || null;
    setHoverIndex(state, findNodeIndex(state, state.externalHoverNodeId));
    hideTooltip(page);
    scheduleFrame(page);
  }
  if (message.type === 'selectNode' && message.nodeId) {
    const selectedNodeIndex = findNodeIndex(state, message.nodeId);
    if (selectedNodeIndex >= 0) {
      setSelectedIndex(state, selectedNodeIndex);
      scheduleFrame(page);
    }
  }
  page.redraw();
}

/** Starts the page: draws its controls, wires the canvas, says which kinds of node it shows, and sizes the canvas. */
function start(): void {
  const page = createPage();
  const handlers = controlHandlers(page);
  page.redraw = () => render(
    <GraphBody ui={page.ui} settings={page.settings} graph={page.state} refs={page.refs} on={handlers} />,
    document.body,
  );
  page.redraw();
  page.canvas = page.refs.canvas.current as HTMLCanvasElement;
  page.ctx = page.canvas.getContext('2d') as CanvasRenderingContext2D;
  (page.refs.search.current as HTMLInputElement).value = page.settings.search;
  // Any later change makes Reset's snapshot stale, so its offer goes:
  // heard before the control, and drawn by the control's handler, which
  // every control that changes has (a checkbox's and a list's input event
  // comes before its change, so nothing may draw between the two).
  document.addEventListener('input', (event) => dismissResetUndo(page, event), true);
  document.addEventListener('change', (event) => dismissResetUndo(page, event), true);
  listenToCanvas(page);
  sendFilter(page);
  window.addEventListener('resize', () => resizeCanvas(page));
  window.addEventListener('message', (event: MessageEvent) => receive(page, event.data as HostMessage | undefined));
  resizeCanvas(page);
}

start();
