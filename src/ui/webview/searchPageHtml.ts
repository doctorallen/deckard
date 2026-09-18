import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getQueryEditorCss,
  getQueryEditorScript,
} from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds a search page: the search box, the tag or entity a one-tag search is
 * about with its hub note, and the notes and tasks the search finds.
 *
 * The host supplies already-projected results, while this layer only escapes
 * source text and posts user intent back across the webview boundary.
 */
export function getSearchPageHtml(
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
<title>Deckard Search</title>
<style nonce="${nonce}">${getBaseCss()}
${getQueryEditorCss()}
/* The gear sits in the header's top-right corner. The margin keeps a short
   header tall enough to hold it. */
header > .toolbar { margin-top: 36px; }
header > .toolbar .view-options { position: absolute; top: 0; right: 0; }
.overview-tag-link.overview-tag-link {
  min-height: 0;
  margin: 0;
  border: 0;
  border-bottom: 1px solid transparent;
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
.overview-eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.saved-view-name { margin: 0 0 8px; color: var(--cyan); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.saved-view-name-label { color: var(--muted); letter-spacing: .12em; text-transform: uppercase; }
.overview-tab-panel[hidden] { display: none; }
.overview-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; margin-top: 20px; }
.overview-pane { min-width: 0; }
.overview-pane-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.overview-pane-controls { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.overview-pane-heading { margin: 0; color: var(--text); font-size: 14px; font-weight: 650; text-transform: uppercase; }
.overview-pane .cards, .overview-pane .task-list { margin-top: 12px; }
.card-header { display: block; }
.entity-meta { margin-top: 8px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.hub { margin-top: 20px; padding: 14px; border: var(--edge) solid var(--line); border-left: 4px solid var(--amber); background: var(--panel); }
.hub-header, .hub-empty { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hub > summary { cursor: pointer; list-style: none; }
.hub > summary::-webkit-details-marker { display: none; }
.hub > summary:focus-visible { outline: var(--edge) solid var(--cyan); outline-offset: 2px; }
.hub-title { display: inline-flex; align-items: center; gap: 8px; }
.hub-toggle { width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 6px solid var(--amber); transition: transform 120ms ease; }
.hub[open] .hub-toggle { transform: rotate(90deg); }
.hub-empty { color: var(--muted); }
.hub-properties { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; margin: 10px 0 0; }
.hub-properties div { display: flex; align-items: baseline; gap: 6px; }
.hub-properties dt { color: var(--muted); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; }
.hub-properties dd { margin: 0; }
.hub .markdown, .hub .rendered { margin: 12px 0 0; }
.hub-note { margin: 10px 0 0; color: var(--muted); }
.stale-results { margin: 16px 0 0; border-left: 3px solid var(--warning-orange); background: var(--panel); padding: 8px 12px; color: var(--muted); font-size: 12px; }
.empty-action { margin: 12px 0 0; }
@media (max-width: 700px) { main { padding: 16px; } header { align-items: start; flex-direction: column; } header > .toolbar { width: 100%; margin-top: 0; } .overview-split { grid-template-columns: 1fr; } .cards, .task-list { grid-template-columns: 1fr !important; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }

/* The amber rule above the page, and the containing block the gear is
   positioned against. */
main { border-top: 2px solid var(--amber); }
header { position: relative; }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app"><div class="empty">Loading search...</div></main>
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
${getQueryEditorScript()}
  let state;
  let activeTab = 'notes';
  /**
   * Whether the reader picked the tab themselves. Until they do, the page
   * opens the tab that actually has results: a task search would otherwise
   * land on an empty Notes tab while every hit sat behind Tasks.
   */
  let tabChosen = false;
  const savedPageState = typeof vscode.getState === 'function' ? vscode.getState() : undefined;
  if (savedPageState && (savedPageState.tab === 'notes' || savedPageState.tab === 'tasks')) {
    activeTab = savedPageState.tab;
    tabChosen = true;
  }
  const editor = createQueryEditor({
    getState: function () { return state && state.query; },
    render: function () { render(); },
    apply: function (text, remember) { vscode.postMessage({ type: 'setOverviewQuery', query: text, remember: remember !== false }); },
    // Clear returns the page to the search it was opened with, such as its
    // own tag, rather than to nothing.
    clear: function () { vscode.postMessage({ type: 'clearOverviewQuery' }); },
    clearedText: function () { return state ? state.originQuery : ''; },
    // Plain words hide what they do not match at once; the rest waits for Enter.
    onDraft: function () {
      filterEntries('notes');
      filterEntries('tasks');
    },
    placeholder: function () { return 'Search notes and tasks: words, #tags, is:open, has:due, in:folder, updated >= 7d…'; },
    label: 'Search notes and tasks',
    refineElsewhere: function () { return Boolean(state && state.refineInSidebar); },
    actions: function (hasText) {
      return '<button data-action="save-filter" data-query-needs-text title="Keep this search, named, on Home"' + (hasText ? '' : ' disabled') + '>Save</button>';
    },
  });

  /** Render a title or metadata tag as a direct link to its page. */
  function renderOverviewTagLink(tag, text) {
    return '<button class="overview-tag-link" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(text) + '</button>';
  }

  /**
   * Hide the entries that lack a plain word of the search, so words narrow
   * the page as they are typed, before the search runs.
   */
  function filterEntries(kind) {
    if (!state) return;
    const words = editor.previewWords(editor.currentText());
    const total = kind === 'notes' ? state.sections.length : state.tasks.length;
    let visibleCount = 0;
    document.querySelectorAll('[data-search-entry="' + kind + '"]').forEach(function (entry) {
      const text = entry.dataset.searchText || entry.textContent.toLowerCase();
      const visible = words.every(function (word) { return text.indexOf(word) >= 0; });
      entry.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    const filtering = words.length > 0 && visibleCount < total;
    document.querySelectorAll('[data-search-count="' + kind + '"]').forEach(function (count) {
      count.textContent = visibleCount + (filtering ? ' / ' + total : '');
    });
    const empty = document.querySelector('[data-search-empty="' + kind + '"]');
    if (empty) empty.hidden = !words.length || visibleCount > 0;
    if (kind === 'tasks') updateTaskFilterCounts(filtering);
  }

  function updateTaskFilterCounts(filtering) {
    const counts = filtering
      ? { all: 0, active: 0, completed: 0 }
      : (state && state.taskCounts ? state.taskCounts : { all: 0, active: 0, completed: 0 });
    if (filtering) {
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

  /** Set once the reader opens or closes the hub, which then outlasts refreshes. */
  let hubOpen;
  document.addEventListener('toggle', function (event) {
    if (event.target.classList && event.target.classList.contains('hub')) hubOpen = event.target.open;
  }, true);

  /** The note that describes the page's tag, or an offer to create one. */
  function renderHub() {
    if (!state.tag) return '';
    const hub = state.hub;
    if (!hub) {
      return '<section class="hub hub-empty" aria-label="Hub note"><span>No note describes ' + escapeHtml(state.tag.label) + ' yet.</span><button data-action="create-hub" title="Create a note whose describes: front matter names this tag">Create hub note</button></section>';
    }
    const properties = hub.properties.length
      ? '<dl class="hub-properties">' + hub.properties.map(function (property) {
        return '<div><dt>' + escapeHtml(property.name) + '</dt><dd>' + property.values.map(function (value) {
          return value.tag ? renderTagButton(value.tag, 'inline-tag') : escapeHtml(value.text);
        }).join(', ') + '</dd></div>';
      }).join('') + '</dl>'
      : '';
    const body = hub.rawContent.trim()
      ? (state.renderMode === 'html' ? '<div class="rendered">' + hub.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(hub.rawContent) + '</pre>')
      : '';
    const others = hub.otherFilePaths.length
      ? '<p class="hub-note">Also described by ' + hub.otherFilePaths.map(function (filePath) {
        return '<button data-action="open-source" data-file-path="' + escapeHtml(filePath) + '" data-line="1">' + escapeHtml(filePath.split('/').pop() || filePath) + '</button>';
      }).join(' ') + '. The first by path is shown.</p>'
      : '';
    // deckard.tagOverview.hubNoteExpanded sets how the hub starts.
    const open = hubOpen === undefined ? hub.expanded !== false : hubOpen;
    return '<details class="hub"' + (open ? ' open' : '') + '><summary class="hub-header"><span class="hub-title"><span class="hub-toggle" aria-hidden="true"></span><span class="eyebrow">Hub note</span></span><button data-action="open-source" data-file-path="' + escapeHtml(hub.filePath) + '" data-line="1" title="' + escapeHtml(hub.filePath) + '">Open ' + escapeHtml(hub.fileName) + '</button></summary>' + properties + body + others + '</details>';
  }

  function renderCard(section) {
    const fileName = section.filePath.split('/').pop() || section.filePath;
    const content = section.rawContent ? (state.renderMode === 'html' ? '<div class="rendered">' + section.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(section.rawContent) + '</pre>') : '';
    const titleHtml = state.tagTitleDisplayMode === 'inline'
      ? renderInlineTitle(section.heading, section.titleTags)
      : escapeHtml(section.heading);
    const tags = state.tagTitleDisplayMode === 'separate' ? section.tags.map(function (tag) {
      return renderTagButton(tag);
    }).join('') : '';
    const searchText = [section.heading, fileName, section.rawContent, section.tags.map(function (tag) { return tag.label; }).join(' ')].join(' ').toLowerCase();
    return '<article class="card" tabindex="0" data-search-entry="notes" data-search-text="' + escapeHtml(searchText) + '" data-file-path="' + escapeHtml(section.filePath) + '" data-line="' + section.startLine + '"><div class="card-header"><h2 class="card-title">' + titleHtml + (tags ? '<span class="tag-list" aria-label="Section tags">' + tags + '</span>' : '') + '</h2><div class="source">' + escapeHtml(fileName) + ' / line ' + section.startLine + '</div></div>' + content + '</article>';
  }

  /** A task row, marked so plain words being typed can hide it. */
  function renderTask(item) {
    return renderTaskListRow(item, { titleDisplay: state.tagTitleDisplayMode })
      .replace('<div class="row task-row', '<div data-search-entry="tasks" class="row task-row');
  }

  /** Lay the result grids out in their columns; a style attribute is not allowed here. */
  function applyColumns() {
    document.querySelectorAll('.cards').forEach(function (grid) {
      grid.style.gridTemplateColumns = 'repeat(' + (state.noteColumns || 1) + ', minmax(0, 1fr))';
    });
    document.querySelectorAll('.task-list').forEach(function (grid) {
      grid.style.gridTemplateColumns = 'repeat(' + (state.taskColumns || 1) + ', minmax(0, 1fr))';
    });
  }

  function columnChoices(section, selected) {
    const choices = [1, 2, 3, 4].map(function (columns) { return [columns, String(columns), columns + ' columns']; });
    return renderViewOptionChoices('set-columns', choices, selected, (section === 'notes' ? 'Note' : 'Task') + ' columns', 'data-section="' + section + '"');
  }

  /** Rebuild the page from the latest host snapshot. */
  function render() {
    if (!state) return;
    closeTagContextMenu();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const hasText = Boolean(String(state.query.text || '').trim());
    const focus = state.entity
      ? { key: state.entity.key, label: state.entity.label }
      : state.tag;
    const title = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : (state.tag ? state.tag.label : 'Search');
    const titleHtml = focus ? renderOverviewTagLink(focus, title) : escapeHtml(title);
    const entityMeta = state.entity
      ? '<div class="entity-meta">' + renderOverviewTagLink(focus, state.entity.label) + '</div>'
      : '';
    const notesCount = state.sections.length;
    const tasksCount = state.tasks.length;
    // An empty side of a search that did find something on the other side is
    // a dead end otherwise: the count is in the tab strip, but nothing says
    // the results are one click away.
    const otherResults = function (kind) {
      if (state.layout === 'split') return '';
      const otherCount = kind === 'notes' ? tasksCount : notesCount;
      if (!otherCount) return '';
      const other = kind === 'notes' ? 'tasks' : 'notes';
      const noun = otherCount === 1 ? other.slice(0, -1) : other;
      return '<p class="empty-action"><button data-action="show-other-results" data-tab="' + other + '">Show ' + otherCount + ' matching ' + escapeHtml(noun) + '</button></p>';
    };
    const cards = state.sections.length
      ? state.sections.map(renderCard).join('')
      : '<div class="empty">' + (state.tag ? 'No sections currently carry this tag.' : hasText ? 'No notes match this search.' : 'No notes yet.') + otherResults('notes') + '</div>';
    const tasks = state.tasks.length
      ? '<div class="task-list">' + state.tasks.map(renderTask).join('') + '</div>'
      : '<div class="empty">' + (state.taskFilter === 'active' ? 'No open tasks match this search.' : 'No tasks match this filter.') + otherResults('tasks') + '</div>';
    if (!tabChosen && state.layout !== 'split') {
      activeTab = notesCount === 0 && tasksCount > 0 ? 'tasks' : 'notes';
    }
    const notesPane = '<section class="overview-pane" aria-labelledby="notes-heading"><div class="overview-pane-header"><h2 id="notes-heading" class="overview-pane-heading">Notes (<span data-search-count="notes">' + notesCount + '</span>)</h2></div><div class="cards">' + cards + '</div><div class="empty" data-search-empty="notes" hidden>No notes match your search.</div></section>';
    const tasksPane = '<section class="overview-pane" aria-labelledby="tasks-heading"><div class="overview-pane-header"><h2 id="tasks-heading" class="overview-pane-heading">Tasks (<span data-search-count="tasks">' + tasksCount + '</span>)</h2><div class="overview-pane-controls">' + renderTaskFilterSwitch(state.taskFilter, state.taskCounts, 'set-task-filter') + '</div></div>' + tasks + '<div class="empty" data-search-empty="tasks" hidden>No tasks match your search.</div></section>';
    const layoutContent = state.layout === 'split'
      ? '<div class="overview-split">' + notesPane + tasksPane + '</div>'
      // Both counts are the ones the panes actually show, so a tab never
      // promises more rows than the pane behind it holds.
      : renderResultTabs([
        { id: 'notes', label: 'Notes', count: notesCount },
        { id: 'tasks', label: 'Tasks', count: tasksCount },
      ], activeTab, 'Search results') + '<div class="overview-tab-panel"' + (activeTab === 'notes' ? '' : ' hidden') + '>' + notesPane + '</div><div class="overview-tab-panel"' + (activeTab === 'tasks' ? '' : ' hidden') + '>' + tasksPane + '</div>';
    const layoutControls = '<div class="segmented toolbar-toggle-group layout-toggle-group" role="group" aria-label="Content layout"><button class="icon-button toolbar-toggle ' + (state.layout === 'tabs' ? 'active' : '') + '" data-action="set-layout" data-layout="tabs" aria-label="Tabs layout" aria-pressed="' + (state.layout === 'tabs') + '" title="Tabs: switch between Notes and Tasks"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M5 2.5V6"/></svg></button><button class="icon-button toolbar-toggle ' + (state.layout === 'split' ? 'active' : '') + '" data-action="set-layout" data-layout="split" aria-label="Side-by-side layout" aria-pressed="' + (state.layout === 'split') + '" title="Side by side: Notes 60%, Tasks 40%"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M9 2v12"/></svg></button></div>';
    const formatControls = '<div class="segmented toolbar-toggle-group" role="group" aria-label="Content format"><button class="icon-button toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button><button class="icon-button toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5"/></svg></button></div>';
    const viewOptions = renderViewOptions([
      { label: 'Layout', html: layoutControls },
      { label: 'Format', html: formatControls },
      { label: 'Note columns', html: columnChoices('notes', state.noteColumns) },
      { label: 'Task columns', html: columnChoices('tasks', state.taskColumns) },
    ]);
    const sortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-sort" aria-label="Sort notes">' + '<option value="alphabetical" ' + (state.sortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option>' + '<option value="created" ' + (state.sortMode === 'created' ? 'selected' : '') + '>Newest created</option>' + '<option value="updated" ' + (state.sortMode === 'updated' ? 'selected' : '') + '>Recently updated</option>' + '<option value="access" ' + (state.sortMode === 'access' ? 'selected' : '') + '>Most accessed</option>' + '</select><svg class="control-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg></span></label>';
    const savedViewName = state.savedViewName
      ? '<div class="saved-view-name" aria-label="Saved search: ' + escapeHtml(state.savedViewName) + '"><span class="saved-view-name-label">Saved search:</span> ' + escapeHtml(state.savedViewName) + '</div>'
      : '';
    const eyebrow = state.tag
      ? 'DECKARD / TAG SEARCH'
      : 'DECKARD / SEARCH';
    // A search that does not parse leaves the previous results on the page.
    // Say so, rather than letting them read as answers to what was typed.
    const invalid = (state.query.diagnostics || []).some(function (diagnostic) { return diagnostic.severity === 'error'; });
    const staleNotice = invalid
      ? '<p class="stale-results">The search above has not run. These are the results of the last one that did.</p>'
      : '';
    document.getElementById('app').innerHTML = '<header><div><div class="overview-eyebrow"><p class="eyebrow">' + eyebrow + '</p></div>' + savedViewName + '<h1 aria-label="' + escapeHtml(title) + '">' + titleHtml + '</h1>' + entityMeta + '</div><div class="toolbar" role="group" aria-label="View options">' + renderHelpButton('search') + viewOptions + '</div></header>' + editor.renderBar(sortControl) + editor.renderFacets() + renderHub() + staleNotice + layoutContent;
    applyColumns();
    filterEntries('notes');
    filterEntries('tasks');
    editor.afterRender();
    window.scrollTo(scrollX, scrollY);
    announce(notesCount + (notesCount === 1 ? ' note' : ' notes') + ' and ' + tasksCount + (tasksCount === 1 ? ' task' : ' tasks') + ' match this search.');
  }

  /** Keep the page's own view state across a window reload. */
  function saveState() {
    if (!state) return;
    const saved = { query: state.query.text, origin: state.originQuery };
    // The host reads this same record to restore a page, so the tab is added
    // only once it is the reader's own choice.
    if (tabChosen) saved.tab = activeTab;
    if (typeof vscode.setState === 'function') vscode.setState(saved);
  }

  installViewOptions();

  document.addEventListener('mousedown', function (event) {
    editor.handleMousedown(event);
  });
  document.addEventListener('focusin', function (event) {
    editor.handleFocusIn(event);
  });
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
    if (editor.handleClick(event)) return;
    const target = event.target.closest('[data-action]');
    if (target) {
      const action = target.dataset.action;
      if (action === 'set-mode') vscode.postMessage({ type: 'setRenderMode', mode: target.dataset.mode });
      if (action === 'set-layout') vscode.postMessage({ type: 'setTagOverviewLayout', layout: target.dataset.layout });
      if (action === 'set-task-filter') vscode.postMessage({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (action === 'set-columns') {
        const columns = Number(target.dataset.value);
        const section = target.dataset.section;
        if (section === 'notes') state.noteColumns = columns;
        if (section === 'tasks') state.taskColumns = columns;
        applyColumns();
        vscode.postMessage({ type: 'setSearchColumns', section: section, columns: columns });
      }
      if (action === 'set-result-tab' || action === 'show-other-results') {
        activeTab = target.dataset.tab === 'tasks' ? 'tasks' : 'notes';
        tabChosen = true;
        saveState();
        render();
      }
      if (action === 'open-help') vscode.postMessage({ type: 'openHelp' });
      if (action === 'save-filter') vscode.postMessage({ type: 'saveTagOverviewFilter' });
      if (action === 'create-hub') vscode.postMessage({ type: 'createHubNote' });
      if (action === 'open-source') vscode.postMessage({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      if (action === 'open-tag') vscode.postMessage({ type: 'openTag', tagKey: target.dataset.tagKey });
      return;
    }
    const entry = event.target.closest('.card, .task-row');
    if (entry && !event.target.closest('button, input, a')) {
      vscode.postMessage({ type: 'openSource', filePath: entry.dataset.filePath, line: Number(entry.dataset.line) });
    }
  });
  document.addEventListener('contextmenu', function (event) {
    const target = event.target.closest('[data-tag-key]');
    if (target) openTagContextMenu(event, target);
  });
  document.addEventListener('keydown', function (event) {
    if (editor.handleKeydown(event)) return;
    if (event.key === 'Escape' && tagContextMenu && !tagContextMenu.hidden) {
      closeTagContextMenu();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-action], button, input, a')) return;
    const entry = event.target.closest('.card, .task-row');
    if (entry) {
      event.preventDefault();
      vscode.postMessage({ type: 'openSource', filePath: entry.dataset.filePath, line: Number(entry.dataset.line) });
    }
  });
  document.addEventListener('change', function (event) {
    if (editor.handleChange(event)) return;
    const target = event.target;
    if (target.dataset.action === 'set-sort') vscode.postMessage({ type: 'setTagOverviewSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') vscode.postMessage({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
  });
  document.addEventListener('input', function (event) {
    editor.handleInput(event);
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') {
      state = event.data.data;
      editor.receive();
      render();
      saveState();
    }
  });
}());
</script>
</body>
</html>`;
}
