import * as vscode from 'vscode';

import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds the tag-overview webview and its source/rendered view controls.
 *
 * The host supplies already-projected card data, while this layer only escapes
 * source text and posts user intent back across the webview boundary.
 */
export function getTagOverviewHtml(
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
<title>Deckard Tag Overview</title>
<style nonce="${nonce}">
:root {
  color-scheme: dark;
  --bg: #050608;
  --panel: #0D1017;
  --panel-raised: #121620;
  --panel-deep: #050608;
  --text: #D9E0E4;
  --muted: #7D8792;
  --line: #212936;
  --line-strong: #34445A;
  --cyan: #00E5FF;
  --green: #33FF33;
  --amber: #FFB000;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 280px; background-color: var(--bg); background-image: linear-gradient(rgba(0, 229, 255, .04) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, .04) 1px, transparent 1px); background-size: 24px 24px; color: var(--text); font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); font-size: 13px; }
main { position: relative; max-width: 1000px; margin: 0 auto; padding: 24px; border-top: 2px solid var(--amber); }
header { display: flex; justify-content: space-between; align-items: end; gap: 18px; border-bottom: 2px solid var(--line-strong); padding-bottom: 16px; }
header { position: relative; }
header > .toolbar { padding-right: 36px; }
header > .toolbar .view-options { position: absolute; top: 0; right: 0; }
h1, h2, .eyebrow, .source { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
h1 { margin: 0; color: var(--text); font-size: 22px; font-weight: 700; overflow-wrap: anywhere; text-transform: uppercase; }
.overview-title-filter { color: var(--text); }
.overview-title-joiner { color: var(--amber); font-size: .72em; font-weight: 400; }
.overview-tag-link.overview-tag-link {
  min-height: 0;
  margin: 0;
  border: 0;
  border-bottom: 1px dotted currentColor;
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-align: inherit;
  text-decoration: none;
  vertical-align: baseline;
  cursor: pointer;
  clip-path: none;
}
.overview-tag-link.overview-tag-link:hover, .overview-tag-link.overview-tag-link:focus-visible {
  border-color: var(--cyan);
  background: transparent;
  color: var(--cyan);
  transform: none;
  box-shadow: none;
}
h2 { margin: 0; font-size: 14px; font-weight: 650; }
.overview-eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.eyebrow { margin: 0; color: var(--amber); font-size: 11px; letter-spacing: .15em; text-transform: uppercase; }
.saved-view-name { margin: 0 0 8px; color: var(--cyan); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.saved-view-name-label { color: var(--muted); letter-spacing: .12em; text-transform: uppercase; }
.toolbar { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.toolbar label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 11px; text-transform: uppercase; }
.overview-search { width: min(250px, 44vw); border-color: var(--line-strong); }
.view-options { position: relative; }
.view-options summary { display: grid; width: 30px; min-height: 30px; place-items: center; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding: 5px; cursor: pointer; list-style: none; }
.view-options summary::-webkit-details-marker { display: none; }
.view-options summary:hover { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
.view-options summary:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.view-options-menu { position: absolute; z-index: 3; top: calc(100% + 5px); right: 0; display: grid; gap: 10px; min-width: 230px; padding: 10px; border: 2px solid var(--line); background: var(--panel-raised); }
.view-options-group { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); text-transform: uppercase; }
.save-filter { border-color: var(--amber); color: var(--amber); }
button, select, input[type="search"] { min-height: 30px; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: inherit; }
input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }
button { cursor: pointer; }
button:hover, button.active, select:hover, input[type="search"]:focus { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
button:focus-visible, select:focus-visible, input[type="search"]:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.toolbar-toggle { display: inline-grid; width: 30px; min-height: 30px; place-items: center; padding: 5px; }
.toolbar-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.settings-icon { fill: currentColor; stroke: none; }
.toolbar-toggle-group { display: inline-flex; }
.toolbar-toggle-group .toolbar-toggle + .toolbar-toggle { margin-left: -2px; }
.toolbar-toggle-group .toolbar-toggle:first-child { border-radius: 2px 0 0 2px; }
.toolbar-toggle-group .toolbar-toggle:last-child { border-radius: 0 2px 2px 0; }
.toolbar-toggle-group .toolbar-toggle.active { position: relative; z-index: 1; }
.layout-toggle-group .toolbar-toggle { border-width: 1px; }
.layout-toggle-group .toolbar-toggle + .toolbar-toggle { margin-left: -1px; }
.overview-tabs-row { margin-top: 20px; padding-bottom: 8px; border-bottom: 2px solid var(--line); }
.overview-tabs { display: inline-flex; gap: 0; }
.overview-tabs button + button { margin-left: -2px; }
.overview-tabs button:first-child { border-radius: 2px 0 0 2px; }
.overview-tabs button:last-child { border-radius: 0 2px 2px 0; }
.overview-tabs button.active { position: relative; z-index: 1; }
.overview-tabs button { border-bottom-color: var(--line); }
.overview-tab-panel { margin-top: 12px; }
.overview-tab-panel[hidden] { display: none; }
.overview-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; margin-top: 20px; }
.overview-pane { min-width: 0; }
.overview-pane-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.overview-pane-controls { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.overview-pane-controls .overview-search { min-width: 0; flex: 1 1 160px; }
.overview-pane-heading { margin: 0; color: var(--text); font-size: 14px; font-weight: 650; text-transform: uppercase; }
.overview-pane .cards, .overview-pane .task-summary { margin-top: 12px; }
.task-filter-toggle { display: inline-flex; }
.task-filter-toggle button + button { margin-left: -2px; }
.task-filter-toggle button:first-child { border-radius: 2px 0 0 2px; }
.task-filter-toggle button:last-child { border-radius: 0 2px 2px 0; }
.task-filter-toggle button.active { position: relative; z-index: 1; }
.task-filter-toggle button { display: inline-flex; min-width: 30px; align-items: center; gap: 4px; padding: 5px 8px; }
.task-filter-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.filter-count { color: var(--muted); font-size: 10px; }
.tag-list { display: inline-flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0 8px; vertical-align: middle; }
.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); font-size: 11px; text-align: left; }
.inline-tag { min-height: 24px; margin-left: 3px; padding: 2px 4px; font-size: .78em; vertical-align: 1px; }
.task-title .inline-tag { color: var(--text); font: inherit; text-transform: none; }
.tag-namespace { opacity: .62; }
.relationship-workspace { margin-top: 16px; overflow: hidden; border: 2px solid var(--line); background: var(--panel-deep); }
.relationship-workspace-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px; border-bottom: 2px solid var(--line); }
.relationship-workspace-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.relationship-heading { margin: 0; color: var(--amber); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.relationship-summary { color: var(--muted); font-size: 11px; }
.relationship-view-switch { display: inline-flex; }
.relationship-view-switch button + button { margin-left: -2px; }
.relationship-view-switch button:first-child { border-radius: 2px 0 0 2px; }
.relationship-view-switch button:last-child { border-radius: 0 2px 2px 0; }
.relationship-view-switch button.active { position: relative; z-index: 1; }
.relationship-view-panel { padding: 12px; }
.relationship-view-panel[hidden] { display: none; }
.relationship-tree { display: grid; gap: 12px; }
.relationship-tree-root { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; border: 2px solid var(--cyan); background: var(--panel); padding: 10px; }
.relationship-tree-root-label { color: var(--muted); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.relationship-tree-root .tag-open { border-color: var(--cyan); color: var(--text); }
.relationship-tree-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.relationship-tree-column { min-width: 0; border: 2px solid var(--line); background: var(--panel); padding: 10px; }
.relationship-tree-column-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 0 8px; color: var(--amber); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.relationship-tree-column-count { color: var(--muted); font-size: 10px; letter-spacing: normal; }
.relationship-tree-group { border-top: 1px solid var(--line); }
.relationship-tree-group:first-child { border-top: 0; }
.relationship-tree-group summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 2px; color: var(--text); cursor: pointer; font-size: 11px; font-weight: 650; list-style-position: inside; text-transform: uppercase; }
.relationship-tree-group summary::marker { color: var(--cyan); }
.relationship-tree-group summary:hover { color: var(--cyan); }
.relationship-tree-group-count { color: var(--muted); font-size: 10px; font-weight: 400; }
.relationship-tree-items { display: grid; gap: 6px; padding: 0 0 8px 18px; }
.relationship-tree-item { min-width: 0; }
.relationship-tree-item .tag-open { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relationship-tree-root .tag-open.relationship-tag, .relationship-tree-item .tag-open.relationship-tag {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  border: 0;
  border-left: 3px solid var(--cyan);
  border-radius: 0;
  background: transparent;
  color: var(--text);
  padding: 6px 8px;
  text-align: left;
  transform: none;
  clip-path: none;
}
.relationship-tree-root .tag-open.relationship-tag {
  width: auto;
  max-width: 100%;
  border: 2px solid var(--amber);
  border-left-width: 4px;
  background: var(--panel-deep);
}
.relationship-tree-root .tag-open.relationship-tag:hover, .relationship-tree-root .tag-open.relationship-tag:focus-visible, .relationship-tree-item .tag-open.relationship-tag:hover, .relationship-tree-item .tag-open.relationship-tag:focus-visible {
  border-color: var(--amber);
  background: var(--panel-raised);
  color: var(--text);
  transform: translateX(3px);
  box-shadow: none;
}
.relationship-empty { padding: 12px 2px 4px; color: var(--muted); font-size: 11px; }
.relationship-graph-shell { overflow: auto; border: 2px solid var(--line); background: var(--panel); }
.relationship-graph { display: block; min-width: 760px; }
.relationship-edge { stroke: var(--line-strong); stroke-width: 1.5; opacity: .75; }
.relationship-node { cursor: pointer; outline: none; }
.relationship-node rect { fill: var(--panel-deep); stroke: var(--cyan); stroke-width: 1.5; }
.relationship-node text { fill: var(--text); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); pointer-events: none; }
.relationship-node:hover rect, .relationship-node:focus rect { fill: var(--panel-raised); stroke: var(--amber); stroke-width: 2; }
.relationship-node:hover text, .relationship-node:focus text { fill: var(--amber); }
.relationship-root-node rect { fill: var(--panel-raised); stroke: var(--amber); stroke-width: 2; }
.relationship-root-node text { fill: var(--text); font-weight: 700; }
.relationship-graph-label { fill: var(--muted); font: 10px var(--vscode-editor-font-family, ui-monospace, monospace); letter-spacing: .12em; text-transform: uppercase; }
.relationship-graph-caption { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
.relationship-tag { display: inline-flex; align-items: center; gap: 6px; }
.tag-open.relationship-tag, .tag-open.relationship-tag:hover, .tag-open.relationship-tag:focus-visible { color: var(--text); }
.relationship-count { color: var(--muted); font-size: 10px; }
.tag-context-menu { position: fixed; z-index: 20; min-width: 150px; padding: 4px; border: 2px solid var(--amber); background: var(--panel-raised); box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
.tag-context-menu[hidden] { display: none; }
.tag-context-menu button { display: block; width: 100%; border: 0; padding: 8px 9px; text-align: left; text-transform: none; }
.cards { display: grid; gap: 12px; margin-top: 20px; }
.overview-filter-tag { display: inline-flex; align-items: baseline; gap: 5px; }
.title-filter-remove { min-height: 18px; border: 1px solid var(--line-strong); border-radius: 50%; background: transparent; color: var(--muted); padding: 0 4px; font-size: 12px; line-height: 16px; vertical-align: middle; }
.title-filter-remove:hover, .title-filter-remove:focus-visible { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
.card[hidden], .task[hidden] { display: none; }
.card { border: 2px solid var(--line); background: var(--panel); padding: 14px; cursor: pointer; }
.card:hover { border-color: var(--amber); }
.card:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }
.card-header { display: block; }
.card-title { margin: 0; color: var(--cyan); font-size: 16px; overflow-wrap: anywhere; }
.source { color: var(--muted); font-size: 11px; margin-top: 5px; overflow-wrap: anywhere; }
.markdown { margin: 14px 0 0; padding: 12px; overflow-x: auto; border: 2px solid var(--line); border-left: 4px solid var(--amber); background: var(--panel-deep); color: var(--text); white-space: pre-wrap; font: 12px/1.55 var(--vscode-editor-font-family, ui-monospace, monospace); }
.rendered { margin-top: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.rendered :first-child { margin-top: 0; }
.rendered :last-child { margin-bottom: 0; }
.rendered code, .rendered pre { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.rendered pre { overflow-x: auto; padding: 10px; border: 2px solid var(--line); background: var(--panel-deep); }
.rendered a { color: var(--cyan); }
.entity-meta { margin-top: 8px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.task-summary { display: grid; gap: 7px; }
.task { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: start; border: 2px solid var(--line); background: var(--panel); padding: 10px; cursor: pointer; }
.task:hover { border-color: var(--amber); }
.task input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--green); }
.task-title { color: var(--cyan); overflow-wrap: anywhere; }
.task-title a { color: var(--cyan); }
.task.completed .task-title { color: var(--muted); text-decoration: line-through; }
.empty { border: 2px dashed var(--line); padding: 20px; color: var(--muted); background: var(--panel-deep); margin-top: 20px; }
@media (max-width: 900px) { .relationship-tree-columns { grid-template-columns: 1fr; } }
@media (max-width: 700px) { main { padding: 16px; } header { align-items: start; flex-direction: column; } header > .toolbar { width: 100%; padding-right: 0; } .overview-split { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading tag...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  let activeTab = 'notes';
  let relationshipView = 'tree';
  let noteSearchQuery = '';
  let taskSearchQuery = '';
  let tagContextMenu;
  let tagContextKey;

  /** Escape headings and source paths before inserting snapshot data as HTML. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function renderTagLabel(label, svg) {
    const value = String(label);
    const match = value.match(/^([#@][^/]+\\/)(.*)$/);
    if (svg) {
      return match
        ? '<tspan class="tag-namespace">' + escapeHtml(match[1]) + '</tspan><tspan class="tag-value">' + escapeHtml(match[2]) + '</tspan>'
        : '<tspan class="tag-value">' + escapeHtml(value) + '</tspan>';
    }
    return match
      ? '<span class="tag-label"><span class="tag-namespace">' + escapeHtml(match[1]) + '</span><span class="tag-value">' + escapeHtml(match[2]) + '</span></span>'
      : '<span class="tag-label"><span class="tag-value">' + escapeHtml(value) + '</span></span>';
  }

  /** Use familiar list and checkbox icons without losing accessible labels. */
  function taskFilterIcon(filter) {
    if (filter === 'all') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 4h8M5 8h8M5 12h8"/><circle cx="2.5" cy="4" r=".5"/><circle cx="2.5" cy="8" r=".5"/><circle cx="2.5" cy="12" r=".5"/></svg>';
    if (filter === 'active') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';
    return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/><path d="m5.5 8 1.7 1.7 3.3-3.3"/></svg>';
  }

  /** Give built-in and user-created namespaces the same readable title form. */
  function formatEntityTitle(kind, name) {
    function formatPart(value) {
      return String(value).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, function (character) { return character.toUpperCase(); });
    }
    return formatPart(kind) + ': ' + formatPart(name);
  }

  /** Formats a filtered tag like the entity title shown beside it. */
  function formatTagReferenceTitle(tag) {
    const key = String(tag.key || '').replace(/^[@#]/, '');
    const separator = key.indexOf('/');
    if (separator > 0) {
      return formatEntityTitle(key.slice(0, separator), key.slice(separator + 1));
    }
    return String(tag.label || key);
  }

  /** Render a title or metadata tag as a direct overview link. */
  function renderOverviewTagLink(tag, text) {
    return '<button class="overview-tag-link" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(text) + '</button>';
  }

  /** Render a combined-overview tag with a control that removes only that tag. */
  function renderFilteredOverviewTag(tag, text, nextTagKey, nextFilterTagKeys) {
    return '<span class="overview-filter-tag">' + renderOverviewTagLink(tag, text) + '<button class="title-filter-remove" data-action="open-tag" data-tag-key="' + escapeHtml(nextTagKey) + '" data-filter-tag-keys="' + escapeHtml(JSON.stringify(nextFilterTagKeys)) + '" aria-label="Remove ' + escapeHtml(tag.label) + ' from this overview" title="Remove ' + escapeHtml(tag.label) + '">&#215;</button></span>';
  }

  function closeTagContextMenu() {
    if (tagContextMenu) tagContextMenu.hidden = true;
    tagContextKey = undefined;
  }

  function openTagContextMenu(event, target) {
    const tagKey = target.dataset.tagKey;
    if (!tagKey) return;
    event.preventDefault();
    closeTagContextMenu();
    if (!tagContextMenu) {
      tagContextMenu = document.createElement('div');
      tagContextMenu.id = 'tag-context-menu';
      tagContextMenu.className = 'tag-context-menu';
      tagContextMenu.setAttribute('role', 'menu');
      document.body.appendChild(tagContextMenu);
    }
    tagContextKey = tagKey;
    tagContextMenu.innerHTML = '<button type="button" role="menuitem" data-context-action="rename-tag">Rename tag</button>';
    tagContextMenu.hidden = false;
    const bounds = tagContextMenu.getBoundingClientRect();
    tagContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
    tagContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
    tagContextMenu.querySelector('button').focus();
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

  /** Render one relationship as a keyboard-accessible tag navigation control. */
  function renderRelationshipTag(tag, count, weight, direction, filterTagKey, detail) {
    const countHtml = Number(count) > 1
      ? '<span class="relationship-count">x' + escapeHtml(count) + '</span>'
      : '';
    const scoreHtml = direction === 'associated'
      ? '<span class="relationship-count">' + Math.round(Number(weight) * 100) + '%</span>'
      : '';
    const label = direction === 'parent'
      ? 'Open parent tag '
      : direction === 'child'
        ? 'Open child tag '
        : direction === 'associated'
          ? 'Open associated tag '
          : 'Current tag ';
    const filterAttribute = filterTagKey
      ? ' data-filter-tag-key="' + escapeHtml(filterTagKey) + '"'
      : '';
    const title = detail ? ' title="' + escapeHtml(detail) + '"' : '';
    return '<button class="tag-open relationship-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '"' + filterAttribute + title + ' aria-label="' + escapeHtml(label + tag.label) + '">' + renderTagLabel(tag.label) + scoreHtml + countHtml + '</button>';
  }

  /** Group relationship nodes by namespace so large trees remain scannable. */
  function groupRelationships(relationships, direction) {
    const groups = new Map();
    (relationships || []).forEach(function (relationship) {
      const tag = direction === 'parent'
        ? relationship.parent
        : direction === 'child'
          ? relationship.child
          : relationship.associatedTag;
      const key = String(tag.key || '').replace(/^[@#]/, '').split('/')[0] || 'other';
      if (!groups.has(key)) groups.set(key, []);
      const detail = relationship.coOccurrenceCount
        ? 'Written together ' + relationship.coOccurrenceCount + ' time' + (relationship.coOccurrenceCount === 1 ? '' : 's') + (relationship.headingRelationshipCount ? '; heading context ' + relationship.headingRelationshipCount + ' time' + (relationship.headingRelationshipCount === 1 ? '' : 's') : '')
        : 'Heading context ' + relationship.headingRelationshipCount + ' time' + (relationship.headingRelationshipCount === 1 ? '' : 's');
      groups.get(key).push({ tag: tag, count: relationship.count, weight: relationship.weight || 0, coOccurrenceCount: relationship.coOccurrenceCount || 0, detail: detail });
    });
    return Array.from(groups.entries()).sort(function (left, right) {
      return left[0].localeCompare(right[0], undefined, { sensitivity: 'base' });
    });
  }

  /** Render one collapsible namespace branch in the relationship tree. */
  function renderRelationshipTreeGroups(relationships, direction, filterTagKey) {
    const groups = groupRelationships(relationships, direction);
    if (!groups.length) {
      const heading = direction === 'parent'
        ? 'parent'
        : direction === 'child'
          ? 'child'
          : 'associated';
      return '<div class="relationship-empty">No ' + heading + ' tags.</div>';
    }
    return groups.map(function (group) {
      const items = group[1].sort(function (left, right) {
        return right.coOccurrenceCount - left.coOccurrenceCount || right.weight - left.weight || left.tag.label.localeCompare(right.tag.label, undefined, { sensitivity: 'base' });
      });
      const namespaceLabel = group[0] === 'other' ? 'Other tags' : group[0].replace(/[-_]+/g, ' ');
      return '<details class="relationship-tree-group"><summary><span>' + escapeHtml(namespaceLabel) + '</span><span class="relationship-tree-group-count">' + items.length + '</span></summary><div class="relationship-tree-items">' + items.map(function (item) {
        return '<div class="relationship-tree-item">' + renderRelationshipTag(item.tag, item.count, item.weight, direction, filterTagKey, item.detail) + '</div>';
      }).join('') + '</div></details>';
    }).join('');
  }

  /** Render the compact, namespace-collapsible relationship tree. */
  function renderRelationshipTree(associations, rootTag) {
    return '<div class="relationship-tree"><div class="relationship-tree-root"><span class="relationship-tree-root-label">Focus</span>' + renderRelationshipTag(rootTag, 0, 0, 'focus') + '</div><div class="relationship-tree-columns"><section class="relationship-tree-column" aria-labelledby="tree-associated-heading"><h3 id="tree-associated-heading" class="relationship-tree-column-heading"><span>Associated tags</span><span class="relationship-tree-column-count">' + associations.length + '</span></h3>' + renderRelationshipTreeGroups(associations, 'associated', rootTag.key) + '</section></div></div>';
  }

  /** Keep graph labels readable while the full value remains available to assistive text. */
  function shortenGraphLabel(label) {
    const value = String(label);
    return value.length > 24 ? value.slice(0, 21) + '...' : value;
  }

  /** Render one SVG node and its edge to the selected tag. */
  function renderGraphNode(item, direction, column, row, startX, rootX, rootY, nodeWidth, nodeHeight, columnGap, filterTagKey, nodeStartY) {
    const x = startX + column * (nodeWidth + columnGap);
    const y = (nodeStartY || 62) + row * 42;
    const node = item.tag;
    const centerX = x + nodeWidth / 2;
    const centerY = y + nodeHeight / 2;
    const edgeX = direction === 'parent'
      ? x + nodeWidth
      : direction === 'child'
        ? x
        : centerX;
    const rootEdgeX = direction === 'parent'
      ? rootX - 112
      : direction === 'child'
        ? rootX + 112
        : rootX;
    const rootEdgeY = direction === 'associated' ? rootY + 15 : rootY;
    const edgeY = direction === 'associated' ? y : centerY;
    const edge = '<line class="relationship-edge" x1="' + rootEdgeX + '" y1="' + rootEdgeY + '" x2="' + edgeX + '" y2="' + edgeY + '"></line>';
    const count = Number(item.count) > 1 ? ' x' + item.count : '';
    const label = shortenGraphLabel(node.label);
    const ariaLabel = (direction === 'parent'
      ? 'Open parent tag '
      : direction === 'child'
        ? 'Open child tag '
        : 'Open associated tag ') + node.label + (count ? ', ' + item.count + ' references' : '');
    const filterAttribute = filterTagKey
      ? ' data-filter-tag-key="' + escapeHtml(filterTagKey) + '"'
      : '';
    const graphNode = '<g class="relationship-node" data-action="open-tag" data-tag-key="' + escapeHtml(node.key) + '"' + filterAttribute + ' role="button" tabindex="0" aria-label="' + escapeHtml(ariaLabel) + '"><title>' + escapeHtml(ariaLabel) + '</title><rect x="' + x + '" y="' + y + '" width="' + nodeWidth + '" height="' + nodeHeight + '" rx="2"></rect><text x="' + centerX + '" y="' + (centerY + 4) + '" text-anchor="middle">' + renderTagLabel(label, true) + escapeHtml(count) + '</text></g>';
    return { edge: edge, node: graphNode };
  }

  /** Render a layered SVG graph with parents on the left and children on the right. */
  function renderRelationshipGraph(associations, rootTag) {
    const nodeWidth = 190;
    const nodeHeight = 30;
    const columnGap = 20;
    const maxRows = 12;
    const parentWidth = 0;
    const childWidth = 0;
    const rootWidth = 224;
    const sideGap = 72;
    const leftPadding = 36;
    const siblingColumns = Math.min(4, Math.max(1, associations.length));
    const siblingWidth = associations.length
      ? siblingColumns * nodeWidth + (siblingColumns - 1) * columnGap
      : 0;
    const width = Math.max(
      leftPadding * 2 + rootWidth,
      leftPadding * 2 + siblingWidth,
    );
    const siblingRows = associations.length ? Math.ceil(associations.length / siblingColumns) : 0;
    const rowCount = 1;
    const height = Math.max(260, 124 + rowCount * 42 + (siblingRows ? siblingRows * 42 + 48 : 0));
    const rootX = Math.max(leftPadding + rootWidth / 2, siblingWidth / 2 + leftPadding);
    const rootY = siblingRows ? 62 + rowCount * 21 : height / 2;
    const siblingStartX = Math.max(leftPadding, rootX - siblingWidth / 2);
    const siblingStartY = rootY + 72;
    const siblings = [];
    associations.forEach(function (relationship, index) {
      const column = index % siblingColumns;
      const row = Math.floor(index / siblingColumns);
      siblings.push(renderGraphNode({ tag: relationship.associatedTag, count: relationship.count }, 'associated', column, row, siblingStartX, rootX, rootY, nodeWidth, nodeHeight, columnGap, rootTag.key, siblingStartY));
    });
    const edges = siblings.map(function (item) { return item.edge; }).join('');
    const nodes = siblings.map(function (item) { return item.node; }).join('');
    const rootLeft = rootX - rootWidth / 2;
    const rootTop = rootY - nodeHeight / 2;
    return '<div class="relationship-graph-shell"><svg class="relationship-graph" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Tag association graph for ' + escapeHtml(rootTag.label) + '"><text class="relationship-graph-label" x="' + rootX + '" y="24" text-anchor="middle">Focus</text>' + (associations.length ? '<text class="relationship-graph-label" x="' + (siblingStartX + siblingWidth / 2) + '" y="' + (siblingStartY - 28) + '" text-anchor="middle">Associated tags</text>' : '') + edges + '<g class="relationship-root-node" data-tag-key="' + escapeHtml(rootTag.key) + '"><rect x="' + rootLeft + '" y="' + rootTop + '" width="' + rootWidth + '" height="' + nodeHeight + '" rx="2"></rect><text x="' + rootX + '" y="' + (rootY + 4) + '" text-anchor="middle">' + renderTagLabel(shortenGraphLabel(rootTag.label), true) + '</text></g>' + nodes + '</svg></div><p class="relationship-graph-caption">Select a node to open its overview. Scroll horizontally when there are many associations.</p>';
  }

  /** Render both relationship modes behind a local view switch. */
  function renderRelationshipViews(associations, rootTag) {
    if (!associations.length) return '';
    const treeActive = relationshipView === 'tree';
    return '<section class="relationship-workspace" aria-labelledby="relationships-heading"><div class="relationship-workspace-header"><div class="relationship-workspace-title"><h2 id="relationships-heading" class="relationship-heading">Tag associations</h2><span class="relationship-summary">' + associations.length + ' related tags</span></div><div class="relationship-view-switch" role="tablist" aria-label="Relationship view"><button class="' + (treeActive ? 'active' : '') + '" data-action="set-relationship-view" data-view="tree" role="tab" aria-selected="' + treeActive + '">Tree</button><button class="' + (!treeActive ? 'active' : '') + '" data-action="set-relationship-view" data-view="graph" role="tab" aria-selected="' + (!treeActive) + '">Graph</button></div></div><div class="relationship-view-panel"' + (treeActive ? '' : ' hidden') + ' role="tabpanel">' + renderRelationshipTree(associations, rootTag) + '</div><div class="relationship-view-panel"' + (!treeActive ? '' : ' hidden') + ' role="tabpanel">' + renderRelationshipGraph(associations, rootTag) + '</div></section>';
  }

  function filterOverviewEntries(kind, query, total) {
    const normalizedQuery = query.trim().toLowerCase();
    let visibleCount = 0;
    document.querySelectorAll('[data-search-entry="' + kind + '"]').forEach(function (entry) {
      const visible = !normalizedQuery || entry.dataset.searchText.indexOf(normalizedQuery) >= 0;
      entry.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    document.querySelectorAll('[data-search-count="' + kind + '"]').forEach(function (count) {
      count.textContent = visibleCount + (normalizedQuery ? ' / ' + total : '');
    });
    const empty = document.querySelector('[data-search-empty="' + kind + '"]');
    if (empty) empty.hidden = !normalizedQuery || visibleCount > 0;
    if (kind === 'tasks') updateTaskFilterCounts(normalizedQuery);
  }

  function updateTaskFilterCounts(query) {
    const counts = query
      ? { all: 0, active: 0, completed: 0 }
      : (state && state.taskCounts
        ? state.taskCounts
        : { all: 0, active: 0, completed: 0 });
    if (query) {
      document.querySelectorAll('[data-search-entry="tasks"]').forEach(function (entry) {
        if (entry.hidden) return;
        counts.all += 1;
        counts[entry.classList.contains('completed') ? 'completed' : 'active'] += 1;
      });
    }
    document.querySelectorAll('.task-filter-toggle button[data-filter]').forEach(function (button) {
      const filter = button.dataset.filter;
      if (!filter || counts[filter] === undefined) return;
      const count = counts[filter];
      const label = filter === 'all' ? 'All' : filter === 'active' ? 'Open' : 'Done';
      const description = label + ' tasks, ' + count;
      const countElement = button.querySelector('.filter-count');
      if (countElement) countElement.textContent = String(count);
      button.setAttribute('aria-label', description);
      button.title = description;
    });
  }

  /** Rebuild the cards from the latest host snapshot without local duplication. */
  function render() {
    if (!state) return;
    closeTagContextMenu();
    const baseTitle = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : state.tag.label;
    const filterTags = state.filterTags || (state.filterTag ? [state.filterTag] : []);
    const focusReference = state.entity
      ? { key: state.entity.key, label: state.entity.label }
      : state.tag;
    const focusTitle = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : state.tag.label;
    const activeTitleTags = filterTags.map(function (tag) {
      return { tag: tag, text: formatTagReferenceTitle(tag) };
    }).concat([{ tag: focusReference, text: focusTitle }]);
    const titleHtml = filterTags.length
      ? activeTitleTags.map(function (item) {
        const removingFocus = item.tag.key === focusReference.key;
        const remainingFilterTags = removingFocus
          ? filterTags.slice(1)
          : filterTags.filter(function (tag) { return tag.key !== item.tag.key; });
        const nextTagKey = removingFocus ? filterTags[0].key : focusReference.key;
        return renderFilteredOverviewTag(item.tag, item.text, nextTagKey, remainingFilterTags.map(function (tag) { return tag.key; }));
      }).join('<span class="overview-title-joiner"> AND </span>')
      : renderOverviewTagLink(focusReference, focusTitle);
    const titleAriaLabel = filterTags.length
      ? activeTitleTags.map(function (item) { return item.text; }).join(' and ') + (state.entity ? '' : ' overview')
      : baseTitle;
    const entityMeta = state.entity
      ? '<div class="entity-meta">' + (filterTags.length ? filterTags.map(function (tag) { return renderOverviewTagLink(tag, tag.label); }).join(' · ') + ' · ' : '') + renderOverviewTagLink(focusReference, state.entity.label) + '</div>'
      : '';
    const cards = state.sections.length ? state.sections.map(function (section) {
      const fileName = section.filePath.split('/').pop() || section.filePath;
      const content = section.rawContent ? (state.renderMode === 'html' ? '<div class="rendered">' + section.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(section.rawContent) + '</pre>') : '';
      const titleHtml = state.tagTitleDisplayMode === 'inline'
        ? renderInlineTitle(section.heading, section.titleTags)
        : escapeHtml(section.heading);
      const tags = state.tagTitleDisplayMode === 'separate' ? section.tags.map(function (tag) {
        return '<button class="tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(tag.label) + '</button>';
      }).join('') : '';
      const searchText = [section.heading, section.filePath, section.rawContent].join(' ').toLowerCase();
      return '<article class="card" tabindex="0" data-search-entry="notes" data-search-text="' + escapeHtml(searchText) + '" data-file-path="' + escapeHtml(section.filePath) + '" data-line="' + section.startLine + '"><div class="card-header"><h2 class="card-title">' + titleHtml + (tags ? '<span class="tag-list" aria-label="Section tags">' + tags + '</span>' : '') + '</h2><div class="source">' + escapeHtml(fileName) + ' / line ' + section.startLine + '</div></div>' + content + '</article>';
    }).join('') : '<div class="empty">' + (filterTags.length ? 'No sections currently carry all selected tags.' : 'No sections currently carry this tag.') + '</div>';
    const tasks = state.tasks.length ? '<div class="task-summary">' + state.tasks.map(function (item) {
      const task = item.task;
      const searchText = [task.title, item.fileName, item.sectionHeading || ''].join(' ').toLowerCase();
      return '<article class="task ' + (task.completed ? 'completed' : '') + '" tabindex="0" data-search-entry="tasks" data-search-text="' + escapeHtml(searchText) + '" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '"><input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '"><div><div class="task-title">' + (state.tagTitleDisplayMode === 'inline' ? renderTaskTitle(item.renderedTitle, item.titleTags) : item.renderedTitle) + '</div><div class="source">' + escapeHtml(item.fileName) + ' / line ' + task.lineNumber + '</div></div></article>';
    }).join('') + '</div>' : '<div class="empty">No tasks match this filter.</div>';
    const taskCounts = state.taskCounts || {
      all: state.tasks.length,
      active: state.tasks.filter(function (item) { return !item.task.completed; }).length,
      completed: state.tasks.filter(function (item) { return item.task.completed; }).length,
    };
    const taskFilters = ['all', 'active', 'completed'].map(function (filter) {
      const label = filter === 'all' ? 'All' : filter === 'active' ? 'Open' : 'Done';
      const description = label + ' tasks, ' + taskCounts[filter];
      return '<button class="' + (state.taskFilter === filter ? 'active' : '') + '" data-action="set-task-filter" data-filter="' + filter + '" aria-label="' + description + '" aria-pressed="' + (state.taskFilter === filter) + '" title="' + description + '">' + taskFilterIcon(filter) + '<span>' + label + '</span><span class="filter-count">' + taskCounts[filter] + '</span></button>';
    }).join('');
    const notesCount = state.sections.length;
    const tasksCount = state.tasks.length;
    const notesPane = '<section class="overview-pane" aria-labelledby="notes-heading"><div class="overview-pane-header"><h2 id="notes-heading" class="overview-pane-heading">Notes (<span data-search-count="notes">' + notesCount + '</span>)</h2><div class="overview-pane-controls"><input class="overview-search" type="search" data-action="search-notes" value="' + escapeHtml(noteSearchQuery) + '" placeholder="Search notes" aria-label="Search current notes" autocomplete="off"></div></div><div class="cards">' + cards + '<div class="empty" data-search-empty="notes" hidden>No notes match your search.</div></div></section>';
    const tasksPane = '<section class="overview-pane" aria-labelledby="tasks-heading"><div class="overview-pane-header"><h2 id="tasks-heading" class="overview-pane-heading">Tasks (<span data-search-count="tasks">' + tasksCount + '</span>)</h2><div class="overview-pane-controls"><input class="overview-search" type="search" data-action="search-tasks" value="' + escapeHtml(taskSearchQuery) + '" placeholder="Search tasks" aria-label="Search current tasks" autocomplete="off"><div class="task-filter-toggle" role="group" aria-label="Task status filter">' + taskFilters + '</div></div></div>' + tasks + '<div class="empty" data-search-empty="tasks" hidden>No tasks match your search.</div></section>';
    const layoutContent = state.layout === 'split'
      ? '<div class="overview-split">' + notesPane + tasksPane + '</div>'
      : '<div class="overview-tabs-row"><div class="overview-tabs" role="tablist" aria-label="Tag overview content"><button class="' + (activeTab === 'notes' ? 'active' : '') + '" data-action="set-tab" data-tab="notes" role="tab" aria-selected="' + (activeTab === 'notes') + '">Notes (<span data-search-count="notes">' + notesCount + '</span>)</button><button class="' + (activeTab === 'tasks' ? 'active' : '') + '" data-action="set-tab" data-tab="tasks" role="tab" aria-selected="' + (activeTab === 'tasks') + '">Tasks (<span data-search-count="tasks">' + tasksCount + '</span>)</button></div></div><div class="overview-tab-panel"' + (activeTab === 'notes' ? '' : ' hidden') + '>' + notesPane + '</div><div class="overview-tab-panel"' + (activeTab === 'tasks' ? '' : ' hidden') + '>' + tasksPane + '</div>';
    const relationships = '';
    const saveFilterControl = filterTags.length
      ? '<button class="save-filter" data-action="save-filter" aria-label="Save this combined tag filter" title="Save filter">Save filter</button>'
      : '';
    const layoutControls = '<div class="toolbar-toggle-group layout-toggle-group" role="group" aria-label="Content layout"><button class="toolbar-toggle ' + (state.layout === 'tabs' ? 'active' : '') + '" data-action="set-layout" data-layout="tabs" aria-label="Tabs layout" aria-pressed="' + (state.layout === 'tabs') + '" title="Tabs: switch between Notes and Tasks"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M5 2.5V6"/></svg></button><button class="toolbar-toggle ' + (state.layout === 'split' ? 'active' : '') + '" data-action="set-layout" data-layout="split" aria-label="Side-by-side layout" aria-pressed="' + (state.layout === 'split') + '" title="Side by side: Notes 60%, Tasks 40%"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M9 2v12"/></svg></button></div>';
    const formatControls = '<div class="toolbar-toggle-group" role="group" aria-label="Content format"><button class="toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button><button class="toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5"/></svg></button></div>';
    const viewOptions = '<details class="view-options"><summary aria-label="View options" title="View options"><svg class="toolbar-icon settings-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.0002 8C9.79111 8 8.00024 9.79086 8.00024 12C8.00024 14.2091 9.79111 16 12.0002 16C14.2094 16 16.0002 14.2091 16.0002 12C16.0002 9.79086 14.2094 8 12.0002 8ZM10.0002 12C10.0002 10.8954 10.8957 10 12.0002 10C13.1048 10 14.0002 10.8954 14.0002 12C14.0002 13.1046 13.1048 14 12.0002 14C10.8957 14 10.0002 13.1046 10.0002 12Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.2867 0.5C9.88583 0.5 8.6461 1.46745 8.37171 2.85605L8.29264 3.25622C8.10489 4.20638 7.06195 4.83059 6.04511 4.48813L5.64825 4.35447C4.32246 3.90796 2.83873 4.42968 2.11836 5.63933L1.40492 6.83735C0.67773 8.05846 0.954349 9.60487 2.03927 10.5142L2.35714 10.7806C3.12939 11.4279 3.12939 12.5721 2.35714 13.2194L2.03927 13.4858C0.954349 14.3951 0.67773 15.9415 1.40492 17.1626L2.11833 18.3606C2.83872 19.5703 4.3225 20.092 5.64831 19.6455L6.04506 19.5118C7.06191 19.1693 8.1049 19.7935 8.29264 20.7437L8.37172 21.1439C8.6461 22.5325 9.88584 23.5 11.2867 23.5H12.7136C14.1146 23.5 15.3543 22.5325 15.6287 21.1438L15.7077 20.7438C15.8954 19.7936 16.9384 19.1693 17.9553 19.5118L18.3521 19.6455C19.6779 20.092 21.1617 19.5703 21.8821 18.3606L22.5955 17.1627C23.3227 15.9416 23.046 14.3951 21.9611 13.4858L21.6432 13.2194C20.8709 12.5722 20.8709 11.4278 21.6432 10.7806L21.9611 10.5142C23.046 9.60489 23.3227 8.05845 22.5955 6.83732L21.8821 5.63932C21.1617 4.42968 19.678 3.90795 18.3522 4.35444L17.9552 4.48814C16.9384 4.83059 15.8954 4.20634 15.7077 3.25617L15.6287 2.85616C15.3543 1.46751 14.1146 0.5 12.7136 0.5H11.2867ZM10.3338 3.24375C10.4149 2.83334 10.7983 2.5 11.2867 2.5H12.7136C13.2021 2.5 13.5855 2.83336 13.6666 3.24378L13.7456 3.64379C14.1791 5.83811 16.4909 7.09167 18.5935 6.38353L18.9905 6.24984C19.4495 6.09527 19.9394 6.28595 20.1637 6.66264L20.8771 7.86064C21.0946 8.22587 21.0208 8.69271 20.6764 8.98135L20.3586 9.24773C18.6325 10.6943 18.6325 13.3057 20.3586 14.7523L20.6764 15.0186C21.0208 15.3073 21.0946 15.7741 20.8771 16.1394L20.1637 17.3373C19.9394 17.714 19.4495 17.9047 18.9905 17.7501L18.5936 17.6164C16.4909 16.9082 14.1791 18.1618 13.7456 20.3562L13.6666 20.7562C13.5855 21.1666 13.2021 21.5 12.7136 21.5H11.2867C10.7983 21.5 10.4149 21.1667 10.3338 20.7562L10.2547 20.356C9.82113 18.1617 7.50931 16.9082 5.40665 17.6165L5.0099 17.7501C4.55092 17.9047 4.06104 17.714 3.83671 17.3373L3.1233 16.1393C2.9058 15.7741 2.97959 15.3073 3.32398 15.0186L3.64185 14.7522C5.36782 13.3056 5.36781 10.6944 3.64185 9.24779L3.32398 8.98137C2.97959 8.69273 2.9058 8.2259 3.1233 7.86067L3.83674 6.66266C4.06106 6.28596 4.55093 6.09528 5.0099 6.24986L5.40676 6.38352C7.50938 7.09166 9.82112 5.83819 10.2547 3.64392L10.3338 3.24375Z"/></svg></summary><div class="view-options-menu"><div class="view-options-group"><span>Layout</span>' + layoutControls + '</div><div class="view-options-group"><span>Format</span>' + formatControls + '</div></div></details>';
    const headerControls = '<div class="toolbar" role="group" aria-label="Tag entry view controls"><label>Sort:<select data-action="set-sort" aria-label="Sort tag entries"><option value="alphabetical" ' + (state.sortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="created" ' + (state.sortMode === 'created' ? 'selected' : '') + '>Newest created</option><option value="updated" ' + (state.sortMode === 'updated' ? 'selected' : '') + '>Recently updated</option><option value="access" ' + (state.sortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select></label>' + viewOptions + '</div>';
    const savedViewName = state.savedViewName
      ? '<div class="saved-view-name" aria-label="Saved view: ' + escapeHtml(state.savedViewName) + '"><span class="saved-view-name-label">Saved view:</span> ' + escapeHtml(state.savedViewName) + '</div>'
      : '';
    document.getElementById('app').innerHTML = '<header><div><div class="overview-eyebrow"><p class="eyebrow">DECKARD / ' + (state.entity ? 'ENTITY' : 'TAG') + ' OVERVIEW</p>' + saveFilterControl + '</div>' + savedViewName + '<h1 aria-label="' + escapeHtml(titleAriaLabel) + '">' + titleHtml + '</h1>' + entityMeta + '</div>' + headerControls + '</header>' + relationships + layoutContent;
    filterOverviewEntries('notes', noteSearchQuery, state.sections.length);
    filterOverviewEntries('tasks', taskSearchQuery, state.tasks.length);
  }

  document.addEventListener('click', function (event) {
    const contextAction = event.target.closest('#tag-context-menu [data-context-action]');
    if (contextAction) {
      const tagKey = tagContextKey;
      closeTagContextMenu();
      if (contextAction.dataset.contextAction === 'rename-tag' && tagKey) {
        vscode.postMessage({ type: 'renameTag', tagKey: tagKey });
      }
      return;
    }
    if (tagContextMenu && !event.target.closest('#tag-context-menu')) {
      closeTagContextMenu();
    }
    const viewOptions = document.querySelector('.view-options');
    if (viewOptions && viewOptions.open && !event.target.closest('.view-options')) {
      viewOptions.open = false;
    }
    const target = event.target.closest('[data-action]');
    if (target) {
      if (target.dataset.action === 'set-mode') vscode.postMessage({ type: 'setRenderMode', mode: target.dataset.mode });
      if (target.dataset.action === 'set-layout') vscode.postMessage({ type: 'setTagOverviewLayout', layout: target.dataset.layout });
      if (target.dataset.action === 'set-task-filter') vscode.postMessage({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (target.dataset.action === 'set-relationship-view') {
        relationshipView = target.dataset.view === 'graph' ? 'graph' : 'tree';
        render();
      }
      if (target.dataset.action === 'set-tab') {
        activeTab = target.dataset.tab;
        render();
      }
      if (target.dataset.action === 'save-filter') {
        vscode.postMessage({ type: 'saveTagOverviewFilter' });
      }
      if (target.dataset.action === 'open-source') vscode.postMessage({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      if (target.dataset.action === 'open-tag') {
        const message = { type: 'openTag', tagKey: target.dataset.tagKey };
        if (target.dataset.filterTagKey) message.filterTagKey = target.dataset.filterTagKey;
        const filterTagKeys = getFilterTagKeys(target.dataset.filterTagKeys);
        if (filterTagKeys) message.filterTagKeys = filterTagKeys;
        vscode.postMessage(message);
      }
      return;
    }
    const card = event.target.closest('.card, .task');
    if (card) vscode.postMessage({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
  });
  document.addEventListener('contextmenu', function (event) {
    const target = event.target.closest('[data-tag-key]');
    if (target) openTagContextMenu(event, target);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      const viewOptions = document.querySelector('.view-options');
      if (viewOptions && viewOptions.open) {
        viewOptions.open = false;
        viewOptions.querySelector('summary').focus();
        return;
      }
    }
    if (event.key === 'Escape' && tagContextMenu && !tagContextMenu.hidden) {
      closeTagContextMenu();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const relationshipNode = event.target.closest('.relationship-node');
    if (relationshipNode) {
      event.preventDefault();
      const message = { type: 'openTag', tagKey: relationshipNode.dataset.tagKey };
      if (relationshipNode.dataset.filterTagKey) message.filterTagKey = relationshipNode.dataset.filterTagKey;
      const filterTagKeys = getFilterTagKeys(relationshipNode.dataset.filterTagKeys);
      if (filterTagKeys) message.filterTagKeys = filterTagKeys;
      vscode.postMessage(message);
      return;
    }
    if (event.target.closest('[data-action]')) return;
    const card = event.target.closest('.card, .task');
    if (card) {
      event.preventDefault();
      vscode.postMessage({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
    }
  });
  document.addEventListener('change', function (event) {
    const target = event.target;
    if (target.dataset.action === 'set-sort') vscode.postMessage({ type: 'setTagOverviewSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') vscode.postMessage({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
  });
  document.addEventListener('input', function (event) {
    const target = event.target;
    if (target.dataset.action !== 'search-notes' && target.dataset.action !== 'search-tasks') return;
    if (target.dataset.action === 'search-notes') {
      noteSearchQuery = target.value;
    } else {
      taskSearchQuery = target.value;
    }
    filterOverviewEntries(
      target.dataset.action === 'search-notes' ? 'notes' : 'tasks',
      target.dataset.action === 'search-notes' ? noteSearchQuery : taskSearchQuery,
      target.dataset.action === 'search-notes' ? state.sections.length : state.tasks.length,
    );
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; vscode.setState({ tagKey: state.tag.key, filterTagKey: state.filterTag && state.filterTag.key, filterTagKeys: (state.filterTags || []).map(function (tag) { return tag.key; }) }); render(); }
  });

  function getFilterTagKeys(value) {
    if (!value) return undefined;
    try {
      const filterTagKeys = JSON.parse(value);
      return Array.isArray(filterTagKeys) && filterTagKeys.every(function (key) {
        return typeof key === 'string' && key.length > 0;
      }) ? filterTagKeys : undefined;
    } catch (_error) {
      return undefined;
    }
  }
}());
</script>
</body>
</html>`;
}

/**
 * Creates a per-webview CSP nonce for the overview's inline style and script.
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
