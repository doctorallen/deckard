import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getQueryEditorCss,
  getQueryEditorScript,
  getPageTailCss,
  zenBodyAttribute,
} from './components';
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
<style nonce="${nonce}">${getBaseCss()}
${getQueryEditorCss()}
.tag-name, .telemetry-line, .section-readout { font-family: var(--font-mono); }
.metric::before { content: attr(data-code); display: block; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--slate-border); color: var(--amber-dim); font: 9px var(--font-mono); text-transform: uppercase; }
.dashboard-header-actions { display: flex; align-self: flex-start; align-items: flex-start; gap: 12px; margin-left: auto; }
.dashboard-header-actions .view-options { order: 2; }
.saved-filters { padding-top: 16px; }
.dashboard-tabs-row { padding-bottom: 8px; border-bottom: 2px solid var(--slate-border); }
.dashboard-tabs { display: inline-flex; margin-top: 18px; }
.dashboard-tabs button + button { margin-left: -1px; }
.dashboard-tabs button[aria-selected="true"] { position: relative; z-index: 1; }
.dashboard-panel { min-width: 0; padding-top: 16px; }
.dashboard-panel[hidden] { display: none; }
section { min-width: 0; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.control-row { display: flex; flex-wrap: nowrap; gap: 6px; align-items: center; overflow-x: auto; padding-bottom: 2px; }
button:hover, button.active, select:hover { border-color: var(--amber-bright); color: var(--amber-bright); background: var(--panel-raised); }
button:focus-visible, select:focus-visible, input:focus-visible, .tag-row.is-draggable:focus-visible, .entity-row:focus-visible, .home-widget:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.tag-list { display: grid; grid-template-columns: repeat(var(--dashboard-columns, 1), 1fr); gap: 7px; }
.entity-list { display: grid; gap: 7px; margin-bottom: 18px; }
.saved-filter-list { display: grid; gap: 7px; margin-bottom: 18px; }
.saved-filter-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; border: 1px solid var(--slate-border); background: var(--panel-bg); padding: 8px; cursor: pointer; transition: background-color 120ms ease, transform 120ms ease; }
.saved-filter-row:hover { background: var(--panel-raised); transform: translateX(3px); }
.saved-filter-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.saved-filter-name { color: var(--cyan-bright); font: 12px var(--font-mono); overflow-wrap: anywhere; }
.saved-filter-tags { margin-top: 3px; color: var(--muted); font: 10px var(--font-mono); overflow-wrap: anywhere; }
.saved-filter-remove { min-height: 26px; text-transform: none; }
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
/* The toggle carries a filled ground in some themes, and a hovered control's
   ground in every one, so hovering it takes the shared hover pair rather than
   keeping a red that was chosen for the ground it has at rest. */
