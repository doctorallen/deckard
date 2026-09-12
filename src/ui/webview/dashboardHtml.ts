import * as vscode from 'vscode';

import { getDeckardTheme, getDeckardThemeCss } from './themes';
import { getFavoriteHeartAssetUris, settingsIcon } from './icons';

/**
 * Builds the dashboard document and its self-contained interaction layer.
 *
 * The webview receives state snapshots rather than querying VS Code directly,
 * keeping rendering deterministic and leaving validation to the extension host.
 */
export function getDashboardHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  extensionUri: vscode.Uri,
): string {
  const nonce = createNonce();
  const favoriteHeartUris = getFavoriteHeartAssetUris(webview, extensionUri);
  const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Dashboard</title>
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
  --grid-line: rgba(255, 176, 0, 0.075);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-width: 280px;
  background-color: var(--bg-dark);
  background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 13px;
}
main { position: relative; width: 100%; max-width: 1180px; margin: 0 auto; padding: 24px; border: 0; }
header { display: flex; justify-content: space-between; gap: 20px; align-items: end; border-bottom: 1px dashed var(--slate-border); padding-bottom: 16px; }
h1, h2, h3, .eyebrow, .metric-value, .tag-name, .task-meta, .telemetry-line, .section-readout { font-family: var(--font-mono); }
h1 { margin: 0; color: var(--text); font-size: 22px; font-weight: 700; text-transform: uppercase; }
h2 { margin: 0 0 4px; color: var(--cyan-bright); font-size: 14px; font-weight: 650; text-transform: uppercase; }
.eyebrow { margin: 0 0 6px; color: var(--amber-bright); font-size: 11px; }
.telemetry-line { display: flex; flex-wrap: wrap; gap: 12px; color: var(--muted); font-size: 10px; text-transform: uppercase; }
.telemetry-line span:first-child { color: var(--cyan-bright); }
.telemetry-line span:last-child { color: var(--toxic-green); }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; min-width: min(380px, 48%); }
.metric { position: relative; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); padding: 10px 12px; background: var(--panel-bg); }
.metric::before { content: attr(data-code); display: block; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--slate-border); color: var(--amber-dim); font: 9px var(--font-mono); text-transform: uppercase; }
.metric-value { display: block; color: var(--toxic-green); font-size: 20px; }
.metric-label { display: block; color: var(--muted); font-size: 11px; margin-top: 3px; }
.dashboard-header-actions { display: flex; align-self: flex-start; align-items: flex-start; gap: 12px; margin-left: auto; }
.dashboard-view-options { position: relative; flex: 0 0 auto; order: 2; }
.dashboard-view-options summary { display: grid; width: 30px; min-height: 30px; place-items: center; border: 2px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px; cursor: pointer; list-style: none; }
.dashboard-view-options summary::-webkit-details-marker { display: none; }
.dashboard-view-options summary:hover { border-color: var(--amber-bright); color: var(--amber-bright); background: var(--panel-raised); }
.dashboard-view-options summary:focus-visible { outline: 2px solid var(--cyan-bright); outline-offset: 2px; }
.dashboard-view-options-menu { position: absolute; z-index: 3; top: calc(100% + 5px); right: 0; display: grid; gap: 10px; min-width: 210px; padding: 10px; border: 1px solid var(--slate-border); background: var(--panel-raised); }
.dashboard-view-options-group { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font: 11px var(--font-mono); text-transform: uppercase; }
.dashboard-column-options { display: inline-flex; }
.dashboard-column-options button { width: 28px; min-height: 28px; padding: 4px; }
.dashboard-column-options button + button { margin-left: -1px; }
.dashboard-column-options button:first-child { border-radius: 2px 0 0 2px; }
.dashboard-column-options button:last-child { border-radius: 0 2px 2px 0; }
.dashboard-column-options button.active { position: relative; z-index: 1; }
.settings-icon { width: 16px; height: 16px; fill: currentColor; stroke: none; }
.saved-filters { padding-top: 16px; }
.dashboard-tabs-row { padding-bottom: 8px; border-bottom: 2px solid var(--slate-border); }
.dashboard-tabs { display: inline-flex; margin-top: 18px; }
.dashboard-tabs button + button { margin-left: -1px; }
.dashboard-tabs button:first-child { border-radius: 2px 0 0 2px; }
.dashboard-tabs button:last-child { border-radius: 0 2px 2px 0; }
.dashboard-tabs button[aria-selected="true"] { position: relative; z-index: 1; color: var(--panel-deep); background: var(--amber-bright); }
.dashboard-panel { min-width: 0; padding-top: 16px; }
.dashboard-panel[hidden] { display: none; }
section { min-width: 0; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.control-row { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center; overflow-x: auto; padding-bottom: 2px; }
.control-label { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; color: var(--muted); font: 11px var(--font-mono); text-transform: uppercase; }
.control-icon { position: relative; display: inline-block; }
.control-icon-svg { position: absolute; z-index: 1; top: 50%; left: 8px; width: 14px; height: 14px; pointer-events: none; color: var(--text); transform: translateY(-50%); }
.control-icon select:hover + .control-icon-svg { color: var(--amber-bright); }
.control-icon select { padding-left: 29px; }
button, select, input[type="search"] { min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: 11px var(--font-mono); text-transform: uppercase; }
input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }
button { cursor: pointer; }
button:hover, button.active, select:hover { border-color: var(--amber-bright); color: var(--amber-bright); background: var(--panel-raised); }
button:focus-visible, select:focus-visible, input:focus-visible, .tag-row.is-draggable:focus-visible, .entity-row:focus-visible, .task-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.toolbar-toggle { display: inline-grid; width: 30px; min-height: 30px; place-items: center; padding: 5px; }
.toolbar-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.toolbar-toggle-group { display: inline-flex; }
.toolbar-toggle-group .toolbar-toggle + .toolbar-toggle { margin-left: -1px; }
.toolbar-toggle-group .toolbar-toggle:first-child { border-radius: 2px 0 0 2px; }
.toolbar-toggle-group .toolbar-toggle:last-child { border-radius: 0 2px 2px 0; }
.toolbar-toggle-group .toolbar-toggle.active { position: relative; z-index: 1; }
.tag-list, .task-list, .note-list { display: grid; grid-template-columns: repeat(var(--dashboard-columns, 1), 1fr); gap: 7px; }
.entity-list { display: grid; gap: 7px; margin-bottom: 18px; }
.saved-filter-list { display: grid; gap: 7px; margin-bottom: 18px; }
.saved-filter-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; border: 1px solid var(--slate-border); background: var(--panel-bg); padding: 8px; cursor: pointer; transition: background-color 120ms ease, transform 120ms ease; }
.saved-filter-row:hover { border-color: var(--amber-bright); background: var(--panel-raised); transform: translateX(3px); }
.saved-filter-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.saved-filter-name { color: var(--cyan-bright); font: 12px var(--font-mono); overflow-wrap: anywhere; }
.saved-filter-tags { margin-top: 3px; color: var(--muted); font: 10px var(--font-mono); overflow-wrap: anywhere; }
.saved-filter-remove { min-height: 26px; color: var(--muted); text-transform: none; }
.entity-row { display: flex; justify-content: space-between; gap: 8px; align-items: center; border: 1px solid var(--slate-border); background: var(--panel-bg); padding: 8px; cursor: pointer; }
.entity-row:hover { border-color: var(--amber-bright); }
.entity-main { display: flex; min-width: 0; align-items: center; gap: 8px; }
.entity-row.is-draggable { cursor: grab; touch-action: none; }
.entity-kind { color: var(--muted); font: 10px var(--font-mono); text-transform: uppercase; }
.tag-group { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px dashed var(--slate-border); }
.tag-group h3 { margin: 0 0 7px; color: var(--amber-bright); font-size: 11px; font-weight: 500; text-transform: uppercase; }
.section-readout { color: var(--muted); font-size: 9px; text-transform: uppercase; }
.tag-row, .task-row { position: relative; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); background: var(--panel-bg); cursor: pointer; }
.tag-row { display: grid; grid-template-columns: 1fr auto; gap: 7px; padding: 8px; }
.tag-row.is-draggable { cursor: grab; touch-action: none; }
.tag-row.is-draggable:active, .entity-row.is-draggable:active, .task-row.is-draggable:active { cursor: grabbing; }
.tag-row.is-dragging, .entity-row.is-dragging, .task-row.is-dragging { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
.drag-ghost { position: fixed; z-index: 10; top: -10000px; left: -10000px; pointer-events: none; opacity: .95; border: 1px solid var(--amber-bright); background: var(--panel-raised); }
.drag-placeholder { border: 1px dashed var(--toxic-green); background: transparent; opacity: .9; pointer-events: none; }
.tag-main { min-width: 0; display: flex; align-items: center; gap: 8px; }
.tag-name { overflow-wrap: anywhere; color: var(--cyan-bright); }
.tag-count { color: var(--muted); font-family: var(--font-mono); }
.tag-actions { display: flex; align-items: center; gap: 5px; }
.tag-actions button { min-height: 26px; padding-inline: 7px; }
.favorite-toggle { display: grid; place-items: center; color: var(--favorite-red); }
.favorite-toggle:hover, .favorite-toggle:focus-visible { color: var(--favorite-red); }
.favorite-heart { display: block; width: 16px; height: 16px; background-color: currentColor; -webkit-mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; }
.favorite-toggle.favorite .favorite-heart { -webkit-mask-image: url("${favoriteHeartUris.filled}"); mask-image: url("${favoriteHeartUris.filled}"); }
.task-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding-bottom: 2px; margin-bottom: 8px; }
.task-toolbar > * { flex: 0 0 auto; }
.toolbar-controls { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-left: auto; }
.toolbar-controls > * { flex: 0 0 auto; }
.task-tag-filter-control { display: flex; align-items: center; gap: 6px; }
.task-filter-toggle { display: inline-flex; }
.task-filter-toggle button + button { margin-left: -1px; }
.task-filter-toggle button:first-child { border-radius: 2px 0 0 2px; }
.task-filter-toggle button:last-child { border-radius: 0 2px 2px 0; }
.task-filter-toggle button.active { position: relative; z-index: 1; }
.task-filter-toggle button { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; padding: 5px 8px; }
.task-filter-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.filter-count { color: var(--muted); font-size: 10px; }
.selected-task-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
.selected-task-tag { min-height: 26px; color: var(--cyan-bright); text-transform: none; }
.selected-task-tag::after { content: " ×"; color: var(--muted); }
.clear-task-filters { color: var(--amber-bright); }
.browse-toolbar { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 2px; margin-bottom: 12px; }
.browse-toolbar > * { flex: 0 0 auto; }
.browse-toolbar-controls { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.browse-toolbar-controls > * { flex: 0 0 auto; }
.browse-scope { display: inline-flex; }
.browse-scope button + button { margin-left: -1px; }
.catalog-search, .task-search, .note-search { width: min(220px, 40vw); border-color: var(--cyan-bright); }
.tag-filter { position: relative; }
.tag-filter summary { position: relative; display: flex; align-items: center; min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px 9px 5px 29px; cursor: pointer; list-style: none; font: 11px var(--font-mono); font-weight: 700; text-transform: uppercase; }
.tag-filter summary .control-icon-svg { color: inherit; }
.tag-filter summary::-webkit-details-marker { display: none; }
.tag-filter summary:hover { border-color: var(--amber-bright); color: var(--amber-bright); }
.tag-filter-menu { position: absolute; z-index: 2; top: calc(100% + 5px); right: 0; min-width: 210px; max-width: min(300px, 80vw); padding: 9px; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); background: var(--panel-raised); }
.tag-filter-search-control { display: flex; align-items: center; margin-bottom: 10px; }
.tag-filter-search { display: block; width: 100%; min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px 7px 5px 29px; font: 11px var(--font-mono); }
input.tag-filter-search { padding: 5px 7px 5px 29px; }
.tag-filter-options { display: grid; gap: 7px; max-height: 220px; overflow-y: auto; }
.tag-filter-option { display: flex; align-items: center; gap: 7px; overflow-wrap: anywhere; }
.tag-filter-option input { flex: 0 0 auto; accent-color: var(--toxic-green); }
.tag-filter-no-results { display: block; margin-top: 8px; color: var(--muted); }
.tag-filter-no-results[hidden] { display: none; }
.tag-filter-clear { margin-top: 9px; color: var(--amber-bright); }
.task-row { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: start; padding: 10px; cursor: pointer; }
.task-row:hover { border-color: var(--amber-bright); }
.task-row.is-draggable { cursor: grab; touch-action: none; }
.task-row input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--toxic-green); }
.note-row { min-width: 0; border: 2px solid var(--slate-border); padding: 14px; background: var(--panel-bg); cursor: pointer; }
.note-row:hover { border-color: var(--amber-bright); }
.note-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.note-row .card-header { display: block; }
.note-row .card-title { margin: 0; color: var(--cyan-bright); font-size: 16px; overflow-wrap: anywhere; }
.note-row .source { color: var(--muted); font-size: 11px; margin-top: 5px; overflow-wrap: anywhere; }
.note-row .tag-list { display: inline-flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0 8px; vertical-align: middle; }
.note-row .markdown { margin: 14px 0 0; padding: 12px; overflow-x: auto; border: 2px solid var(--slate-border); border-left: 4px solid var(--amber-bright); background: var(--panel-deep); color: var(--text); white-space: pre-wrap; font: 12px/1.55 var(--vscode-editor-font-family, ui-monospace, monospace); }
.note-row .rendered { margin-top: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.note-row .rendered :first-child { margin-top: 0; }
.note-row .rendered :last-child { margin-bottom: 0; }
.note-row .rendered code, .note-row .rendered pre { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.note-row .rendered pre { overflow-x: auto; padding: 10px; border: 2px solid var(--slate-border); background: var(--panel-deep); }
.note-row .rendered a { color: var(--cyan-bright); }
.task-title { overflow-wrap: anywhere; line-height: 1.45; }
.task-title a { color: var(--cyan-bright); }
.inline-tag { min-height: 0; margin-left: 3px; padding: 1px 4px; font-size: .85em; line-height: 1.3; text-transform: none; vertical-align: 1px; }
.task-title .inline-tag { color: var(--text); font: inherit; text-transform: none; }
.tag-namespace { opacity: .62; }
.task-row.completed .task-title { color: var(--muted); text-decoration: line-through; }
.task-meta { display: flex; gap: 8px; flex-wrap: wrap; color: #3d4145; font-size: 11px; margin-top: 5px; }
.due-date { color: var(--toxic-green); font-weight: 700; letter-spacing: .03em; }
.due-date.overdue { color: var(--favorite-red); }
.rank-context-menu { position: fixed; z-index: 20; min-width: 170px; padding: 4px; border: 1px solid var(--amber-bright); background: var(--panel-raised); box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
.rank-context-menu[hidden] { display: none; }
.rank-context-menu button { display: block; width: 100%; border: 0; padding: 8px 9px; text-align: left; text-transform: none; }
.empty { border: 1px dashed var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); padding: 18px; color: var(--muted); background: var(--panel-deep); }
.error { color: var(--warning-orange); }
@media (max-width: 720px) {
  main { padding: 16px; }
  header { align-items: start; flex-direction: column; }
  .dashboard-header-actions { width: 100%; flex-direction: column; align-items: stretch; }
  .dashboard-header-actions .dashboard-view-options { align-self: flex-end; order: -1; }
  .metrics { width: 100%; min-width: 0; }
  .tag-list, .task-list, .note-list { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading index...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  let draggedTask;
  let draggedTag;
  let draggedEntity;
  let dragGhost;
  let dragPlaceholder;
  let dropTarget;
  let dropBefore = true;
  let pointerDrag;
  let suppressDragClick = false;
  let taskSearchQuery = '';
  let taskTagQuery = '';
  let taskTagFilterOpen = false;
  let noteSearchQuery = '';
  let noteTagQuery = '';
  let noteTagFilterOpen = false;
  const noteSearchDebounceDelay = 350;
  const tagSearchDebounceDelay = 180;
  let noteSearchTimer;
  let pendingNoteSearchQuery;
  let taskTagSearchTimer;
  let noteTagSearchTimer;
  let pendingTaskTagQuery;
  let pendingNoteTagQuery;
  const restoredViewState = vscode.getState();
  let dashboardMode = restoredViewState && (
    restoredViewState.dashboardMode === 'notes' ||
    restoredViewState.dashboardMode === 'browse'
  )
    ? restoredViewState.dashboardMode
    : 'tasks';
  let taskColumns = restoredViewState && [1, 2, 3, 4].indexOf(restoredViewState.taskColumns) >= 0
    ? restoredViewState.taskColumns
    : undefined;
  let tagColumns = restoredViewState && [1, 2, 3, 4].indexOf(restoredViewState.tagColumns) >= 0
    ? restoredViewState.tagColumns
    : undefined;
  let noteColumns = restoredViewState && [1, 2, 3, 4].indexOf(restoredViewState.noteColumns) >= 0
    ? restoredViewState.noteColumns
    : undefined;
  let browseQuery = '';
  let entityKindFilter = 'all';
  let rankContextMenu;
  let rankContextKind;
  let rankContextKey;

  /** Escape state values before inserting them into the generated DOM. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function renderTagLabel(label) {
    const value = String(label);
    const match = value.match(/^([#@][^/]+\\/)(.*)$/);
    return match
      ? '<span class="tag-label"><span class="tag-namespace">' + escapeHtml(match[1]) + '</span><span class="tag-value">' + escapeHtml(match[2]) + '</span></span>'
      : '<span class="tag-label"><span class="tag-value">' + escapeHtml(value) + '</span></span>';
  }

  /** Replace source tag tokens with buttons while preserving their position. */
  function renderInlineTitle(title, tags, appendMissing) {
    const references = tags || [];
    const labels = references.map(function (tag) { return tag.label; }).filter(Boolean).sort(function (left, right) { return right.length - left.length; });
    if (!labels.length) return escapeHtml(title);
    const pattern = new RegExp(labels.map(function (label) {
      return String(label).split('').map(function (character) {
        return '[]{}()|^$+*?.-'.indexOf(character) >= 0 || character === String.fromCharCode(92)
          ? String.fromCharCode(92) + character
          : character;
      }).join('');
    }).join('|'), 'g');
    let rendered = '';
    let offset = 0;
    const matchedKeys = new Set();
    title.replace(pattern, function (match, matchOffset) {
      rendered += escapeHtml(title.slice(offset, matchOffset));
      const tag = references.find(function (candidate) { return candidate.label === match; });
      if (tag) {
        matchedKeys.add(tag.key);
      }
      rendered += tag
        ? '<button class="tag-open inline-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(tag.label) + '</button>'
        : escapeHtml(match);
      offset = matchOffset + match.length;
      return match;
    });
    const trailingTags = appendMissing === false ? '' : references
      .filter(function (tag) { return !matchedKeys.has(tag.key); })
      .map(function (tag) {
        return '<button class="tag-open inline-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(tag.label) + '</button>';
      })
      .join('');
    return rendered + escapeHtml(title.slice(offset)) + trailingTags;
  }

  /** Decorate task tag text without replacing the task's rendered Markdown. */
  function renderTaskTitle(renderedTitle, references) {
    references = references || [];
    if (!references.length) return renderedTitle;

    const template = document.createElement('template');
    template.innerHTML = renderedTitle;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (node) {
      if (node.parentElement && node.parentElement.closest('a, button')) return;
      const source = node.nodeValue || '';
      const replacementHtml = renderInlineTitle(source, references, false);
      if (replacementHtml === escapeHtml(source)) return;
      const replacement = document.createElement('template');
      replacement.innerHTML = replacementHtml;
      node.parentNode.replaceChild(replacement.content, node);
    });
    return template.innerHTML;
  }

  function formatEntityKindLabel(value) {
    return String(value).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, function (character) { return character.toUpperCase(); });
  }

  function formatTagDisplay(tag) {
    const label = String(tag.label || tag.key || '');
    const labelValue = label.replace(/^[@#]/, '');
    const name = labelValue.slice(labelValue.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
    const key = String(tag.key || '');
    const keyValue = key.replace(/^[@#]/, '');
    const separator = keyValue.indexOf('/');
    const namespace = key.startsWith('#') && separator > 0 && keyValue.slice(0, separator).toLowerCase() !== 'tag-at'
      ? keyValue.slice(0, separator).replace(/[-_]+/g, ' ')
      : '';
    return { name: name || label, namespace: namespace };
  }

  /** Use familiar list and checkbox icons without losing accessible labels. */
  function taskFilterIcon(filter) {
    if (filter === 'all') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 4h8M5 8h8M5 12h8"/><circle cx="2.5" cy="4" r=".5"/><circle cx="2.5" cy="8" r=".5"/><circle cx="2.5" cy="12" r=".5"/></svg>';
    if (filter === 'active') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';
    return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/><path d="m5.5 8 1.7 1.7 3.3-3.3"/></svg>';
  }

  function send(message) { vscode.postMessage(message); }

  /** Store only presentation state locally so data refreshes retain the active mode. */
  function saveDashboardViewState() {
    vscode.setState({
      dashboardMode: dashboardMode,
      taskColumns: taskColumns,
      tagColumns: tagColumns,
      noteColumns: noteColumns,
      taskSearchQuery: taskSearchQuery,
      noteSearchQuery: noteSearchQuery,
      browseQuery: browseQuery,
      taskTagQuery: taskTagQuery,
      noteTagQuery: noteTagQuery,
      selectedTaskTags: state ? state.selectedTaskTags : [],
      selectedNoteTags: state ? state.selectedNoteTags : [],
    });
  }

  /** Batch local note filtering and preference writes while the user types. */
  function scheduleNoteSearch(target) {
    if (noteSearchTimer) clearTimeout(noteSearchTimer);
    pendingNoteSearchQuery = noteSearchQuery;
    noteSearchTimer = setTimeout(function () {
      noteSearchTimer = undefined;
      if (pendingNoteSearchQuery === undefined) return;
      send({ type: 'setDashboardSearch', field: 'notes', query: noteSearchQuery });
      const restoreSearchFocus = document.activeElement === target;
      render();
      if (restoreSearchFocus) requestAnimationFrame(function () {
        const search = document.querySelector('.note-search');
        if (search) {
          search.focus();
          search.setSelectionRange(noteSearchQuery.length, noteSearchQuery.length);
        }
      });
    }, noteSearchDebounceDelay);
  }

  /** Keep tag-picker filtering local, then persist it after typing settles. */
  function scheduleTagFilterSearch(kind) {
    const isNoteFilter = kind === 'note';
    const timer = isNoteFilter ? noteTagSearchTimer : taskTagSearchTimer;
    if (timer) clearTimeout(timer);
    if (isNoteFilter) {
      pendingNoteTagQuery = noteTagQuery;
    } else {
      pendingTaskTagQuery = taskTagQuery;
    }
    const nextTimer = setTimeout(function () {
      if (isNoteFilter) {
        noteTagSearchTimer = undefined;
        if (pendingNoteTagQuery === undefined) return;
        send({
          type: 'setDashboardSearch',
          field: 'noteTags',
          query: noteTagQuery,
        });
      } else {
        taskTagSearchTimer = undefined;
        if (pendingTaskTagQuery === undefined) return;
        send({
          type: 'setDashboardSearch',
          field: 'taskTags',
          query: taskTagQuery,
        });
      }
    }, tagSearchDebounceDelay);
    if (isNoteFilter) {
      noteTagSearchTimer = nextTimer;
    } else {
      taskTagSearchTimer = nextTimer;
    }
  }

  function setDashboardMode(mode, focusTab) {
    dashboardMode = mode === 'notes' || mode === 'browse' ? mode : 'tasks';
    saveDashboardViewState();
    send({ type: 'setDashboardMode', mode: dashboardMode });
    render();
    if (focusTab) {
      const selectedTab = document.querySelector('[data-dashboard-mode="' + dashboardMode + '"]');
      if (selectedTab) selectedTab.focus();
    }
  }

  /** Apply grid changes without replacing the open View options control. */
  function applyDashboardColumns(section, columns) {
    if (section === 'tasks') {
      taskColumns = columns;
      if (state) state.taskColumns = columns;
    } else if (section === 'notes') {
      noteColumns = columns;
      if (state) state.noteColumns = columns;
    } else {
      tagColumns = columns;
      if (state) state.tagColumns = columns;
    }
    const selector = section === 'tasks'
      ? '.task-list'
      : section === 'notes'
        ? '.note-list'
        : '.tag-list';
    document.querySelectorAll(selector).forEach(function (grid) {
      grid.style.gridTemplateColumns = 'repeat(' + columns + ', 1fr)';
    });
    document.querySelectorAll('[data-action="set-columns"][data-section="' + section + '"]').forEach(function (button) {
      const selected = Number(button.dataset.columns) === columns;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  /** Ranked modes alone have a meaningful user-controlled display order. */
  function canRank(kind) {
    return Boolean(state) && (
      kind === 'tag' ? state.tagSortMode === 'custom' :
      kind === 'entity' ? state.entitySortMode === 'custom' :
      state.taskSortMode === 'rank'
    );
  }

  /** Keep the transient context menu from surviving a state refresh. */
  function closeRankContextMenu() {
    if (rankContextMenu) rankContextMenu.hidden = true;
    rankContextKind = undefined;
    rankContextKey = undefined;
  }

  /** Provide a keyboard/mouse alternative to drag reordering. */
  function openRankContextMenu(event, row) {
    const kind = row.dataset.entityKey ? 'entity' : row.dataset.tagKey ? 'tag' : 'task';
    const key = row.dataset.entityKey || row.dataset.tagKey || row.dataset.taskId;
    if (!key || (kind === 'task' && !canRank(kind))) return;
    event.preventDefault();
    closeRankContextMenu();
    if (!rankContextMenu) {
      rankContextMenu = document.createElement('div');
      rankContextMenu.id = 'rank-context-menu';
      rankContextMenu.className = 'rank-context-menu';
      rankContextMenu.setAttribute('role', 'menu');
      document.body.appendChild(rankContextMenu);
    }
    rankContextKind = kind;
    rankContextKey = key;
    const actions = [];
    if (kind === 'tag' || kind === 'entity') {
      actions.push('<button type="button" role="menuitem" data-context-action="rename-tag">Rename tag</button>');
    }
    if (canRank(kind)) {
      actions.push('<button type="button" role="menuitem" data-context-action="top">Move to top</button>');
      actions.push('<button type="button" role="menuitem" data-context-action="bottom">Move to bottom</button>');
    }
    if (!actions.length) return;
    rankContextMenu.innerHTML = actions.join('');
    rankContextMenu.hidden = false;
    const bounds = rankContextMenu.getBoundingClientRect();
    rankContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
    rankContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
    rankContextMenu.querySelector('button').focus();
  }

  /** Rebuild a complete order from the current visible group before sending it. */
  function moveContextItem(toTop) {
    if (!state || !rankContextKind || !rankContextKey || !canRank(rankContextKind)) return;
    const contextKey = rankContextKey;
    if (rankContextKind === 'task') {
      const ids = state.tasks.map(function (item) { return item.task.id; });
      const index = ids.indexOf(contextKey);
      if (index < 0) return;
      ids.splice(index, 1);
      ids.splice(toTop ? 0 : ids.length, 0, contextKey);
      closeRankContextMenu();
      send({ type: 'reorderTasks', taskIds: ids });
      return;
    }
    if (rankContextKind === 'entity') {
      const keys = state.entities.map(function (entity) { return entity.key; });
      const index = keys.indexOf(contextKey);
      if (index < 0) return;
      keys.splice(index, 1);
      keys.splice(toTop ? 0 : keys.length, 0, contextKey);
      closeRankContextMenu();
      send({ type: 'reorderEntities', entityKeys: keys });
      return;
    }

    const selectedTag = state.tags.find(function (tag) { return tag.key === contextKey; });
    if (!selectedTag) return;
    const groupKeys = state.tags.filter(function (tag) { return tag.isFavorite === selectedTag.isFavorite; }).map(function (tag) { return tag.key; });
    const groupIndex = groupKeys.indexOf(contextKey);
    if (groupIndex < 0) return;
    groupKeys.splice(groupIndex, 1);
    groupKeys.splice(toTop ? 0 : groupKeys.length, 0, contextKey);
    let groupPosition = 0;
    const keys = state.tags.map(function (tag) {
      return tag.isFavorite === selectedTag.isFavorite ? groupKeys[groupPosition++] : tag.key;
    });
    closeRankContextMenu();
    send({ type: 'reorderTags', tagKeys: keys, tagKey: contextKey, isFavorite: selectedTag.isFavorite });
  }

  /** Remove the insertion marker before a drag starts or ends. */
  function clearDropTarget() {
    if (!dropTarget) return;
    dropTarget.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    dropTarget = undefined;
  }

  /** Restore all temporary drag DOM state on every completion path. */
  function clearDragPreview() {
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = undefined;
    }
    if (dragPlaceholder) {
      dragPlaceholder.remove();
      dragPlaceholder = undefined;
    }
    clearDropTarget();
    document.querySelectorAll('.tag-row.is-dragging, .entity-row.is-dragging, .task-row.is-dragging').forEach(function (row) {
      row.classList.remove('is-dragging');
    });
  }

  /** Bind directly because the controls live inside a native details menu. */
  function bindDashboardColumnControls() {
    document
      .querySelectorAll('[data-action="set-columns"]')
      .forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          const section = button.dataset.section;
          const columns = Number(button.dataset.columns);
          if (
            (section !== 'tasks' && section !== 'notes' && section !== 'tags') ||
            columns < 1 ||
            columns > 4
          ) {
            return;
          }
          applyDashboardColumns(section, columns);
          saveDashboardViewState();
          send({
            type: 'setDashboardColumns',
            section: section,
            columns: columns,
          });
        });
      });
  }

  /** Keep the dragged row's dimensions while the original row is hidden. */
  function createDragGhost(row) {
    const ghost = row.cloneNode(true);
    ghost.classList.remove('is-dragging', 'is-drop-target', 'is-drop-before', 'is-drop-after');
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('data-tag-key');
    ghost.removeAttribute('data-entity-key');
    ghost.removeAttribute('data-task-id');
    ghost.removeAttribute('data-file-path');
    ghost.removeAttribute('data-line');
    ghost.removeAttribute('draggable');
    ghost.setAttribute('aria-hidden', 'true');
    const bounds = row.getBoundingClientRect();
    ghost.style.width = bounds.width + 'px';
    ghost.style.height = bounds.height + 'px';
    document.body.appendChild(ghost);
    dragGhost = ghost;
  }

  /** Follow the pointer without reflowing the source list. */
  function moveDragGhost(clientX, clientY) {
    if (!dragGhost) return;
    dragGhost.style.left = clientX + 12 + 'px';
    dragGhost.style.top = clientY + 12 + 'px';
  }

  /** Reserve the row's space so the list does not jump during reordering. */
  function createDragPlaceholder(row) {
    const placeholder = row.cloneNode(true);
    placeholder.classList.remove('is-dragging', 'is-drop-target', 'is-drop-before', 'is-drop-after');
    placeholder.classList.add('drag-placeholder');
    placeholder.removeAttribute('data-tag-key');
    placeholder.removeAttribute('data-entity-key');
    placeholder.removeAttribute('data-task-id');
    placeholder.removeAttribute('data-file-path');
    placeholder.removeAttribute('data-line');
    placeholder.removeAttribute('draggable');
    placeholder.removeAttribute('tabindex');
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.querySelectorAll('[data-action], [data-tag-key], [data-entity-key], [data-task-id], button, input').forEach(function (element) {
      element.removeAttribute('data-action');
      element.removeAttribute('data-tag-key');
      element.removeAttribute('data-entity-key');
      element.removeAttribute('data-task-id');
      element.setAttribute('tabindex', '-1');
    });
    dragPlaceholder = placeholder;
  }

  /** Move the reserved space to show the exact before/after insertion point. */
  function moveDragPlaceholder(row, before) {
    if (!dragPlaceholder || !row.parentElement) return;
    const insertionPoint = before ? row : row.nextSibling;
    if (insertionPoint === dragPlaceholder) return;
    row.parentElement.insertBefore(dragPlaceholder, insertionPoint);
  }

  /** Convert the pointer's vertical position into a stable insertion side. */
  function updateDropTarget(row, event) {
    const bounds = row.getBoundingClientRect();
    const before = event.clientY < bounds.top + bounds.height / 2;
    if (dropTarget === row && dropBefore === before) return;
    clearDropTarget();
    dropTarget = row;
    dropBefore = before;
    moveDragPlaceholder(row, before);
  }

  /** Resolve the row under the pointer even when the document owns the listener. */
  function updateDropTargetAtPoint(clientX, clientY) {
    if (!pointerDrag) return;
    const element = document.elementFromPoint(clientX, clientY);
    const selector = pointerDrag.kind === 'tag'
      ? '.tag-row[data-tag-key]'
      : pointerDrag.kind === 'entity'
        ? '.entity-row[data-entity-key]'
        : '.task-row[data-task-id]';
    const row = element ? element.closest(selector) : undefined;
    const keyAttribute = pointerDrag.kind === 'tag'
      ? 'tagKey'
      : pointerDrag.kind === 'entity'
        ? 'entityKey'
        : 'taskId';
    const draggedKey = pointerDrag.kind === 'tag'
      ? draggedTag
      : pointerDrag.kind === 'entity'
        ? draggedEntity
        : draggedTask;
    if (!row || !draggedKey || row.dataset[keyAttribute] === draggedKey) return;
    updateDropTarget(row, { clientY: clientY });
  }

  /** Send tag order only in custom mode, preserving favorite-group semantics. */
  function reorderDraggedTag() {
    if (!draggedTag || !dropTarget || state.tagSortMode !== 'custom') return false;
    const targetTag = dropTarget.dataset.tagKey;
    if (!targetTag || draggedTag === targetTag) return false;
    const keys = state.tags.map(function (tag) { return tag.key; });
    const from = keys.indexOf(draggedTag);
    const to = keys.indexOf(targetTag);
    const insertionIndex = to + (dropBefore ? 0 : 1);
    const adjustedIndex = insertionIndex > from ? insertionIndex - 1 : insertionIndex;
    if (from >= 0 && to >= 0) {
      keys.splice(from, 1);
      keys.splice(adjustedIndex, 0, draggedTag);
      const group = dragPlaceholder ? dragPlaceholder.closest('.tag-group') : undefined;
      const isFavorite = Boolean(group && group.dataset.tagGroup === 'favorites');
      send({ type: 'reorderTags', tagKeys: keys, tagKey: draggedTag, isFavorite: isFavorite });
      return true;
    }
    return false;
  }

  /** Send task order only in rank mode; date modes remain intentionally fixed. */
  function reorderDraggedTask() {
    if (!draggedTask || !dropTarget || !state || state.taskSortMode !== 'rank') return false;
    const targetTask = dropTarget.dataset.taskId;
    if (!targetTask || draggedTask === targetTask) return false;
    const ids = state.tasks.map(function (item) { return item.task.id; });
    const from = ids.indexOf(draggedTask);
    const to = ids.indexOf(targetTask);
    const insertionIndex = to + (dropBefore ? 0 : 1);
    const adjustedIndex = insertionIndex > from ? insertionIndex - 1 : insertionIndex;
    if (from >= 0 && to >= 0) {
      ids.splice(from, 1);
      ids.splice(adjustedIndex, 0, draggedTask);
      send({ type: 'reorderTasks', taskIds: ids });
      return true;
    }
    return false;
  }

  /** Send canonical tag order only while custom rank is active. */
  function reorderDraggedEntity() {
    if (!draggedEntity || !dropTarget || !state || state.entitySortMode !== 'custom') return false;
    const targetEntity = dropTarget.dataset.entityKey;
    if (!targetEntity || draggedEntity === targetEntity) return false;
    const keys = state.entities.map(function (entity) { return entity.key; });
    const from = keys.indexOf(draggedEntity);
    const to = keys.indexOf(targetEntity);
    const insertionIndex = to + (dropBefore ? 0 : 1);
    const adjustedIndex = insertionIndex > from ? insertionIndex - 1 : insertionIndex;
    if (from >= 0 && to >= 0) {
      keys.splice(from, 1);
      keys.splice(adjustedIndex, 0, draggedEntity);
      send({ type: 'reorderEntities', entityKeys: keys });
      return true;
    }
    return false;
  }

  /** Dispatch the appropriate reorder algorithm for the active row type. */
  function reorderDraggedItem() {
    if (!pointerDrag) return false;
    if (pointerDrag.kind === 'tag') return reorderDraggedTag();
    if (pointerDrag.kind === 'entity') return reorderDraggedEntity();
    return reorderDraggedTask();
  }

  /** Put the real row back where the placeholder was before cleanup. */
  function settleDragAtDrop(row) {
    if (!dragPlaceholder || !dragPlaceholder.parentElement) return;
    dragPlaceholder.parentElement.insertBefore(row, dragPlaceholder);
    dragPlaceholder.remove();
    dragPlaceholder = undefined;
    row.classList.remove('is-dragging');
  }

  /** Delay drag activation until movement passes a threshold so clicks survive. */
  function beginPointerDrag(drag, event) {
    clearDragPreview();
    draggedTask = drag.kind === 'task' ? drag.row.dataset.taskId : undefined;
    draggedTag = drag.kind === 'tag' ? drag.row.dataset.tagKey : undefined;
    draggedEntity = drag.kind === 'entity' ? drag.row.dataset.entityKey : undefined;
    createDragGhost(drag.row);
    createDragPlaceholder(drag.row);
    if (drag.row.parentElement && dragPlaceholder) {
      drag.row.parentElement.insertBefore(dragPlaceholder, drag.row);
    }
    drag.row.classList.add('is-dragging');
    drag.active = true;
    moveDragGhost(event.clientX, event.clientY);
    updateDropTargetAtPoint(event.clientX, event.clientY);
  }

  /** Release pointer capture and suppress the synthetic click after a drag. */
  function finishPointerDrag(event, cancelled) {
    const drag = pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.row.hasPointerCapture(event.pointerId)) {
      drag.row.releasePointerCapture(event.pointerId);
    }
    if (!drag.active) {
      pointerDrag = undefined;
      return;
    }
    let dropped = false;
    if (!cancelled) {
      updateDropTargetAtPoint(event.clientX, event.clientY);
      dropped = reorderDraggedItem();
      suppressDragClick = true;
    }
    if (dropped) settleDragAtDrop(drag.row);
    clearDragPreview();
    draggedTask = undefined;
    draggedTag = undefined;
    draggedEntity = undefined;
    pointerDrag = undefined;
  }

  /** Re-render from a snapshot while preserving scroll and filter affordances. */
  function render() {
    if (!state) return;
    const selectedTaskColumns = taskColumns ?? state.taskColumns ?? 1;
    const selectedNoteColumns = noteColumns ?? state.noteColumns ?? 1;
    const selectedTagColumns = tagColumns ?? state.tagColumns ?? 2;
    taskColumns = selectedTaskColumns;
    noteColumns = selectedNoteColumns;
    tagColumns = selectedTagColumns;
    state.taskColumns = selectedTaskColumns;
    state.noteColumns = selectedNoteColumns;
    state.tagColumns = selectedTagColumns;
    closeRankContextMenu();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const currentTagFilter = document.querySelector('.tag-filter');
    const currentTagOptions = document.querySelector('.tag-filter-options');
    const hasRenderedTagFilter = Boolean(currentTagFilter);
    if (currentTagFilter) taskTagFilterOpen = currentTagFilter.open;
    const tagOptionsScrollTop = currentTagOptions ? currentTagOptions.scrollTop : 0;
    const currentNoteTagFilter = document.querySelector('.note-tag-filter');
    const currentNoteTagOptions = document.querySelector('.note-tag-filter-options');
    const hasRenderedNoteTagFilter = Boolean(currentNoteTagFilter);
    if (currentNoteTagFilter) noteTagFilterOpen = currentNoteTagFilter.open;
    const noteTagOptionsScrollTop = currentNoteTagOptions ? currentNoteTagOptions.scrollTop : 0;
    const normalizedBrowseQuery = browseQuery.trim().toLowerCase();
    const filteredTags = state.tags.filter(function (tag) {
      return !normalizedBrowseQuery || (tag.label + ' ' + tag.key).toLowerCase().indexOf(normalizedBrowseQuery) >= 0;
    });
    const filterIcon = '<svg class="control-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 3h12L9 8v4l-2 1V8L2 3Z"/></svg>';
    const sortIcon = '<svg class="control-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg>';
    const renderEntity = function (entity) {
      const draggable = state.entitySortMode === 'custom';
      const favoriteLabel = entity.isFavorite ? 'Unfavorite' : 'Favorite';
      return '<div class="entity-row ' + (draggable ? 'is-draggable' : '') + '" draggable="false" tabindex="0" data-entity-key="' + escapeHtml(entity.key) + '"><div class="entity-main"><span class="tag-name">' + escapeHtml(entity.name) + '</span><span class="tag-count">' + entity.count + '</span></div><div class="tag-actions"><span class="entity-kind">' + escapeHtml(entity.kind) + '</span><button class="favorite-toggle ' + (entity.isFavorite ? 'favorite' : '') + '" data-action="favorite-entity" data-entity-key="' + escapeHtml(entity.key) + '" aria-label="' + favoriteLabel + ' ' + escapeHtml(entity.name) + '"><span class="favorite-heart" aria-hidden="true"></span></button></div></div>';
    };
    const renderTag = function (tag) {
      const draggable = state.tagSortMode === 'custom';
      const display = formatTagDisplay(tag);
      const displayLabel = display.namespace ? display.name + ' ' + display.namespace : display.name;
      const favoriteLabel = tag.isFavorite ? 'Unfavorite' : 'Favorite';
      return '<div class="tag-row ' + (draggable ? 'is-draggable' : '') + '" draggable="false" tabindex="0" data-tag-key="' + escapeHtml(tag.key) + '"><div class="tag-main"><span class="tag-name">' + escapeHtml(display.name) + '</span><span class="tag-count">' + tag.count + '</span></div><div class="tag-actions">' + (display.namespace ? '<span class="entity-kind">' + escapeHtml(display.namespace) + '</span>' : '') + '<button class="favorite-toggle ' + (tag.isFavorite ? 'favorite' : '') + '" data-action="favorite-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="' + favoriteLabel + ' ' + escapeHtml(displayLabel) + '"><span class="favorite-heart" aria-hidden="true"></span></button></div></div>';
    };
    const favoriteTags = filteredTags.filter(function (tag) { return tag.isFavorite; });
    const otherTags = filteredTags.filter(function (tag) { return !tag.isFavorite; });
    const tagContent = filteredTags.length
      ? (favoriteTags.length
        ? '<div class="tag-group" data-tag-group="favorites"><h3>Favorites <span class="tag-count">(' + favoriteTags.length + ')</span></h3><div class="tag-list" style="grid-template-columns: repeat(' + selectedTagColumns + ', 1fr);">' + favoriteTags.map(renderTag).join('') + '</div></div>'
        : '') + (otherTags.length ? '<div class="tag-group" data-tag-group="other"><h3>Other tags <span class="tag-count">(' + otherTags.length + ')</span></h3><div class="tag-list" style="grid-template-columns: repeat(' + selectedTagColumns + ', 1fr);">' + otherTags.map(renderTag).join('') + '</div></div>' : '')
      : '<div class="empty">No tags match your search.</div>';
    const savedFilters = state.savedFilters.length
      ? '<section class="saved-filters" aria-labelledby="saved-filters-heading"><div class="section-heading"><h2 id="saved-filters-heading">Saved tag views <span class="tag-count">' + state.savedFilters.length + '</span></h2></div><div class="saved-filter-list">' + state.savedFilters.map(function (filter) {
          const tagCount = filter.tags.length;
          return '<div class="saved-filter-row" tabindex="0" data-saved-filter-id="' + escapeHtml(filter.id) + '"><div><div class="saved-filter-name">' + escapeHtml(filter.name) + '</div><div class="saved-filter-tags">' + filter.tags.map(function (tag) { return renderTagLabel(tag.label); }).join(' AND ') + ' · ' + tagCount + ' tags</div></div><button class="saved-filter-remove" data-action="remove-saved-filter" data-saved-filter-id="' + escapeHtml(filter.id) + '" aria-label="Remove saved tag view ' + escapeHtml(filter.name) + '">Remove</button></div>';
        }).join('') + '</div></section>'
      : '';
    const normalizedTaskSearchQuery = taskSearchQuery.trim().toLowerCase();
    const filteredTasks = state.tasks.filter(function (item) {
      const searchableText = [
        item.task.title,
        item.fileName,
        item.sectionHeading || '',
      ].join(' ').toLowerCase();
      return !normalizedTaskSearchQuery || searchableText.indexOf(normalizedTaskSearchQuery) >= 0;
    });
    const tasks = filteredTasks.length ? filteredTasks.map(function (item) {
      const task = item.task;
      const draggable = state.taskSortMode === 'rank';
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const dueDate = task.dueText
        ? '<span class="due-date ' + (task.dueAt !== undefined && task.dueAt < startOfToday.getTime() ? 'overdue' : '') + '">DUE ' + escapeHtml(task.dueText) + '</span>'
        : '';
      return '<div class="task-row ' + (task.completed ? 'completed ' : '') + (draggable ? 'is-draggable' : '') + '" draggable="false" tabindex="0" data-task-id="' + escapeHtml(task.id) + '" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '">' +
        '<input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '">' +
        '<div><div class="task-title">' + (state.tagTitleDisplayMode === 'inline' ? renderTaskTitle(item.renderedTitle, item.titleTags) : item.renderedTitle) + '</div><div class="task-meta">' + dueDate + '<span>' + escapeHtml(item.fileName) + '</span>' + (item.sectionHeading ? '<span>' + escapeHtml(item.sectionHeading) + '</span>' : '') + '<span>line ' + task.lineNumber + '</span></div></div>' +
        '</div>';
    }).join('') : '<div class="empty">No tasks match this filter.</div>';
    const normalizedNoteSearchQuery = noteSearchQuery.trim().toLowerCase();
    const filteredNotes = state.notes.filter(function (note) {
      const searchableText = [
        note.heading,
        note.fileName,
        note.rawContent || '',
        note.tags.map(function (tag) { return tag.label; }).join(' '),
      ].join(' ').toLowerCase();
      return !normalizedNoteSearchQuery || searchableText.indexOf(normalizedNoteSearchQuery) >= 0;
    });
    const notes = filteredNotes.length ? filteredNotes.map(function (note) {
      const titleHtml = state.tagTitleDisplayMode === 'inline'
        ? renderInlineTitle(note.heading, note.titleTags)
        : escapeHtml(note.heading);
      const tags = state.tagTitleDisplayMode === 'separate' ? note.tags.map(function (tag) {
        return '<button class="tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(tag.label) + '</button>';
      }).join('') : '';
      const content = note.rawContent
        ? (state.renderMode === 'html'
          ? '<div class="rendered">' + note.renderedHtml + '</div>'
          : '<pre class="markdown">' + escapeHtml(note.rawContent) + '</pre>')
        : '';
      return '<article class="card note-row" tabindex="0" data-file-path="' + escapeHtml(note.filePath) + '" data-line="' + note.startLine + '">' +
        '<div class="card-header"><h2 class="card-title">' + titleHtml + (tags ? '<span class="tag-list" aria-label="Section tags">' + tags + '</span>' : '') + '</h2><div class="source">' + escapeHtml(note.fileName) + ' / line ' + note.startLine + '</div></div>' +
        content +
        '</article>';
    }).join('') : '<div class="empty">No notes match this filter.</div>';
    const taskCounts = {
      all: normalizedTaskSearchQuery ? filteredTasks.length : state.totalTaskCount,
      active: normalizedTaskSearchQuery
        ? filteredTasks.filter(function (item) { return !item.task.completed; }).length
        : state.activeTaskCount,
      completed: normalizedTaskSearchQuery
        ? filteredTasks.filter(function (item) { return item.task.completed; }).length
        : state.totalTaskCount - state.activeTaskCount
    };
    const filters = ['all', 'active', 'completed'].map(function (filter) {
      const label = filter === 'all' ? 'All' : filter === 'active' ? 'Open' : 'Done';
      return '<button class="' + (state.taskFilter === filter ? 'active' : '') + '" data-action="set-filter" data-filter="' + filter + '" aria-label="' + label + ' tasks, ' + taskCounts[filter] + '" aria-pressed="' + (state.taskFilter === filter) + '">' + taskFilterIcon(filter) + '<span>' + label + '</span><span class="filter-count">' + taskCounts[filter] + '</span></button>';
    }).join('');
    const normalizedTagQuery = taskTagQuery.trim().toLowerCase();
    const filteredTaskTags = state.availableTaskTags.filter(function (tag) {
      return !normalizedTagQuery || (tag.label + ' ' + tag.key).toLowerCase().indexOf(normalizedTagQuery) >= 0;
    });
    const tagOptions = state.availableTaskTags.length ? filteredTaskTags.map(function (tag) {
      return '<label class="tag-filter-option" data-filter-text="' + escapeHtml((tag.label + ' ' + tag.key).toLowerCase()) + '"><input type="checkbox" data-action="set-task-tag" data-tag-key="' + escapeHtml(tag.key) + '" ' + (state.selectedTaskTags.indexOf(tag.key) >= 0 ? 'checked' : '') + '>' + renderTagLabel(tag.label) + '</label>';
    }).join('') : '<span class="empty">No task tags.</span>';
    const noMatchingTags = state.availableTaskTags.length
      ? '<span class="tag-filter-no-results"' + (normalizedTagQuery && !filteredTaskTags.length ? '' : ' hidden') + '>No task tags match your search.</span>'
      : '';
    const selectedTagSummary = state.selectedTaskTags.length ? state.selectedTaskTags.length + ' selected' : 'all tags';
    const taskTagFilter = '<span class="control-label">Tags:</span><details class="tag-filter" ' + (taskTagFilterOpen || (!hasRenderedTagFilter && state.selectedTaskTags.length) ? 'open' : '') + '><summary>' + selectedTagSummary + filterIcon + '</summary><div class="tag-filter-menu"><span class="control-icon tag-filter-search-control"><input class="tag-filter-search" type="search" data-action="filter-task-tags" value="' + escapeHtml(taskTagQuery) + '" placeholder="Filter tags" aria-label="Filter task tags" autocomplete="off">' + filterIcon + '</span><div class="tag-filter-options">' + tagOptions + '</div>' + noMatchingTags + '</div></details>';
    const taskSearch = '<input class="task-search" type="search" data-action="search-tasks" value="' + escapeHtml(taskSearchQuery) + '" placeholder="Search tasks" aria-label="Search tasks" autocomplete="off">';
    const selectedTaskTags = state.selectedTaskTags.map(function (tagKey) {
      const tag = state.availableTaskTags.find(function (candidate) { return candidate.key === tagKey; });
      return tag ? '<button class="selected-task-tag" data-action="remove-task-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Remove task tag ' + escapeHtml(tag.label) + '">' + renderTagLabel(tag.label) + '</button>' : '';
    }).join('');
    const selectedTaskTagControls = selectedTaskTags
      ? '<div class="selected-task-tags" aria-label="Selected task tags">' + selectedTaskTags + '<button class="clear-task-filters" data-action="clear-task-tags">Clear filters</button></div>'
      : '';
    const normalizedNoteTagQuery = noteTagQuery.trim().toLowerCase();
    const filteredNoteTags = state.availableNoteTags.filter(function (tag) {
      return !normalizedNoteTagQuery || (tag.label + ' ' + tag.key).toLowerCase().indexOf(normalizedNoteTagQuery) >= 0;
    });
    const noteTagOptions = state.availableNoteTags.length ? filteredNoteTags.map(function (tag) {
      return '<label class="tag-filter-option note-tag-filter-option" data-filter-text="' + escapeHtml((tag.label + ' ' + tag.key).toLowerCase()) + '"><input type="checkbox" data-action="set-note-tag" data-tag-key="' + escapeHtml(tag.key) + '" ' + (state.selectedNoteTags.indexOf(tag.key) >= 0 ? 'checked' : '') + '>' + renderTagLabel(tag.label) + '</label>';
    }).join('') : '<span class="empty">No note tags.</span>';
    const noMatchingNoteTags = state.availableNoteTags.length
      ? '<span class="tag-filter-no-results note-tag-filter-no-results"' + (normalizedNoteTagQuery && !filteredNoteTags.length ? '' : ' hidden') + '>No note tags match your search.</span>'
      : '';
    const selectedNoteTagSummary = state.selectedNoteTags.length ? state.selectedNoteTags.length + ' selected' : 'all tags';
    const noteTagFilter = '<span class="control-label">Tags:</span><details class="tag-filter note-tag-filter" ' + (noteTagFilterOpen || (!hasRenderedNoteTagFilter && state.selectedNoteTags.length) ? 'open' : '') + '><summary>' + selectedNoteTagSummary + filterIcon + '</summary><div class="tag-filter-menu"><span class="control-icon tag-filter-search-control"><input class="tag-filter-search" type="search" data-action="filter-note-tags" value="' + escapeHtml(noteTagQuery) + '" placeholder="Filter tags" aria-label="Filter note tags" autocomplete="off">' + filterIcon + '</span><div class="tag-filter-options note-tag-filter-options">' + noteTagOptions + '</div>' + noMatchingNoteTags + '</div></details>';
    const noteSearch = '<input class="note-search" type="search" data-action="search-notes" value="' + escapeHtml(noteSearchQuery) + '" placeholder="Search notes" aria-label="Search notes" autocomplete="off">';
    const selectedNoteTags = state.selectedNoteTags.map(function (tagKey) {
      const tag = state.availableNoteTags.find(function (candidate) { return candidate.key === tagKey; });
      return tag ? '<button class="selected-task-tag" data-action="remove-note-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Remove note tag ' + escapeHtml(tag.label) + '">' + renderTagLabel(tag.label) + '</button>' : '';
    }).join('');
    const selectedNoteTagControls = selectedNoteTags
      ? '<div class="selected-task-tags" aria-label="Selected note tags">' + selectedNoteTags + '<button class="clear-task-filters" data-action="clear-note-tags">Clear filters</button></div>'
      : '';
    const noteSortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-note-sort" aria-label="Sort notes"><option value="alphabetical" ' + (state.noteSortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="created" ' + (state.noteSortMode === 'created' ? 'selected' : '') + '>Newest created</option><option value="updated" ' + (state.noteSortMode === 'updated' ? 'selected' : '') + '>Recently updated</option><option value="access" ' + (state.noteSortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select>' + sortIcon + '</span></label>';
    const formatControls = '<div class="toolbar-toggle-group" role="group" aria-label="Content format"><button class="toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button><button class="toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5"/></svg></button></div>';
    const tagSortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-sort" aria-label="Sort tags"><option value="alphabetical" ' + (state.tagSortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="count" ' + (state.tagSortMode === 'count' ? 'selected' : '') + '>Entry Count</option><option value="access" ' + (state.tagSortMode === 'access' ? 'selected' : '') + '>Most accessed</option><option value="custom" ' + (state.tagSortMode === 'custom' ? 'selected' : '') + '>Rank</option></select>' + sortIcon + '</span></label>';
    const columnControls = function (section, selectedColumns) {
      const label = section === 'tasks' ? 'Task' : section === 'notes' ? 'Note' : 'Tag';
      return '<div class="dashboard-column-options" role="group" aria-label="' + label + ' columns">' + [1, 2, 3, 4].map(function (columns) {
        return '<button class="' + (columns === selectedColumns ? 'active' : '') + '" data-action="set-columns" data-section="' + section + '" data-columns="' + columns + '" aria-label="' + columns + ' columns" aria-pressed="' + (columns === selectedColumns) + '">' + columns + '</button>';
      }).join('') + '</div>';
    };
    const metrics = '<div class="metrics" aria-label="Workspace totals">' +
      '<div class="metric" data-code="SYS.ENT // 1982-AZ"><span class="metric-value">' + state.entities.length + '</span><span class="metric-label">entities</span></div>' +
      '<div class="metric" data-code="IDX.SEC // 01"><span class="metric-value">' + state.totalSectionCount + '</span><span class="metric-label">sections</span></div>' +
      '<div class="metric" data-code="IDX.TSK // 02"><span class="metric-value">' + state.totalTaskCount + '</span><span class="metric-label">tasks</span></div>' +
      '</div>';
    const dashboardOptions = '<details class="dashboard-view-options"><summary aria-label="View options" title="View options">${settingsIcon}</summary><div class="dashboard-view-options-menu"><div class="dashboard-view-options-group"><span>Task columns</span>' + columnControls('tasks', state.taskColumns) + '</div><div class="dashboard-view-options-group"><span>Note columns</span>' + columnControls('notes', state.noteColumns) + '</div><div class="dashboard-view-options-group"><span>Tag columns</span>' + columnControls('tags', state.tagColumns) + '</div><div class="dashboard-view-options-group"><span>Format</span>' + formatControls + '</div></div></details>';

    document.getElementById('app').innerHTML =
      '<header><div><p class="eyebrow">DECKARD / WORKSPACE INDEX</p><h1>Dashboard: ' + (dashboardMode === 'tasks' ? 'Tasks' : dashboardMode === 'notes' ? 'Notes' : 'Tags') + '</h1></div><div class="dashboard-header-actions">' + metrics + dashboardOptions + '</div></header>' +
      savedFilters +
      '<div class="dashboard-tabs-row"><div class="dashboard-tabs" role="tablist" aria-label="Dashboard mode"><button id="tasks-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="tasks" aria-selected="' + (dashboardMode === 'tasks') + '" aria-controls="tasks-panel" tabindex="' + (dashboardMode === 'tasks' ? '0' : '-1') + '">Tasks</button><button id="notes-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="notes" aria-selected="' + (dashboardMode === 'notes') + '" aria-controls="notes-panel" tabindex="' + (dashboardMode === 'notes' ? '0' : '-1') + '">Notes</button><button id="browse-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="browse" aria-selected="' + (dashboardMode === 'browse') + '" aria-controls="browse-panel" tabindex="' + (dashboardMode === 'browse' ? '0' : '-1') + '">Tags</button></div></div>' +
      '<section id="tasks-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="tasks-tab"' + (dashboardMode === 'tasks' ? '' : ' hidden') + '><div class="task-toolbar"><div class="task-filter-toggle" role="group" aria-label="Task completion filter">' + filters + '</div><div class="toolbar-controls">' + taskSearch + '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-task-sort" aria-label="Sort tasks"><option value="rank" ' + (state.taskSortMode === 'rank' ? 'selected' : '') + '>Rank</option><option value="created" ' + (state.taskSortMode === 'created' ? 'selected' : '') + '>Created</option><option value="updated" ' + (state.taskSortMode === 'updated' ? 'selected' : '') + '>Updated</option></select>' + sortIcon + '</span></label><div class="task-tag-filter-control">' + taskTagFilter + '</div></div></div>' + selectedTaskTagControls + '<div class="task-list" style="grid-template-columns: repeat(' + state.taskColumns + ', 1fr);">' + tasks + '</div></section>' +
      '<section id="notes-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="notes-tab"' + (dashboardMode === 'notes' ? '' : ' hidden') + '><div class="task-toolbar"><div class="toolbar-controls">' + noteSearch + noteSortControl + '<div class="task-tag-filter-control">' + noteTagFilter + '</div></div></div>' + selectedNoteTagControls + '<div class="note-list" style="grid-template-columns: repeat(' + state.noteColumns + ', 1fr);">' + notes + '</div></section>' +
      '<section id="browse-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="browse-tab"' + (dashboardMode === 'browse' ? '' : ' hidden') + '><div class="browse-toolbar"><div class="browse-toolbar-controls"><input class="catalog-search" type="search" data-action="search-browse" value="' + escapeHtml(browseQuery) + '" placeholder="Search tags" aria-label="Search tags" autocomplete="off"><div class="control-row">' + tagSortControl + '</div></div></div>' + tagContent + '</section>';
    const nextTagFilter = document.querySelector('.tag-filter');
    const nextTagOptions = document.querySelector('.tag-filter-options');
    if (nextTagFilter) {
      nextTagFilter.addEventListener('toggle', function () {
        taskTagFilterOpen = nextTagFilter.open;
      });
    }
    if (nextTagOptions) nextTagOptions.scrollTop = tagOptionsScrollTop;
    const nextNoteTagFilter = document.querySelector('.note-tag-filter');
    const nextNoteTagOptions = document.querySelector('.note-tag-filter-options');
    if (nextNoteTagFilter) {
      nextNoteTagFilter.addEventListener('toggle', function () {
        noteTagFilterOpen = nextNoteTagFilter.open;
      });
    }
    if (nextNoteTagOptions) nextNoteTagOptions.scrollTop = noteTagOptionsScrollTop;
    bindDashboardColumnControls();
    applyDashboardColumns('tasks', selectedTaskColumns);
    applyDashboardColumns('notes', selectedNoteColumns);
    applyDashboardColumns('tags', selectedTagColumns);
    window.scrollTo(scrollX, scrollY);
  }

  function filterTagOptions(optionSelector, rawQuery, noResultsSelector) {
    const query = rawQuery.trim().toLowerCase();
    let visibleCount = 0;
    document.querySelectorAll(optionSelector).forEach(function (option) {
      const visible = !query || option.dataset.filterText.indexOf(query) >= 0;
      option.hidden = !visible;
      option.style.display = visible ? 'flex' : 'none';
      if (visible) visibleCount += 1;
    });
    const noResults = document.querySelector(noResultsSelector);
    if (noResults) noResults.hidden = visibleCount > 0 || !query;
  }

  document.addEventListener('click', function (event) {
    const contextAction = event.target.closest('#rank-context-menu [data-context-action]');
    if (contextAction) {
      if (contextAction.dataset.contextAction === 'rename-tag') {
        const tagKey = rankContextKind === 'tag' || rankContextKind === 'entity'
          ? rankContextKey
          : undefined;
        closeRankContextMenu();
        if (tagKey) send({ type: 'renameTag', tagKey: tagKey });
      } else {
        moveContextItem(contextAction.dataset.contextAction === 'top');
      }
      return;
    }
    if (rankContextMenu && !event.target.closest('#rank-context-menu')) closeRankContextMenu();
    if (suppressDragClick) {
      suppressDragClick = false;
      if (event.target.closest('.tag-row[data-tag-key], .entity-row[data-entity-key], .task-row[data-task-id]')) {
        event.preventDefault();
        return;
      }
    }
    document.querySelectorAll('.tag-filter').forEach(function (tagFilter) {
      if (tagFilter.open && !event.target.closest('.tag-filter')) {
        tagFilter.open = false;
        if (tagFilter.classList.contains('note-tag-filter')) {
          noteTagFilterOpen = false;
        } else {
          taskTagFilterOpen = false;
        }
      }
    });
    const dashboardOptions = document.querySelector('.dashboard-view-options');
    if (dashboardOptions && dashboardOptions.open && !event.target.closest('.dashboard-view-options')) {
      dashboardOptions.open = false;
    }
    const target = event.target.closest('[data-action]');
    if (target) {
      const action = target.dataset.action;
      if (action === 'set-dashboard-mode') {
        setDashboardMode(
          target.dataset.dashboardMode,
          document.activeElement === target,
        );
        return;
      }
      if (action === 'set-mode') {
        send({ type: 'setRenderMode', mode: target.dataset.mode });
        return;
      }
      if (action === 'open-tag') send({ type: 'openTag', tagKey: target.dataset.tagKey });
      if (action === 'remove-saved-filter') send({ type: 'removeSavedFilter', filterId: target.dataset.savedFilterId });
      if (action === 'favorite-tag') send({ type: 'toggleFavorite', tagKey: target.dataset.tagKey });
      if (action === 'favorite-entity') send({ type: 'toggleFavoriteEntity', entityKey: target.dataset.entityKey });
      if (action === 'set-filter') send({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (action === 'remove-task-tag') {
        send({ type: 'setTaskTags', tagKeys: state.selectedTaskTags.filter(function (tagKey) { return tagKey !== target.dataset.tagKey; }) });
      }
      if (action === 'remove-note-tag') {
        send({ type: 'setNoteTags', tagKeys: state.selectedNoteTags.filter(function (tagKey) { return tagKey !== target.dataset.tagKey; }) });
      }
      if (action === 'clear-task-tags') {
        taskTagQuery = '';
        taskTagFilterOpen = false;
        const tagFilter = document.querySelector('.tag-filter:not(.note-tag-filter)');
        if (tagFilter) tagFilter.open = false;
        send({ type: 'setTaskTags', tagKeys: [] });
      }
      if (action === 'clear-note-tags') {
        noteTagQuery = '';
        noteTagFilterOpen = false;
        const tagFilter = document.querySelector('.note-tag-filter');
        if (tagFilter) tagFilter.open = false;
        send({ type: 'setNoteTags', tagKeys: [] });
      }
      if (action === 'open-source') send({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      return;
    }
    const taskRow = event.target.closest('.task-row');
    if (taskRow && !event.target.closest('button, input, a')) send({ type: 'openSource', filePath: taskRow.dataset.filePath, line: Number(taskRow.dataset.line) });
    const noteRow = event.target.closest('.note-row');
    if (noteRow && !event.target.closest('button, input, a')) send({ type: 'openSource', filePath: noteRow.dataset.filePath, line: Number(noteRow.dataset.line) });
    const entityRow = event.target.closest('.entity-row');
    if (entityRow && !event.target.closest('button, input, a')) {
      send({ type: 'openTag', tagKey: entityRow.dataset.entityKey });
    }
    const tagRow = event.target.closest('.tag-row');
    if (tagRow && !event.target.closest('button, input, a')) {
      send({ type: 'openTag', tagKey: tagRow.dataset.tagKey });
    }
    const savedFilterRow = event.target.closest('.saved-filter-row');
    if (savedFilterRow && !event.target.closest('button, input, a')) {
      send({ type: 'openSavedFilter', filterId: savedFilterRow.dataset.savedFilterId });
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      const dashboardOptions = document.querySelector('.dashboard-view-options');
      if (dashboardOptions && dashboardOptions.open) {
        dashboardOptions.open = false;
        dashboardOptions.querySelector('summary').focus();
        return;
      }
    }
    if (event.key === 'Escape' && rankContextMenu && !rankContextMenu.hidden) {
      closeRankContextMenu();
      return;
    }
    const dashboardTab = event.target.closest('[role="tab"][data-dashboard-mode]');
    if (dashboardTab && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      const modes = ['tasks', 'notes', 'browse'];
      const currentIndex = modes.indexOf(dashboardMode);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : modes.length - 1)) % modes.length;
      setDashboardMode(modes[nextIndex], true);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const taskRow = event.target.closest('.task-row');
    if (taskRow && !event.target.closest('button, input, a')) {
      event.preventDefault();
      send({ type: 'openSource', filePath: taskRow.dataset.filePath, line: Number(taskRow.dataset.line) });
      return;
    }
    const noteRow = event.target.closest('.note-row');
    if (noteRow && !event.target.closest('button, input, a')) {
      event.preventDefault();
      send({ type: 'openSource', filePath: noteRow.dataset.filePath, line: Number(noteRow.dataset.line) });
      return;
    }
    const entityRow = event.target.closest('.entity-row');
    if (entityRow && !event.target.closest('button, input, a')) {
      event.preventDefault();
      send({ type: 'openTag', tagKey: entityRow.dataset.entityKey });
      return;
    }
    const tagRow = event.target.closest('.tag-row');
    if (tagRow && !event.target.closest('button, input, a')) {
      event.preventDefault();
      send({ type: 'openTag', tagKey: tagRow.dataset.tagKey });
    }
    const savedFilterRow = event.target.closest('.saved-filter-row');
    if (savedFilterRow && !event.target.closest('button, input, a')) {
      event.preventDefault();
      send({ type: 'openSavedFilter', filterId: savedFilterRow.dataset.savedFilterId });
    }
  });

  document.addEventListener('change', function (event) {
    const target = event.target;
    if (target.dataset.action === 'set-sort') send({ type: 'setTagSort', mode: target.value });
    if (target.dataset.action === 'set-task-sort') send({ type: 'setTaskSort', mode: target.value });
    if (target.dataset.action === 'set-note-sort') send({ type: 'setNoteSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') send({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
    if (target.dataset.action === 'set-task-tag') {
      const selectedTags = Array.from(document.querySelectorAll('input[data-action="set-task-tag"]:checked')).map(function (input) { return input.dataset.tagKey; });
      state.selectedTaskTags = selectedTags;
      saveDashboardViewState();
      send({ type: 'setTaskTags', tagKeys: selectedTags });
    }
    if (target.dataset.action === 'set-note-tag') {
      const selectedTags = Array.from(document.querySelectorAll('input[data-action="set-note-tag"]:checked')).map(function (input) { return input.dataset.tagKey; });
      state.selectedNoteTags = selectedTags;
      saveDashboardViewState();
      send({ type: 'setNoteTags', tagKeys: selectedTags });
    }
  });

  document.addEventListener('input', function (event) {
    const target = event.target;
    if (target.dataset.action === 'search-browse') {
      browseQuery = target.value;
      saveDashboardViewState();
      send({ type: 'setDashboardSearch', field: 'tags', query: browseQuery });
      const restoreSearchFocus = document.activeElement === target;
      render();
      if (restoreSearchFocus) requestAnimationFrame(function () {
        const search = document.querySelector('.catalog-search');
        if (search) {
          search.focus();
          search.setSelectionRange(browseQuery.length, browseQuery.length);
        }
      });
      return;
    }
    if (target.dataset.action === 'search-tasks') {
      taskSearchQuery = target.value;
      saveDashboardViewState();
      send({ type: 'setDashboardSearch', field: 'tasks', query: taskSearchQuery });
      const restoreSearchFocus = document.activeElement === target;
      render();
      if (restoreSearchFocus) requestAnimationFrame(function () {
        const search = document.querySelector('.task-search');
        if (search) {
          search.focus();
          search.setSelectionRange(taskSearchQuery.length, taskSearchQuery.length);
        }
      });
      return;
    }
    if (target.dataset.action === 'search-notes') {
      noteSearchQuery = target.value;
      saveDashboardViewState();
      scheduleNoteSearch(target);
      return;
    }
    if (target.dataset.action === 'filter-task-tags') {
      taskTagQuery = target.value;
      saveDashboardViewState();
      scheduleTagFilterSearch('task');
      filterTagOptions('.tag-filter-option:not(.note-tag-filter-option)', taskTagQuery, '.tag-filter-no-results:not(.note-tag-filter-no-results)');
      return;
    }
    if (target.dataset.action !== 'filter-note-tags') return;
    noteTagQuery = target.value;
    saveDashboardViewState();
    scheduleTagFilterSearch('note');
    filterTagOptions('.note-tag-filter-option', noteTagQuery, '.note-tag-filter-no-results');
  });

  document.addEventListener('contextmenu', function (event) {
    const row = event.target.closest('.tag-row[data-tag-key], .entity-row[data-entity-key], .task-row[data-task-id]');
    if (row) openRankContextMenu(event, row);
  });

  document.addEventListener('pointerdown', function (event) {
    suppressDragClick = false;
    const row = event.target.closest('.tag-row[data-tag-key], .entity-row[data-entity-key], .task-row[data-task-id]');
    if (!row || !state || event.button !== 0 || pointerDrag) return;
    if (event.target.closest('button, input, select, textarea, a, [data-action]')) return;
    const kind = row.dataset.entityKey ? 'entity' : row.dataset.tagKey ? 'tag' : 'task';
    if (!canRank(kind)) return;
    pointerDrag = {
      row: row,
      kind: kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    row.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', function (event) {
    const drag = pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 5) return;
      event.preventDefault();
      beginPointerDrag(drag, event);
    }
    if (!drag.active) return;
    event.preventDefault();
    moveDragGhost(event.clientX, event.clientY);
    updateDropTargetAtPoint(event.clientX, event.clientY);
  });
  document.addEventListener('pointerup', function (event) {
    finishPointerDrag(event, false);
  });
  document.addEventListener('pointercancel', function (event) {
    finishPointerDrag(event, true);
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') {
      const incomingState = event.data.data;
      const activeElement = document.activeElement;
      const focusedSearchAction = activeElement && activeElement.dataset.action;
      taskColumns = incomingState.taskColumns ?? taskColumns ?? 1;
      noteColumns = incomingState.noteColumns ?? noteColumns ?? 1;
      tagColumns = incomingState.tagColumns ?? tagColumns ?? 2;
      if (incomingState.viewState) {
        dashboardMode = incomingState.viewState.mode;
        taskSearchQuery = incomingState.viewState.taskSearchQuery;
        if (
          pendingNoteSearchQuery === undefined ||
          (
            noteSearchTimer === undefined &&
            incomingState.viewState.noteSearchQuery === pendingNoteSearchQuery
          )
        ) {
          noteSearchQuery = incomingState.viewState.noteSearchQuery;
          pendingNoteSearchQuery = undefined;
        }
        if (
          pendingTaskTagQuery === undefined ||
          (
            taskTagSearchTimer === undefined &&
            incomingState.viewState.taskTagQuery === pendingTaskTagQuery
          )
        ) {
          taskTagQuery = incomingState.viewState.taskTagQuery;
          pendingTaskTagQuery = undefined;
        }
        if (
          pendingNoteTagQuery === undefined ||
          (
            noteTagSearchTimer === undefined &&
            incomingState.viewState.noteTagQuery === pendingNoteTagQuery
          )
        ) {
          noteTagQuery = incomingState.viewState.noteTagQuery;
          pendingNoteTagQuery = undefined;
        }
        browseQuery = incomingState.viewState.tagSearchQuery;
      }
      incomingState.taskColumns = taskColumns;
      incomingState.noteColumns = noteColumns;
      incomingState.tagColumns = tagColumns;
      state = incomingState;
      render();
      if (
        focusedSearchAction === 'search-notes' ||
        focusedSearchAction === 'filter-task-tags' ||
        focusedSearchAction === 'filter-note-tags'
      ) {
        requestAnimationFrame(function () {
          const search = document.querySelector(
            '[data-action="' + focusedSearchAction + '"]',
          );
          if (search) {
            search.focus();
            search.setSelectionRange(search.value.length, search.value.length);
          }
        });
      }
    }
  });
}());
</script>
</body>
</html>`;
}

/**
 * Creates a per-webview CSP nonce so inline styles/scripts are allowed only for
 * this generated document.
 */
function createNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
