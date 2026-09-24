import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getPageTailCss,
  zenBodyAttribute,
} from './components';

/**
 * Builds the Notes Graph document: a full-viewport Canvas 2D force-directed
 * graph with Obsidian-style Filters/Display/Forces overlay panels.
 *
 * The webview receives full snapshots via postMessage and does every render
 * and filter locally. The simulation is a hand-rolled velocity-Verlet loop
 * with Barnes-Hut repulsion, time-budgeted per animation frame so graphs with
 * thousands of nodes stay interactive while they converge.
 */
export function getNotesGraphHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
): string {
  const nonce = createNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Notes Graph</title>
<style nonce="${nonce}">${getBaseCss()}
:root {
  color-scheme: dark;
  --bg-dark: #050608;
  --panel-bg: #0D1017;
  --panel-raised: #121620;
  --panel-deep: #080A0E;
  --amber-bright: #FFB000;
  --amber-dim: #7A5400;
  --favorite-red: #D23C28;
  --toxic-green: #33FF33;
  --cyan-bright: #00E5FF;
  --slate-border: #212936;
  --slate-olive: #3E4A42;
  --warning-orange: #FF5500;
  --text: #D9E0E4;
  --muted: #7D8792;
  --font-mono: var(--vscode-editor-font-family, 'Share Tech Mono', 'JetBrains Mono', 'Space Mono', 'IBM Plex Mono', 'Courier New', monospace);
  --font-display: var(--vscode-font-family, 'DIN Alternate', 'Arial Narrow', sans-serif);
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; overflow: hidden; background: var(--bg-dark); color: var(--text); font-family: var(--font-display); font-size: 12px; }
#graph { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
#graph.is-panning { cursor: grabbing; }
#graph.is-pointing { cursor: pointer; }
.overlay { position: absolute; z-index: 2; top: 12px; left: 12px; display: flex; flex-direction: column; gap: 4px; width: 240px; max-height: calc(100vh - 70px); overflow-y: auto; }
.control-group { border: 1px solid var(--slate-border); background: rgba(13, 16, 23, .94); }
.control-group summary { padding: 7px 10px; color: var(--cyan-bright); font: 700 11px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; cursor: pointer; list-style: none; user-select: none; }
.control-group summary::before { content: '▸ '; color: var(--muted); }
.control-group[open] summary::before { content: '▾ '; }
.control-group summary:hover, .control-group summary:focus-visible { background: var(--panel-raised); }
.control-body { display: flex; flex-direction: column; gap: 8px; padding: 4px 10px 10px; border-top: 1px solid var(--slate-border); }
.control-row { display: flex; flex-direction: column; gap: 3px; }
.control-row label { color: var(--muted); font: 10px var(--font-mono); text-transform: uppercase; }
.control-row output { color: var(--toxic-green); font: 10px var(--font-mono); }
.control-row .slider-line { display: flex; align-items: center; gap: 8px; }
input[type='range'] { flex: 1; min-width: 0; accent-color: var(--amber-bright); }
input[type='checkbox'] { accent-color: var(--amber-bright); }
.toggle-row { display: flex; align-items: center; gap: 7px; color: var(--text); font: 11px var(--font-mono); cursor: pointer; }
.graph-search, .tag-search { width: 100%; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 6px 8px; font: 11px var(--font-mono); }
input[type='search']::-webkit-search-cancel-button { cursor: pointer; }
.graph-search:focus, .tag-search:focus { border-color: var(--cyan-bright); }
.tag-list { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; border: 1px solid var(--slate-border); background: var(--panel-deep); padding: 4px; }
.tag-list .toggle-row { padding: 2px 4px; font-size: 10px; }
.tag-list .toggle-row:hover { background: var(--panel-raised); }
.tag-list .tag-count { margin-left: auto; color: var(--muted); }
.tag-list-note { color: var(--muted); font: 10px var(--font-mono); padding: 2px 4px; }
.relationship-note { margin: 0; color: var(--muted); font: 10px/1.45 var(--font-mono); }
.clear-tags { align-self: flex-start; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 4px 8px; font: 10px var(--font-mono); text-transform: uppercase; cursor: pointer; }
.clear-tags:hover, .clear-tags:focus-visible { border-color: var(--amber-bright); background: var(--hover-bg); color: var(--hover-fg); }
.graph-zoom-controls { position: absolute; z-index: 2; right: 12px; bottom: 34px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.zoom-controls { display: inline-flex; }
.zoom-controls button { min-width: 32px; min-height: 30px; border: 1px solid var(--slate-border); background: rgba(8, 10, 14, .94); color: var(--text); padding: 4px 8px; font: 12px var(--font-mono); cursor: pointer; }
.zoom-controls button + button, .zoom-controls .zoom-readout + button { margin-left: -1px; }
.zoom-controls button:hover, .zoom-controls button:focus-visible { border-color: var(--amber-bright); background: var(--hover-bg); color: var(--hover-fg); position: relative; }
.zoom-readout { display: inline-grid; place-items: center; min-width: 58px; margin-left: -1px; border-block: 1px solid var(--slate-border); background: rgba(8, 10, 14, .94); color: var(--muted); font: 10px var(--font-mono); }
.reset-graph-settings { min-height: 30px; border: 1px solid var(--slate-border); background: rgba(8, 10, 14, .94); color: var(--text); padding: 4px 8px; font: 10px var(--font-mono); text-transform: uppercase; cursor: pointer; }
.reset-graph-settings:hover, .reset-graph-settings:focus-visible { border-color: var(--amber-bright); background: var(--hover-bg); color: var(--hover-fg); }
.status-line { position: absolute; z-index: 2; left: 12px; bottom: 10px; display: flex; gap: 12px; color: var(--muted); font: 10px var(--font-mono); text-transform: uppercase; pointer-events: none; }
.status-line .sim-note { color: var(--amber-bright); }
.graph-legend { display: flex; align-items: center; gap: 5px; }
.graph-legend .legend-swatch { width: 8px; height: 8px; border-radius: 50%; }
.graph-legend .legend-swatch + .legend-swatch, .graph-legend .legend-swatch:not(:first-child) { margin-left: 7px; }
.legend-note { background: var(--cyan-bright); }
.legend-task { background: var(--amber-bright); }
.legend-tag { background: var(--toxic-green); }
/* The panels follow the theme rather than a fixed near-black, which was
   unreadable when corpo took its text colour from a light VS Code theme. */
.control-group { background: var(--panel); }
.tooltip { background: var(--panel-raised); }
.tooltip { position: absolute; z-index: 3; display: none; max-width: 320px; border: 1px solid var(--slate-border); background: rgba(8, 10, 14, .97); padding: 6px 9px; pointer-events: none; }
.tooltip .tooltip-title { color: var(--text); font: 700 11px var(--font-mono); }
.tooltip .tooltip-meta { color: var(--muted); font: 10px var(--font-mono); margin-top: 2px; }
.focus-note { margin: 2px 0 0; color: var(--muted); font: 10px var(--font-mono); overflow-wrap: anywhere; }
.empty-state { position: absolute; z-index: 1; inset: 0; display: none; place-items: center; color: var(--muted); font: 12px var(--font-mono); text-transform: uppercase; pointer-events: none; }
${getPageTailCss()}
</style>
</head>
<body${zenBodyAttribute()}>
<canvas id="graph" tabindex="0" role="application" aria-label="Notes graph. Press Tab or the arrow keys to move between nodes, Enter to open one, Escape to clear." aria-describedby="graph-legend"></canvas>
<div class="empty-state" id="empty-state">No indexed notes yet — save a Markdown file with tags or links.</div>
<div class="overlay" role="group" aria-label="Graph controls">
  <details class="control-group" open>
    <summary>Focus</summary>
    <div class="control-body">
      <label class="toggle-row" title="Draw only the note open in the editor and what it is connected to."><input type="checkbox" id="local-graph" title="Draw only the note open in the editor and what it is connected to."> Around this note</label>
      <div class="control-row"><label for="local-depth" title="How many connections out from the note the graph reaches.">Hops out</label><div class="slider-line"><input type="range" id="local-depth" min="1" max="3" step="1" value="1" title="How many connections out from the note the graph reaches."><output id="local-depth-out">1</output></div></div>
      <p class="focus-note" id="focus-note">Open a note to draw the graph around it.</p>
    </div>
  </details>
  <details class="control-group" open>
    <summary>Filters</summary>
    <div class="control-body">
      <input class="graph-search" id="search" type="search" placeholder="Search notes…" aria-label="Search graph nodes" title="Filter note, task, and tag titles and file paths.">
      <label class="toggle-row" title="Show or hide note nodes and their visible links."><input type="checkbox" id="show-notes" checked title="Show or hide note nodes and their visible links."> Show notes</label>
      <label class="toggle-row" title="Show or hide task nodes and their visible links."><input type="checkbox" id="show-tasks" checked title="Show or hide task nodes and their visible links."> Show tasks</label>
      <label class="toggle-row" title="Show tag nodes and tag links; hidden tags still guide clustering."><input type="checkbox" id="show-tags" title="Show tag nodes and tag links; hidden tags still guide clustering."> Show tags</label>
      <label class="toggle-row" title="Show nodes with no currently visible connections."><input type="checkbox" id="show-orphans" checked title="Show nodes with no currently visible connections."> Show orphans</label>
      <input class="tag-search" id="tag-search" type="search" placeholder="Filter tag list…" aria-label="Filter tag checklist" title="Narrow the tag checklist without changing the graph.">
      <div class="tag-list" id="tag-list" role="group" aria-label="Tag filters"></div>
      <button class="clear-tags" id="clear-tags" type="button" title="Remove all selected tag filters.">Clear tag filters</button>
    </div>
  </details>
  <details class="control-group">
    <summary>Display</summary>
    <div class="control-body">
      <div class="control-row"><label for="node-size" title="Scale node circles; larger nodes make highly connected items easier to spot.">Node size</label><div class="slider-line"><input type="range" id="node-size" min="0.5" max="3" step="0.1" value="1" title="Scale node circles; larger nodes make highly connected items easier to spot."><output id="node-size-out">1.0</output></div></div>
      <div class="control-row"><label for="link-thickness" title="Scale the width of visible edges.">Link thickness</label><div class="slider-line"><input type="range" id="link-thickness" min="0.5" max="3" step="0.1" value="1" title="Scale the width of visible edges."><output id="link-thickness-out">1.0</output></div></div>
      <div class="control-row"><label for="link-density" title="Choose how many of each node's strongest links remain in the visual backbone; lower values reduce clutter without changing sidebar connections.">Connection density</label><div class="slider-line"><input type="range" id="link-density" min="0.15" max="1" step="0.05" value="0.3" title="Choose how many of each node's strongest links remain in the visual backbone; lower values reduce clutter without changing sidebar connections."><output id="link-density-out">0.30</output></div></div>
      <div class="control-row"><label for="tag-specificity" title="Control how strongly rare and common tag populations affect visual-link scores; higher values favor useful coverage.">Tag prevalence bias</label><div class="slider-line"><input type="range" id="tag-specificity" min="0" max="1" step="0.05" value="0.9" title="Control how strongly rare and common tag populations affect visual-link scores; higher values favor useful coverage."><output id="tag-specificity-out">0.90</output></div></div>
      <div class="control-row"><label for="bridge-strength" title="Control how strongly secondary tags and tag associations bridge different communities.">Secondary bridge strength</label><div class="slider-line"><input type="range" id="bridge-strength" min="0" max="1" step="0.05" value="0.15" title="Control how strongly secondary tags and tag associations bridge different communities."><output id="bridge-strength-out">0.15</output></div></div>
      <label class="toggle-row" title="Display every indexed visual link instead of only the strongest local backbone; useful for comparison but potentially dense."><input type="checkbox" id="show-all-links" title="Display every indexed visual link instead of only the strongest local backbone; useful for comparison but potentially dense."> Show all links (comparison)</label>
      <div class="control-row"><label for="label-threshold" title="Set the zoom level where node labels begin to appear; higher values keep labels hidden longer.">Label fade zoom</label><div class="slider-line"><input type="range" id="label-threshold" min="0.5" max="4" step="0.1" value="1.4" title="Set the zoom level where node labels begin to appear; higher values keep labels hidden longer."><output id="label-threshold-out">1.4</output></div></div>
    </div>
  </details>
  <details class="control-group">
    <summary>Forces</summary>
    <div class="control-body">
      <div class="control-row"><label for="center-strength" title="Pull community anchors gently toward the center of the viewport.">Cluster centering</label><div class="slider-line"><input type="range" id="center-strength" min="0" max="1" step="0.05" value="0.4" title="Pull community anchors gently toward the center of the viewport."><output id="center-strength-out">0.40</output></div></div>
      <div class="control-row"><label for="cluster-cohesion" title="Strengthen or weaken the pull from notes and tasks toward their detected community anchor.">Cluster cohesion</label><div class="slider-line"><input type="range" id="cluster-cohesion" min="0.5" max="3" step="0.1" value="1.5" title="Strengthen or weaken the pull from notes and tasks toward their detected community anchor."><output id="cluster-cohesion-out">1.5</output></div></div>
      <div class="control-row"><label for="community-spacing" title="Increase or reduce the distance between detected communities; changing it recomputes the layout framing.">Community spacing</label><div class="slider-line"><input type="range" id="community-spacing" min="0.6" max="2.5" step="0.1" value="1.2" title="Increase or reduce the distance between detected communities; changing it recomputes the layout framing."><output id="community-spacing-out">1.2</output></div></div>
      <div class="control-row"><label for="repel-strength" title="Increase or reduce node-to-node repulsion; higher values spread crowded nodes apart.">Repel strength</label><div class="slider-line"><input type="range" id="repel-strength" min="50" max="2000" step="25" value="220" title="Increase or reduce node-to-node repulsion; higher values spread crowded nodes apart."><output id="repel-strength-out">220</output></div></div>
      <div class="control-row"><label for="link-strength" title="Increase or reduce the spring force along visible links.">Link strength</label><div class="slider-line"><input type="range" id="link-strength" min="0" max="2" step="0.05" value="1" title="Increase or reduce the spring force along visible links."><output id="link-strength-out">1.00</output></div></div>
      <div class="control-row"><label for="link-distance" title="Set the target length of visible links; larger values spread connected nodes farther apart.">Link distance</label><div class="slider-line"><input type="range" id="link-distance" min="10" max="200" step="5" value="32" title="Set the target length of visible links; larger values spread connected nodes farther apart."><output id="link-distance-out">32</output></div></div>
    </div>
  </details>
  <details class="control-group">
    <summary>Relationships</summary>
    <div class="control-body">
      <p class="relationship-note">The graph uses prevalence-aware visual communities: direct Wiki links and headings seed strong groups, while tag membership is discounted when a tag is too rare or too widespread. Hidden tags act as virtual anchors rather than high-mass particles, and each node keeps only its strongest local connections.</p>
      <p class="relationship-note">Connection density controls that local budget. The status line reports strong links retained versus all indexed links; Connected Nodes in the sidebar still uses the complete graph.</p>
      <p class="relationship-note">Selecting a node highlights its direct graph neighbors and lists those same note, task, and tag nodes in the sidebar. Related Notes ranking remains exclusive to Markdown pages.</p>
    </div>
  </details>
</div>
<div class="graph-zoom-controls">
  <div class="zoom-controls" role="group" aria-label="Zoom controls">
    <button type="button" id="zoom-out" aria-label="Zoom out" title="Zoom out the graph.">−</button>
    <span class="zoom-readout" id="zoom-readout">100%</span>
    <button type="button" id="zoom-in" aria-label="Zoom in" title="Zoom in the graph.">+</button>
    <button type="button" id="zoom-fit" aria-label="Fit graph to view" title="Fit the full graph in the current view.">Fit</button>
  </div>
  <button class="reset-graph-settings" id="reset-graph-settings" type="button" title="Restore all graph controls and filters, clear node momentum, and reframe the graph.">Reset graph settings</button>
</div>
<div class="status-line"><span id="graph-legend" class="graph-legend"><span class="legend-swatch legend-note"></span>Notes<span class="legend-swatch legend-task"></span>Tasks<span class="legend-swatch legend-tag"></span>Tags</span><span id="status-counts"></span><span class="sim-note" id="sim-note" hidden>Simulating…</span></div>
<div class="tooltip" id="tooltip" aria-hidden="true"></div>
<script nonce="${nonce}">
(function () {
  'use strict';
  var vscode = acquireVsCodeApi();
  var canvas = document.getElementById('graph');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('tooltip');
  var emptyState = document.getElementById('empty-state');
  var statusCounts = document.getElementById('status-counts');
  var simNote = document.getElementById('sim-note');
  var zoomReadout = document.getElementById('zoom-readout');

  var rootStyles = getComputedStyle(document.documentElement);
  function themeColor(name, fallback) {
    var value = rootStyles.getPropertyValue(name).trim();
    return value || fallback;
  }
  var colors = {
    background: themeColor('--bg-dark', '#050608'),
    note: themeColor('--cyan-bright', '#00E5FF'),
    task: themeColor('--amber-bright', '#FFB000'),
    tag: themeColor('--toxic-green', '#33FF33'),
    edge: themeColor('--muted', '#7D8792'),
    edgeHighlight: themeColor('--amber-bright', '#FFB000'),
    label: themeColor('--text', '#D9E0E4'),
    halo: themeColor('--favorite-red', '#D23C28')
  };

  // ---- persisted webview-local settings -------------------------------
  var defaults = {
    showNotes: true,
    showTasks: true,
    showTags: false,
    showOrphans: true,
    selectedTags: [],
    search: '',
    nodeSize: 1,
    linkThickness: 1,
    linkDensity: 0.3,
    tagSpecificity: 0.9,
    bridgeStrength: 0.15,
    showAllLinks: false,
    labelThreshold: 1.4,
    centerStrength: 0.4,
    clusterCohesion: 1.5,
    communitySpacing: 1.2,
    repelStrength: 220,
    linkStrength: 1,
    linkDistance: 32
  };
  var saved = vscode.getState() || {};
  var settings = {};
  Object.keys(defaults).forEach(function (key) {
    settings[key] = saved[key] !== undefined ? saved[key] : defaults[key];
  });
  var savedCamera = saved.camera;
  function persist() {
    var state = {};
    Object.keys(settings).forEach(function (key) { state[key] = settings[key]; });
    state.camera = { x: camera.x, y: camera.y, k: camera.k };
    vscode.setState(state);
  }

  // ---- graph + simulation state ---------------------------------------
  var snapshot = null;          // latest full snapshot from the extension
  var nodes = [];               // visible node records
  var edges = [];               // visible edge records {a, b, weight, types}
  var nodeIndexById = {};
  var adjacency = [];           // index -> array of neighbor indices
  var px, py, vx, vy;           // Float32Array simulation state
  var degrees;                  // per-node visible edge counts
  /** How many of the best-connected notes on screen are named at rest. */
  var HUB_LABELS_AT_REST = 12;
  var primaryTag;               // note/task index -> strongest cluster anchor
  var primaryClusterSize;       // tag index -> assigned note/task count
  var communityId;              // node index -> visual community index
  var communitySizes = [];
  var communityAnchorX = new Float32Array(0);
  var communityAnchorY = new Float32Array(0);
  var communityVx = new Float32Array(0);
  var communityVy = new Float32Array(0);
  var tagOffsetX = new Float32Array(0);
  var tagOffsetY = new Float32Array(0);
  var communityEdges = [];
  var communityCount = 0;
  var alpha = 0;
  var alphaDecay = 0.0228;
  var alphaMin = 0.005;
  var velocityDecay = 0.6;
  var hasFramed = false;

  var camera = savedCamera && isFinite(savedCamera.k)
    ? { x: savedCamera.x, y: savedCamera.y, k: savedCamera.k }
    : { x: 0, y: 0, k: 1 };
  var dpr = window.devicePixelRatio || 1;
  var hoverIndex = -1;
  var dragIndex = -1;
  var panning = false;
  var pointerId = -1;
  var pointerDownAt = null;
  var pointerMoved = false;
  var needsDraw = true;
  var frameQueued = false;
  var matchSet = null;          // null = everything matches the search
  var tagMatchSet = null;       // null = no tag filter active
  var hoverNeighbors = {};      // neighbor index set for the hovered node
  var externalHoverNodeId = null;
  var selectedId = null;        // sticky selection survives snapshot rebuilds
  var selectedIndex = -1;
  var selectedNeighbors = {};

  // ---- view construction ------------------------------------------------
  function rebuildView(repositionCommunities) {
    if (!snapshot) { return; }
    var previous = {};
    if (!repositionCommunities) {
      for (var p = 0; p < nodes.length; p += 1) {
        previous[nodes[p].id] = { x: px[p], y: py[p], vx: vx[p], vy: vy[p] };
      }
    }

    var candidate = snapshot.nodes.filter(function (node) {
      if (node.kind === 'note' && !settings.showNotes) { return false; }
      if (node.kind === 'task' && !settings.showTasks) { return false; }
      return true;
    });
    var candidateIndex = {};
    candidate.forEach(function (node, index) { candidateIndex[node.id] = index; });

    var allCandidateEdges = snapshot.edges.filter(function (edge) {
      return candidateIndex[edge.source] !== undefined &&
        candidateIndex[edge.target] !== undefined;
    });
    var candidateEdges = settings.showAllLinks
      ? allCandidateEdges
      : selectSalientEdges(
      candidate,
      allCandidateEdges,
      settings.linkDensity,
      settings.tagSpecificity,
      settings.bridgeStrength
    );

    var connected = {};
    candidateEdges.forEach(function (edge) {
      connected[edge.source] = true;
      connected[edge.target] = true;
    });
    candidate = candidate.filter(function (node) {
      return node.kind !== 'tag' || connected[node.id];
    });
    candidateIndex = {};
    candidate.forEach(function (node, index) { candidateIndex[node.id] = index; });
    candidateEdges = candidateEdges.filter(function (edge) {
      return candidateIndex[edge.source] !== undefined &&
        candidateIndex[edge.target] !== undefined;
    });

    if (!settings.showOrphans) {
      candidate = candidate.filter(function (node) { return connected[node.id]; });
      candidateIndex = {};
      candidate.forEach(function (node, index) { candidateIndex[node.id] = index; });
      candidateEdges = candidateEdges.filter(function (edge) {
        return candidateIndex[edge.source] !== undefined &&
          candidateIndex[edge.target] !== undefined;
      });
    }

    nodes = candidate;
    nodeIndexById = candidateIndex;
    edges = candidateEdges.map(function (edge) {
      return {
        a: candidateIndex[edge.source],
        b: candidateIndex[edge.target],
        weight: edge.weight,
        types: edge.types
      };
    });

    var count = nodes.length;
    px = new Float32Array(count);
    py = new Float32Array(count);
    vx = new Float32Array(count);
    vy = new Float32Array(count);
    degrees = new Float32Array(count);
    adjacency = [];
    primaryTag = new Int32Array(count);
    primaryClusterSize = new Uint32Array(count);
    var memberships = [];
    var membershipCount = new Uint32Array(count);
    var clusteringEdges = allCandidateEdges.filter(function (edge) {
      return candidateIndex[edge.source] !== undefined &&
        candidateIndex[edge.target] !== undefined;
    });
    for (var a = 0; a < count; a += 1) { adjacency.push([]); }
    for (var pTag = 0; pTag < count; pTag += 1) {
      primaryTag[pTag] = -1;
      memberships.push([]);
    }
    edges.forEach(function (edge) {
      degrees[edge.a] += 1;
      degrees[edge.b] += 1;
      adjacency[edge.a].push(edge.b);
      adjacency[edge.b].push(edge.a);
    });
    clusteringEdges.forEach(function (edge) {
      if (candidateIndex[edge.source] === undefined ||
          candidateIndex[edge.target] === undefined) {
        return;
      }
      var clusterA = candidateIndex[edge.source];
      var clusterB = candidateIndex[edge.target];
      if (edge.types.indexOf('tag-membership') !== -1) {
        var noteIndex = nodes[clusterA].kind === 'tag' ? clusterB : clusterA;
        var tagIndex = nodes[clusterA].kind === 'tag' ? clusterA : clusterB;
        memberships[noteIndex].push({ tagIndex: tagIndex, weight: edge.weight });
        membershipCount[tagIndex] += 1;
      }
    });
    var sourceCount = nodes.filter(function (node) {
      return node.kind !== 'tag';
    }).length;
    var targetClusterSize = Math.max(3, Math.sqrt(sourceCount));
    for (var memberIndex = 0; memberIndex < count; memberIndex += 1) {
      if (nodes[memberIndex].kind === 'tag' || !memberships[memberIndex].length) {
        continue;
      }
      var bestMembership = memberships[memberIndex][0];
      var bestScore = -Infinity;
      memberships[memberIndex].forEach(function (membership) {
        var members = membershipCount[membership.tagIndex];
        var sizeScore = members > 1
          ? 1 / (1 + Math.abs(Math.log(members / targetClusterSize)))
          : 0.05;
        var score = sizeScore + membership.weight * 0.05;
        if (score > bestScore) {
          bestMembership = membership;
          bestScore = score;
        }
      });
      primaryTag[memberIndex] = bestMembership.tagIndex;
      primaryClusterSize[bestMembership.tagIndex] += 1;
    }
    var communityData = buildCommunities(
      nodes,
      clusteringEdges,
      memberships,
      membershipCount,
      primaryTag
    );
    communityId = communityData.ids;
    communitySizes = communityData.sizes;
    communityEdges = communityData.edges;
    communityCount = communitySizes.length;
    communityAnchorX = new Float32Array(communityCount);
    communityAnchorY = new Float32Array(communityCount);
    communityVx = new Float32Array(communityCount);
    communityVy = new Float32Array(communityCount);
    tagOffsetX = new Float32Array(count);
    tagOffsetY = new Float32Array(count);
    var previousCommunityCenters = [];
    var previousCommunityCounts = [];
    for (var previousCommunity = 0; previousCommunity < communityCount; previousCommunity += 1) {
      previousCommunityCenters.push({ x: 0, y: 0 });
      previousCommunityCounts.push(0);
    }
    if (!repositionCommunities) {
      for (var previousNode = 0; previousNode < count; previousNode += 1) {
        var previousPosition = previous[nodes[previousNode].id];
        var previousCommunityId = communityId[previousNode];
        if (!previousPosition || previousCommunityId < 0) { continue; }
        previousCommunityCenters[previousCommunityId].x += previousPosition.x;
        previousCommunityCenters[previousCommunityId].y += previousPosition.y;
        previousCommunityCounts[previousCommunityId] += 1;
      }
    }
    for (var community = 0; community < communityCount; community += 1) {
      if (previousCommunityCounts[community] > 0) {
        communityAnchorX[community] =
          previousCommunityCenters[community].x / previousCommunityCounts[community];
        communityAnchorY[community] =
          previousCommunityCenters[community].y / previousCommunityCounts[community];
        continue;
      }
      var communityRadius = 150 * settings.communitySpacing *
        Math.sqrt(community + 1);
      var communityAngle = community * 2.39996322972865332;
      communityAnchorX[community] = communityRadius * Math.cos(communityAngle);
      communityAnchorY[community] = communityRadius * Math.sin(communityAngle);
    }
    var reusedAny = false;
    var retained = {};
    var communityMemberOrdinal = [];
    var communityTagOrdinal = [];
    for (var communityOrdinal = 0; communityOrdinal < communityCount; communityOrdinal += 1) {
      communityMemberOrdinal.push(0);
      communityTagOrdinal.push(0);
    }
    for (var i = 0; i < count; i += 1) {
      if (nodes[i].kind === 'tag') {
        var tagCommunity = communityId[i];
        if (tagCommunity >= 0) {
          var tagOrdinal = communityTagOrdinal[tagCommunity]++;
          var tagRadius = 18 + 5 * Math.sqrt(tagOrdinal + 1);
          var tagAngle = tagOrdinal * 2.39996322972865332;
          tagOffsetX[i] = tagRadius * Math.cos(tagAngle);
          tagOffsetY[i] = tagRadius * Math.sin(tagAngle);
          px[i] = communityAnchorX[tagCommunity] + tagOffsetX[i];
          py[i] = communityAnchorY[tagCommunity] + tagOffsetY[i];
        } else {
          px[i] = 0;
          py[i] = 0;
        }
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      var kept = previous[nodes[i].id];
      if (kept) {
        px[i] = kept.x; py[i] = kept.y; vx[i] = kept.vx; vy[i] = kept.vy;
        retained[i] = true;
        reusedAny = true;
        continue;
      }
      var nodeCommunity = communityId[i];
      if (nodeCommunity >= 0) {
        var localOrdinal = communityMemberOrdinal[nodeCommunity]++;
        var localAngle = localOrdinal * 2.39996322972865332;
        var localRadius = 14 + 4 * Math.sqrt(localOrdinal + 1);
        px[i] = communityAnchorX[nodeCommunity] +
          localRadius * Math.cos(localAngle);
        py[i] = communityAnchorY[nodeCommunity] +
          localRadius * Math.sin(localAngle);
      } else {
        var orphanRadius = 30 * Math.sqrt(i + 1);
        var orphanAngle = i * 2.39996322972865332;
        px[i] = orphanRadius * Math.cos(orphanAngle);
        py[i] = orphanRadius * Math.sin(orphanAngle);
      }
      vx[i] = 0;
      vy[i] = 0;
    }
    for (var sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
      if (retained[sourceIndex] || nodes[sourceIndex].kind === 'tag') {
        continue;
      }
      var anchorIndex = primaryTag[sourceIndex];
      var localAngle = sourceIndex * 2.39996322972865332;
      var localRadius = 12 + 5 * Math.sqrt((sourceIndex % 23) + 1);
      if (anchorIndex >= 0) {
        px[sourceIndex] = px[anchorIndex] + localRadius * Math.cos(localAngle);
        py[sourceIndex] = py[anchorIndex] + localRadius * Math.sin(localAngle);
      } else {
        var orphanRadius = 30 * Math.sqrt(sourceIndex + 1);
        px[sourceIndex] = orphanRadius * Math.cos(localAngle);
        py[sourceIndex] = orphanRadius * Math.sin(localAngle);
      }
      vx[sourceIndex] = 0;
      vy[sourceIndex] = 0;
    }

    recomputeSearchMatches();
    recomputeTagMatches();
    setHoverIndex(findNodeIndex(externalHoverNodeId));
    hideTooltip();
    var restoredSelection = selectedId !== null &&
      nodeIndexById[selectedId] !== undefined
      ? nodeIndexById[selectedId]
      : -1;
    setSelectedIndex(restoredSelection);
    alpha = reusedAny && hasFramed ? 0.3 : 1;
    updateStatus();
    emptyState.style.display = snapshot.nodes.length === 0 ? 'grid' : 'none';
    if (!hasFramed && count > 0) {
      fitToView();
      hasFramed = true;
    }
    scheduleFrame();
  }

  function recomputeSearchMatches() {
    var query = settings.search.trim().toLowerCase();
    if (!query) { matchSet = null; return; }
    matchSet = {};
    nodes.forEach(function (node, index) {
      var haystack = node.title.toLowerCase();
      if (node.filePath) { haystack += ' ' + node.filePath.toLowerCase(); }
      if (haystack.indexOf(query) !== -1) { matchSet[index] = true; }
    });
  }

  function recomputeTagMatches() {
    if (!settings.selectedTags.length) { tagMatchSet = null; return; }
    var selected = {};
    settings.selectedTags.forEach(function (key) { selected[key] = true; });
    tagMatchSet = {};
    nodes.forEach(function (node, index) {
      if (node.kind === 'tag') {
        var tagKey = node.id.slice(4);
        if (selected[tagKey]) { tagMatchSet[index] = true; }
        return;
      }

      for (var t = 0; t < node.tagKeys.length; t += 1) {
        if (selected[node.tagKeys[t]]) { tagMatchSet[index] = true; return; }
      }
    });
  }

  // Build visual communities without changing the indexed graph. Primary tag
  // labels provide deterministic seeds, then structural links and specific
  // tag evidence merge those seeds through a few bounded label-propagation
  // passes. Generic tags have bounded influence through their prevalence score.
  function buildCommunities(
    candidateNodes,
    analyticalEdges,
    memberships,
    membershipCount,
    primaryTags
  ) {
    var count = candidateNodes.length;
    var directNeighbors = [];
    var tagMembers = {};
    var candidateIndexById = {};
    var sourceCount = candidateNodes.filter(function (node) {
      return node.kind !== 'tag';
    }).length;
    var targetClusterSize = Math.max(3, Math.sqrt(sourceCount));
    for (var index = 0; index < count; index += 1) {
      candidateIndexById[candidateNodes[index].id] = index;
      directNeighbors.push([]);
      if (candidateNodes[index].kind !== 'tag') {
        memberships[index].forEach(function (membership) {
          (tagMembers[membership.tagIndex] ||
            (tagMembers[membership.tagIndex] = [])).push({
            nodeIndex: index,
            weight: membership.weight
          });
        });
      }
    }
    analyticalEdges.forEach(function (edge) {
      var sourceIndex = candidateIndexById[edge.source];
      var targetIndex = candidateIndexById[edge.target];
      var source = sourceIndex === undefined ? null : candidateNodes[sourceIndex];
      var target = targetIndex === undefined ? null : candidateNodes[targetIndex];
      if (!source || !target ||
          source.kind === 'tag' || target.kind === 'tag') {
        return;
      }
      var weight = 0.6;
      if (edge.types.indexOf('wiki-link') !== -1) { weight += 3.5; }
      if (edge.types.indexOf('heading') !== -1) { weight += 1.5; }
      directNeighbors[sourceIndex].push({
        index: targetIndex,
        weight: weight
      });
      directNeighbors[targetIndex].push({
        index: sourceIndex,
        weight: weight
      });
    });

    var labels = new Int32Array(count);
    for (var seed = 0; seed < count; seed += 1) {
      labels[seed] = candidateNodes[seed].kind === 'tag'
        ? -1
        : primaryTags[seed] >= 0 ? primaryTags[seed] : count + seed;
    }

    function chooseTagLabels(currentLabels) {
      var tagLabels = {};
      Object.keys(tagMembers).forEach(function (tagKey) {
        var scores = {};
        tagMembers[tagKey].forEach(function (member) {
          var label = currentLabels[member.nodeIndex];
          if (label < 0) { return; }
          var evidence = tagMembershipScore(
            member.weight,
            membershipCount[Number(tagKey)] || 1,
            targetClusterSize,
            settings.tagSpecificity
          );
          var labelKey = String(label);
          scores[labelKey] = (scores[labelKey] || 0) + evidence;
        });
        var bestLabel = -1;
        var bestScore = -Infinity;
        Object.keys(scores).forEach(function (labelKey) {
          var label = Number(labelKey);
          var score = scores[labelKey];
          if (score > bestScore ||
              score === bestScore && (bestLabel < 0 || label < bestLabel)) {
            bestLabel = label;
            bestScore = score;
          }
        });
        tagLabels[tagKey] = bestLabel;
      });
      return tagLabels;
    }

    for (var pass = 0; pass < 5; pass += 1) {
      var tagLabels = chooseTagLabels(labels);
      var nextLabels = new Int32Array(labels);
      for (var nodeIndex = 0; nodeIndex < count; nodeIndex += 1) {
        if (candidateNodes[nodeIndex].kind === 'tag') { continue; }
        var scores = {};
        var currentLabel = labels[nodeIndex];
        scores[String(currentLabel)] = 0.15;
        directNeighbors[nodeIndex].forEach(function (neighbor) {
          var neighborLabel = labels[neighbor.index];
          if (neighborLabel < 0) { return; }
          var neighborKey = String(neighborLabel);
          scores[neighborKey] = (scores[neighborKey] || 0) + neighbor.weight;
        });
        memberships[nodeIndex].forEach(function (membership) {
          var tagLabel = tagLabels[membership.tagIndex];
          if (tagLabel === undefined || tagLabel < 0) { return; }
          var membershipEvidence = tagMembershipScore(
            membership.weight,
            membershipCount[membership.tagIndex] || 1,
            targetClusterSize,
            settings.tagSpecificity
          );
          membershipEvidence *= primaryTags[nodeIndex] === membership.tagIndex
            ? 1.25
            : 0.45;
          var tagLabelKey = String(tagLabel);
          scores[tagLabelKey] = (scores[tagLabelKey] || 0) + membershipEvidence;
        });
        var bestLabel = currentLabel;
        var bestScore = scores[String(currentLabel)] || 0;
        Object.keys(scores).forEach(function (labelKey) {
          var label = Number(labelKey);
          var score = scores[labelKey];
          if (score > bestScore ||
              score === bestScore && label < bestLabel) {
            bestLabel = label;
            bestScore = score;
          }
        });
        nextLabels[nodeIndex] = bestLabel;
      }
      labels = nextLabels;
    }

    var labelKeys = {};
    for (var labeled = 0; labeled < count; labeled += 1) {
      if (candidateNodes[labeled].kind !== 'tag') {
        labelKeys[String(labels[labeled])] = true;
      }
    }
    var sortedLabels = Object.keys(labelKeys).map(function (value) {
      return Number(value);
    }).sort(function (left, right) { return left - right; });
    var labelToCommunity = {};
    sortedLabels.forEach(function (label, community) {
      labelToCommunity[String(label)] = community;
    });
    var ids = new Int32Array(count);
    for (var idIndex = 0; idIndex < count; idIndex += 1) { ids[idIndex] = -1; }
    var sizes = [];
    sortedLabels.forEach(function () { sizes.push(0); });
    for (var assigned = 0; assigned < count; assigned += 1) {
      if (candidateNodes[assigned].kind === 'tag') { continue; }
      var assignedCommunity = labelToCommunity[String(labels[assigned])];
      ids[assigned] = assignedCommunity;
      sizes[assignedCommunity] += 1;
    }

    Object.keys(tagMembers).forEach(function (tagKey) {
      var communityScores = {};
      tagMembers[tagKey].forEach(function (member) {
        var memberCommunity = ids[member.nodeIndex];
        if (memberCommunity < 0) { return; }
        var score = tagMembershipScore(
          member.weight,
          membershipCount[Number(tagKey)] || 1,
          targetClusterSize,
          settings.tagSpecificity
        );
        communityScores[String(memberCommunity)] =
          (communityScores[String(memberCommunity)] || 0) + score;
      });
      var bestCommunity = -1;
      var bestCommunityScore = -Infinity;
      Object.keys(communityScores).forEach(function (communityKey) {
        var community = Number(communityKey);
        var score = communityScores[communityKey];
        if (score > bestCommunityScore ||
            score === bestCommunityScore &&
            (bestCommunity < 0 || community < bestCommunity)) {
          bestCommunity = community;
          bestCommunityScore = score;
        }
      });
      var tagIndex = Number(tagKey);
      if (tagIndex >= 0 && tagIndex < count) {
        ids[tagIndex] = bestCommunity;
      }
    });
    var communityEdgeWeights = {};
    analyticalEdges.forEach(function (edge) {
      var sourceIndex = candidateIndexById[edge.source];
      var targetIndex = candidateIndexById[edge.target];
      if (sourceIndex === undefined || targetIndex === undefined ||
          candidateNodes[sourceIndex].kind === 'tag' ||
          candidateNodes[targetIndex].kind === 'tag') {
        return;
      }
      var sourceCommunity = ids[sourceIndex];
      var targetCommunity = ids[targetIndex];
      if (sourceCommunity < 0 || targetCommunity < 0 ||
          sourceCommunity === targetCommunity) {
        return;
      }
      var edgeWeight = 0.6;
      if (edge.types.indexOf('wiki-link') !== -1) { edgeWeight += 3.5; }
      if (edge.types.indexOf('heading') !== -1) { edgeWeight += 1.5; }
      var low = Math.min(sourceCommunity, targetCommunity);
      var high = Math.max(sourceCommunity, targetCommunity);
      var key = low + ':' + high;
      communityEdgeWeights[key] = (communityEdgeWeights[key] || 0) + edgeWeight;
    });
    var edges = Object.keys(communityEdgeWeights).map(function (key) {
      var parts = key.split(':');
      return {
        a: Number(parts[0]),
        b: Number(parts[1]),
        weight: communityEdgeWeights[key]
      };
    });
    return { ids: ids, sizes: sizes, edges: edges };
  }

  function selectSalientEdges(
    candidateNodes,
    allEdges,
    density,
    specificity,
    bridgeStrength
  ) {
    var nodeById = {};
    candidateNodes.forEach(function (node) { nodeById[node.id] = node; });
    var memberCountByTag = {};
    var sourceCount = candidateNodes.filter(function (node) {
      return node.kind !== 'tag';
    }).length;
    var targetClusterSize = Math.max(3, Math.sqrt(sourceCount));
    allEdges.forEach(function (edge) {
      if (edge.types.indexOf('tag-membership') === -1) { return; }
      var tagId = nodeById[edge.source].kind === 'tag'
        ? edge.source
        : edge.target;
      var tagKey = tagId.slice(4);
      memberCountByTag[tagKey] = (memberCountByTag[tagKey] || 0) + 1;
    });
    var primaryTagByNode = {};
    var membershipsByNode = {};
    allEdges.forEach(function (edge) {
      if (edge.types.indexOf('tag-membership') === -1) { return; }
      var noteId = nodeById[edge.source].kind === 'tag'
        ? edge.target
        : edge.source;
      var tagId = nodeById[edge.source].kind === 'tag'
        ? edge.source
        : edge.target;
      (membershipsByNode[noteId] || (membershipsByNode[noteId] = []))
        .push({ edge: edge, tagId: tagId });
    });
    Object.keys(membershipsByNode).forEach(function (nodeId) {
      membershipsByNode[nodeId].sort(function (left, right) {
        return tagMembershipScore(
          right.edge.weight,
          memberCountByTag[right.tagId.slice(4)] || 1,
          targetClusterSize,
          specificity
        ) - tagMembershipScore(
          left.edge.weight,
          memberCountByTag[left.tagId.slice(4)] || 1,
          targetClusterSize,
          specificity
        ) || left.tagId.localeCompare(right.tagId);
      });
      primaryTagByNode[nodeId] = membershipsByNode[nodeId][0].tagId;
    });

    var scored = allEdges.map(function (edge) {
      return {
        edge: edge,
        score: graphEdgeSalience(
          edge,
          nodeById,
          memberCountByTag,
          targetClusterSize,
          primaryTagByNode,
          bridgeStrength,
          specificity
        )
      };
    });
    var incident = {};
    scored.forEach(function (item) {
      [item.edge.source, item.edge.target].forEach(function (nodeId) {
        (incident[nodeId] || (incident[nodeId] = [])).push(item);
      });
    });

    var clampedDensity = Math.max(
      0.15,
      Math.min(1, finiteNumber(density, 0.45))
    );
    var selectedByNode = {};
    Object.keys(incident).forEach(function (nodeId) {
      var node = nodeById[nodeId];
      var tagCount = node.kind === 'tag'
        ? memberCountByTag[nodeId.slice(4)] || 1
        : 0;
      var budget = node.kind === 'tag'
        ? Math.max(
          8,
          Math.round(5 + Math.sqrt(tagCount) * (1 + clampedDensity * 2))
        )
        : Math.max(3, Math.round(3 + clampedDensity * 7));
      incident[nodeId].sort(function (left, right) {
        return right.score - left.score ||
          left.edge.id.localeCompare(right.edge.id);
      });
      selectedByNode[nodeId] = {};
      incident[nodeId].slice(0, budget).forEach(function (item) {
        selectedByNode[nodeId][item.edge.id] = true;
      });
    });

    var minimumScore = 0.06 + (1 - clampedDensity) * 0.1;
    return scored
      .filter(function (item) {
        if (item.score < minimumScore) { return false; }
        var edge = item.edge;
        var selectedA = selectedByNode[edge.source] &&
          selectedByNode[edge.source][edge.id];
        var selectedB = selectedByNode[edge.target] &&
          selectedByNode[edge.target][edge.id];
        var hasTagRelationship =
          edge.types.indexOf('tag-membership') !== -1 ||
          edge.types.indexOf('associated-tag') !== -1;
        return hasTagRelationship
          ? selectedA && selectedB
          : selectedA || selectedB;
      })
      .map(function (item) { return item.edge; });
  }

  function tagMembershipScore(weight, memberCount, targetClusterSize, specificity) {
    var fit = memberCount > 1
      ? 1 / (1 + Math.abs(Math.log(memberCount / targetClusterSize)))
      : 0.05;
    var support = memberCount > 1
      ? Math.min(
        1,
        Math.log1p(memberCount) / Math.log1p(targetClusterSize)
      )
      : 0.05;
    var exponent = 0.5 + unitValue(specificity, 0.75) * 2.5;
    return weight * Math.pow(fit, exponent) * support * 3;
  }

  function graphEdgeSalience(
    edge,
    nodeById,
    memberCountByTag,
    targetClusterSize,
    primaryTagByNode,
    bridgeStrength,
    specificity
  ) {
    var score = 0;
    if (edge.types.indexOf('wiki-link') !== -1) { score += 2.5; }
    if (edge.types.indexOf('heading') !== -1) { score += 0.9; }
    if (edge.types.indexOf('associated-tag') !== -1) {
      score += (0.25 + Math.min(0.75, edge.weight)) *
        unitValue(bridgeStrength, 0.25);
    }
    if (edge.types.indexOf('tag-membership') !== -1) {
      var noteId = nodeById[edge.source].kind === 'tag'
        ? edge.target
        : edge.source;
      var tagId = nodeById[edge.source].kind === 'tag'
        ? edge.source
        : edge.target;
      var memberCount = memberCountByTag[tagId.slice(4)] || 1;
      var membershipScore = tagMembershipScore(
        edge.weight,
        memberCount,
        targetClusterSize,
        specificity
      );
      var isPrimary = primaryTagByNode[noteId] === tagId;
      var bridge = unitValue(bridgeStrength, 0.25);
      score += isPrimary ? membershipScore : membershipScore * bridge;
    }
    return score;
  }

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function unitValue(value, fallback) {
    return Math.max(0, Math.min(1, finiteNumber(value, fallback)));
  }

  function isDimmed(index) {
    if (hoverIndex >= 0) {
      return index !== hoverIndex && !hoverNeighbors[index];
    }
    if (matchSet && !matchSet[index]) { return true; }
    if (tagMatchSet && !tagMatchSet[index]) { return true; }
    if (selectedIndex >= 0) {
      return index !== selectedIndex && !selectedNeighbors[index];
    }
    return false;
  }

  function setSelectedIndex(index) {
    selectedIndex = index;
    selectedId = index >= 0 ? nodes[index].id : null;
    selectedNeighbors = {};
    if (index >= 0) {
      adjacency[index].forEach(function (neighbor) {
        selectedNeighbors[neighbor] = true;
      });
    }
  }

  function setHoverIndex(index) {
    hoverIndex = index;
    hoverNeighbors = {};
    if (index >= 0) {
      adjacency[index].forEach(function (neighbor) {
        hoverNeighbors[neighbor] = true;
      });
    }
  }

  function findNodeIndex(nodeId) {
    return nodeId && nodeIndexById[nodeId] !== undefined
      ? nodeIndexById[nodeId]
      : -1;
  }

  function isRendered(index) {
    return nodes[index].kind !== 'tag' ||
      settings.showTags ||
      index === selectedIndex ||
      index === hoverIndex ||
      selectedNeighbors[index];
  }

  function isPhysicalNode(index) {
    return nodes[index].kind !== 'tag';
  }

  // ---- simulation -------------------------------------------------------
  function tickCommunityAnchors() {
    if (communityCount === 0) { return; }
    var macroStrength = Math.max(0.25, settings.linkStrength) *
      0.035 * alpha;
    var macroDistance = settings.linkDistance *
      (3 + settings.communitySpacing);
    communityEdges.forEach(function (edge) {
      var dx = communityAnchorX[edge.b] - communityAnchorX[edge.a];
      var dy = communityAnchorY[edge.b] - communityAnchorY[edge.a];
      var distance = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      var strength = macroStrength * Math.min(1, edge.weight / 6);
      var delta = (distance - macroDistance) / distance * strength;
      communityVx[edge.b] -= dx * delta;
      communityVy[edge.b] -= dy * delta;
      communityVx[edge.a] += dx * delta;
      communityVy[edge.a] += dy * delta;
    });

    // Community anchors are few compared with graph nodes. A bounded
    // pairwise pass keeps nearby communities separated while large graphs
    // retain their deterministic spiral spacing without an O(n^2) fallback.
    if (communityCount <= 384) {
      for (var left = 0; left < communityCount; left += 1) {
        for (var right = left + 1; right < communityCount; right += 1) {
          var separationX = communityAnchorX[right] - communityAnchorX[left];
          var separationY = communityAnchorY[right] - communityAnchorY[left];
          var separation = Math.sqrt(
            separationX * separationX + separationY * separationY
          ) || 1e-6;
          var desiredSeparation = 90 * settings.communitySpacing +
            3 * (
              Math.sqrt(communitySizes[left]) +
              Math.sqrt(communitySizes[right])
            );
          if (separation >= desiredSeparation) { continue; }
          var separationForce = (desiredSeparation - separation) /
            separation * 0.025 * alpha;
          communityVx[right] += separationX * separationForce;
          communityVy[right] += separationY * separationForce;
          communityVx[left] -= separationX * separationForce;
          communityVy[left] -= separationY * separationForce;
        }
      }
    }

    var center = settings.centerStrength * 0.0008 * alpha;
    for (var community = 0; community < communityCount; community += 1) {
      communityVx[community] -= communityAnchorX[community] * center;
      communityVy[community] -= communityAnchorY[community] * center;
      communityVx[community] *= 0.75;
      communityVy[community] *= 0.75;
      communityAnchorX[community] += communityVx[community];
      communityAnchorY[community] += communityVy[community];
    }
    for (var tag = 0; tag < nodes.length; tag += 1) {
      if (nodes[tag].kind !== 'tag') { continue; }
      var tagCommunity = communityId[tag];
      if (tagCommunity >= 0) {
        px[tag] = communityAnchorX[tagCommunity] + tagOffsetX[tag];
        py[tag] = communityAnchorY[tagCommunity] + tagOffsetY[tag];
      }
      vx[tag] = 0;
      vy[tag] = 0;
    }
  }

  function tick() {
    var count = nodes.length;
    if (count === 0) { return; }

    tickCommunityAnchors();

    // Link springs, degree-biased like d3-force so hubs move less.
    var linkDistance = settings.linkDistance;
    for (var e = 0; e < edges.length; e += 1) {
      var edge = edges[e];
      var isMembership = edge.types.indexOf('tag-membership') !== -1;
      var isAssociation = edge.types.indexOf('associated-tag') !== -1;
      if (!settings.showTags && (isMembership || isAssociation)) {
        continue;
      }
      var dx = (px[edge.b] + vx[edge.b]) - (px[edge.a] + vx[edge.a]);
      var dy = (py[edge.b] + vy[edge.b]) - (py[edge.a] + vy[edge.a]);
      var distance = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      var minDegree = Math.min(degrees[edge.a], degrees[edge.b]) || 1;
      var strength = settings.linkStrength * Math.min(1, edge.weight) / minDegree;
      var desiredDistance = linkDistance;
      if (isMembership) {
        var membershipNote = nodes[edge.a].kind === 'tag' ? edge.b : edge.a;
        var membershipTag = nodes[edge.a].kind === 'tag' ? edge.a : edge.b;
        var isPrimaryMembership = primaryTag[membershipNote] === membershipTag;
        strength *= isPrimaryMembership ? 3 : 0.08;
        desiredDistance *= isPrimaryMembership ? 0.8 : 1.6;
      } else if (isAssociation) {
        // Associations influence neighboring communities without collapsing
        // every tag anchor into one dense central component.
        strength *= 0.2;
        desiredDistance *= 1.8;
      }
      var delta = (distance - desiredDistance) / distance * alpha * strength;
      var bias = degrees[edge.a] / (degrees[edge.a] + degrees[edge.b] || 1);
      vx[edge.b] -= dx * delta * bias;
      vy[edge.b] -= dy * delta * bias;
      vx[edge.a] += dx * delta * (1 - bias);
      vy[edge.a] += dy * delta * (1 - bias);
    }

    applyRepulsion();

    // Virtual community anchors keep hidden tags from becoming high-mass
    // particles while still pulling each note/task into a compact island.
    var clusterGravity = Math.max(0.25, settings.linkStrength) *
      settings.clusterCohesion * 0.035 * alpha;
    for (var clustered = 0; clustered < count; clustered += 1) {
      if (nodes[clustered].kind === 'tag' || clustered === dragIndex) {
        continue;
      }
      var community = communityId[clustered];
      if (community < 0) { continue; }
      var clusterDx = communityAnchorX[community] - px[clustered];
      var clusterDy = communityAnchorY[community] - py[clustered];
      vx[clustered] += clusterDx * clusterGravity;
      vy[clustered] += clusterDy * clusterGravity;
    }

    // Tags are cluster anchors. Center only those anchors (plus truly
    // untagged nodes) so tagged notes orbit their communities instead of
    // collapsing into one global sun.
    var center = settings.centerStrength * 0.006 * alpha;
    for (var i = 0; i < count; i += 1) {
      if (nodes[i].kind === 'tag') {
        var tagCommunity = communityId[i];
        if (tagCommunity >= 0) {
          px[i] = communityAnchorX[tagCommunity] + tagOffsetX[i];
          py[i] = communityAnchorY[tagCommunity] + tagOffsetY[i];
        }
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      var centerScale = nodes[i].kind === 'tag'
        ? 1
        : nodes[i].tagKeys.length === 0 ? 0.2 : 0;
      vx[i] -= px[i] * center * centerScale;
      vy[i] -= py[i] * center * centerScale;
      vx[i] *= velocityDecay;
      vy[i] *= velocityDecay;
      if (i !== dragIndex) {
        px[i] += vx[i];
        py[i] += vy[i];
      }
    }

    alpha += (0 - alpha) * alphaDecay;
    if (alpha < alphaMin) { alpha = 0; }
  }

  // Barnes-Hut approximation: build a quadtree each tick and treat far cells
  // as single point charges (theta = 0.9).
  function applyRepulsion() {
    var physicalIndices = [];
    for (var physical = 0; physical < nodes.length; physical += 1) {
      if (isPhysicalNode(physical)) { physicalIndices.push(physical); }
    }
    if (physicalIndices.length < 2) { return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < physicalIndices.length; i += 1) {
      var physicalIndex = physicalIndices[i];
      if (px[physicalIndex] < minX) { minX = px[physicalIndex]; }
      if (px[physicalIndex] > maxX) { maxX = px[physicalIndex]; }
      if (py[physicalIndex] < minY) { minY = py[physicalIndex]; }
      if (py[physicalIndex] > maxY) { maxY = py[physicalIndex]; }
    }
    var size = Math.max(maxX - minX, maxY - minY) || 1;

    function makeCell(x0, y0, extent) {
      return { x0: x0, y0: y0, extent: extent, mass: 0, cx: 0, cy: 0, nodeIndex: -1, children: null };
    }
    var root = makeCell(minX, minY, size);
    function nodeMass(index) {
      if (nodes[index].kind !== 'tag') { return 1; }
      return primaryClusterSize[index] > 0
        ? 2 + Math.min(4, Math.sqrt(primaryClusterSize[index]))
        : 0.35;
    }

    function insert(cell, index) {
      var insertedMass = nodeMass(index);
      if (cell.mass === 0 && cell.nodeIndex === -1 && cell.children === null) {
        cell.nodeIndex = index;
        cell.mass = insertedMass;
        cell.cx = px[index];
        cell.cy = py[index];
        return;
      }
      if (cell.children === null) {
        var existing = cell.nodeIndex;
        cell.nodeIndex = -1;
        cell.children = [null, null, null, null];
        if (existing !== -1) { placeInChild(cell, existing); }
      }
      placeInChild(cell, index);
      cell.cx = (cell.cx * cell.mass + px[index] * insertedMass) /
        (cell.mass + insertedMass);
      cell.cy = (cell.cy * cell.mass + py[index] * insertedMass) /
        (cell.mass + insertedMass);
      cell.mass += insertedMass;
    }

    function placeInChild(cell, index) {
      var half = cell.extent / 2;
      var right = px[index] >= cell.x0 + half ? 1 : 0;
      var bottom = py[index] >= cell.y0 + half ? 1 : 0;
      var slot = bottom * 2 + right;
      if (cell.children[slot] === null) {
        cell.children[slot] = makeCell(
          cell.x0 + right * half,
          cell.y0 + bottom * half,
          half
        );
      }
      var child = cell.children[slot];
      if (child.extent < 1e-4) {
        // Coincident points: merge into the child as extra mass.
        var insertedMass = nodeMass(index);
        child.cx = (child.cx * child.mass + px[index] * insertedMass) /
          (child.mass + insertedMass);
        child.cy = (child.cy * child.mass + py[index] * insertedMass) /
          (child.mass + insertedMass);
        child.mass += insertedMass;
        return;
      }
      insert(child, index);
    }

    for (var n = 0; n < physicalIndices.length; n += 1) {
      insert(root, physicalIndices[n]);
    }

    var theta2 = 0.81;
    var repel = settings.repelStrength;
    function applyCell(cell, index) {
      if (cell === null || cell.mass === 0) { return; }
      var dx = cell.cx - px[index];
      var dy = cell.cy - py[index];
      var dist2 = dx * dx + dy * dy;
      var farEnough = cell.extent * cell.extent / dist2 < theta2;
      if (cell.children === null || farEnough) {
        if (cell.nodeIndex === index) { return; }
        if (dist2 < 1e-6) {
          dx = (index % 7 - 3) * 0.01 || 0.01;
          dy = (index % 5 - 2) * 0.01 || 0.01;
          dist2 = dx * dx + dy * dy;
        }
        if (dist2 < 16) { dist2 = 16; }
        var targetCharge = nodes[index].kind === 'tag'
          ? primaryClusterSize[index] > 0 ? 1.5 : 0.5
          : 1;
        var force = repel * cell.mass * targetCharge * alpha / dist2;
        var dist = Math.sqrt(dist2);
        vx[index] -= dx / dist * force;
        vy[index] -= dy / dist * force;
        return;
      }
      applyCell(cell.children[0], index);
      applyCell(cell.children[1], index);
      applyCell(cell.children[2], index);
      applyCell(cell.children[3], index);
    }

    for (var target = 0; target < physicalIndices.length; target += 1) {
      applyCell(root, physicalIndices[target]);
    }
  }

  // ---- rendering --------------------------------------------------------
  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    scheduleFrame();
  }

  function nodeRadius(index) {
    return (2 + Math.sqrt(degrees[index])) * settings.nodeSize;
  }

  function draw() {
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    if (nodes.length === 0) { updateZoomReadout(); return; }

    var k = camera.k;
    ctx.setTransform(k * dpr, 0, 0, k * dpr, camera.x * dpr, camera.y * dpr);

    // Visible world rectangle with margin for culling.
    var margin = 80 / k;
    var worldLeft = -camera.x / k - margin;
    var worldTop = -camera.y / k - margin;
    var worldRight = (width - camera.x) / k + margin;
    var worldBottom = (height - camera.y) / k + margin;
    function inView(index) {
      return px[index] >= worldLeft && px[index] <= worldRight &&
        py[index] >= worldTop && py[index] <= worldBottom;
    }

    var hovering = hoverIndex >= 0;
    var focusIndex = hovering ? hoverIndex : selectedIndex;
    var dimmingActive = focusIndex >= 0 || matchSet !== null || tagMatchSet !== null;

    // Edges: one batched path for base edges, a second for highlighted ones.
    var edgeAlpha = Math.min(0.45, 0.1 + 0.18 * k);
    ctx.lineWidth = settings.linkThickness / k;
    ctx.strokeStyle = colors.edge;
    ctx.globalAlpha = dimmingActive ? edgeAlpha * 0.25 : edgeAlpha;
    ctx.beginPath();
    var highlighted = [];
    for (var e = 0; e < edges.length; e += 1) {
      var edge = edges[e];
      if (!isRendered(edge.a) || !isRendered(edge.b)) { continue; }
      if (!inView(edge.a) && !inView(edge.b)) { continue; }
      if (focusIndex >= 0 && (edge.a === focusIndex || edge.b === focusIndex)) {
        highlighted.push(edge);
        continue;
      }
      ctx.moveTo(px[edge.a], py[edge.a]);
      ctx.lineTo(px[edge.b], py[edge.b]);
    }
    ctx.stroke();
    if (highlighted.length > 0) {
      ctx.strokeStyle = colors.edgeHighlight;
      ctx.globalAlpha = Math.min(0.9, edgeAlpha * 3);
      ctx.beginPath();
      highlighted.forEach(function (h) {
        ctx.moveTo(px[h.a], py[h.a]);
        ctx.lineTo(px[h.b], py[h.b]);
      });
      ctx.stroke();
    }

    // Nodes retain their established kind colors.
    var kinds = ['note', 'task', 'tag'];
    var kindColors = { note: colors.note, task: colors.task, tag: colors.tag };
    for (var pass = 0; pass < 2; pass += 1) {
      var dimPass = pass === 1;
      ctx.globalAlpha = dimPass ? 0.15 : 1;
      for (var c = 0; c < kinds.length; c += 1) {
        var kind = kinds[c];
        ctx.fillStyle = kindColors[kind];
        ctx.beginPath();
        for (var i = 0; i < nodes.length; i += 1) {
          if (nodes[i].kind !== kind || !isRendered(i) || !inView(i)) { continue; }
          if (isDimmed(i) !== dimPass) { continue; }
          var radius = nodeRadius(i);
          ctx.moveTo(px[i] + radius, py[i]);
          ctx.arc(px[i], py[i], radius, 0, 6.2832);
        }
        ctx.fill();
      }
    }

    // Selection halo persists; hover halo follows the pointer.
    if (selectedIndex >= 0 && isRendered(selectedIndex)) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.halo;
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      ctx.arc(px[selectedIndex], py[selectedIndex], nodeRadius(selectedIndex) + 4 / k, 0, 6.2832);
      ctx.stroke();
    }
    if (hovering && isRendered(hoverIndex) && hoverIndex !== selectedIndex) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.halo;
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      ctx.arc(px[hoverIndex], py[hoverIndex], nodeRadius(hoverIndex) + 3 / k, 0, 6.2832);
      ctx.stroke();
    }

    // Labels in screen space. Zoomed in past the threshold every node that
    // is big enough is named; at rest the few best-connected nodes on screen
    // are, so an overview reads as places rather than as density alone.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    if (k < settings.labelThreshold) {
      ctx.fillStyle = colors.label;
      ctx.font = '10px ' + (rootStyles.getPropertyValue('--font-mono') || 'monospace');
      ctx.textAlign = 'center';
      var hubs = [];
      for (var h = 0; h < nodes.length; h += 1) {
        if (!isRendered(h) || !inView(h) || isDimmed(h) || nodes[h].kind === 'tag') { continue; }
        if (degrees[h] < 2) { continue; }
        hubs.push(h);
      }
      hubs.sort(function (a, b) { return degrees[b] - degrees[a]; });
      ctx.globalAlpha = 0.85;
      for (var u = 0; u < Math.min(hubs.length, HUB_LABELS_AT_REST); u += 1) {
        var hub = hubs[u];
        var hx = px[hub] * k + camera.x;
        var hy = py[hub] * k + camera.y;
        var hubTitle = nodes[hub].title;
        if (hubTitle.length > 28) { hubTitle = hubTitle.slice(0, 27) + '…'; }
        ctx.fillText(hubTitle, hx, hy + nodeRadius(hub) * k + 11);
      }
      ctx.globalAlpha = 1;
    }
    if (k >= settings.labelThreshold) {
      ctx.fillStyle = colors.label;
      ctx.font = '10px ' + (rootStyles.getPropertyValue('--font-mono') || 'monospace');
      ctx.textAlign = 'center';
      var labeled = [];
      for (var l = 0; l < nodes.length; l += 1) {
        if (!isRendered(l) || !inView(l) || isDimmed(l)) { continue; }
        if (nodeRadius(l) * k <= 8) { continue; }
        labeled.push(l);
      }
      labeled.sort(function (a, b) { return degrees[b] - degrees[a]; });
      var maxLabels = Math.min(labeled.length, 300);
      var fade = Math.min(1, (k - settings.labelThreshold) / 0.5 + 0.35);
      ctx.globalAlpha = fade;
      for (var t = 0; t < maxLabels; t += 1) {
        var index = labeled[t];
        var sx = px[index] * k + camera.x;
        var sy = py[index] * k + camera.y;
        var title = nodes[index].title;
        if (title.length > 28) { title = title.slice(0, 27) + '…'; }
        ctx.fillText(title, sx, sy + nodeRadius(index) * k + 11);
      }
      ctx.globalAlpha = 1;
    }

    updateZoomReadout();
  }

  function updateZoomReadout() {
    zoomReadout.textContent = Math.round(camera.k * 100) + '%';
  }

  function updateStatus() {
    if (!snapshot) { return; }
    var visibleEdgeCount = edges.filter(function (edge) {
      return isRendered(edge.a) && isRendered(edge.b);
    }).length;
    var matchCount = matchSet ? Object.keys(matchSet).length : -1;
    var searchNote = matchCount >= 0
      ? matchCount + (matchCount === 1 ? ' match' : ' matches') + ' · '
      : '';
    statusCounts.textContent = searchNote + snapshot.totalNoteCount + ' notes · ' +
      snapshot.totalTaskCount + ' tasks · ' + visibleEdgeCount +
      ' strong links / ' + snapshot.edges.length + ' indexed · ' +
      communityCount + ' communities';
  }

  // ---- frame loop -------------------------------------------------------
  function scheduleFrame() {
    needsDraw = true;
    if (frameQueued) { return; }
    frameQueued = true;
    requestAnimationFrame(frame);
  }

  function frame() {
    frameQueued = false;
    var start = performance.now();
    var ticked = false;
    while (alpha > 0 && performance.now() - start < 8) {
      tick();
      ticked = true;
    }
    if (ticked || needsDraw) {
      needsDraw = false;
      draw();
      rebuildHitGrid();
    }
    simNote.hidden = alpha <= 0;
    if (alpha > 0) {
      frameQueued = true;
      requestAnimationFrame(frame);
    }
  }

  function reheat(target) {
    alpha = Math.max(alpha, target);
    scheduleFrame();
  }

  // ---- hit testing ------------------------------------------------------
  var hitGrid = {};
  var hitCell = 64;
  function rebuildHitGrid() {
    hitGrid = {};
    for (var i = 0; i < nodes.length; i += 1) {
      if (!isRendered(i)) { continue; }
      var key = Math.floor(px[i] / hitCell) + ':' + Math.floor(py[i] / hitCell);
      (hitGrid[key] || (hitGrid[key] = [])).push(i);
    }
  }

  function nodeAt(worldX, worldY) {
    var cellX = Math.floor(worldX / hitCell);
    var cellY = Math.floor(worldY / hitCell);
    var best = -1;
    var bestDist = Infinity;
    for (var gx = cellX - 1; gx <= cellX + 1; gx += 1) {
      for (var gy = cellY - 1; gy <= cellY + 1; gy += 1) {
        var bucket = hitGrid[gx + ':' + gy];
        if (!bucket) { continue; }
        for (var b = 0; b < bucket.length; b += 1) {
          var index = bucket[b];
          var dx = px[index] - worldX;
          var dy = py[index] - worldY;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var reach = Math.max(nodeRadius(index), 8 / camera.k) + 2 / camera.k;
          if (dist <= reach && dist < bestDist) {
            best = index;
            bestDist = dist;
          }
        }
      }
    }
    return best;
  }

  function toWorld(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - camera.x) / camera.k,
      y: (clientY - rect.top - camera.y) / camera.k
    };
  }

  // ---- camera -----------------------------------------------------------
  function zoomAt(clientX, clientY, factor) {
    var rect = canvas.getBoundingClientRect();
    var mx = clientX - rect.left;
    var my = clientY - rect.top;
    var next = Math.min(8, Math.max(0.02, camera.k * factor));
    camera.x = mx - (mx - camera.x) * (next / camera.k);
    camera.y = my - (my - camera.y) * (next / camera.k);
    camera.k = next;
    persist();
    scheduleFrame();
  }

  function fitToView() {
    if (nodes.length === 0) { return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < nodes.length; i += 1) {
      if (px[i] < minX) { minX = px[i]; }
      if (px[i] > maxX) { maxX = px[i]; }
      if (py[i] < minY) { minY = py[i]; }
      if (py[i] > maxY) { maxY = py[i]; }
    }
    var width = canvas.clientWidth || 800;
    var height = canvas.clientHeight || 600;
    var spanX = Math.max(maxX - minX, 1);
    var spanY = Math.max(maxY - minY, 1);
    var k = Math.min(8, Math.max(0.02, Math.min(
      (width - 80) / spanX,
      (height - 80) / spanY
    )));
    camera.k = k;
    camera.x = width / 2 - (minX + spanX / 2) * k;
    camera.y = height / 2 - (minY + spanY / 2) * k;
    persist();
    scheduleFrame();
  }

  // ---- pointer interaction ---------------------------------------------
  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.002));
  }, { passive: false });

  canvas.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) { return; }
    pointerId = event.pointerId;
    pointerDownAt = { x: event.clientX, y: event.clientY };
    pointerMoved = false;
    var world = toWorld(event.clientX, event.clientY);
    var hit = nodeAt(world.x, world.y);
    if (hit >= 0) {
      dragIndex = hit;
      vx[hit] = 0; vy[hit] = 0;
    } else {
      panning = true;
      canvas.classList.add('is-panning');
    }
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', function (event) {
    if (pointerId === event.pointerId && pointerDownAt) {
      var movedX = event.clientX - pointerDownAt.x;
      var movedY = event.clientY - pointerDownAt.y;
      if (Math.abs(movedX) + Math.abs(movedY) > 3) { pointerMoved = true; }
      if (panning) {
        camera.x += event.movementX;
        camera.y += event.movementY;
        scheduleFrame();
        return;
      }
      if (dragIndex >= 0) {
        var world = toWorld(event.clientX, event.clientY);
        px[dragIndex] = world.x;
        py[dragIndex] = world.y;
        vx[dragIndex] = 0; vy[dragIndex] = 0;
        reheat(0.3);
        return;
      }
    }
    var hoverWorld = toWorld(event.clientX, event.clientY);
    var hovered = nodeAt(hoverWorld.x, hoverWorld.y);
    if (hovered !== hoverIndex) {
      setHoverIndex(hovered);
      canvas.classList.toggle('is-pointing', hovered >= 0);
      scheduleFrame();
    }
    if (hovered >= 0) {
      showTooltip(hovered, event.clientX, event.clientY);
    } else {
      hideTooltip();
    }
  });

  function endPointer(event) {
    if (pointerId !== event.pointerId) { return; }
    var wasDrag = dragIndex;
    var clicked = !pointerMoved;
    dragIndex = -1;
    panning = false;
    pointerId = -1;
    pointerDownAt = null;
    canvas.classList.remove('is-panning');
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (wasDrag >= 0 && !clicked) { reheat(0.3); persist(); return; }
    persist();
    if (!clicked) { return; }
    if (wasDrag >= 0) {
      // Cmd/Ctrl+click opens the source; a plain click selects the node and
      // surfaces direct graph connections in the sidebar.
      if (event.metaKey || event.ctrlKey) {
        openNode(wasDrag);
      } else {
        selectNode(wasDrag);
      }
      return;
    }
    if (selectedIndex >= 0) {
      setSelectedIndex(-1);
      vscode.postMessage({ type: 'clearSelection' });
      scheduleFrame();
    }
  }
  /**
   * Move the selection between nodes without a pointer.
   *
   * The graph is a canvas, so there is nothing for Tab to land on inside it:
   * without this the whole view could be looked at but never used from the
   * keyboard. Nodes are visited in the order they are drawn, and the camera
   * follows the selection so it is never off screen.
   */
  canvas.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setSelectedIndex(-1);
      vscode.postMessage({ type: 'selectNode', nodeId: null });
      scheduleFrame();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (selectedIndex >= 0) {
        event.preventDefault();
        openNode(selectedIndex);
      }
      return;
    }
    var forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    var backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) { return; }
    event.preventDefault();
    var visible = [];
    for (var i = 0; i < nodes.length; i += 1) {
      if (isRendered(i)) { visible.push(i); }
    }
    if (!visible.length) { return; }
    var current = visible.indexOf(selectedIndex);
    var next = current < 0
      ? (forward ? 0 : visible.length - 1)
      : (current + (forward ? 1 : -1) + visible.length) % visible.length;
    selectNode(visible[next]);
    centerOnNode(visible[next]);
  });

  /** Bring a node into view, keeping the current zoom. */
  function centerOnNode(index) {
    var width = canvas.clientWidth || 800;
    var height = canvas.clientHeight || 600;
    camera.x = width / 2 - px[index] * camera.k;
    camera.y = height / 2 - py[index] * camera.k;
    persist();
    scheduleFrame();
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function () {
    if (pointerId === -1 && hoverIndex !== -1) {
      setHoverIndex(findNodeIndex(externalHoverNodeId));
      canvas.classList.remove('is-pointing');
      hideTooltip();
      scheduleFrame();
    }
  });

  function selectNode(index) {
    setSelectedIndex(index);
    scheduleFrame();
    var node = nodes[index];
    if (node) {
      vscode.postMessage({ type: 'selectNode', nodeId: node.id });
    }
  }

  function openNode(index) {
    var node = nodes[index];
    if (!node) { return; }
    if (node.kind === 'tag') {
      vscode.postMessage({ type: 'openTag', tagKey: node.id.slice(4) });
      return;
    }
    if (node.filePath && node.line) {
      vscode.postMessage({ type: 'openSource', filePath: node.filePath, line: node.line });
    }
  }

  function showTooltip(index, clientX, clientY) {
    var node = nodes[index];
    tooltip.textContent = '';
    var title = document.createElement('div');
    title.className = 'tooltip-title';
    title.textContent = node.title;
    tooltip.appendChild(title);
    var meta = document.createElement('div');
    meta.className = 'tooltip-meta';
    if (node.kind === 'tag') {
      meta.textContent = 'Tag · ' + degrees[index] + ' connections';
    } else {
      var fileName = node.filePath ? node.filePath.split('/').pop() : '';
      meta.textContent = (node.kind === 'task' ? 'Task · ' : '') + fileName +
        ':' + node.line + ' · ' + degrees[index] + ' links';
    }
    tooltip.appendChild(meta);
    tooltip.style.display = 'block';
    var offset = 14;
    var maxX = window.innerWidth - tooltip.offsetWidth - 8;
    var maxY = window.innerHeight - tooltip.offsetHeight - 8;
    tooltip.style.left = Math.min(clientX + offset, maxX) + 'px';
    tooltip.style.top = Math.min(clientY + offset, maxY) + 'px';
  }

  function hideTooltip() {
    tooltip.style.display = 'none';
  }

  // ---- controls ---------------------------------------------------------
  function bindToggle(id, key, needsRebuild) {
    var element = document.getElementById(id);
    element.checked = settings[key];
    element.addEventListener('change', function () {
      settings[key] = element.checked;
      persist();
      if (needsRebuild) { rebuildView(); } else { scheduleFrame(); }
    });
  }
  /**
   * Drawing around the note in the editor is the host's business: it sends
   * the neighbourhood rather than the workspace, so the page asks and draws
   * whatever comes back.
   */
  var localGraph = document.getElementById('local-graph');
  var localDepth = document.getElementById('local-depth');
  var localDepthOut = document.getElementById('local-depth-out');
  var focusNote = document.getElementById('focus-note');
  function requestScope() {
    localDepthOut.textContent = localDepth.value;
    vscode.postMessage({
      type: 'setGraphScope',
      local: localGraph.checked,
      depth: Number(localDepth.value),
    });
  }
  localGraph.addEventListener('change', requestScope);
  localDepth.addEventListener('input', function () {
    localDepthOut.textContent = localDepth.value;
  });
  localDepth.addEventListener('change', requestScope);
  /** Says which note the graph is drawn around, and what that costs. */
  function updateFocus() {
    var focus = snapshot && snapshot.focus;
    if (!focus) { return; }
    localGraph.checked = Boolean(focus.local);
    localDepth.value = String(focus.depth || 1);
    localDepthOut.textContent = localDepth.value;
    if (!focus.title) {
      focusNote.textContent = 'Open a note to draw the graph around it.';
      return;
    }
    focusNote.textContent = focus.local
      ? focus.title + ' · ' + snapshot.nodes.length + ' of ' + focus.workspaceNodeCount + ' nodes'
      : 'Around ' + focus.title + ', when this is on.';
  }
  bindToggle('show-notes', 'showNotes', true);
  bindToggle('show-tasks', 'showTasks', true);
  bindToggle('show-tags', 'showTags', true);
  bindToggle('show-orphans', 'showOrphans', true);
  bindToggle('show-all-links', 'showAllLinks', true);

  function resetGraphSettings() {
    Object.keys(defaults).forEach(function (key) {
      settings[key] = Array.isArray(defaults[key])
        ? defaults[key].slice()
        : defaults[key];
    });
    ['show-notes', 'show-tasks', 'show-tags', 'show-orphans', 'show-all-links']
      .forEach(function (id) {
        var key = id.replace(/-([a-z])/g, function (_, letter) {
          return letter.toUpperCase();
        });
        document.getElementById(id).checked = settings[key];
      });
    [
      ['node-size', 'nodeSize', 1],
      ['link-thickness', 'linkThickness', 1],
      ['link-density', 'linkDensity', 2],
      ['tag-specificity', 'tagSpecificity', 2],
      ['bridge-strength', 'bridgeStrength', 2],
      ['label-threshold', 'labelThreshold', 1],
      ['center-strength', 'centerStrength', 2],
      ['cluster-cohesion', 'clusterCohesion', 1],
      ['community-spacing', 'communitySpacing', 1],
      ['repel-strength', 'repelStrength', 0],
      ['link-strength', 'linkStrength', 2],
      ['link-distance', 'linkDistance', 0]
    ].forEach(function (definition) {
      var input = document.getElementById(definition[0]);
      input.value = String(settings[definition[1]]);
      document.getElementById(definition[0] + '-out').textContent =
        Number(settings[definition[1]]).toFixed(definition[2]);
    });
    searchInput.value = settings.search;
    tagSearchInput.value = '';
    window.clearTimeout(searchTimer);
    camera = { x: 0, y: 0, k: 1 };
    hasFramed = false;
    persist();
    renderTagList();
    rebuildView(true);
    if (vx && vy) {
      vx.fill(0);
      vy.fill(0);
    }
    reheat(1);
  }
  document.getElementById('reset-graph-settings').addEventListener(
    'click',
    resetGraphSettings
  );

  function bindSlider(id, key, decimals, onChange) {
    var element = document.getElementById(id);
    var output = document.getElementById(id + '-out');
    element.value = String(settings[key]);
    output.textContent = Number(settings[key]).toFixed(decimals);
    element.addEventListener('input', function () {
      settings[key] = Number(element.value);
      output.textContent = Number(settings[key]).toFixed(decimals);
      persist();
      onChange();
    });
  }
  bindSlider('node-size', 'nodeSize', 1, scheduleFrame);
  bindSlider('link-thickness', 'linkThickness', 1, scheduleFrame);
  bindSlider('link-density', 'linkDensity', 2, rebuildView);
  bindSlider('tag-specificity', 'tagSpecificity', 2, rebuildView);
  bindSlider('bridge-strength', 'bridgeStrength', 2, rebuildView);
  bindSlider('label-threshold', 'labelThreshold', 1, scheduleFrame);
  bindSlider('center-strength', 'centerStrength', 2, function () { reheat(0.5); });
  bindSlider('cluster-cohesion', 'clusterCohesion', 1, function () { reheat(0.5); });
  bindSlider('community-spacing', 'communitySpacing', 1, function () {
    hasFramed = false;
    rebuildView(true);
  });
  bindSlider('repel-strength', 'repelStrength', 0, function () { reheat(0.5); });
  bindSlider('link-strength', 'linkStrength', 2, function () { reheat(0.5); });
  bindSlider('link-distance', 'linkDistance', 0, function () { reheat(0.5); });

  var searchInput = document.getElementById('search');
  searchInput.value = settings.search;
  var searchTimer = 0;
  searchInput.addEventListener('input', function () {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      settings.search = searchInput.value;
      persist();
      recomputeSearchMatches();
      scheduleFrame();
    }, 150);
  });

  var tagListElement = document.getElementById('tag-list');
  var tagSearchInput = document.getElementById('tag-search');
  var maximumTagRows = 200;

  function renderTagList() {
    if (!snapshot) { return; }
    var filter = tagSearchInput.value.trim().toLowerCase();
    var selected = {};
    settings.selectedTags.forEach(function (key) { selected[key] = true; });
    tagListElement.textContent = '';
    var shown = 0;
    var total = 0;
    snapshot.tags.forEach(function (entry) {
      var key = entry[0];
      var label = entry[1];
      var count = entry[2];
      if (filter && label.toLowerCase().indexOf(filter) === -1) { return; }
      total += 1;
      if (shown >= maximumTagRows) { return; }
      shown += 1;
      var row = document.createElement('label');
      row.className = 'toggle-row';
      row.title = 'Filter to nodes carrying the ' + label + ' tag.';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.title = row.title;
      checkbox.checked = Boolean(selected[key]);
      checkbox.addEventListener('change', function () {
        var next = settings.selectedTags.filter(function (item) { return item !== key; });
        if (checkbox.checked) { next.push(key); }
        settings.selectedTags = next;
        persist();
        recomputeTagMatches();
        scheduleFrame();
      });
      var text = document.createElement('span');
      text.textContent = label;
      var countBadge = document.createElement('span');
      countBadge.className = 'tag-count';
      countBadge.textContent = String(count);
      row.appendChild(checkbox);
      row.appendChild(text);
      row.appendChild(countBadge);
      tagListElement.appendChild(row);
    });
    if (total > shown) {
      var note = document.createElement('div');
      note.className = 'tag-list-note';
      note.textContent = (total - shown) + ' more — refine the tag filter';
      tagListElement.appendChild(note);
    }
    if (total === 0) {
      var emptyNote = document.createElement('div');
      emptyNote.className = 'tag-list-note';
      emptyNote.textContent = 'No matching tags';
      tagListElement.appendChild(emptyNote);
    }
  }

  var tagSearchTimer = 0;
  tagSearchInput.addEventListener('input', function () {
    window.clearTimeout(tagSearchTimer);
    tagSearchTimer = window.setTimeout(renderTagList, 150);
  });

  document.getElementById('clear-tags').addEventListener('click', function () {
    settings.selectedTags = [];
    persist();
    recomputeTagMatches();
    renderTagList();
    scheduleFrame();
  });

  document.getElementById('zoom-in').addEventListener('click', function () {
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.3);
  });
  document.getElementById('zoom-out').addEventListener('click', function () {
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.3);
  });
  document.getElementById('zoom-fit').addEventListener('click', fitToView);

  window.addEventListener('resize', resizeCanvas);

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (message && message.type === 'state' && message.data) {
      snapshot = message.data;
      rebuildView();
      renderTagList();
      updateFocus();
    }
    if (message && message.type === 'highlightNode') {
      externalHoverNodeId = message.nodeId || null;
      setHoverIndex(findNodeIndex(externalHoverNodeId));
      hideTooltip();
      scheduleFrame();
    }
    if (message && message.type === 'selectNode' && message.nodeId) {
      var selectedNodeIndex = findNodeIndex(message.nodeId);
      if (selectedNodeIndex >= 0) {
        setSelectedIndex(selectedNodeIndex);
        scheduleFrame();
      }
    }
  });

  resizeCanvas();
})();
</script>
</body>
</html>`;
}

