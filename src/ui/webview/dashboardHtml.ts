import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getQueryEditorCss,
  getQueryEditorScript,
} from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';
import { getFavoriteHeartAssetUris } from './icons';

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
<style nonce="${nonce}">${getBaseCss()}
${getQueryEditorCss()}
.notes-search .query-workspace { margin-top: 0; margin-bottom: 10px; }
.note-search-tasks { margin-top: 18px; }
.note-search-tasks .section-heading h2 { font-size: 13px; }
.tag-name, .telemetry-line, .section-readout { font-family: var(--font-mono); }
.telemetry-line { display: flex; flex-wrap: wrap; gap: 12px; color: var(--muted); font-size: 10px; text-transform: uppercase; }
.telemetry-line span:first-child { color: var(--cyan-bright); }
.telemetry-line span:last-child { color: var(--toxic-green); }
.metric::before { content: attr(data-code); display: block; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--slate-border); color: var(--amber-dim); font: 9px var(--font-mono); text-transform: uppercase; }
.dashboard-header-actions { display: flex; align-self: flex-start; align-items: flex-start; gap: 12px; margin-left: auto; }
.dashboard-header-actions .view-options { order: 2; }
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
button:hover, button.active, select:hover { border-color: var(--amber-bright); color: var(--amber-bright); background: var(--panel-raised); }
button:focus-visible, select:focus-visible, input:focus-visible, .tag-row.is-draggable:focus-visible, .entity-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.tag-list, .task-list, .note-list { display: grid; grid-template-columns: repeat(var(--dashboard-columns, 1), 1fr); gap: 7px; }
.entity-list { display: grid; gap: 7px; margin-bottom: 18px; }
.saved-filter-list { display: grid; gap: 7px; margin-bottom: 18px; }
.saved-filter-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; border: 1px solid var(--slate-border); background: var(--panel-bg); padding: 8px; cursor: pointer; transition: background-color 120ms ease, transform 120ms ease; }
.saved-filter-row:hover { background: var(--panel-raised); transform: translateX(3px); }
.saved-filter-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.saved-filter-name { color: var(--cyan-bright); font: 12px var(--font-mono); overflow-wrap: anywhere; }
.saved-filter-tags { margin-top: 3px; color: var(--muted); font: 10px var(--font-mono); overflow-wrap: anywhere; }
.saved-filter-remove { min-height: 26px; color: var(--muted); text-transform: none; }
.entity-row { display: flex; justify-content: space-between; gap: 8px; align-items: center; border: 1px solid var(--slate-border); background: var(--panel-bg); padding: 8px; cursor: pointer; }
.entity-main { display: flex; min-width: 0; align-items: center; gap: 8px; }
.entity-kind { color: var(--muted); font: 10px var(--font-mono); text-transform: uppercase; }
.tag-group { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px dashed var(--slate-border); }
.tag-group h3 { margin: 0 0 7px; color: var(--amber-bright); font-size: 11px; font-weight: 500; text-transform: uppercase; }
.section-readout { color: var(--muted); font-size: 9px; text-transform: uppercase; }
.tag-row { position: relative; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); background: var(--panel-bg); cursor: pointer; }
.tag-row { display: grid; grid-template-columns: 1fr auto; gap: 7px; padding: 8px; }
.tag-main { min-width: 0; display: flex; align-items: center; gap: 8px; }
.tag-name { overflow-wrap: anywhere; color: var(--cyan-bright); }
.tag-count { color: var(--muted); font-family: var(--font-mono); }
.tag-actions { display: flex; align-items: center; gap: 5px; }
.tag-actions button { min-height: 26px; padding-inline: 7px; }
.favorite-toggle { display: grid; place-items: center; color: var(--favorite-red); }
.favorite-toggle:hover, .favorite-toggle:focus-visible { color: var(--favorite-red); }
.favorite-heart { display: block; width: 16px; height: 16px; background-color: currentColor; -webkit-mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; }
.favorite-toggle.favorite .favorite-heart { -webkit-mask-image: url("${favoriteHeartUris.filled}"); mask-image: url("${favoriteHeartUris.filled}"); }
.browse-toolbar { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 2px; margin-bottom: 12px; }
.browse-toolbar > * { flex: 0 0 auto; }
.browse-toolbar-controls { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.browse-toolbar-controls > * { flex: 0 0 auto; }
.browse-scope { display: inline-flex; }
.browse-scope button + button { margin-left: -1px; }
.catalog-search { width: min(220px, 40vw); border-color: var(--cyan-bright); }
/* A kept search stands out from an empty box, whatever the theme. */
input.catalog-search[data-has-query], select[data-action="set-tag-namespace"][data-has-query] { border-color: var(--amber-bright); background: var(--panel-raised); color: var(--amber-bright); }
.search-notice { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; padding: 6px 10px; border: 1px solid var(--amber-bright); border-left-width: 4px; background: var(--panel-raised); color: var(--text); font: 12px var(--font-mono); }
.search-notice strong { color: var(--amber-bright); }
.search-notice button { min-height: 26px; color: var(--amber-bright); text-transform: none; }
.tab-search-mark { display: inline-block; width: 11px; height: 11px; margin-left: 6px; vertical-align: -2px; }
.tab-search-mark svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.note-row { min-width: 0; border: 2px solid var(--slate-border); padding: 14px; background: var(--panel-bg); cursor: pointer; }
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
.error { color: var(--warning-orange); }
@media (max-width: 720px) {
  main { padding: 16px; }
  header { align-items: start; flex-direction: column; }
  .dashboard-header-actions { width: 100%; flex-direction: column; align-items: stretch; }
  .dashboard-header-actions .view-options { align-self: flex-end; order: -1; }
  .metrics { width: 100%; min-width: 0; }
  .tag-list, .task-list, .note-list { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }

/* Page layout. The base sheet supplies the look; these keep the Dashboard's
   own proportions and its chamfered HUD shapes. */
main { width: 100%; max-width: 1180px; }
header { gap: 20px; border-bottom: 1px dashed var(--slate-border); }
h2 { margin: 0 0 4px; }
.eyebrow { margin: 0 0 6px; }
.metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; min-width: min(380px, 48%); margin-top: 0; }
.metric { position: relative; clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); padding: 10px 12px; }
.metric-label { margin-top: 3px; }
.metric-value { font-size: 20px; margin-top: 0; }
.empty { clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); padding: 18px; }
@media (max-width: 700px) {
  .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; }
}
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading index...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
${getQueryEditorScript()}
  let state;
  /** Which half of the Search tab's results is shown, as a tag overview does. */
  let noteSearchTab = 'notes';
  let noteSearchQuery = '';
  const noteSearchDebounceDelay = 350;
  /** Tag searches wait as long as note searches before telling the host. */
  const searchDebounceDelay = noteSearchDebounceDelay;
  const pendingSearches = {};
  let noteSearchTimer;
  let pendingNoteSearchQuery;
  const restoredViewState = vscode.getState();
  let dashboardMode = restoredViewState && restoredViewState.dashboardMode === 'browse'
    ? 'browse'
    : 'notes';
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
  // A namespace never contains "/", so this value cannot clash with one.
  const noTagNamespace = '/';
  let tagNamespaceFilter = restoredViewState && typeof restoredViewState.tagNamespaceFilter === 'string'
    ? restoredViewState.tagNamespaceFilter
    : '';

  /**
   * The Search tab is Deckard's search page. Plain words filter its notes as
   * they are typed; tags, shorthands, and the builder run when applied.
   */
  const noteEditor = createQueryEditor({
    getState: function () { return state && state.noteQuery; },
    render: function () { renderKeepingFocus(); },
    apply: function (text) { applyNoteSearch(text, true); },
    clear: function () { applyNoteSearch('', false); },
    onDraft: function (text) {
      noteSearchQuery = text;
      saveDashboardViewState();
      scheduleNoteSearch();
    },
    placeholder: function () { return 'Search notes and tasks: words, #tags, is:open, has:due, in:folder, updated >= 7d…'; },
    label: 'Search notes and tasks',
    // Saving sits with the search it saves.
    actions: function (hasText) {
      return '<button data-action="save-note-search" data-query-needs-text title="Save this search as a view"' + (hasText ? '' : ' disabled') + '>Save</button>';
    },
  });

  /** Run a note search now, and remember it when it was asked for. */
  function applyNoteSearch(text, remember) {
    noteSearchQuery = text;
    if (noteSearchTimer) {
      clearTimeout(noteSearchTimer);
      noteSearchTimer = undefined;
    }
    pendingNoteSearchQuery = text;
    saveDashboardViewState();
    send({ type: 'setDashboardSearch', field: 'notes', query: text });
    if (remember && text.trim()) send({ type: 'recordRecentQuery', query: text });
  }

  /** Whether a search is only plain words, which the page matches itself. */
  function isPlainWords(text) {
    const words = String(text || '').trim().split(/\\s+/).filter(Boolean);
    return words.length === noteEditor.previewWords(text).length;
  }

  function formatEntityKindLabel(value) {
    return String(value).replace(/[-_]+/g, ' ').replace(/\\b[a-z]/g, function (character) { return character.toUpperCase(); });
  }

  /** The namespace of a #namespace/name tag, as written in its key. An @ tag names a person. */
  function getTagNamespace(tag) {
    const key = String(tag.key || '');
    if (key.startsWith('@')) return 'person';
    const keyValue = key.replace(/^[@#]/, '');
    const separator = keyValue.indexOf('/');
    return key.startsWith('#') && separator > 0 && keyValue.slice(0, separator).toLowerCase() !== 'tag-at'
      ? keyValue.slice(0, separator)
      : '';
  }

  function formatTagDisplay(tag) {
    const label = String(tag.label || tag.key || '');
    const labelValue = label.replace(/^[@#]/, '');
    const name = labelValue.slice(labelValue.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
    const namespace = getTagNamespace(tag).replace(/[-_]+/g, ' ');
    return { name: name || label, namespace: namespace };
  }

  function send(message) { vscode.postMessage(message); }

  /** Store only presentation state locally so data refreshes retain the active mode. */
  function saveDashboardViewState() {
    vscode.setState({
      dashboardMode: dashboardMode,
      taskColumns: taskColumns,
      tagColumns: tagColumns,
      noteColumns: noteColumns,
      noteSearchQuery: noteSearchQuery,
      browseQuery: browseQuery,
      tagNamespaceFilter: tagNamespaceFilter,
    });
  }

  /**
   * Redraw the page without taking the caret away from a field being typed in.
   *
   * render() rebuilds every control, so the focused text field is found again
   * by its action and gets its focus and selection back at once, before the
   * next keystroke can land on the page instead of the field.
   */
  function renderKeepingFocus() {
    const active = document.activeElement;
    const isTextField = Boolean(active && active.matches && active.matches('input[type="search"], input[type="text"]'));
    const action = isTextField ? active.dataset.action : undefined;
    const selectionStart = isTextField ? active.selectionStart : null;
    const selectionEnd = isTextField ? active.selectionEnd : null;
    render();
    if (!action) return;
    const field = document.querySelector('input[data-action="' + action + '"]');
    if (!field) return;
    field.focus();
    if (selectionStart !== null && selectionEnd !== null) field.setSelectionRange(selectionStart, selectionEnd);
  }

  /**
   * Tell the host about a tag search once typing settles.
   *
   * The page filters at once on its own; the host only stores the query. Each
   * store sends the whole state back, so storing every keystroke would redraw
   * the page mid-word and could echo an older query over newer typing.
   */
  function scheduleSearch(field, query) {
    const pending = pendingSearches[field] || (pendingSearches[field] = {});
    if (pending.timer) clearTimeout(pending.timer);
    pending.query = query;
    pending.timer = setTimeout(function () {
      pending.timer = undefined;
      send({ type: 'setDashboardSearch', field: field, query: query });
    }, searchDebounceDelay);
  }

  /** The host's copy of a search, unless the page still holds newer typing. */
  function acceptHostSearch(field, hostQuery, localQuery) {
    const pending = pendingSearches[field];
    if (!pending || pending.query === undefined) return hostQuery;
    if (!pending.timer && hostQuery === pending.query) {
      pending.query = undefined;
      return hostQuery;
    }
    return localQuery;
  }

  /** Batch local note filtering and preference writes while the user types. */
  function scheduleNoteSearch() {
    if (noteSearchTimer) clearTimeout(noteSearchTimer);
    pendingNoteSearchQuery = noteSearchQuery;
    noteSearchTimer = setTimeout(function () {
      noteSearchTimer = undefined;
      if (pendingNoteSearchQuery === undefined) return;
      // Plain words are stored as they settle, so the tab reopens on them.
      // Tags and conditions wait for Enter, so a half-typed tag never
      // empties the list.
      if (isPlainWords(noteSearchQuery)) {
        send({ type: 'setDashboardSearch', field: 'notes', query: noteSearchQuery });
      } else {
        pendingNoteSearchQuery = undefined;
      }
      renderKeepingFocus();
    }, noteSearchDebounceDelay);
  }

  function setDashboardMode(mode, focusTab) {
    dashboardMode = mode === 'browse' ? 'browse' : 'notes';
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
      const selected = Number(button.dataset.value) === columns;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  /** Ranked modes alone have a meaningful user-controlled display order. */
  function canRank(kind) {
    return Boolean(state) && (
      kind === 'tag' ? state.tagSortMode === 'custom' : state.entitySortMode === 'custom'
    );
  }

  /** The tags a drag or a menu reorders: its own favorites group, in place. */
  function rankTag(tagKey, reorder) {
    const selectedTag = state.tags.find(function (tag) { return tag.key === tagKey; });
    if (!selectedTag) return false;
    const groupKeys = reorder(state.tags.filter(function (tag) { return tag.isFavorite === selectedTag.isFavorite; }).map(function (tag) { return tag.key; }));
    if (!groupKeys) return false;
    let groupPosition = 0;
    const keys = state.tags.map(function (tag) {
      return tag.isFavorite === selectedTag.isFavorite ? groupKeys[groupPosition++] : tag.key;
    });
    send({ type: 'reorderTags', tagKeys: keys, tagKey: tagKey, isFavorite: selectedTag.isFavorite });
    return true;
  }

  function rankEntity(entityKey, reorder) {
    const keys = reorder(state.entities.map(function (entity) { return entity.key; }));
    if (!keys) return false;
    send({ type: 'reorderEntities', entityKeys: keys });
    return true;
  }

  // Tags and entities are ranked by dragging, or from their context menu,
  // which also renames a tag.
  installRankedRows({
    kinds: {
      tag: { selector: '.tag-row[data-tag-key]', key: 'tagKey' },
      entity: { selector: '.entity-row[data-entity-key]', key: 'entityKey' },
    },
    canRank: canRank,
    reorder: function (kind, key, targetKey, before, placeholder) {
      if (kind === 'entity') {
        return rankEntity(key, function (keys) { return rankKeys(keys, key, targetKey, before); });
      }
      // A tag dropped into the other group moves between favorites and the rest.
      const keys = rankKeys(state.tags.map(function (tag) { return tag.key; }), key, targetKey, before);
      if (!keys) return false;
      const group = placeholder ? placeholder.closest('.tag-group') : undefined;
      send({ type: 'reorderTags', tagKeys: keys, tagKey: key, isFavorite: Boolean(group && group.dataset.tagGroup === 'favorites') });
      return true;
    },
    move: function (kind, key, toTop) {
      const reorder = function (keys) { return moveKeyToEdge(keys, key, toTop); };
      if (kind === 'entity') rankEntity(key, reorder);
      else rankTag(key, reorder);
    },
    menuActions: function () {
      return ['<button type="button" role="menuitem" data-context-action="rename-tag">Rename tag</button>'];
    },
    onMenuAction: function (action, kind, key) {
      if (action === 'rename-tag') send({ type: 'renameTag', tagKey: key });
    },
  });

  /** Bind directly because the controls live inside a native details menu. */
  function bindDashboardColumnControls() {
    document
      .querySelectorAll('[data-action="set-columns"]')
      .forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          const section = button.dataset.section;
          const columns = Number(button.dataset.value);
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

  /**
   * The line above a list a search is narrowing. Searches are kept between
   * visits, so a list that comes back narrowed says so, with a way out.
   */
  function renderSearchNotice(shown, total, noun, query, action) {
    const text = String(query || '').trim();
    return '<div class="search-notice" role="status"><span>Showing <strong>' + shown + '</strong> of ' + total + ' ' + escapeHtml(noun) + (text ? ' matching “' + escapeHtml(text) + '”' : '') + '</span><button data-action="' + action + '">Clear search</button></div>';
  }

  /** A dot on a tab whose search has text or a filter, seen from any tab. */
  function renderTabSearchMark(query, filter) {
    const text = String(query || '').trim();
    const parts = (text ? ['Searching “' + text + '”'] : []).concat(filter ? [filter] : []);
    return parts.length
      ? '<span class="tab-search-mark" title="' + escapeHtml(parts.join(', ')) + '"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 3h12L9 8v4l-2 1V8L2 3Z"/></svg></span><span class="visually-hidden">, searching</span>'
      : '';
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
    closeRankMenu();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const normalizedBrowseQuery = browseQuery.trim().toLowerCase();
    const tagNamespaces = Array.from(new Set(state.tags.map(getTagNamespace).filter(Boolean)))
      .sort(function (left, right) { return left.localeCompare(right); });
    const hasTagsWithoutNamespace = state.tags.some(function (tag) { return !getTagNamespace(tag); });
    // A namespace no tag uses any more, after a rename, shows every tag.
    const activeTagNamespace = tagNamespaces.indexOf(tagNamespaceFilter) >= 0 || (tagNamespaceFilter === noTagNamespace && hasTagsWithoutNamespace)
      ? tagNamespaceFilter
      : '';
    const filteredTags = state.tags.filter(function (tag) {
      const namespace = getTagNamespace(tag);
      return (!activeTagNamespace || namespace === (activeTagNamespace === noTagNamespace ? '' : activeTagNamespace)) &&
        (!normalizedBrowseQuery || (tag.label + ' ' + tag.key).toLowerCase().indexOf(normalizedBrowseQuery) >= 0);
    });
    const tagNamespaceLabel = !activeTagNamespace ? '' : activeTagNamespace === noTagNamespace ? 'None' : formatEntityKindLabel(activeTagNamespace);
    // A namespace filter narrows the tags as much as a search does, so either says so.
    const tagNotice = normalizedBrowseQuery || activeTagNamespace
      ? renderSearchNotice(
        filteredTags.length,
        state.tags.length,
        !activeTagNamespace ? 'tags' : activeTagNamespace === noTagNamespace ? 'tags, without a namespace' : 'tags, in ' + tagNamespaceLabel,
        browseQuery,
        'clear-tag-search',
      )
      : '';
    const filterIcon = '<svg class="control-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 3h12L9 8v4l-2 1V8L2 3Z"/></svg>';
    const sortIcon = '<svg class="control-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg>';
    const renderEntity = function (entity) {
      const draggable = state.entitySortMode === 'custom';
      const favoriteLabel = entity.isFavorite ? 'Unfavorite' : 'Favorite';
      return '<div class="row entity-row ' + (draggable ? 'is-draggable' : '') + '" draggable="false" tabindex="0" data-entity-key="' + escapeHtml(entity.key) + '"><div class="entity-main"><span class="tag-name">' + escapeHtml(entity.name) + '</span><span class="tag-count">' + entity.count + '</span></div><div class="tag-actions"><span class="entity-kind">' + escapeHtml(entity.kind) + '</span><button class="favorite-toggle ' + (entity.isFavorite ? 'favorite' : '') + '" data-action="favorite-entity" data-entity-key="' + escapeHtml(entity.key) + '" aria-label="' + favoriteLabel + ' ' + escapeHtml(entity.name) + '"><span class="favorite-heart" aria-hidden="true"></span></button></div></div>';
    };
    const renderTag = function (tag) {
      const draggable = state.tagSortMode === 'custom';
      const display = formatTagDisplay(tag);
      const displayLabel = display.namespace ? display.name + ' ' + display.namespace : display.name;
      const favoriteLabel = tag.isFavorite ? 'Unfavorite' : 'Favorite';
      return '<div class="row tag-row ' + (draggable ? 'is-draggable' : '') + '" draggable="false" tabindex="0" data-tag-key="' + escapeHtml(tag.key) + '"><div class="tag-main"><span class="tag-name">' + escapeHtml(display.name) + '</span><span class="tag-count">' + tag.count + '</span></div><div class="tag-actions">' + (display.namespace ? '<span class="entity-kind">' + escapeHtml(display.namespace) + '</span>' : '') + '<button class="favorite-toggle ' + (tag.isFavorite ? 'favorite' : '') + '" data-action="favorite-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="' + favoriteLabel + ' ' + escapeHtml(displayLabel) + '"><span class="favorite-heart" aria-hidden="true"></span></button></div></div>';
    };
    const favoriteTags = filteredTags.filter(function (tag) { return tag.isFavorite; });
    const otherTags = filteredTags.filter(function (tag) { return !tag.isFavorite; });
    const tagContent = filteredTags.length
      ? (favoriteTags.length
        ? '<div class="tag-group" data-tag-group="favorites"><h3>Favorites <span class="tag-count">(' + favoriteTags.length + ')</span></h3><div class="tag-list" style="grid-template-columns: repeat(' + selectedTagColumns + ', 1fr);">' + favoriteTags.map(renderTag).join('') + '</div></div>'
        : '') + (otherTags.length ? '<div class="tag-group" data-tag-group="other"><h3>Other tags <span class="tag-count">(' + otherTags.length + ')</span></h3><div class="tag-list" style="grid-template-columns: repeat(' + selectedTagColumns + ', 1fr);">' + otherTags.map(renderTag).join('') + '</div></div>' : '')
      : '<div class="empty">No tags match your search.</div>';
    const savedFilters = state.savedFilters.length
      ? '<section class="saved-filters" aria-labelledby="saved-filters-heading"><div class="section-heading"><h2 id="saved-filters-heading">Saved searches <span class="tag-count">' + state.savedFilters.length + '</span></h2></div><div class="saved-filter-list">' + state.savedFilters.map(function (filter) {
          const tagCount = filter.tags.length;
          return '<div class="row saved-filter-row" tabindex="0" data-saved-filter-id="' + escapeHtml(filter.id) + '"><div><div class="saved-filter-name">' + escapeHtml(filter.name) + '</div><div class="saved-filter-tags">' + filter.tags.map(function (tag) { return renderTagLabel(tag.label); }).join(' AND ') + ' · ' + tagCount + ' tags</div></div><button class="saved-filter-remove" data-action="remove-saved-filter" data-saved-filter-id="' + escapeHtml(filter.id) + '" aria-label="Remove saved search ' + escapeHtml(filter.name) + '">Remove</button></div>';
        }).join('') + '</div></section>'
      : '';
    // Plain words match here, including file names and tags, as they are
    // typed; the host has already applied everything else in the search.
    const noteWords = noteEditor.previewWords(noteEditor.currentText());
    const filteredNotes = state.notes.filter(function (note) {
      const searchableText = [
        note.heading,
        note.fileName,
        note.rawContent || '',
        note.tags.map(function (tag) { return tag.label; }).join(' '),
      ].join(' ').toLowerCase();
      return noteWords.every(function (word) { return searchableText.indexOf(word) >= 0; });
    });
    const searchTasks = state.noteQueryTasks || [];
    const searchTaskCount = state.noteQueryTaskCount || searchTasks.length;
    const searchResultTabs = renderResultTabs([
      { id: 'notes', label: 'Notes', count: state.notes.length },
      { id: 'tasks', label: 'Tasks', count: state.noteQueryTaskCount ?? searchTasks.length },
    ], noteSearchTab, 'Search results');
    const noteSearchTasks = searchTasks.length
      ? '<section class="note-search-tasks" aria-labelledby="note-search-tasks-heading"><div class="section-heading"><h2 id="note-search-tasks-heading">Matching tasks <span class="tag-count">' + searchTaskCount + '</span></h2></div><div class="task-list">' + searchTasks.map(function (item) { return renderTaskListRow(item, { titleDisplay: state.tagTitleDisplayMode }); }).join('') + '</div>' + (searchTaskCount > searchTasks.length ? '<p class="source">Showing the first ' + searchTasks.length + '.</p>' : '') + '</section>'
      : '';
    // Notes arrive only once the Search tab asks the host for them.
    const notes = state.notesOmitted
      ? '<div class="empty">Loading notes…</div>'
      : filteredNotes.length ? filteredNotes.map(function (note) {
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
    }).join('') : '<div class="empty">' + (searchTaskCount && noteEditor.currentText().trim()
      ? 'No notes match this search. The tasks it matches are listed below.'
      : 'No notes match this filter.') + '</div>';
    const noteSortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-note-sort" aria-label="Sort notes"><option value="alphabetical" ' + (state.noteSortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="created" ' + (state.noteSortMode === 'created' ? 'selected' : '') + '>Newest created</option><option value="updated" ' + (state.noteSortMode === 'updated' ? 'selected' : '') + '>Recently updated</option><option value="access" ' + (state.noteSortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select>' + sortIcon + '</span></label>';
    const formatControls = '<div class="segmented toolbar-toggle-group" role="group" aria-label="Content format"><button class="icon-button toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button><button class="icon-button toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5"/></svg></button></div>';
    const tagSortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-sort" aria-label="Sort tags"><option value="alphabetical" ' + (state.tagSortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="count" ' + (state.tagSortMode === 'count' ? 'selected' : '') + '>Entry Count</option><option value="access" ' + (state.tagSortMode === 'access' ? 'selected' : '') + '>Most accessed</option><option value="custom" ' + (state.tagSortMode === 'custom' ? 'selected' : '') + '>Rank</option></select>' + sortIcon + '</span></label>';
    const tagNamespaceOptions = [{ value: '', label: 'All' }]
      .concat(tagNamespaces.map(function (namespace) { return { value: namespace, label: formatEntityKindLabel(namespace) }; }))
      .concat(hasTagsWithoutNamespace ? [{ value: noTagNamespace, label: 'None' }] : []);
    const tagNamespaceControl = tagNamespaces.length
      ? '<label class="control-label">Namespace:<span class="control-icon"><select data-action="set-tag-namespace"' + (activeTagNamespace ? ' data-has-query' : '') + ' aria-label="Filter tags by namespace">' + tagNamespaceOptions.map(function (option) {
          return '<option value="' + escapeHtml(option.value) + '" ' + (activeTagNamespace === option.value ? 'selected' : '') + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select>' + filterIcon + '</span></label>'
      : '';
    const columnControls = function (section, selectedColumns) {
      const label = section === 'tasks' ? 'Task' : section === 'notes' ? 'Note' : 'Tag';
      const choices = [1, 2, 3, 4].map(function (columns) { return [columns, String(columns), columns + ' columns']; });
      // Each button names its grid, which the column binding reads.
      return renderViewOptionChoices('set-columns', choices, selectedColumns, label + ' columns', 'data-section="' + section + '"');
    };
    const metrics = '<div class="metrics" aria-label="Workspace totals">' +
      '<div class="metric" data-code="SYS.ENT // 1982-AZ"><span class="metric-value">' + state.entities.length + '</span><span class="metric-label">entities</span></div>' +
      '<div class="metric" data-code="IDX.SEC // 01"><span class="metric-value">' + state.totalSectionCount + '</span><span class="metric-label">sections</span></div>' +
      '<div class="metric" data-code="IDX.TSK // 02"><span class="metric-value">' + state.totalTaskCount + '</span><span class="metric-label">tasks</span></div>' +
      '</div>';
    const dashboardOptions = renderViewOptions([
      { label: 'Task columns', html: columnControls('tasks', state.taskColumns) },
      { label: 'Note columns', html: columnControls('notes', state.noteColumns) },
      { label: 'Tag columns', html: columnControls('tags', state.tagColumns) },
      { label: 'Format', html: formatControls },
    ]);

    document.getElementById('app').innerHTML =
      '<header><div><p class="eyebrow">DECKARD / WORKSPACE INDEX</p><h1>Dashboard: ' + (dashboardMode === 'notes' ? 'Search' : 'Tags') + '</h1></div><div class="dashboard-header-actions">' + metrics + dashboardOptions + '</div></header>' +
      savedFilters +
      '<div class="dashboard-tabs-row"><div class="dashboard-tabs" role="tablist" aria-label="Dashboard mode"><button id="notes-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="notes" aria-selected="' + (dashboardMode === 'notes') + '" aria-controls="notes-panel" tabindex="' + (dashboardMode === 'notes' ? '0' : '-1') + '">Search' + renderTabSearchMark(noteEditor.currentText() || state.noteQueryText || '') + '</button><button id="browse-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="browse" aria-selected="' + (dashboardMode === 'browse') + '" aria-controls="browse-panel" tabindex="' + (dashboardMode === 'browse' ? '0' : '-1') + '">Tags' + renderTabSearchMark(browseQuery, tagNamespaceLabel ? 'Namespace: ' + tagNamespaceLabel : '') + '</button></div></div>' +
      '<section id="notes-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="notes-tab"' + (dashboardMode === 'notes' ? '' : ' hidden') + '><div class="notes-search">' + noteEditor.renderBar(noteSortControl) + '</div>' + noteEditor.renderFacets() + searchResultTabs + '<div class="overview-tab-panel"' + (noteSearchTab === 'notes' ? '' : ' hidden') + '><div class="note-list" style="grid-template-columns: repeat(' + state.noteColumns + ', 1fr);">' + notes + '</div></div><div class="overview-tab-panel"' + (noteSearchTab === 'tasks' ? '' : ' hidden') + '>' + noteSearchTasks + '</div></section>' +
      '<section id="browse-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="browse-tab"' + (dashboardMode === 'browse' ? '' : ' hidden') + '><div class="browse-toolbar"><div class="browse-toolbar-controls"><input class="catalog-search" type="search"' + (normalizedBrowseQuery ? ' data-has-query' : '') + ' data-action="search-browse" value="' + escapeHtml(browseQuery) + '" placeholder="Search tags" aria-label="Search tags" autocomplete="off"><div class="control-row">' + tagNamespaceControl + tagSortControl + '</div></div></div>' + tagNotice + tagContent + '</section>';
    bindDashboardColumnControls();
    applyDashboardColumns('tasks', selectedTaskColumns);
    applyDashboardColumns('notes', selectedNoteColumns);
    applyDashboardColumns('tags', selectedTagColumns);
    noteEditor.afterRender();
    window.scrollTo(scrollX, scrollY);
  }

  installViewOptions();

  document.addEventListener('click', function (event) {
    if (noteEditor.handleClick(event)) return;
    const target = event.target.closest('[data-action]');
    if (target) {
      const action = target.dataset.action;
      if (action === 'save-note-search') {
        send({ type: 'saveDashboardSearch' });
        return;
      }
      if (action === 'clear-tag-search') {
        // The namespace filter is part of the Tags search, so it clears too.
        browseQuery = '';
        tagNamespaceFilter = '';
        saveDashboardViewState();
        scheduleSearch('tags', '');
        render();
        const field = document.querySelector('input[data-action="search-browse"]');
        if (field) field.focus();
        return;
      }
      if (action === 'set-result-tab') {
        noteSearchTab = target.dataset.tab === 'tasks' ? 'tasks' : 'notes';
        render();
        return;
      }
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

  document.addEventListener('mousedown', function (event) {
    noteEditor.handleMousedown(event);
  });
  document.addEventListener('focusin', function (event) {
    noteEditor.handleFocusIn(event);
  });

  document.addEventListener('keydown', function (event) {
    // The search box takes / only where it is on screen.
    const inSearch = Boolean(event.target.closest && event.target.closest('[data-suggest-key]'));
    if ((inSearch || dashboardMode === 'notes') && noteEditor.handleKeydown(event)) return;
    const dashboardTab = event.target.closest('[role="tab"][data-dashboard-mode]');
    if (dashboardTab && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      const modes = ['notes', 'browse'];
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
    if (noteEditor.handleChange(event)) return;
    const target = event.target;
    if (target.dataset.action === 'set-sort') send({ type: 'setTagSort', mode: target.value });
    if (target.dataset.action === 'set-tag-namespace') {
      tagNamespaceFilter = target.value;
      saveDashboardViewState();
      render();
      const namespaceSelect = document.querySelector('select[data-action="set-tag-namespace"]');
      if (namespaceSelect) namespaceSelect.focus();
    }
    if (target.dataset.action === 'set-note-sort') send({ type: 'setNoteSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') send({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
  });

  document.addEventListener('input', function (event) {
    if (noteEditor.handleInput(event)) return;
    const target = event.target;
    if (target.dataset.action === 'search-browse') {
      browseQuery = target.value;
      saveDashboardViewState();
      scheduleSearch('tags', browseQuery);
      renderKeepingFocus();
    }
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') {
      const incomingState = event.data.data;
      taskColumns = incomingState.taskColumns ?? taskColumns ?? 1;
      noteColumns = incomingState.noteColumns ?? noteColumns ?? 1;
      tagColumns = incomingState.tagColumns ?? tagColumns ?? 2;
      if (incomingState.viewState) {
        dashboardMode = incomingState.viewState.mode;
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
        browseQuery = acceptHostSearch('tags', incomingState.viewState.tagSearchQuery, browseQuery);
      }
      incomingState.taskColumns = taskColumns;
      incomingState.noteColumns = noteColumns;
      incomingState.tagColumns = tagColumns;
      state = incomingState;
      noteEditor.receive();
      renderKeepingFocus();
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
