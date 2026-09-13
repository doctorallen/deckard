import * as vscode from 'vscode';

import { getDeckardTheme, getDeckardThemeCss } from './themes';

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
<style nonce="${nonce}">
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
.control-group summary:hover, .control-group summary:focus-visible { background: var(--panel-raised); outline: none; }
.control-body { display: flex; flex-direction: column; gap: 8px; padding: 4px 10px 10px; border-top: 1px solid var(--slate-border); }
.control-row { display: flex; flex-direction: column; gap: 3px; }
.control-row label { color: var(--muted); font: 10px var(--font-mono); text-transform: uppercase; }
.control-row output { color: var(--toxic-green); font: 10px var(--font-mono); }
.control-row .slider-line { display: flex; align-items: center; gap: 8px; }
input[type='range'] { flex: 1; min-width: 0; accent-color: var(--amber-bright); }
input[type='checkbox'] { accent-color: var(--amber-bright); }
.toggle-row { display: flex; align-items: center; gap: 7px; color: var(--text); font: 11px var(--font-mono); cursor: pointer; }
.graph-search, .tag-search { width: 100%; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 6px 8px; font: 11px var(--font-mono); }
.graph-search:focus, .tag-search:focus { border-color: var(--cyan-bright); outline: none; }
.tag-list { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; border: 1px solid var(--slate-border); background: var(--panel-deep); padding: 4px; }
.tag-list .toggle-row { padding: 2px 4px; font-size: 10px; }
.tag-list .toggle-row:hover { background: var(--panel-raised); }
.tag-list .tag-count { margin-left: auto; color: var(--muted); }
.tag-list-note { color: var(--muted); font: 10px var(--font-mono); padding: 2px 4px; }
.relationship-note { margin: 0; color: var(--muted); font: 10px/1.45 var(--font-mono); }
.clear-tags { align-self: flex-start; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 4px 8px; font: 10px var(--font-mono); text-transform: uppercase; cursor: pointer; }
.clear-tags:hover, .clear-tags:focus-visible { border-color: var(--amber-bright); color: var(--amber-bright); outline: none; }
.zoom-controls { position: absolute; z-index: 2; right: 12px; bottom: 34px; display: inline-flex; }
.zoom-controls button { min-width: 32px; min-height: 30px; border: 1px solid var(--slate-border); background: rgba(8, 10, 14, .94); color: var(--text); padding: 4px 8px; font: 12px var(--font-mono); cursor: pointer; }
.zoom-controls button + button, .zoom-controls .zoom-readout + button { margin-left: -1px; }
.zoom-controls button:hover, .zoom-controls button:focus-visible { border-color: var(--amber-bright); color: var(--amber-bright); outline: none; position: relative; }
.zoom-readout { display: inline-grid; place-items: center; min-width: 58px; margin-left: -1px; border-block: 1px solid var(--slate-border); background: rgba(8, 10, 14, .94); color: var(--muted); font: 10px var(--font-mono); }
.status-line { position: absolute; z-index: 2; left: 12px; bottom: 10px; display: flex; gap: 12px; color: var(--muted); font: 10px var(--font-mono); text-transform: uppercase; pointer-events: none; }
.status-line .sim-note { color: var(--amber-bright); }
.tooltip { position: absolute; z-index: 3; display: none; max-width: 320px; border: 1px solid var(--slate-border); background: rgba(8, 10, 14, .97); padding: 6px 9px; pointer-events: none; }
.tooltip .tooltip-title { color: var(--text); font: 700 11px var(--font-mono); }
.tooltip .tooltip-meta { color: var(--muted); font: 10px var(--font-mono); margin-top: 2px; }
.empty-state { position: absolute; z-index: 1; inset: 0; display: none; place-items: center; color: var(--muted); font: 12px var(--font-mono); text-transform: uppercase; pointer-events: none; }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<canvas id="graph" aria-label="Notes graph"></canvas>
<div class="empty-state" id="empty-state">No indexed notes yet — save a Markdown file with tags or links.</div>
<div class="overlay" role="group" aria-label="Graph controls">
  <details class="control-group" open>
    <summary>Filters</summary>
    <div class="control-body">
      <input class="graph-search" id="search" type="search" placeholder="Search notes…" aria-label="Search graph nodes">
      <label class="toggle-row"><input type="checkbox" id="show-tasks" checked> Show tasks</label>
      <label class="toggle-row"><input type="checkbox" id="show-tags"> Show tags</label>
      <label class="toggle-row"><input type="checkbox" id="show-orphans" checked> Show orphans</label>
      <input class="tag-search" id="tag-search" type="search" placeholder="Filter tag list…" aria-label="Filter tag checklist">
      <div class="tag-list" id="tag-list" role="group" aria-label="Tag filters"></div>
      <button class="clear-tags" id="clear-tags" type="button">Clear tag filters</button>
    </div>
  </details>
  <details class="control-group">
    <summary>Display</summary>
    <div class="control-body">
      <div class="control-row"><label for="node-size">Node size</label><div class="slider-line"><input type="range" id="node-size" min="0.5" max="3" step="0.1" value="1"><output id="node-size-out">1.0</output></div></div>
      <div class="control-row"><label for="link-thickness">Link thickness</label><div class="slider-line"><input type="range" id="link-thickness" min="0.5" max="3" step="0.1" value="1"><output id="link-thickness-out">1.0</output></div></div>
      <div class="control-row"><label for="label-threshold">Label fade zoom</label><div class="slider-line"><input type="range" id="label-threshold" min="0.5" max="4" step="0.1" value="1.4"><output id="label-threshold-out">1.4</output></div></div>
    </div>
  </details>
  <details class="control-group">
    <summary>Forces</summary>
    <div class="control-body">
      <div class="control-row"><label for="center-strength">Cluster centering</label><div class="slider-line"><input type="range" id="center-strength" min="0" max="1" step="0.05" value="0.4"><output id="center-strength-out">0.40</output></div></div>
      <div class="control-row"><label for="repel-strength">Repel strength</label><div class="slider-line"><input type="range" id="repel-strength" min="50" max="2000" step="25" value="400"><output id="repel-strength-out">400</output></div></div>
      <div class="control-row"><label for="link-strength">Link strength</label><div class="slider-line"><input type="range" id="link-strength" min="0" max="2" step="0.05" value="1"><output id="link-strength-out">1.00</output></div></div>
      <div class="control-row"><label for="link-distance">Link distance</label><div class="slider-line"><input type="range" id="link-distance" min="10" max="200" step="5" value="40"><output id="link-distance-out">40</output></div></div>
    </div>
  </details>
  <details class="control-group">
    <summary>Relationships</summary>
    <div class="control-body">
      <p class="relationship-note">Specific tags act as stronger gravity wells than common tags. Visible resting links are Wiki links and heading structure; enable Show tags to reveal membership and learned tag-association links.</p>
      <p class="relationship-note">Selecting a note overlays its top Related Notes results, including shared and associated tags, links, lexical similarity, and optional recency scoring.</p>
    </div>
  </details>
