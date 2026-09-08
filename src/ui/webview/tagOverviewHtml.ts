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
h1, h2, .eyebrow, .source { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
h1 { margin: 0; color: var(--text); font-size: 22px; font-weight: 700; overflow-wrap: anywhere; text-transform: uppercase; }
h2 { margin: 0; font-size: 14px; font-weight: 650; }
.eyebrow { margin: 0 0 6px; color: var(--amber); font-size: 11px; letter-spacing: .15em; text-transform: uppercase; }
.toolbar { display: flex; gap: 6px; flex-wrap: wrap; }
button, select { min-height: 30px; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: inherit; cursor: pointer; }
button:hover, button.active, select:hover { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.toolbar-toggle { display: inline-grid; width: 30px; min-height: 30px; place-items: center; padding: 5px; }
.toolbar-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.toolbar-toggle-group { display: inline-flex; }
.toolbar-toggle-group .toolbar-toggle + .toolbar-toggle { margin-left: -2px; }
.toolbar-toggle-group .toolbar-toggle:first-child { border-radius: 2px 0 0 2px; }
.toolbar-toggle-group .toolbar-toggle:last-child { border-radius: 0 2px 2px 0; }
.toolbar-toggle-group .toolbar-toggle.active { position: relative; z-index: 1; }
.overview-tabs { display: flex; gap: 6px; margin-top: 20px; border-bottom: 2px solid var(--line); padding-bottom: 8px; }
.overview-tabs button { border-bottom-color: var(--line); }
.overview-tab-panel { margin-top: 12px; }
.overview-tab-panel[hidden] { display: none; }
.overview-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; margin-top: 20px; }
.overview-pane { min-width: 0; }
.overview-pane-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.overview-pane-heading { margin: 0; color: var(--text); font-size: 14px; font-weight: 650; text-transform: uppercase; }
.overview-pane .cards, .overview-pane .task-summary { margin-top: 12px; }
.task-filter-toggle { display: inline-flex; }
.task-filter-toggle button + button { margin-left: -2px; }
.task-filter-toggle button:first-child { border-radius: 2px 0 0 2px; }
.task-filter-toggle button:last-child { border-radius: 0 2px 2px 0; }
.task-filter-toggle button.active { position: relative; z-index: 1; }
.task-filter-toggle button { display: inline-grid; width: 30px; place-items: center; padding: 5px; }
.task-filter-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.tag-list { display: inline-flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0 8px; vertical-align: middle; }
.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); font-size: 11px; text-align: left; }
.inline-tag { min-height: 24px; margin-left: 6px; padding: 2px 6px; font-size: .78em; vertical-align: 1px; }
.cards { display: grid; gap: 12px; margin-top: 20px; }
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
@media (max-width: 700px) { main { padding: 16px; } header { align-items: start; flex-direction: column; } .overview-split { grid-template-columns: 1fr; } }
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

  /** Escape headings and source paths before inserting snapshot data as HTML. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

  /** Replace source tag tokens with buttons while preserving their position. */
  function renderInlineTitle(title, tags) {
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
        ? '<button class="tag-open inline-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '">' + escapeHtml(tag.label) + '</button>'
        : escapeHtml(match);
      offset = matchOffset + match.length;
      return match;
    });
    const trailingTags = references
      .filter(function (tag) { return !matchedKeys.has(tag.key); })
      .map(function (tag) {
        return '<button class="tag-open inline-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '">' + escapeHtml(tag.label) + '</button>';
      })
      .join('');
    return rendered + escapeHtml(title.slice(offset)) + trailingTags;
  }

  /** Rebuild the cards from the latest host snapshot without local duplication. */
  function render() {
    if (!state) return;
    const title = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : state.tag.label + ' Overview';
    const entityMeta = state.entity
      ? '<div class="entity-meta">' + escapeHtml(state.entity.label) + ' · ' + (state.entity.sectionIds.length + state.entity.filePaths.length) + ' note entries · ' + state.entity.taskIds.length + ' tasks</div>'
      : '';
    const cards = state.sections.length ? state.sections.map(function (section) {
      const fileName = section.filePath.split('/').pop() || section.filePath;
      const content = section.rawContent ? (state.renderMode === 'html' ? '<div class="rendered">' + section.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(section.rawContent) + '</pre>') : '';
      const titleHtml = state.tagTitleDisplayMode === 'inline'
        ? renderInlineTitle(section.heading, section.titleTags)
        : escapeHtml(section.heading);
      const tags = state.tagTitleDisplayMode === 'separate' ? section.tags.map(function (tag) {
        return '<button class="tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '">' + escapeHtml(tag.label) + '</button>';
      }).join('') : '';
      return '<article class="card" tabindex="0" data-file-path="' + escapeHtml(section.filePath) + '" data-line="' + section.startLine + '"><div class="card-header"><h2 class="card-title">' + titleHtml + (tags ? '<span class="tag-list" aria-label="Section tags">' + tags + '</span>' : '') + '</h2><div class="source">' + escapeHtml(fileName) + ' / line ' + section.startLine + '</div></div>' + content + '</article>';
    }).join('') : '<div class="empty">No sections currently carry this tag.</div>';
    const tasks = state.tasks.length ? '<div class="task-summary">' + state.tasks.map(function (item) {
      const task = item.task;
      return '<article class="task ' + (task.completed ? 'completed' : '') + '" tabindex="0" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '"><input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '"><div><div class="task-title">' + item.renderedTitle + '</div><div class="source">' + escapeHtml(item.fileName) + ' / line ' + task.lineNumber + '</div></div></article>';
    }).join('') + '</div>' : '<div class="empty">No tasks match this filter.</div>';
    const taskFilters = ['all', 'active', 'completed'].map(function (filter) {
      const label = filter === 'all' ? 'All tasks' : filter === 'active' ? 'Active tasks' : 'Completed tasks';
      return '<button class="' + (state.taskFilter === filter ? 'active' : '') + '" data-action="set-task-filter" data-filter="' + filter + '" aria-label="' + label + '" aria-pressed="' + (state.taskFilter === filter) + '" title="' + label + '">' + taskFilterIcon(filter) + '</button>';
    }).join('');
    const notesPane = '<section class="overview-pane" aria-labelledby="notes-heading"><h2 id="notes-heading" class="overview-pane-heading">Notes (' + state.sections.length + ')</h2><div class="cards">' + cards + '</div></section>';
    const tasksPane = '<section class="overview-pane" aria-labelledby="tasks-heading"><div class="overview-pane-header"><h2 id="tasks-heading" class="overview-pane-heading">Tasks (' + state.tasks.length + ')</h2><div class="task-filter-toggle" role="group" aria-label="Task status filter">' + taskFilters + '</div></div>' + tasks + '</section>';
    const layoutContent = state.layout === 'split'
      ? '<div class="overview-split">' + notesPane + tasksPane + '</div>'
      : '<div class="overview-tabs" role="tablist" aria-label="Tag overview content"><button class="' + (activeTab === 'notes' ? 'active' : '') + '" data-action="set-tab" data-tab="notes" role="tab" aria-selected="' + (activeTab === 'notes') + '">Notes (' + state.sections.length + ')</button><button class="' + (activeTab === 'tasks' ? 'active' : '') + '" data-action="set-tab" data-tab="tasks" role="tab" aria-selected="' + (activeTab === 'tasks') + '">Tasks (' + state.tasks.length + ')</button></div><div class="overview-tab-panel"' + (activeTab === 'notes' ? '' : ' hidden') + '>' + notesPane + '</div><div class="overview-tab-panel"' + (activeTab === 'tasks' ? '' : ' hidden') + '>' + tasksPane + '</div>';
    document.getElementById('app').innerHTML = '<header><div><p class="eyebrow">DECKARD / ' + (state.entity ? 'ENTITY' : 'TAG') + ' OVERVIEW</p><h1>' + escapeHtml(title) + '</h1>' + entityMeta + '</div><div class="toolbar" role="group" aria-label="Tag entry view controls"><div class="toolbar-toggle-group" role="group" aria-label="Content layout"><button class="toolbar-toggle ' + (state.layout === 'tabs' ? 'active' : '') + '" data-action="set-layout" data-layout="tabs" aria-label="Tabs layout" aria-pressed="' + (state.layout === 'tabs') + '" title="Tabs: switch between Notes and Tasks"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M5 2.5V6"/></svg></button><button class="toolbar-toggle ' + (state.layout === 'split' ? 'active' : '') + '" data-action="set-layout" data-layout="split" aria-label="Side-by-side layout" aria-pressed="' + (state.layout === 'split') + '" title="Side by side: Notes 60%, Tasks 40%"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M9 2v12"/></svg></button></div><select data-action="set-sort" aria-label="Sort tag entries"><option value="alphabetical" ' + (state.sortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="created" ' + (state.sortMode === 'created' ? 'selected' : '') + '>Newest created</option><option value="updated" ' + (state.sortMode === 'updated' ? 'selected' : '') + '>Recently updated</option><option value="access" ' + (state.sortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select><div class="toolbar-toggle-group" role="group" aria-label="Content format"><button class="toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 4-4 4 4 4M10 4l4 4-4 4"/></svg></button><button class="toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button></div></div></header>' + layoutContent;
  }

  document.addEventListener('click', function (event) {
    const target = event.target.closest('[data-action]');
    if (target) {
      if (target.dataset.action === 'set-mode') vscode.postMessage({ type: 'setRenderMode', mode: target.dataset.mode });
      if (target.dataset.action === 'set-layout') vscode.postMessage({ type: 'setTagOverviewLayout', layout: target.dataset.layout });
      if (target.dataset.action === 'set-task-filter') vscode.postMessage({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (target.dataset.action === 'set-tab') {
        activeTab = target.dataset.tab;
        render();
      }
      if (target.dataset.action === 'open-source') vscode.postMessage({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      if (target.dataset.action === 'open-tag') vscode.postMessage({ type: 'openTag', tagKey: target.dataset.tagKey });
      return;
    }
    const card = event.target.closest('.card, .task');
    if (card) vscode.postMessage({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
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
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; vscode.setState({ tagKey: state.tag.key }); render(); }
  });
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