.favorite-toggle:hover, .favorite-toggle:focus-visible { background: var(--hover-bg); color: var(--hover-fg); }
.favorite-heart { display: block; width: 16px; height: 16px; background-color: currentColor; -webkit-mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; }
.favorite-toggle.favorite .favorite-heart { -webkit-mask-image: url("${favoriteHeartUris.filled}"); mask-image: url("${favoriteHeartUris.filled}"); }
.browse-toolbar { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 2px; margin-bottom: 12px; }
.browse-toolbar > * { flex: 0 0 auto; }
.browse-toolbar-controls { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.browse-toolbar-controls > * { flex: 0 0 auto; }
.catalog-search { width: min(220px, 40vw); border-color: var(--cyan-bright); }
/* A kept search stands out from an empty box, whatever the theme. */
input.catalog-search[data-has-query], select[data-action="set-tag-namespace"][data-has-query] { border-color: var(--amber-bright); background: var(--panel-raised); color: var(--amber-bright); }
.search-notice { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; padding: 6px 10px; border: 1px solid var(--amber-bright); border-left-width: 4px; background: var(--panel-raised); color: var(--text); font: 12px var(--font-mono); }
.search-notice strong { color: var(--amber-bright); }
.search-notice button { min-height: 26px; color: var(--amber-bright); text-transform: none; }
.tab-search-mark { display: inline-block; width: 11px; height: 11px; margin-left: 6px; vertical-align: -2px; }
.tab-search-mark svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Home: the reader's widgets, in two columns. */
.home-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: stretch; }
.home-widget { position: relative; min-width: 0; border: 2px solid var(--slate-border); background: var(--panel-bg); padding: 12px; }
.home-widget.is-full { grid-column: 1 / -1; }
.home-widget.is-editing { border-style: dashed; border-color: var(--amber-dim); }
.home-widget.is-editing:hover { border-color: var(--amber-bright); }
.home-widget-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.home-widget-title { margin: 0; color: var(--amber-bright); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.home-widget-grip { margin-right: 6px; color: var(--muted); }
.home-widget-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.home-open { min-height: 26px; padding: 3px 8px; text-transform: none; }
.home-remove { min-height: 26px; padding: 3px 8px; text-transform: none; }
.home-list { display: grid; gap: 6px; }
/* A row on Home is a button, but it is painted by the row rules, so it reads
   as a row: the text that belongs on a panel rather than the color a theme
   wrote for a hovered control over the hover ground. Its label and its detail
   follow it from there, as they do inside any hovered control. */
.home-row { display: flex; width: 100%; align-items: baseline; justify-content: space-between; gap: 10px; color: var(--text); text-align: left; text-transform: none; }
.home-row:hover, .home-row:focus-visible { color: var(--text); }
.home-row-label { min-width: 0; overflow-wrap: anywhere; color: var(--cyan-bright); }
.home-row-label code { background: none; padding: 0; color: inherit; font-size: 11px; }
.home-row-detail { flex: 0 0 auto; color: var(--muted); font: 10px var(--font-mono); }
/* A row with its own action beside it, such as Create hub or Unpin. */
.home-row-with-action { display: flex; align-items: stretch; gap: 4px; min-width: 0; }
.home-row-with-action > .home-row { flex: 1 1 auto; min-width: 0; }
.home-row-action { flex: 0 0 auto; min-height: 26px; padding: 2px 8px; text-transform: none; white-space: nowrap; }
.home-widget-source { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; color: var(--muted); font: 11px var(--font-mono); }
.home-widget-source strong { color: var(--text); font-weight: normal; overflow-wrap: anywhere; }
.home-tag-pair { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.home-tag-pair-join { color: var(--muted); font: 10px var(--font-mono); }
.home-today-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
.home-today-date { color: var(--text); font: 13px var(--font-mono); }
.home-quick-add { display: flex; gap: 6px; }
.home-quick-add input { flex: 1 1 auto; min-width: 0; min-height: 30px; }
.home-quick-add button { min-height: 30px; padding: 3px 10px; }
.home-quick-add-status { margin: 6px 0 0; color: var(--muted); font: 11px var(--font-mono); }
.home-widget-group { margin: 12px 0 6px; color: var(--muted); font: 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.home-widget-group:first-child { margin-top: 0; }
.home-widget-empty { margin: 0; color: var(--muted); font-size: 12px; }
.home-widget-paging { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 0 0; border-top: 1px solid var(--line); padding-top: 8px; font-size: 11px; }
.home-widget-paging .page-range { color: var(--muted); font-family: var(--font-mono); }
.home-widget-paging .control-label { gap: 4px; font-size: 11px; }
.home-widget-paging select { min-width: 46px; }
.home-widget-steps { display: flex; align-items: center; gap: 6px; }
.home-widget-steps .page-range { margin-right: 2px; }
.home-widget-steps button { display: grid; width: 22px; min-height: 22px; place-items: center; border: 1px solid var(--line); background: var(--panel); color: var(--text); padding: 0; cursor: pointer; }
.home-widget-steps button:hover:not([disabled]) { border-color: var(--amber); background: var(--hover-bg); color: var(--hover-fg); }
.home-widget-steps button[disabled] { color: var(--muted); cursor: default; opacity: 0.45; }
.home-widget-steps svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.home-widget .query-workspace { margin-top: 0; }
.home-widget .task-list { --task-columns: 1; }
.home-widget .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; }
.home-widget .metric::before { display: none; }
/* The resting hint is a quiet line, not the dashed frame of edit mode. */
.home-hint-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; padding: 6px 10px; border: 1px solid var(--line); color: var(--muted); font: 11px var(--font-mono); }
.home-hint-bar button { min-height: 24px; padding: 2px 8px; font-size: 11px; }
.home-hint-actions { display: inline-flex; gap: 6px; }
.home-widget-about { margin: 0; max-width: 220px; color: var(--muted); font-size: 11px; line-height: 1.35; white-space: normal; }
.home-reset-confirm { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--warning-orange); }
.home-edit-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; padding: 8px 10px; border: 1px dashed var(--amber-bright); background: var(--panel-raised); color: var(--text); font: 12px var(--font-mono); }
.home-edit-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.home-widget-options { position: relative; }
.home-widget-options summary { display: grid; width: 28px; min-height: 28px; place-items: center; border: 2px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 4px; cursor: pointer; list-style: none; }
.home-widget-options summary::-webkit-details-marker { display: none; }
.home-widget-options summary:hover { border-color: var(--amber-bright); color: var(--amber-bright); }
.home-widget-options summary:focus-visible { outline: 2px solid var(--cyan-bright); outline-offset: 2px; }
.home-widget-options .settings-icon { width: 14px; height: 14px; }
.home-widget-options-menu { position: absolute; z-index: 4; top: calc(100% + 5px); right: 0; display: grid; gap: 10px; min-width: 240px; padding: 10px; border: 1px solid var(--slate-border); background: var(--panel-raised); }
.home-widget-form { display: flex; gap: 4px; }
.home-widget-form input { flex: 1 1 auto; min-width: 0; min-height: 26px; }
.home-widget-form button { min-height: 26px; padding: 2px 8px; }
.home-widget-options-menu select { width: 100%; }
.error { color: var(--warning-orange); }
@media (max-width: 720px) {
  main { padding: 16px; }
  header { align-items: start; flex-direction: column; }
  .dashboard-header-actions { width: 100%; flex-direction: column; align-items: stretch; }
  .dashboard-header-actions .view-options { align-self: flex-end; order: -1; }
  .metrics { width: 100%; min-width: 0; }
  .tag-list, .home-grid { grid-template-columns: 1fr; }
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
.settings-icon { width: 16px; height: 16px; }
.empty { clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); padding: 18px; }
@media (max-width: 700px) {
  .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; }
}
${getPageTailCss()}
</style>
</head>
<body${zenBodyAttribute()}>
<main id="app"><div class="empty">Loading index...</div></main>
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
${getQueryEditorScript()}
  let state;
  /** Tag searches wait for typing to settle before telling the host. */
  const tagSearchDebounceDelay = 350;
  const pendingSearches = {};
  const restoredViewState = vscode.getState();
  let dashboardMode = restoredViewState && restoredViewState.dashboardMode === 'browse'
    ? 'browse'
    : 'home';
  let tagColumns = restoredViewState && [1, 2, 3, 4].indexOf(restoredViewState.tagColumns) >= 0
    ? restoredViewState.tagColumns
    : undefined;
  let browseQuery = '';
  // A namespace never contains "/", so this value cannot clash with one.
  const noTagNamespace = '/';
  let tagNamespaceFilter = restoredViewState && typeof restoredViewState.tagNamespaceFilter === 'string'
    ? restoredViewState.tagNamespaceFilter
    : '';
  /** Whether Home is being arranged. */
  let editingHome = Boolean(restoredViewState && restoredViewState.editingHome);
  /**
   * Whether the reader has put away the line saying Home can be arranged.
   * The line also goes on its own once Home has been arranged, which the
   * host says with each state; this remembers a reader who closed it first.
   */
  let homeHintDismissed = Boolean(restoredViewState && restoredViewState.homeHintDismissed);
  /** Whether Reset is waiting to be confirmed. It is never restored. */
  let confirmingReset = false;
  /** The widget whose options are open, which stays open across a redraw. */
  let openWidgetOptions;
  /** A tasks widget's search being typed in its options, by widget. */
  const widgetQueryDrafts = {};
  /** The task being typed into Quick add, and what became of the last one. */
  let quickAddDraft = '';
  let quickAddStatus = '';

  /** The widgets Home can add, and what each shows. */
  const WIDGET_KINDS = {
    search: { label: 'Search', description: 'A search box that opens a search page', repeatable: false, listed: false },
    tasks: { label: 'Tasks', description: 'The tasks a search finds, ranked as on the Task Board', repeatable: true, listed: true },
    agenda: { label: 'Agenda', description: 'Overdue, today, and upcoming tasks', repeatable: false, listed: true, pageable: false },
    favoriteTags: { label: 'Favorite tags', description: 'The tags you favorited', repeatable: false, listed: true },
    topTags: { label: 'Frequent tags', description: 'The tags you open most, lately', repeatable: false, listed: true },
    savedSearches: { label: 'Saved searches', description: 'Your saved searches', repeatable: false, listed: false },
    recentSearches: { label: 'Recent searches', description: 'The searches you ran lately', repeatable: false, listed: true },
    recentNotes: { label: 'Recently opened', description: 'The notes you opened lately', repeatable: false, listed: true },
    stats: { label: 'Workspace', description: 'How many notes, tasks, and tags there are', repeatable: false, listed: false },
    savedQuery: { label: 'Saved search results', description: 'What one saved search finds', repeatable: true, listed: true, pageable: false },
    todayNote: { label: 'Today', description: "Today's daily note and its open tasks", repeatable: false, listed: true },
    quickAdd: { label: 'Quick add', description: "Add a task to today's daily note", repeatable: false, listed: false },
    staleTasks: { label: 'Stale tasks', description: 'Open tasks in notes left unchanged for a while', repeatable: false, listed: true, days: [[7, '7d'], [14, '14d'], [30, '30d'], [90, '90d']], defaultDays: 30 },
    relatedNotes: { label: 'Related notes', description: 'Notes related to the note you had open last', repeatable: false, listed: true },
    tagPairs: { label: 'Tags written together', description: 'Tags most often carried together, which may want a hub note or one name', repeatable: false, listed: true },
    unhubbedTags: { label: 'Tags without a hub', description: 'Frequently used tags with no hub note', repeatable: false, listed: true },
    newTags: { label: 'New tags', description: 'Tags first seen lately, to catch typos early', repeatable: false, listed: true, days: [[7, '7d'], [14, '14d'], [30, '30d'], [90, '90d']], defaultDays: 14 },
    quietPeople: { label: 'People gone quiet', description: 'People you have not written about lately', repeatable: false, listed: true, days: [[30, '30d'], [60, '60d'], [90, '90d'], [180, '180d']], defaultDays: 90 },
    pinnedNotes: { label: 'Pinned notes', description: 'Notes you pin to Home', repeatable: false, listed: true },
  };

  /**
   * Home's search box opens a search page. It is the box every search page
   * uses, with its completions and builder, so a search is written here as
   * it would be anywhere.
   */
  const searchEditor = createQueryEditor({
    getState: function () {
      const widget = findWidget('search');
      return widget && widget.searchState;
    },
    render: function () { renderKeepingFocus(); },
    apply: function (text) {
      if (String(text).trim()) send({ type: 'openSearch', query: text });
    },
    clear: function () { renderKeepingFocus(); },
    placeholder: function () { return 'Search notes and tasks: words, #tags, is:open, has:due, in:folder, updated >= 7d…'; },
    label: 'Search notes and tasks',
  });

  function findWidget(kind) {
    return state && state.widgets
      ? state.widgets.find(function (widget) { return widget.kind === kind; })
      : undefined;
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
      tagColumns: tagColumns,
      browseQuery: browseQuery,
      tagNamespaceFilter: tagNamespaceFilter,
      editingHome: editingHome,
      homeHintDismissed: homeHintDismissed,
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
    const widgetId = isTextField ? active.dataset.widgetId : undefined;
    const selectionStart = isTextField ? active.selectionStart : null;
    const selectionEnd = isTextField ? active.selectionEnd : null;
    render();
    if (!action) return;
    const field = Array.from(document.querySelectorAll('input[data-action="' + action + '"]')).find(function (input) {
      return input.dataset.widgetId === widgetId;
    });
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
    }, tagSearchDebounceDelay);
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

  function setDashboardMode(mode, focusTab) {
    dashboardMode = mode === 'browse' ? 'browse' : 'home';
    saveDashboardViewState();
    send({ type: 'setDashboardMode', mode: dashboardMode });
    render();
    if (focusTab) {
      const selectedTab = document.querySelector('[data-dashboard-mode="' + dashboardMode + '"]');
      if (selectedTab) selectedTab.focus();
    }
  }

  function setEditingHome(editing) {
    editingHome = editing;
    openWidgetOptions = undefined;
    saveDashboardViewState();
    render();
  }

  /** Apply grid changes without replacing the open View options control. */
  function applyTagColumns(columns) {
    tagColumns = columns;
    if (state) state.tagColumns = columns;
    document.querySelectorAll('.tag-list').forEach(function (grid) {
      grid.style.gridTemplateColumns = 'repeat(' + columns + ', 1fr)';
    });
    document.querySelectorAll('[data-action="set-columns"][data-section="tags"]').forEach(function (button) {
      const selected = Number(button.dataset.value) === columns;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  /** Ranked modes alone have a meaningful user-controlled display order. */
  function canRank(kind) {
    if (!state) return false;
    if (kind === 'widget') return editingHome;
    return kind === 'tag' ? state.tagSortMode === 'custom' : state.entitySortMode === 'custom';
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

  /** Home's widgets as the host keeps them: their settings, in order. */
  function widgetConfig() {
    return (state.widgetConfig || []).map(function (widget) { return Object.assign({}, widget); });
  }

  /** Save Home's widgets. The host answers with what each shows. */
  function sendWidgets(widgets) {
    state.widgetConfig = widgets;
    send({ type: 'setDashboardWidgets', widgets: widgets });
  }

  function updateWidget(widgetId, changes) {
    sendWidgets(widgetConfig().map(function (widget) {
      return widget.id === widgetId ? Object.assign(widget, changes) : widget;
    }));
  }

  function rankWidget(reorder) {
    const widgets = widgetConfig();
    const ids = reorder(widgets.map(function (widget) { return widget.id; }));
    if (!ids) return false;
    sendWidgets(ids.map(function (id) { return widgets.find(function (widget) { return widget.id === id; }); }));
    return true;
  }

  /** Add a widget of a kind, or a saved search's widget as savedQuery:<id>. */
  function addWidget(value) {
    const separator = String(value).indexOf(':');
    const kind = separator < 0 ? String(value) : String(value).slice(0, separator);
    const traits = WIDGET_KINDS[kind];
    if (!traits) return;
    const widget = {
      id: kind + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: kind,
      width: kind === 'search' || kind === 'stats' || kind === 'quickAdd' ? 'full' : 'half',
    };
    if (traits.listed) widget.count = 5;
    if (kind === 'tasks') widget.query = 'is:open';
    if (traits.defaultDays) widget.days = traits.defaultDays;
    if (kind === 'savedQuery') {
      if (separator < 0) return;
      widget.filterId = String(value).slice(separator + 1);
    }
    sendWidgets(widgetConfig().concat([widget]));
  }

  // Tags, entities, and Home's widgets are ranked by dragging, or from their
  // context menu, which also renames a tag.
  installRankedRows({
    kinds: {
      tag: { selector: '.tag-row[data-tag-key]', key: 'tagKey' },
      entity: { selector: '.entity-row[data-entity-key]', key: 'entityKey' },
      widget: { selector: '.home-widget.is-editing[data-widget-id]', key: 'widgetId', edgeLabels: ['Move to first', 'Move to last'] },
    },
    canRank: canRank,
    reorder: function (kind, key, targetKey, before, placeholder) {
      if (kind === 'widget') {
        return rankWidget(function (keys) { return rankKeys(keys, key, targetKey, before); });
      }
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
      if (kind === 'widget') rankWidget(reorder);
      else if (kind === 'entity') rankEntity(key, reorder);
      else rankTag(key, reorder);
    },
    menuActions: function (kind) {
      return kind === 'tag'
        ? ['<button type="button" role="menuitem" data-context-action="rename-tag">Rename tag</button>']
        : [];
    },
    onMenuAction: function (action, kind, key) {
      if (action === 'rename-tag') send({ type: 'renameTag', tagKey: key });
    },
  });

  /** Bind directly because the controls live inside a native details menu. */
  function bindTagColumnControls() {
    document
      .querySelectorAll('[data-action="set-columns"]')
      .forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          const columns = Number(button.dataset.value);
          if (button.dataset.section !== 'tags' || columns < 1 || columns > 4) return;
          applyTagColumns(columns);
          saveDashboardViewState();
          send({ type: 'setDashboardColumns', section: 'tags', columns: columns });
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

  function renderSavedFilterRow(filter, removable) {
    const detail = filter.query
      ? (filter.page === 'taskBoard' ? 'Task Board · ' : '') + escapeHtml(filter.query)
      : filter.tags.map(function (tag) { return renderTagLabel(tag.label); }).join(' AND ') + ' · ' + filter.tags.length + ' tags';
    return '<div class="row saved-filter-row" tabindex="0" data-saved-filter-id="' + escapeHtml(filter.id) + '"><div><div class="saved-filter-name">' + escapeHtml(filter.name) + '</div><div class="saved-filter-tags">' + detail + '</div></div>'
      + (removable ? '<button class="saved-filter-remove" data-action="remove-saved-filter" data-saved-filter-id="' + escapeHtml(filter.id) + '" aria-label="Remove saved search ' + escapeHtml(filter.name) + '">Remove</button>' : '')
      + '</div>';
  }

  /** A row that opens something: a tag, a search, or a note. */
  function renderHomeRow(action, attributes, labelHtml, detail) {
    return '<button type="button" class="row saved-filter-row home-row" data-action="' + action + '" ' + attributes + '><span class="home-row-label">' + labelHtml + '</span>' + (detail ? '<span class="home-row-detail">' + escapeHtml(detail) + '</span>' : '') + '</button>';
  }

  function renderHomeTasks(tasks, emptyText) {
    return tasks && tasks.length
      ? '<div class="task-list">' + tasks.map(function (item) { return renderTaskListRow(item, { titleDisplay: state.tagTitleDisplayMode }); }).join('') + '</div>'
      : '<p class="home-widget-empty">' + escapeHtml(emptyText) + '</p>';
  }

  /** A row, and beside it a button of its own when there is one. */
  function withRowAction(row, actionHtml) {
    return actionHtml ? '<div class="home-row-with-action">' + row + actionHtml + '</div>' : row;
  }

  function renderRowAction(action, attributes, label, title) {
    return '<button type="button" class="home-row-action" data-action="' + action + '" ' + attributes + ' title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '">' + escapeHtml(label) + '</button>';
  }

  /**
   * Notes that open at their line, or at their top when they are whole notes.
   * actionFor adds a button beside a note.
   */
  function renderHomeNotes(notes, emptyText, wholeNotes, actionFor) {
    return notes && notes.length
      ? '<div class="home-list">' + notes.map(function (note) {
        const row = wholeNotes
          ? renderHomeRow('open-note', 'data-file-path="' + escapeHtml(note.filePath) + '"', escapeHtml(note.title), note.detail)
          : renderHomeRow('open-source', 'data-file-path="' + escapeHtml(note.filePath) + '" data-line="' + note.line + '"', escapeHtml(note.title), note.detail);
        return withRowAction(row, actionFor ? actionFor(note) : '');
      }).join('') + '</div>'
      : '<p class="home-widget-empty">' + escapeHtml(emptyText) + '</p>';
  }

  /** Tags that open their page. actionFor adds a button beside a tag. */
  function renderHomeTags(tags, emptyText, actionFor) {
    return tags && tags.length
      ? '<div class="home-list">' + tags.map(function (tag) {
        const row = renderHomeRow('open-tag', 'data-tag-key="' + escapeHtml(tag.key) + '"', renderTagLabel(tag.label), tag.detail);
        return withRowAction(row, actionFor ? actionFor(tag) : '');
      }).join('') + '</div>'
      : '<p class="home-widget-empty">' + escapeHtml(emptyText) + '</p>';
  }

  /** Two tags written together, which open a search for both. */
  function renderTagPairs(pairs) {
    return pairs && pairs.length
      ? '<div class="home-list">' + pairs.map(function (pair) {
        const query = pair.tags[0].key + ' AND ' + pair.tags[1].key;
        const label = '<span class="home-tag-pair">' + renderTagLabel(pair.tags[0].label) + '<span class="home-tag-pair-join">+</span>' + renderTagLabel(pair.tags[1].label) + '</span>';
        return '<button type="button" class="row saved-filter-row home-row" data-action="open-search" data-query="' + escapeHtml(query) + '" title="' + escapeHtml(pair.detail + '. Search for both.') + '"><span class="home-row-label">' + label + '</span><span class="home-row-detail">' + pair.count + '× · ' + Math.round(pair.overlap * 100) + '%</span></button>';
      }).join('') + '</div>'
      : '<p class="home-widget-empty">Two tags carried by the same note or task show up here.</p>';
  }

  /** The note a widget follows, and what can be done with it. */
  function renderSourceNote(prefix, note, actionHtml) {
    return '<div class="home-widget-source"><span>' + escapeHtml(prefix) + ' <strong>' + escapeHtml(note.title) + '</strong></span>' + (actionHtml || '') + '</div>';
  }

  function renderQuickAdd(widget) {
    const today = widget.today || {};
    const target = today.filePath ? 'today’s note, ' + today.date : 'a new note for ' + (today.date || 'today');
    return '<form class="home-quick-add" data-form="quick-add"><input type="text" data-action="quick-add-draft" value="' + escapeHtml(quickAddDraft) + '" placeholder="Call Ren about the audit #project/atlas 📅 tomorrow" aria-label="Task to add to today’s note" autocomplete="off" spellcheck="true"><button type="submit">Add</button></form>'
      + '<p class="home-quick-add-status" role="status">' + escapeHtml(quickAddStatus || 'Adds an open task to ' + target + '.') + '</p>';
  }

  /** What one widget shows. */
  function renderWidgetBody(widget) {
    switch (widget.kind) {
      case 'search':
        return searchEditor.renderBar('');
      case 'tasks':
        return widget.error
          ? '<p class="query-error" role="alert">' + escapeHtml(widget.error) + '</p>'
          : renderHomeTasks(widget.tasks, 'No tasks match ' + (widget.query || 'this search') + '.');
      case 'agenda': {
        const groups = (widget.agenda || []).filter(function (group) { return group.count > 0; });
        return groups.length
          ? groups.map(function (group) {
            return '<h3 class="home-widget-group">' + escapeHtml(group.label) + ' <span class="tag-count">' + group.count + '</span></h3>' + renderHomeTasks(group.tasks, '');
          }).join('')
          : '<p class="home-widget-empty">Nothing is overdue or due soon.</p>';
      }
      case 'favoriteTags':
        return renderHomeTags(widget.tags, 'Favorite a tag on the Tags tab to keep it here.');
      case 'topTags':
        return renderHomeTags(widget.tags, 'The tags you open most show up here.');
      case 'savedSearches':
        return widget.savedFilters && widget.savedFilters.length
          ? '<div class="saved-filter-list">' + widget.savedFilters.map(function (filter) { return renderSavedFilterRow(filter, true); }).join('') + '</div>'
          : '<p class="home-widget-empty">Save a search from a search page to keep it here.</p>';
      case 'recentSearches':
        return widget.queries && widget.queries.length
          ? '<div class="home-list">' + widget.queries.map(function (query) {
            return renderHomeRow('open-search', 'data-query="' + escapeHtml(query) + '"', '<code>' + escapeHtml(query) + '</code>', '');
          }).join('') + '</div>'
          : '<p class="home-widget-empty">The searches you run show up here.</p>';
      case 'recentNotes':
        return renderHomeNotes(widget.notes, 'The notes you open from Deckard show up here.');
      case 'stats':
        return '<div class="metrics">' + (widget.stats || []).map(function (stat) {
          return '<div class="metric"><span class="metric-value">' + stat.value + '</span><span class="metric-label">' + escapeHtml(stat.label) + '</span></div>';
        }).join('') + '</div>';
      case 'todayNote': {
        const today = widget.today || {};
        const summary = '<div class="home-today-summary"><span class="home-today-date">' + escapeHtml(today.date || '') + '</span>'
          + (today.filePath ? '' : '<button type="button" data-action="open-daily-note">Create today’s note</button>') + '</div>';
        if (!today.filePath) return summary + '<p class="home-widget-empty">There is no daily note for today yet.</p>';
        return summary + renderHomeTasks(widget.tasks, 'No open tasks in today’s note.');
      }
      case 'quickAdd':
        return renderQuickAdd(widget);
      case 'staleTasks':
        return renderHomeTasks(widget.tasks, 'No open task sits in a note left unchanged for ' + (widget.days || 30) + ' days.');
      case 'relatedNotes':
        if (!widget.sourceNote) return '<p class="home-widget-empty">Open a note to see the notes related to it.</p>';
        return renderSourceNote('Related to', widget.sourceNote)
          + renderHomeNotes(widget.notes, 'No notes share its tags.');
      case 'tagPairs':
        return renderTagPairs(widget.tagPairs);
      case 'unhubbedTags':
        return renderHomeTags(widget.tags, 'Every frequently used tag has a hub note.', function (tag) {
          return renderRowAction('create-tag-hub', 'data-tag-key="' + escapeHtml(tag.key) + '"', 'Create hub', 'Create a hub note for ' + tag.label);
        });
      case 'newTags':
        return renderHomeTags(widget.tags, 'No tag was first seen in the last ' + (widget.days || 14) + ' days.', function (tag) {
          return renderRowAction('rename-tag', 'data-tag-key="' + escapeHtml(tag.key) + '"', 'Rename', 'Rename ' + tag.label + ' everywhere');
        });
      case 'quietPeople':
        return renderHomeTags(widget.tags, 'Everyone you write about has come up in the last ' + (widget.days || 90) + ' days.');
      case 'pinnedNotes':
        // Home lists pins and lets go of them; pinning happens where the
        // note is: the editor, a search result, or the command.
        // A pin names an entry, so its row opens at that entry's line.
        return renderHomeNotes(widget.notes, 'Pin the note you are in with “Deckard: Pin Note to Home”, or right-click a search result.', false, function (note) {
          return renderRowAction('unpin-note', 'data-pin-key="' + escapeHtml(note.pinKey || '') + '"', '×', 'Unpin ' + note.title);
        });
      case 'savedQuery':
        if (widget.missing) return '<p class="home-widget-empty">This saved search was removed. <button type="button" data-action="customize-home">Pick another</button></p>';
        // A search saved on the Task Board finds tasks alone.
        if (widget.savedPage === 'taskBoard') return renderHomeTasks(widget.tasks, 'No open tasks match.');
        return '<h3 class="home-widget-group">Notes <span class="tag-count">' + (widget.noteTotal || 0) + '</span></h3>' + renderHomeNotes(widget.notes, 'No notes match.')
          + '<h3 class="home-widget-group">Open tasks <span class="tag-count">' + (widget.total || 0) + '</span></h3>' + renderHomeTasks(widget.tasks, 'No open tasks match.');
      default:
        return '';
    }
  }

  /** Where a widget leads, when it leads anywhere. */
  function renderWidgetOpen(widget) {
    const link = function (action, attributes, label) {
      return '<button type="button" class="home-open" data-action="' + action + '" ' + attributes + '>' + escapeHtml(label) + ' →</button>';
    };
    switch (widget.kind) {
      case 'tasks': return link('open-task-board', 'data-query="' + escapeHtml(widget.query || '') + '"', 'Task Board');
      case 'agenda': return link('open-view', 'data-view="agenda"', 'Agenda');
      case 'favoriteTags':
      case 'topTags': return link('set-dashboard-mode', 'data-dashboard-mode="browse"', 'All tags');
      case 'stats': return link('open-view', 'data-view="stats"', 'Stats');
      case 'todayNote': return widget.today && widget.today.filePath ? link('open-daily-note', '', 'Open') : '';
      case 'staleTasks': return link('open-task-board', 'data-query="is:open"', 'Task Board');
      case 'unhubbedTags':
      case 'newTags':
      case 'quietPeople':
      case 'tagPairs': return link('set-dashboard-mode', 'data-dashboard-mode="browse"', 'All tags');
      case 'relatedNotes': return widget.sourceNote ? link('open-note', 'data-file-path="' + escapeHtml(widget.sourceNote.filePath) + '"', 'Open note') : '';
      case 'savedQuery':
        if (widget.missing) return '';
        return widget.savedPage === 'taskBoard'
          ? link('open-task-board', 'data-query="' + escapeHtml(widget.savedQuery || '') + '"', 'Task Board')
          : link('open-search', 'data-query="' + escapeHtml(widget.savedQuery || '') + '"', 'Open');
      default: return '';
    }
  }

  /** A widget's own settings, in the menu its gear opens. */
  function renderWidgetOptions(widget) {
    const traits = WIDGET_KINDS[widget.kind] || {};
    const attribute = 'data-widget-id="' + escapeHtml(widget.id) + '"';
    const groups = [];
    if (traits.listed && !widget.paged) {
      groups.push('<div class="view-options-group"><span>Show</span>' + renderViewOptionChoices('set-widget-count', [[3, '3'], [5, '5'], [10, '10'], [20, '20']], widget.count || 5, 'Entries shown', attribute) + '</div>');
    }
    if (traits.listed && traits.pageable !== false) {
      groups.push('<div class="view-options-group"><span>Paging</span>' + renderViewOptionChoices('set-widget-paged', [['off', 'Off', 'Show the first few'], ['on', 'On', 'Page through all of them']], widget.paged ? 'on' : 'off', 'Paging', attribute) + '</div>');
    }
    if (traits.days) {
      groups.push('<div class="view-options-group"><span>' + (widget.kind === 'newTags' ? 'Seen within' : 'Unchanged for') + '</span>' + renderViewOptionChoices('set-widget-days', traits.days, widget.days || traits.defaultDays, 'Days', attribute) + '</div>');
    }
    if (widget.kind === 'tasks') {
      const draft = widgetQueryDrafts[widget.id] !== undefined ? widgetQueryDrafts[widget.id] : (widget.query || '');
      groups.push('<div class="view-options-group is-stacked"><span>Search</span><form class="home-widget-form" data-form="widget-query" ' + attribute + '><input type="text" data-action="widget-query-draft" ' + attribute + ' value="' + escapeHtml(draft) + '" placeholder="is:open #project/atlas" aria-label="Tasks to list" autocomplete="off" spellcheck="false"><button type="submit">Apply</button></form></div>');
    }
    if (widget.kind === 'savedQuery') {
      groups.push('<div class="view-options-group is-stacked"><span>Saved search</span><select data-action="set-widget-filter" ' + attribute + ' aria-label="Saved search to show">' + state.savedFilters.map(function (filter) {
        return '<option value="' + escapeHtml(filter.id) + '"' + (filter.id === widget.filterId ? ' selected' : '') + '>' + escapeHtml(filter.name) + '</option>';
      }).join('') + '</select></div>');
    }
    const description = WIDGET_KINDS[widget.kind] && WIDGET_KINDS[widget.kind].description;
    if (description) {
      groups.unshift('<div class="view-options-group is-stacked"><span>About</span><p class="home-widget-about">' + escapeHtml(description) + '</p></div>');
    }
    if (!groups.length) return '';
    return '<details class="home-widget-options" ' + attribute + (openWidgetOptions === widget.id ? ' open' : '') + '><summary aria-label="Widget options" title="Widget options">' + '${settingsIcon}' + '</summary><div class="home-widget-options-menu">' + groups.join('') + '</div></details>';
  }

  function renderWidget(widget) {
    const listed = WIDGET_KINDS[widget.kind] && WIDGET_KINDS[widget.kind].listed;
    // Each kind lists its own sort of entry, so the shown count is whichever
    // list the widget carries.
    const list = widget.tasks || widget.tags || widget.notes || widget.queries || widget.savedFilters || widget.tagPairs;
    const shown = listed && list ? list.length : undefined;
    // "5 of 37" rather than "37" over five rows, which read as the whole list.
    const count = widget.total !== undefined && listed
      ? ' <span class="tag-count">' + (!widget.paged && shown !== undefined && shown < widget.total ? shown + ' of ' + widget.total : widget.total) + '</span>'
      : '';
    const actions = editingHome
      ? renderViewOptionChoices('set-widget-width', [['half', '½', 'Half width'], ['full', 'Full', 'Full width']], widget.width, 'Width', 'data-widget-id="' + escapeHtml(widget.id) + '"')
        + renderWidgetOptions(widget)
        + '<button type="button" class="home-remove" data-action="remove-widget" data-widget-id="' + escapeHtml(widget.id) + '" aria-label="Remove ' + escapeHtml(widget.title) + '" title="Remove widget">&#215;</button>'
      : renderWidgetOpen(widget);
    return '<article class="home-widget view-panel' + (widget.width === 'full' ? ' is-full' : '') + (editingHome ? ' is-editing is-draggable' : '') + '"' + (editingHome ? ' tabindex="0" title="Drag to move, or press the menu key (Shift+F10) to move it first or last"' : '') + ' data-widget-id="' + escapeHtml(widget.id) + '" aria-label="' + escapeHtml(widget.title) + '">'
      + '<div class="home-widget-header"><h2 class="home-widget-title">' + (editingHome ? '<span class="home-widget-grip" aria-hidden="true">&#10303;</span>' : '') + escapeHtml(widget.title) + count + '</h2><div class="home-widget-actions">' + actions + '</div></div>'
      + renderWidgetBody(widget)
      + renderWidgetPaging(widget)
      + '</article>';
  }

  /**
   * A paged widget's pager: how many it holds, where the reader is in the
   * list, and a step either way.
   *
   * A search page offers every page number because a reader goes to one; a
   * widget is a few entries in a corner of Home, walked a page at a time, so
   * it is two chevrons and the count it is showing.
   */
  function renderWidgetPaging(widget) {
    const paging = widget.paging;
    if (!paging || editingHome) return '';
    const attribute = 'data-widget-id="' + escapeHtml(widget.id) + '"';
    const step = function (page, label, path, enabled) {
      return '<button type="button" data-action="set-widget-page" data-page="' + page + '" ' + attribute
        + (enabled ? '' : ' disabled')
        + ' aria-label="' + label + ' page of ' + escapeHtml(widget.title) + '" title="' + label + ' page">'
        + '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="' + path + '"/></svg></button>';
    };
    // The sizes on offer, and whatever this widget is already set to, so a
    // count chosen before it was paged is not silently changed by its own
    // control.
    const sizes = [3, 5, 10, 20, 50]
      .concat(paging.size)
      .filter(function (size, index, all) { return all.indexOf(size) === index; })
      .sort(function (left, right) { return left - right; });
    const perPage = '<label class="control-label">Per page:<select data-action="set-widget-page-size" ' + attribute + ' aria-label="Entries per page">'
      + sizes.map(function (size) {
        return '<option value="' + size + '"' + (size === paging.size ? ' selected' : '') + '>' + size + '</option>';
      }).join('')
      + '</select></label>';
    return '<nav class="home-widget-paging" aria-label="' + escapeHtml(widget.title) + ' pages">'
      + perPage
      + '<span class="home-widget-steps"><span class="page-range">' + describePageRange(paging) + '</span>'
      + step(paging.page - 1, 'Previous', 'M10 3 5 8l5 5', paging.page > 1)
      + step(paging.page + 1, 'Next', 'M6 3l5 5-5 5', paging.page < paging.pageCount)
      + '</span></nav>';
  }

  /** The kinds that can still be added, and a saved search's widget for each. */
  function renderAddWidget() {
    const present = new Set(widgetConfig().map(function (widget) { return widget.kind; }));
    const options = Object.keys(WIDGET_KINDS).filter(function (kind) {
      return kind !== 'savedQuery' && (WIDGET_KINDS[kind].repeatable || !present.has(kind));
    }).map(function (kind) {
      return '<option value="' + kind + '" title="' + escapeHtml(WIDGET_KINDS[kind].description) + '">' + escapeHtml(WIDGET_KINDS[kind].label) + '</option>';
    }).concat(state.savedFilters.map(function (filter) {
      return '<option value="savedQuery:' + escapeHtml(filter.id) + '">Saved search: ' + escapeHtml(filter.name) + '</option>';
    }));
    return '<select data-action="add-widget" aria-label="Add a widget"><option value="" selected>+ Add widget…</option>' + options.join('') + '</select>';
  }

  function renderHome() {
    // The widgets arrive once the host knows Home is showing.
    if (!state.widgets) return '<div class="empty">Loading Home…</div>';
    const widgets = state.widgets;
    const bar = editingHome
      ? '<div class="home-edit-bar" role="status"><span>Customizing Home. Drag a widget to move it, or right-click it to move it first or last.</span><div class="home-edit-actions">' + renderAddWidget() + '' + (confirmingReset
        ? '<span class="home-reset-confirm">Reset discards the widgets you arranged. <button type="button" data-action="confirm-reset-widgets">Reset</button><button type="button" data-action="cancel-reset-widgets">Keep them</button></span>'
        : '<button type="button" data-action="reset-widgets" title="Put back the widgets Home started with">Reset</button>') + '<button type="button" class="active" data-action="finish-customizing">Done</button></div></div>'
      // A resting Home says it can be arranged, until it has been, or the
      // reader closes the line: a fixed line of instruction is read the first
      // few times and skipped after. Customize stays in the gear throughout.
      // It is not the customizing bar, and does not share its class: that
      // one means "Home is being edited".
      : (state.homeArranged || homeHintDismissed)
        ? ''
        : '<div class="home-hint-bar"><span>Home is yours to arrange.</span><span class="home-hint-actions"><button type="button" data-action="customize-home">Customize</button><button type="button" data-action="dismiss-home-hint" title="Stop saying so">Dismiss</button></span></div>';
    const grid = widgets.length
      ? '<div class="home-grid">' + widgets.map(renderWidget).join('') + '</div>'
      : '<div class="empty">Home has no widgets. <button type="button" data-action="customize-home">Customize Home</button></div>';
    return bar + grid;
  }

  /** Re-render from a snapshot while preserving scroll and filter affordances. */
  function render() {
    if (!state) return;
    const selectedTagColumns = tagColumns ?? state.tagColumns ?? 2;
    tagColumns = selectedTagColumns;
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
        ? '<div class="tag-group" data-tag-group="favorites"><h3>Favorites <span class="tag-count">(' + favoriteTags.length + ')</span></h3><div class="tag-list">' + favoriteTags.map(renderTag).join('') + '</div></div>'
        : '') + (otherTags.length ? '<div class="tag-group" data-tag-group="other"><h3>Other tags <span class="tag-count">(' + otherTags.length + ')</span></h3><div class="tag-list">' + otherTags.map(renderTag).join('') + '</div></div>' : '')
      : '<div class="empty">' + (state.tags.length
        ? 'No tags match your search.'
        : 'No tags indexed yet. Write a tag such as #project/atlas on a heading or a task, and it appears here.') + '</div>';
    const savedFilters = state.savedFilters.length
      ? '<section class="saved-filters" aria-labelledby="saved-filters-heading"><div class="section-heading"><h2 id="saved-filters-heading">Saved searches <span class="tag-count">' + state.savedFilters.length + '</span></h2></div><div class="saved-filter-list">' + state.savedFilters.map(function (filter) { return renderSavedFilterRow(filter, true); }).join('') + '</div></section>'
      : '';
    const tagSortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-sort" aria-label="Sort tags"><option value="alphabetical" ' + (state.tagSortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="count" ' + (state.tagSortMode === 'count' ? 'selected' : '') + '>Entry Count</option><option value="access" ' + (state.tagSortMode === 'access' ? 'selected' : '') + '>Most accessed</option><option value="custom" ' + (state.tagSortMode === 'custom' ? 'selected' : '') + '>Rank</option></select>' + sortIcon + '</span></label>';
    const tagNamespaceOptions = [{ value: '', label: 'All' }]
      .concat(tagNamespaces.map(function (namespace) { return { value: namespace, label: formatEntityKindLabel(namespace) }; }))
      .concat(hasTagsWithoutNamespace ? [{ value: noTagNamespace, label: 'None' }] : []);
    const tagNamespaceControl = tagNamespaces.length
      ? '<label class="control-label">Namespace:<span class="control-icon"><select data-action="set-tag-namespace"' + (activeTagNamespace ? ' data-has-query' : '') + ' aria-label="Filter tags by namespace">' + tagNamespaceOptions.map(function (option) {
          return '<option value="' + escapeHtml(option.value) + '" ' + (activeTagNamespace === option.value ? 'selected' : '') + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select>' + filterIcon + '</span></label>'
      : '';
    const tagColumnChoices = renderViewOptionChoices('set-columns', [1, 2, 3, 4].map(function (columns) { return [columns, String(columns), columns + ' columns']; }), state.tagColumns, 'Tag columns', 'data-section="tags"');
    // One vocabulary everywhere: notes are the headed entries, tasks, and
    // tags. Stats and the graph count the same things under the same names.
    const metrics = '<div class="metrics" aria-label="Workspace totals">' +
      '<div class="metric" data-code="IDX.NTE // 01"><span class="metric-value">' + state.totalNoteCount + '</span><span class="metric-label">notes</span></div>' +
      '<div class="metric" data-code="IDX.TSK // 02"><span class="metric-value">' + state.totalTaskCount + '</span><span class="metric-label">tasks</span></div>' +
      '<div class="metric" data-code="SYS.TAG // 1982-AZ"><span class="metric-value">' + state.tags.length + '</span><span class="metric-label">tags</span></div>' +
      '</div>';
    const dashboardOptions = renderViewOptions([
      { label: 'Home', html: '<button type="button" class="' + (editingHome ? 'active' : '') + '" data-action="' + (editingHome ? 'finish-customizing' : 'customize-home') + '" aria-pressed="' + editingHome + '">' + (editingHome ? 'Done customizing' : 'Customize') + '</button>' },
      { label: 'Tag columns', html: tagColumnChoices },
      renderZenOption(),
    ]);
    const home = dashboardMode === 'home' ? renderHome() : '';

    document.getElementById('app').innerHTML =
      '<header><div><p class="eyebrow">DECKARD / WORKSPACE INDEX</p><h1>Dashboard: ' + (dashboardMode === 'home' ? 'Home' : 'Tags') + '</h1></div><div class="dashboard-header-actions">' + metrics + dashboardOptions + '</div></header>' +
      '<div class="dashboard-tabs-row"><div class="segmented dashboard-tabs" role="tablist" aria-label="Dashboard mode"><button id="home-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="home" aria-selected="' + (dashboardMode === 'home') + '" aria-controls="home-panel" tabindex="' + (dashboardMode === 'home' ? '0' : '-1') + '">Home</button><button id="browse-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="browse" aria-selected="' + (dashboardMode === 'browse') + '" aria-controls="browse-panel" tabindex="' + (dashboardMode === 'browse' ? '0' : '-1') + '">Tags' + renderTabSearchMark(browseQuery, tagNamespaceLabel ? 'Namespace: ' + tagNamespaceLabel : '') + '</button></div></div>' +
      '<section id="home-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="home-tab"' + (dashboardMode === 'home' ? '' : ' hidden') + '>' + home + '</section>' +
      '<section id="browse-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="browse-tab"' + (dashboardMode === 'browse' ? '' : ' hidden') + '><div class="browse-toolbar"><div class="browse-toolbar-controls"><input class="catalog-search" type="search"' + (normalizedBrowseQuery ? ' data-has-query' : '') + ' data-action="search-browse" value="' + escapeHtml(browseQuery) + '" placeholder="Search tags" aria-label="Search tags" autocomplete="off"><div class="control-row">' + tagNamespaceControl + tagSortControl + '</div></div></div>' + tagNotice + tagContent + savedFilters + '</section>';
    bindTagColumnControls();
    applyTagColumns(selectedTagColumns);
    searchEditor.afterRender();
    window.scrollTo(scrollX, scrollY);
  }

  installViewOptions();

  // A widget's options stay open across a redraw until closed.
  document.addEventListener('toggle', function (event) {
    const options = event.target;
    if (!options.classList || !options.classList.contains('home-widget-options')) return;
    if (options.open) openWidgetOptions = options.dataset.widgetId;
    else if (openWidgetOptions === options.dataset.widgetId) openWidgetOptions = undefined;
  }, true);

  document.addEventListener('click', function (event) {
    if (openWidgetOptions && !event.target.closest('.home-widget-options')) {
      openWidgetOptions = undefined;
      document.querySelectorAll('.home-widget-options[open]').forEach(function (options) { options.open = false; });
    }
    if (searchEditor.handleClick(event)) return;
    const target = event.target.closest('[data-action]');
    if (target) {
      const action = target.dataset.action;
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
      if (action === 'set-dashboard-mode') {
        setDashboardMode(
          target.dataset.dashboardMode,
          document.activeElement === target,
        );
        return;
      }
      if (action === 'customize-home') {
        if (dashboardMode !== 'home') setDashboardMode('home', false);
        setEditingHome(true);
        return;
      }
      if (action === 'finish-customizing') {
        setEditingHome(false);
        return;
      }
      if (action === 'dismiss-home-hint') {
        homeHintDismissed = true;
        saveDashboardViewState();
        render();
        return;
      }
      if (action === 'reset-widgets') {
        confirmingReset = true;
        render();
        return;
      }
      if (action === 'confirm-reset-widgets') {
        confirmingReset = false;
        send({ type: 'resetDashboardWidgets' });
        return;
      }
      if (action === 'cancel-reset-widgets') {
        confirmingReset = false;
        render();
        return;
      }
      if (action === 'remove-widget') {
        sendWidgets(widgetConfig().filter(function (widget) { return widget.id !== target.dataset.widgetId; }));
        return;
      }
      if (action === 'set-widget-width') {
        updateWidget(target.dataset.widgetId, { width: target.dataset.value === 'full' ? 'full' : 'half' });
        return;
      }
      if (action === 'set-widget-paged') {
        const paged = target.dataset.value === 'on';
        // A list that starts being paged starts at its first page, and one
        // that stops keeps nothing to come back to.
        updateWidget(target.dataset.widgetId, paged ? { paged: true, page: 1 } : { paged: false, page: 1 });
        return;
      }
      if (action === 'set-widget-page') {
        updateWidget(target.dataset.widgetId, { page: Number(target.dataset.page) });
        return;
      }
      if (action === 'set-widget-count') {
        updateWidget(target.dataset.widgetId, { count: Number(target.dataset.value), page: 1 });
        return;
      }
      if (action === 'set-widget-days') {
        updateWidget(target.dataset.widgetId, { days: Number(target.dataset.value) });
        return;
      }
      if (action === 'open-daily-note') send({ type: 'openDailyNote' });
      if (action === 'create-tag-hub') send({ type: 'createTagHub', tagKey: target.dataset.tagKey });
      if (action === 'rename-tag') send({ type: 'renameTag', tagKey: target.dataset.tagKey });
      if (action === 'open-note') send({ type: 'openNote', filePath: target.dataset.filePath });
      if (action === 'unpin-note') send({ type: 'unpinNote', filePath: target.dataset.filePath || ' ', pinKey: target.dataset.pinKey });
      if (action === 'open-search') send({ type: 'openSearch', query: target.dataset.query || '' });
      if (action === 'open-task-board') send({ type: 'openTaskBoard', query: target.dataset.query || '' });
      if (action === 'open-view') send({ type: 'openView', view: target.dataset.view });
      if (action === 'open-tag') send({ type: 'openTag', tagKey: target.dataset.tagKey });
      if (action === 'remove-saved-filter') send({ type: 'removeSavedFilter', filterId: target.dataset.savedFilterId });
      if (action === 'favorite-tag') send({ type: 'toggleFavorite', tagKey: target.dataset.tagKey });
      if (action === 'favorite-entity') send({ type: 'toggleFavoriteEntity', entityKey: target.dataset.entityKey });
      if (action === 'open-source') send({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      return;
    }
    if (event.target.closest('button, input, select, a, summary')) return;
    const taskRow = event.target.closest('.task-row');
    if (taskRow) send({ type: 'openSource', filePath: taskRow.dataset.filePath, line: Number(taskRow.dataset.line) });
    const entityRow = event.target.closest('.entity-row');
    if (entityRow) send({ type: 'openTag', tagKey: entityRow.dataset.entityKey });
    const tagRow = event.target.closest('.tag-row');
    if (tagRow) send({ type: 'openTag', tagKey: tagRow.dataset.tagKey });
    const savedFilterRow = event.target.closest('.saved-filter-row[data-saved-filter-id]');
    if (savedFilterRow) send({ type: 'openSavedFilter', filterId: savedFilterRow.dataset.savedFilterId });
  });

  document.addEventListener('mousedown', function (event) {
    searchEditor.handleMousedown(event);
  });
  document.addEventListener('focusin', function (event) {
    searchEditor.handleFocusIn(event);
  });

  document.addEventListener('submit', function (event) {
    if (event.target.closest('[data-form="quick-add"]')) {
      event.preventDefault();
      const text = quickAddDraft.trim();
      if (!text) return;
      // The field is cleared at once; the host gives the text back if it
      // could not add it.
      quickAddDraft = '';
      quickAddStatus = 'Adding…';
      send({ type: 'quickAdd', text: text });
      renderKeepingFocus();
      return;
    }
    const form = event.target.closest('[data-form="widget-query"]');
    if (!form) return;
    event.preventDefault();
    const widgetId = form.dataset.widgetId;
    const query = widgetQueryDrafts[widgetId];
    delete widgetQueryDrafts[widgetId];
    if (query !== undefined) updateWidget(widgetId, { query: query.trim() });
  });

  document.addEventListener('keydown', function (event) {
    // The search box takes / only where it is on screen.
    const inSearch = Boolean(event.target.closest && event.target.closest('[data-suggest-key]'));
    if ((inSearch || (dashboardMode === 'home' && findWidget('search'))) && searchEditor.handleKeydown(event)) return;
    const dashboardTab = event.target.closest('[role="tab"][data-dashboard-mode]');
    if (dashboardTab && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      const modes = ['home', 'browse'];
      const currentIndex = modes.indexOf(dashboardMode);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : modes.length - 1)) % modes.length;
      setDashboardMode(modes[nextIndex], true);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button, input, select, a, summary')) return;
    const row = event.target.closest('.task-row, .entity-row, .tag-row, .saved-filter-row[data-saved-filter-id]');
    if (!row) return;
    event.preventDefault();
    if (row.classList.contains('task-row')) send({ type: 'openSource', filePath: row.dataset.filePath, line: Number(row.dataset.line) });
    else if (row.classList.contains('entity-row')) send({ type: 'openTag', tagKey: row.dataset.entityKey });
    else if (row.classList.contains('tag-row')) send({ type: 'openTag', tagKey: row.dataset.tagKey });
    else send({ type: 'openSavedFilter', filterId: row.dataset.savedFilterId });
  });

  document.addEventListener('change', function (event) {
    if (searchEditor.handleChange(event)) return;
    const target = event.target;
    if (target.dataset.action === 'set-sort') send({ type: 'setTagSort', mode: target.value });
    if (target.dataset.action === 'set-tag-namespace') {
      tagNamespaceFilter = target.value;
      saveDashboardViewState();
      render();
      const namespaceSelect = document.querySelector('select[data-action="set-tag-namespace"]');
      if (namespaceSelect) namespaceSelect.focus();
    }
    if (target.dataset.action === 'add-widget' && target.value) addWidget(target.value);
    if (target.dataset.action === 'set-widget-filter') updateWidget(target.dataset.widgetId, { filterId: target.value });
    // A different page size is a different set of pages, so the list is read
    // again from its top.
    if (target.dataset.action === 'set-widget-page-size') updateWidget(target.dataset.widgetId, { count: Number(target.value), page: 1 });
    if (target.dataset.action === 'toggle-task') send({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
  });

  document.addEventListener('input', function (event) {
    if (searchEditor.handleInput(event)) return;
    const target = event.target;
    if (target.dataset.action === 'search-browse') {
      browseQuery = target.value;
      saveDashboardViewState();
      scheduleSearch('tags', browseQuery);
      renderKeepingFocus();
    }
    if (target.dataset.action === 'quick-add-draft') {
      quickAddDraft = target.value;
    }
    if (target.dataset.action === 'widget-query-draft') {
      widgetQueryDrafts[target.dataset.widgetId] = target.value;
    }
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'quickAddResult') {
      if (event.data.added) {
        quickAddStatus = 'Added “' + event.data.text + '”.';
      } else {
        quickAddStatus = 'Could not add the task.';
        if (!quickAddDraft) quickAddDraft = event.data.text;
      }
      renderKeepingFocus();
      return;
    }
    if (event.data && event.data.type === 'state') {
      const incomingState = event.data.data;
      tagColumns = incomingState.tagColumns ?? tagColumns ?? 2;
      if (incomingState.viewState) {
        dashboardMode = incomingState.viewState.mode === 'browse' ? 'browse' : 'home';
        browseQuery = acceptHostSearch('tags', incomingState.viewState.tagSearchQuery, browseQuery);
      }
      incomingState.tagColumns = tagColumns;
      // Widgets are sent only while Home is showing, and the snapshot
      // replaces the state wholesale. Keeping the last set stops Home
      // blanking to "Loading Home…" on every return from the Tags tab.
      if (!incomingState.widgets && state && state.widgets) {
        incomingState.widgets = state.widgets;
      }
      state = incomingState;
      searchEditor.receive();
      renderKeepingFocus();
    }
  });
}());
</script>
</body>
</html>`;
}