</div>
<div class="zoom-controls" role="group" aria-label="Zoom controls">
  <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
  <span class="zoom-readout" id="zoom-readout">100%</span>
  <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
  <button type="button" id="zoom-fit" aria-label="Fit graph to view">Fit</button>
</div>
<div class="status-line"><span id="status-counts"></span><span class="sim-note" id="sim-note" hidden>Simulating…</span></div>
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
    showTasks: true,
    showTags: false,
    showOrphans: true,
    selectedTags: [],
    search: '',
    nodeSize: 1,
    linkThickness: 1,
    labelThreshold: 1.4,
    centerStrength: 0.4,
    repelStrength: 400,
    linkStrength: 1,
    linkDistance: 40
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
  var externalHoverSource = null;
  var selectedId = null;        // sticky selection survives snapshot rebuilds
  var selectedIndex = -1;
  var selectedNeighbors = {};
  var relatedSources = [];
  var selectedRelated = {};

  // ---- view construction ------------------------------------------------
  function rebuildView() {
    if (!snapshot) { return; }
    var previous = {};
    for (var p = 0; p < nodes.length; p += 1) {
      previous[nodes[p].id] = { x: px[p], y: py[p], vx: vx[p], vy: vy[p] };
    }

    var candidate = snapshot.nodes.filter(function (node) {
      if (node.kind === 'task' && !settings.showTasks) { return false; }
      return true;
    });
    var candidateIndex = {};
    candidate.forEach(function (node, index) { candidateIndex[node.id] = index; });

    var candidateEdges = snapshot.edges.filter(function (edge) {
      return candidateIndex[edge.source] !== undefined &&
        candidateIndex[edge.target] !== undefined;
    });

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
    var primaryTag = new Int32Array(count);
    var primaryTagWeight = new Float32Array(count);
    for (var a = 0; a < count; a += 1) { adjacency.push([]); }
    for (var pTag = 0; pTag < count; pTag += 1) { primaryTag[pTag] = -1; }
    edges.forEach(function (edge) {
      degrees[edge.a] += 1;
      degrees[edge.b] += 1;
      adjacency[edge.a].push(edge.b);
      adjacency[edge.b].push(edge.a);
      if (edge.types.indexOf('tag-membership') !== -1) {
        var noteIndex = nodes[edge.a].kind === 'tag' ? edge.b : edge.a;
        var tagIndex = nodes[edge.a].kind === 'tag' ? edge.a : edge.b;
        if (edge.weight > primaryTagWeight[noteIndex]) {
          primaryTag[noteIndex] = tagIndex;
          primaryTagWeight[noteIndex] = edge.weight;
        }
      }
    });

    var reusedAny = false;
    var retained = {};
    var tagOrdinal = 0;
    for (var i = 0; i < count; i += 1) {
      var currentTagOrdinal = nodes[i].kind === 'tag' ? tagOrdinal++ : -1;
      var kept = previous[nodes[i].id];
      if (kept) {
        px[i] = kept.x; py[i] = kept.y; vx[i] = kept.vx; vy[i] = kept.vy;
        retained[i] = true;
        reusedAny = true;
      } else if (nodes[i].kind === 'tag') {
        // Spread invisible tag anchors first so communities start separated.
        var radius = 90 * Math.sqrt(currentTagOrdinal);
        var angle = currentTagOrdinal * 2.39996322972865332;
        px[i] = radius * Math.cos(angle);
        py[i] = radius * Math.sin(angle);
        vx[i] = 0; vy[i] = 0;
      }
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
    setHoverIndex(findSourceIndex(externalHoverSource));
    hideTooltip();
    var restoredSelection = selectedId !== null &&
      nodeIndexById[selectedId] !== undefined
      ? nodeIndexById[selectedId]
      : -1;
    setSelectedIndex(restoredSelection);
    rebuildRelatedIndices();
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

  function isDimmed(index) {
    if (hoverIndex >= 0) {
      return index !== hoverIndex && !hoverNeighbors[index];
    }
    if (matchSet && !matchSet[index]) { return true; }
    if (tagMatchSet && !tagMatchSet[index]) { return true; }
    if (selectedIndex >= 0) {
      return index !== selectedIndex &&
        !selectedNeighbors[index] &&
        !selectedRelated[index];
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

  function rebuildRelatedIndices() {
    selectedRelated = {};
    relatedSources.forEach(function (source) {
      var index = findSourceIndex(source);
      if (index >= 0 && index !== selectedIndex) {
        selectedRelated[index] = true;
      }
    });
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

  function findSourceIndex(source) {
    if (!source) { return -1; }
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].filePath === source.filePath && nodes[i].line === source.line) {
        return i;
      }
    }
    return -1;
  }

  function isRendered(index) {
    return nodes[index].kind !== 'tag' || settings.showTags;
  }

  // ---- simulation -------------------------------------------------------
  function tick() {
    var count = nodes.length;
    if (count === 0) { return; }

    // Link springs, degree-biased like d3-force so hubs move less.
    var linkDistance = settings.linkDistance;
    for (var e = 0; e < edges.length; e += 1) {
      var edge = edges[e];
      var dx = (px[edge.b] + vx[edge.b]) - (px[edge.a] + vx[edge.a]);
      var dy = (py[edge.b] + vy[edge.b]) - (py[edge.a] + vy[edge.a]);
      var distance = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      var minDegree = Math.min(degrees[edge.a], degrees[edge.b]) || 1;
      var strength = settings.linkStrength * Math.min(1, edge.weight) / minDegree;
      var isMembership = edge.types.indexOf('tag-membership') !== -1;
      var desiredDistance = isMembership ? linkDistance * 1.25 : linkDistance;
      var delta = (distance - desiredDistance) / distance * alpha * strength;
      var bias = degrees[edge.a] / (degrees[edge.a] + degrees[edge.b] || 1);
      vx[edge.b] -= dx * delta * bias;
      vy[edge.b] -= dy * delta * bias;
      vx[edge.a] += dx * delta * (1 - bias);
      vy[edge.a] += dy * delta * (1 - bias);
    }

    applyRepulsion();

    // Tags are cluster anchors. Center only those anchors (plus truly
    // untagged nodes) so tagged notes orbit their communities instead of
    // collapsing into one global sun.
    var center = settings.centerStrength * 0.006 * alpha;
    for (var i = 0; i < count; i += 1) {
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
    var count = nodes.length;
    if (count < 2) { return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < count; i += 1) {
      if (px[i] < minX) { minX = px[i]; }
      if (px[i] > maxX) { maxX = px[i]; }
      if (py[i] < minY) { minY = py[i]; }
      if (py[i] > maxY) { maxY = py[i]; }
    }
    var size = Math.max(maxX - minX, maxY - minY) || 1;

    function makeCell(x0, y0, extent) {
      return { x0: x0, y0: y0, extent: extent, mass: 0, cx: 0, cy: 0, nodeIndex: -1, children: null };
    }
    var root = makeCell(minX, minY, size);
    function nodeMass(index) {
      return nodes[index].kind === 'tag'
        ? 1 + Math.min(3, Math.sqrt(degrees[index]) * 0.5)
        : 1;
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

    for (var n = 0; n < count; n += 1) { insert(root, n); }

    var theta2 = 0.81;
    var repel = settings.repelStrength;
    function applyCell(cell, index) {
      if (cell === null || cell.mass === 0) { return; }
      var dx = cell.cx - px[index];
      var dy = cell.cy - py[index];
      var dist2 = dx * dx + dy * dy;
      var farEnough = cell.extent * cell.extent / dist2 < theta2;
      if (cell.children === null || farEnough) {
        if (cell.nodeIndex === index && cell.mass === 1) { return; }
        if (dist2 < 1e-6) {
          dx = (index % 7 - 3) * 0.01 || 0.01;
          dy = (index % 5 - 2) * 0.01 || 0.01;
          dist2 = dx * dx + dy * dy;
        }
        if (dist2 < 16) { dist2 = 16; }
        var targetCharge = nodes[index].kind === 'tag' ? 1.5 : 1;
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

    for (var target = 0; target < count; target += 1) {
      applyCell(root, target);
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
    if (!hovering && selectedIndex >= 0) {
      Object.keys(selectedRelated).forEach(function (key) {
        var relatedIndex = Number(key);
        if (!inView(selectedIndex) && !inView(relatedIndex)) { return; }
        highlighted.push({ a: selectedIndex, b: relatedIndex });
      });
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

    // Nodes: batch full-opacity and dimmed passes per kind color.
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

    // Labels in screen space, only when zoomed in enough (LOD).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
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
    statusCounts.textContent = snapshot.totalNoteCount + ' notes · ' +
      snapshot.totalTaskCount + ' tasks · ' + visibleEdgeCount + ' visible links';
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
      // surfaces its connections in the Related Notes sidebar.
      if (event.metaKey || event.ctrlKey) {
        openNode(wasDrag);
      } else {
        selectNode(wasDrag);
      }
      return;
    }
    if (selectedIndex >= 0) {
      relatedSources = [];
      selectedRelated = {};
      setSelectedIndex(-1);
      scheduleFrame();
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function () {
    if (pointerId === -1 && hoverIndex !== -1) {
      setHoverIndex(findSourceIndex(externalHoverSource));
      canvas.classList.remove('is-pointing');
      hideTooltip();
      scheduleFrame();
    }
  });

  function selectNode(index) {
    relatedSources = [];
    selectedRelated = {};
    setSelectedIndex(index);
    scheduleFrame();
    var node = nodes[index];
    if (node && node.kind !== 'tag' && node.filePath && node.line) {
      vscode.postMessage({
        type: 'showConnections',
        filePath: node.filePath,
        line: node.line
      });
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
  bindToggle('show-tasks', 'showTasks', true);
  bindToggle('show-tags', 'showTags', true);
  bindToggle('show-orphans', 'showOrphans', true);

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
  bindSlider('label-threshold', 'labelThreshold', 1, scheduleFrame);
  bindSlider('center-strength', 'centerStrength', 2, function () { reheat(0.5); });
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
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
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
    }
    if (message && message.type === 'highlightSource') {
      externalHoverSource = message.filePath && message.line
        ? { filePath: message.filePath, line: message.line }
        : null;
      setHoverIndex(findSourceIndex(externalHoverSource));
      hideTooltip();
      scheduleFrame();
    }
    if (message && message.type === 'relatedSources' && message.source) {
      var selected = selectedIndex >= 0 ? nodes[selectedIndex] : null;
      if (selected &&
          selected.filePath === message.source.filePath &&
          selected.line === message.source.line &&
          Array.isArray(message.sources)) {
        relatedSources = message.sources;
        rebuildRelatedIndices();
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

function createNonce(): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}
