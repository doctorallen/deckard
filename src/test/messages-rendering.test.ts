import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  parseDashboardMessage,
  parseSidebarMessage,
  parseTagOverviewMessage,
} from '../ui/webview/messages';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getHelpHtml } from '../ui/webview/helpHtml';
import { getRelatedNotesDebugHtml } from '../ui/webview/relatedNotesDebugHtml';
import { renderMarkdown } from '../ui/webview/rendering';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { getTagOverviewHtml } from '../ui/webview/tagOverviewHtml';
import { deckardThemes, getDeckardThemeCss } from '../ui/webview/themes';

function assertWebviewScriptParses(html: string): void {
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
}

suite('Webview contracts', () => {
  test('distinguishes selected, parent, and child tag context in diagnostics', () => {
    const html = getRelatedNotesDebugHtml(
      { cspSource: 'test-csp' },
      {
        filePath: 'notes/current.md',
        sourceLine: 2,
        title: 'Selected',
        tags: [
          {
            key: '#selected',
            weight: 1,
            context: 'selected',
            source: 'Written on the selected entry',
          },
          {
            key: '#parent/context',
            weight: 0.5,
            context: 'parent',
            source: 'Parent ancestry: one level up (0.5 / 1)',
          },
          {
            key: '#child/context',
            weight: 0.25,
            context: 'child',
            source: 'Child heading: 2 levels down (0.5 / 2)',
          },
          {
            key: '#child/item',
            weight: 0.25,
            context: 'childItem',
            source: 'Child item: 2 levels down (0.5 / 2)',
          },
        ],
        snapshot: {
          activeTags: [],
          notes: [],
          tagOverviewFilters: [],
          tagTitleDisplayMode: 'inline',
          state: 'noMatches',
        },
      },
    );

    assert.strictEqual(html.includes('>Context</th>'), true);
    assert.strictEqual(html.includes('Selected entry'), true);
    assert.strictEqual(html.includes('Parent ancestry'), true);
    assert.strictEqual(html.includes('Child heading'), true);
    assert.strictEqual(html.includes('Child item'), true);
    assert.strictEqual(html.includes('How to read this page'), true);
    assert.strictEqual(html.includes('Source unit'), true);
    assert.strictEqual(html.includes('Raw evidence'), true);
    assert.strictEqual(html.includes('Normalized relevance'), true);
    assert.strictEqual(html.includes('BM25 lexical similarity'), true);
    assert.strictEqual(html.includes('Shared source units'), true);
    assert.strictEqual(html.includes('Tag appearances'), true);
    assert.strictEqual(html.includes('Raw connection'), true);
    assert.strictEqual(html.includes('Adjusted connection'), true);
    assert.strictEqual(html.includes('Text match (BM25)'), true);
    assert.strictEqual(
      html.includes('parent and child headings provide context'),
      true,
    );
    assert.strictEqual(html.includes('child items start at two levels'), true);
  });

  test('accepts valid dashboard messages and rejects malformed payloads', () => {
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTaskFilter', filter: 'active' }),
      {
        type: 'setTaskFilter',
        filter: 'active',
      },
    );
    assert.strictEqual(
      parseDashboardMessage({
        type: 'toggleTask',
        taskId: 'task-1',
        completed: 'yes',
      }),
      undefined,
    );
    assert.strictEqual(
      parseDashboardMessage({
        type: 'openSource',
        filePath: 'notes/a.md',
        line: 0,
      }),
      undefined,
    );
    assert.strictEqual(parseDashboardMessage({ type: 'unknown' }), undefined);
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTagSort', mode: 'custom' }),
      { type: 'setTagSort', mode: 'custom' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTaskTags', tagKeys: ['work'] }),
      { type: 'setTaskTags', tagKeys: ['work'] },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setNoteTags', tagKeys: ['work'] }),
      { type: 'setNoteTags', tagKeys: ['work'] },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'renameTag', tagKey: '#project/atlas' }),
      { type: 'renameTag', tagKey: '#project/atlas' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'openSavedFilter',
        filterId: 'atlas-follow-up',
      }),
      { type: 'openSavedFilter', filterId: 'atlas-follow-up' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'removeSavedFilter',
        filterId: 'atlas-follow-up',
      }),
      { type: 'removeSavedFilter', filterId: 'atlas-follow-up' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'openSavedFilter', filterId: '' }),
      undefined,
    );
    assert.strictEqual(
      parseDashboardMessage({
        type: 'openSavedFilter',
        filterId: 'atlas-follow-up',
        tagKeys: ['#untrusted'],
      }),
      undefined,
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'renameTag', tagKey: '' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTaskSort', mode: 'updated' }),
      { type: 'setTaskSort', mode: 'updated' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setNoteSort', mode: 'access' }),
      { type: 'setNoteSort', mode: 'access' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setRenderMode', mode: 'html' }),
      { type: 'setRenderMode', mode: 'html' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setRenderMode', mode: 'source' }),
      undefined,
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setTaskSort', mode: 'random' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'setDashboardColumns',
        section: 'tags',
        columns: 3,
      }),
      {
        type: 'setDashboardColumns',
        section: 'tags',
        columns: 3,
      },
    );
    assert.strictEqual(
      parseDashboardMessage({
        type: 'setDashboardColumns',
        section: 'tasks',
        columns: 5,
      }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'setDashboardColumns',
        section: 'notes',
        columns: 2,
      }),
      {
        type: 'setDashboardColumns',
        section: 'notes',
        columns: 2,
      },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'setDashboardMode',
        mode: 'notes',
      }),
      { type: 'setDashboardMode', mode: 'notes' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'setDashboardSearch',
        field: 'notes',
        query: 'atlas',
      }),
      { type: 'setDashboardSearch', field: 'notes', query: 'atlas' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'reorderTags',
        tagKeys: ['work'],
        tagKey: 'work',
        isFavorite: false,
      }),
      {
        type: 'reorderTags',
        tagKeys: ['work'],
        tagKey: 'work',
        isFavorite: false,
      },
    );
  });

  test('accepts only supported tag overview messages', () => {
    assert.deepStrictEqual(
      parseTagOverviewMessage({ type: 'setRenderMode', mode: 'html' }),
      {
        type: 'setRenderMode',
        mode: 'html',
      },
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({ type: 'saveTagOverviewFilter' }),
      { type: 'saveTagOverviewFilter' },
    );
    assert.strictEqual(
      parseTagOverviewMessage({
        type: 'saveTagOverviewFilter',
        tagKeys: ['#untrusted', '#browser-data'],
      }),
      undefined,
    );
    assert.strictEqual(
      parseTagOverviewMessage({ type: 'setRenderMode', mode: 'unsafe' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({
        type: 'toggleTask',
        taskId: 'task-1',
        completed: true,
      }),
      {
        type: 'toggleTask',
        taskId: 'task-1',
        completed: true,
      },
    );
    assert.strictEqual(
      parseTagOverviewMessage({
        type: 'toggleTask',
        taskId: 'task-1',
        completed: 'yes',
      }),
      undefined,
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({ type: 'setTaskFilter', filter: 'active' }),
      { type: 'setTaskFilter', filter: 'active' },
    );
    assert.strictEqual(
      parseTagOverviewMessage({ type: 'setTaskFilter', filter: 'random' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({ type: 'openTag', tagKey: 'other' }),
      { type: 'openTag', tagKey: 'other' },
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({
        type: 'openTag',
        tagKey: '#child',
        filterTagKey: '#parent',
      }),
      { type: 'openTag', tagKey: '#child', filterTagKey: '#parent' },
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', '#second'],
      }),
      {
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', '#second'],
      },
    );
    assert.strictEqual(
      parseTagOverviewMessage({
        type: 'openTag',
        tagKey: '#child',
        filterTagKey: 42,
      }),
      undefined,
    );
    assert.strictEqual(
      parseTagOverviewMessage({
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', 42],
      }),
      undefined,
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({
        type: 'renameTag',
        tagKey: '#child',
      }),
      { type: 'renameTag', tagKey: '#child' },
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({
        type: 'setTagOverviewSort',
        mode: 'access',
      }),
      { type: 'setTagOverviewSort', mode: 'access' },
    );
    assert.strictEqual(
      parseTagOverviewMessage({
        type: 'setTagOverviewSort',
        mode: 'random',
      }),
      undefined,
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({
        type: 'setTagOverviewLayout',
        layout: 'split',
      }),
      { type: 'setTagOverviewLayout', layout: 'split' },
    );
    assert.strictEqual(
      parseTagOverviewMessage({
        type: 'setTagOverviewLayout',
        layout: 'stacked',
      }),
      undefined,
    );
  });

  test('renders safe Markdown without executable HTML or unsafe links', () => {
    const rendered = renderMarkdown(
      '[bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n**safe**',
    );

    assert.strictEqual(rendered.includes('<script'), false);
    assert.strictEqual(rendered.includes('href="javascript:'), false);
    assert.strictEqual(rendered.includes('<strong>safe</strong>'), true);
  });

  test('renders accessible Tasks and Tags dashboard modes with focused controls', () => {
    const html = getDashboardHtml(
      {
        cspSource: 'vscode-webview://deckard',
        asWebviewUri: (resource) => resource,
      },
      vscode.Uri.file('/deckard'),
    );

    assert.strictEqual(html.includes('img-src vscode-webview://deckard;'), true);
    assert.strictEqual(html.includes('favorite-heart-outline.svg'), true);
    assert.strictEqual(html.includes('favorite-heart-filled.svg'), true);
    assert.strictEqual(html.includes('class="favorite-heart"'), true);
    assert.strictEqual(
      html.includes(
        'input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }',
      ),
      true,
    );
    assert.strictEqual(html.includes('padding: 10px; cursor: pointer;'), true);
    assert.strictEqual(
      html.includes('.task-row:hover { border-color: var(--amber-bright); }'),
      true,
    );
    assert.strictEqual(
      html.includes('.task-row.is-draggable { cursor: grab;'),
      true,
    );
    assert.strictEqual(
      html.includes('.entity-row:hover { border-color: var(--amber-bright); }'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.saved-filter-row:hover { border-color: var(--amber-bright); background: var(--panel-raised); transform: translateX(3px); }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '<div class="task-filter-toggle" role="group" aria-label="Task completion filter">',
      ),
      true,
    );
    assert.strictEqual(html.includes('class="task-filter-icon"'), true);
    assert.strictEqual(
      html.includes('function renderTaskTitle(renderedTitle, references)'),
      true,
    );
    assert.strictEqual(
      html.includes('function renderTagLabel(label)'),
      true,
    );
    assert.strictEqual(
      html.includes('.tag-namespace { opacity: .62; }'),
      true,
    );
    assert.strictEqual(
      html.includes('class="tag-namespace"'),
      true,
    );
    assert.strictEqual(
      html.includes('class="tag-value"'),
      true,
    );
    assertWebviewScriptParses(html);
    assert.strictEqual(
      html.includes('renderTaskTitle(item.renderedTitle, item.titleTags)'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.task-title .inline-tag { color: var(--text); font: inherit; text-transform: none; }',
      ),
      true,
    );
    assert.strictEqual(html.includes("const taskCounts = {"), true);
    assert.strictEqual(
      html.includes(
        'all: normalizedTaskSearchQuery ? filteredTasks.length : state.totalTaskCount,',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        'completed: normalizedTaskSearchQuery',
      ),
      true,
    );
    assert.strictEqual(html.includes("'<span>' + label + '</span>"), true);
    assert.strictEqual(html.includes('Sort:<span class="control-icon">'), true);
    assert.strictEqual(html.includes('class="toolbar-controls"'), true);
    assert.strictEqual(html.includes('class="browse-toolbar-controls"'), true);
    assert.strictEqual(html.includes('data-action="search-tasks"'), true);
    assert.strictEqual(html.includes('aria-label="Search tasks"'), true);
    assert.strictEqual(html.includes('class="task-search" type="search"'), true);
    assert.strictEqual(html.includes('class="note-search" type="search"'), true);
    assert.strictEqual(html.includes('class="catalog-search" type="search"'), true);
    assert.strictEqual(html.includes('<h1>Dashboard: '), true);
    assert.strictEqual(html.includes('class="dashboard-header-actions"'), true);
    assert.strictEqual(
      html.indexOf('class="metrics"') <
        html.indexOf('class="dashboard-view-options"'),
      true,
    );
    assert.strictEqual(html.includes('class="toolbar-icon settings-icon"'), true);
    assert.strictEqual(html.includes('class="dashboard-view-options"'), true);
    assert.strictEqual(
      html.includes(
        '.dashboard-view-options summary { display: grid; width: 30px; min-height: 30px; place-items: center; border: 2px solid var(--slate-border);',
      ),
      true,
    );
    assert.strictEqual(html.includes('data-action="set-columns"'), true);
    assert.strictEqual(html.includes('Task columns'), true);
    assert.strictEqual(html.includes('Note columns'), true);
    assert.strictEqual(html.includes('Tag columns'), true);
    assert.strictEqual(html.includes('saveDashboardViewState()'), true);
    assert.strictEqual(html.includes('taskColumns: taskColumns'), true);
    assert.strictEqual(html.includes('tagColumns: tagColumns'), true);
    assert.strictEqual(
      html.includes("grid.style.gridTemplateColumns = 'repeat(' + columns + ', 1fr)'"),
      true,
    );
    assert.strictEqual(
      html.includes("applyDashboardColumns('tasks', selectedTaskColumns)"),
      true,
    );
    assert.strictEqual(html.includes('style="grid-template-columns: repeat('), true);
    assert.strictEqual(html.includes('Search:<input class="task-search"'), false);
    assert.strictEqual(html.includes('.catalog-search, .task-search, .note-search { width: min(220px, 40vw); border-color: var(--cyan-bright); }'), true);
    assert.strictEqual(html.includes('.tag-list, .task-list, .note-list { display: grid; grid-template-columns: repeat(var(--dashboard-columns, 1), 1fr); gap: 7px; }'), true);
    assert.strictEqual(html.includes('placeholder="Search tags" aria-label="Search tags"'), true);
    assert.strictEqual(html.includes('state.tags.filter(function (tag)'), true);
    assert.strictEqual(html.includes('function formatTagDisplay(tag)'), true);
    assert.strictEqual(html.includes('const display = formatTagDisplay(tag);'), true);
    assert.strictEqual(html.includes("escapeHtml(display.name)"), true);
    assert.strictEqual(
      html.includes("display.namespace ? '<span class=\"entity-kind\">'"),
      true,
    );
    assert.strictEqual(html.includes('data-browse-scope='), false);
    assert.strictEqual(
      html.includes('data-tag-group="favorites"><h3>Favorites <span class="tag-count">('),
      true,
    );
    assert.strictEqual(
      html.includes('data-tag-group="other"><h3>Other tags <span class="tag-count">('),
      true,
    );
    assert.strictEqual(html.includes('class="section-summary"'), false);
    assert.strictEqual(html.includes('.tag-group { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px dashed var(--slate-border); }'), true);
    assert.strictEqual(
      html.includes(
        '.dashboard-tabs-row { padding-bottom: 8px; border-bottom: 2px solid var(--slate-border); }',
      ),
      true,
    );
    assert.strictEqual(html.includes('<div class="dashboard-tabs-row"><div class="dashboard-tabs"'), true);
    assert.strictEqual(html.includes('.dashboard-tabs { display: inline-flex; margin-top: 18px; }'), true);
    assert.strictEqual(
      html.includes('.dashboard-tabs button[aria-selected="true"] { position: relative; z-index: 1; color: var(--panel-deep); background: var(--amber-bright); }'),
      true,
    );
    assert.strictEqual(html.includes('<span class="control-label">Tags:</span>'), true);
    assert.strictEqual(html.includes('class="selected-task-tag"'), true);
    assert.strictEqual(html.includes('data-action="remove-task-tag"'), true);
    assert.strictEqual(html.includes('Clear filters'), true);
    assert.strictEqual(html.includes('class="rename-tag"'), false);
    assert.strictEqual(
      html.includes('data-context-action="rename-tag"'),
      true,
    );
    assert.strictEqual(html.includes('openRankContextMenu(event, row)'), true);
    assert.strictEqual(
      html.includes(
        '.tag-filter summary { position: relative; display: flex; align-items: center; min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px 9px 5px 29px; cursor: pointer; list-style: none; font: 11px var(--font-mono); font-weight: 700; text-transform: uppercase; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes('input.tag-filter-search { padding: 5px 7px 5px 29px; }'),
      true,
    );
    assert.strictEqual(html.includes('class="tag-open"'), true);
    assert.strictEqual(
      html.includes("const entityRow = event.target.closest('.entity-row');"),
      true,
    );
    assert.strictEqual(html.includes('const filteredTags = state.tags.filter'), true);
    assert.strictEqual(html.includes('data-action="search-browse"'), true);
    assert.strictEqual(html.includes('aria-label="Tag scope"'), false);
    assert.strictEqual(html.includes('data-action="favorite-tag"'), true);
    assert.strictEqual(html.includes('Saved tag views'), true);
    assert.strictEqual(
      html.indexOf('Saved tag views') <
        html.indexOf('role="tablist" aria-label="Dashboard mode"'),
      true,
    );
    assert.strictEqual(html.includes('data-action="remove-saved-filter"'), true);
    assert.strictEqual(html.includes("type: 'openSavedFilter'"), true);
    assert.strictEqual(html.includes('role="tablist" aria-label="Dashboard mode"'), true);
    assert.strictEqual(html.includes('role="tab" data-action="set-dashboard-mode"'), true);
    assert.strictEqual(html.includes('aria-controls="tasks-panel"'), true);
    assert.strictEqual(html.includes('aria-controls="notes-panel"'), true);
    assert.strictEqual(html.includes('aria-controls="browse-panel"'), true);
    assert.strictEqual(html.includes('id="notes-panel"'), true);
    assert.strictEqual(html.includes('data-action="set-note-sort"'), true);
    assert.strictEqual(html.includes('data-action="set-note-tag"'), true);
    assert.strictEqual(html.includes('data-action="filter-note-tags"'), true);
    assert.strictEqual(html.includes('data-action="search-notes"'), true);
    assert.strictEqual(html.includes('const noteSearchDebounceDelay = 350;'), true);
    assert.strictEqual(html.includes('const tagSearchDebounceDelay = 180;'), true);
    assert.strictEqual(html.includes('clearTimeout(noteSearchTimer)'), true);
    assert.strictEqual(html.includes('noteSearchTimer = setTimeout'), true);
    assert.strictEqual(html.includes('pendingNoteSearchQuery'), true);
    assert.strictEqual(html.includes('function scheduleTagFilterSearch(kind)'), true);
    assert.strictEqual(html.includes('taskTagSearchTimer'), true);
    assert.strictEqual(html.includes('noteTagSearchTimer'), true);
    assert.strictEqual(html.includes('pendingTaskTagQuery'), true);
    assert.strictEqual(html.includes('pendingNoteTagQuery'), true);
    assert.strictEqual(
      html.includes("focusedSearchAction === 'search-notes'"),
      true,
    );
    assert.strictEqual(
      html.includes("focusedSearchAction === 'filter-task-tags'"),
      true,
    );
    assert.strictEqual(
      html.includes("focusedSearchAction === 'filter-note-tags'"),
      true,
    );
    assert.strictEqual(html.includes('class="card note-row"'), true);
    assert.strictEqual(html.includes('class="markdown"'), true);
    assert.strictEqual(html.includes('class="rendered"'), true);
    assert.strictEqual(html.includes('data-action="set-mode"'), true);
    assert.strictEqual(html.includes('aria-label="Source view"'), true);
    assert.strictEqual(html.includes('aria-label="Rendered view"'), true);
    assert.strictEqual(html.includes('Content format'), true);
    assert.strictEqual(html.includes('data-mode="markdown"'), true);
    assert.strictEqual(html.includes('data-mode="html"'), true);
    assert.strictEqual(html.includes("state.renderMode === 'html'"), true);
    assert.strictEqual(html.includes("'<div class=\"rendered\">'"), true);
    assert.strictEqual(html.includes('role="tabpanel"'), true);
    assert.strictEqual(html.includes("vscode.getState()"), true);
    assert.strictEqual(
      html.includes("type: 'setDashboardColumns'"),
      true,
    );
    assert.strictEqual(
      html.includes('taskColumns = incomingState.taskColumns ?? taskColumns ?? 1;'),
      true,
    );
    assert.strictEqual(
      html.includes('noteColumns = incomingState.noteColumns ?? noteColumns ?? 1;'),
      true,
    );
    assert.strictEqual(
      html.includes('incomingState.tagColumns = tagColumns;'),
      true,
    );
    assert.strictEqual(html.includes("type: 'setDashboardMode'"), true);
    assert.strictEqual(html.includes("type: 'setDashboardSearch'"), true);
    assert.strictEqual(html.includes('bindDashboardColumnControls()'), true);
    assert.strictEqual(
      html.includes("event.stopPropagation();"),
      true,
    );
    assert.strictEqual(html.includes("event.key === 'ArrowLeft'"), true);
  });

  test('defines theme overrides for each selectable webview theme', () => {
    assert.deepStrictEqual(deckardThemes, [
      'replicant',
      'oblivion',
      'lcars',
      'synthwave',
      'tomcat',
      'fellowship',
    ]);
    assert.strictEqual(
      getDeckardThemeCss('replicant').includes(
        '.entity-row:hover, .tag-row:hover, .tag-open:hover, .note .tag-list button:hover, .card:hover, .note:hover, .task:hover, .task-row:hover',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('replicant').includes(
        '.note:hover, .note-row:hover { border-color: var(--amber); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('replicant').includes(
        '.inline-tag, .inline-tag:hover, .inline-tag:focus-visible { transform: none; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('replicant').includes(
        '.card .tag-open, .note-row .tag-open { color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('oblivion').includes('#70e1dc'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('oblivion').includes(
        '.entity-row:hover, .tag-row:hover, .tag-open:hover, .note .tag-list button:hover, .card:hover, .note:hover, .task:hover, .task-row:hover',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('oblivion').includes(
        '.card .tag-open, .note-row .tag-open { color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(getDeckardThemeCss('lcars').includes('#211b25'), true);
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes('border-radius: 0 15px 15px 0'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        'border-left: 7px solid var(--amber)',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes('background: var(--favorite-red)'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes('.metrics { gap: 0; }'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.dashboard-tabs-row { border-bottom-color: var(--line-strong); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.overview-tabs-row { border-bottom-color: var(--line-strong); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.metric::before { border-bottom-color: var(--amber); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.metric:nth-child(3n + 2)::before { border-bottom-color: var(--cyan); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.note .tag-list button { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.active-file .tag-list button { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.inline-tag, .note-title .inline-tag, .task-title .inline-tag { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.saved-filter-remove.saved-filter-remove, .task-filter-toggle .filter-count { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.active-name .active-filter-tag { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.sidebar-relationships { border: 0; border-left: 7px solid var(--amber); border-radius: 0;',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.sidebar-relationship-items { margin: 0 8px 5px; border-left: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.favorite-toggle { background: var(--cyan); color: #7a1f1f; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.favorite-toggle .favorite-heart { color: #7a1f1f; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.task-row .task-title, .task .task-title, .note-row .card-title { color: var(--cyan); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-title { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); } .task-row .task-title a, .task .task-title a { color: inherit; } .task-row .task-meta, .task .source, .note-row .source { color: var(--muted); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-meta { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.note-row { border: 0; border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); clip-path: none; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.overview-tabs { gap: 0; } .overview-tabs button { border-radius: 0; } .overview-tabs button:first-child { border-radius: 15px 0 0 0; } .overview-tabs button:last-child { border-radius: 0 0 15px 0; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        'section[aria-labelledby="tags-heading"] .control-row { gap: 2px; } section[aria-labelledby="tags-heading"] .control-row .control-icon select { border-radius: 0; } section[aria-labelledby="tags-heading"] .control-row .control-icon:first-child select { border-radius: 15px 0 0 0; } section[aria-labelledby="tags-heading"] .control-row .control-icon:last-child select { border-radius: 0 0 15px 0; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.tag-filter summary, .tag-filter-search { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; } .tag-filter-search::placeholder { color: #050505; opacity: 1; } .tag-filter summary .control-icon-svg, .tag-filter-search-control .control-icon-svg, .tag-filter-clear { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        'input.tag-filter-search { border-color: var(--panel-deep); background: var(--cyan); color: #050505; } input.tag-filter-search::placeholder { color: #050505; opacity: 1; } input.tag-filter-search:focus { border-color: var(--panel-deep); background: var(--amber); color: #050505; } .selected-task-tag { background: var(--cyan); color: #050505; } .selected-task-tag::after { color: #050505; } button.clear-task-filters { border-color: var(--panel-deep); background: var(--cyan); color: #050505; } button.clear-task-filters:hover, button.clear-task-filters:focus-visible { border-color: var(--panel-deep); background: var(--amber); color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.overview-search, .catalog-search, .task-search, .note-search { border: 2px solid var(--cyan-bright); border-radius: 0 15px 15px 0; background: var(--panel); box-shadow: inset 0 0 0 1px var(--cyan-bright); color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.dashboard-tabs button { border-radius: 0; } .dashboard-tabs button:first-child { border-radius: 15px 0 0 0; } .dashboard-tabs button:last-child { border-radius: 0 0 15px 0; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.save-filter.save-filter { border-color: var(--panel-deep); color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.task-filter-toggle button { border-radius: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.dashboard-column-options button, .dashboard-column-options button:first-child, .dashboard-column-options button:last-child { border-radius: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes('.sidebar-toolbar { gap: 0; }'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.sidebar-toolbar .icon-button:last-child { border-radius: 0 15px 15px 0; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.control-icon select:hover + .control-icon-svg, .related-notes-sort-icon { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('synthwave').includes('--bg-dark: #090713'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('synthwave').includes('repeating-linear-gradient'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('synthwave').includes(
        'background: var(--cyan); color: var(--bg-dark);',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('synthwave').includes(
        '.favorite-toggle.favorite { border-color: var(--favorite-red); background: var(--favorite-red); color: var(--bg-dark); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('tomcat').includes('--bg-dark: #010401'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('tomcat').includes('repeating-linear-gradient'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('tomcat').includes('inset 0 0 0 1px'),
      false,
    );
    assert.strictEqual(
      getDeckardThemeCss('tomcat').includes(
        'box-shadow: inset 2px 0 0 var(--green)',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('tomcat').includes(
        '.favorite-toggle { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('fellowship').includes('--bg-dark: #d6cda9'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('fellowship').includes(
        "--font-display: Georgia, 'Times New Roman', serif",
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('fellowship').includes(
        'body { background-image: none; }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('fellowship').includes('gradient'),
      false,
    );
    assert.strictEqual(
      getDeckardThemeCss('fellowship').includes('border-radius: 5px'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('fellowship').includes('inset 0 0 0 1px'),
      false,
    );
    assert.strictEqual(
      getDeckardThemeCss('tomcat').includes(
        '.favorite-toggle.favorite { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }',
      ),
      true,
    );
  });

  test('renders the Dashboard with a centered maximum width and no outer frame', () => {
    const html = getDashboardHtml(
      {
        cspSource: 'vscode-webview://deckard',
        asWebviewUri: (resource) => resource,
      },
      vscode.Uri.file('/deckard'),
    );

    assert.strictEqual(
      html.includes(
        'main { position: relative; width: 100%; max-width: 1180px; margin: 0 auto; padding: 24px; border: 0; }',
      ),
      true,
    );
  });

  test('renders Tag Overview tabs and side-by-side layouts', () => {
    const html = getTagOverviewHtml({
      cspSource: 'vscode-webview://deckard',
    });

    assertWebviewScriptParses(html);
    assert.strictEqual(
      html.includes('grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);'),
      true,
    );
    assert.strictEqual(
      html.includes('<select data-action="set-layout"'),
      false,
    );
    assert.strictEqual(
      html.includes('data-action="set-layout" data-layout="tabs"'),
      true,
    );
    assert.strictEqual(
      html.includes('data-action="set-layout" data-layout="split"'),
      true,
    );
    assert.strictEqual(
      html.includes('title="Tabs: switch between Notes and Tasks"'),
      true,
    );
    assert.strictEqual(
      html.includes('title="Side by side: Notes 60%, Tasks 40%"'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '<div class="toolbar-toggle-group layout-toggle-group" role="group" aria-label="Content layout">',
      ),
      true,
    );
    assert.strictEqual(
      html.includes('.layout-toggle-group .toolbar-toggle { border-width: 1px; }'),
      true,
    );
    assert.strictEqual(
      html.includes('.layout-toggle-group .toolbar-toggle + .toolbar-toggle { margin-left: -1px; }'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.inline-tag { min-height: 24px; margin-left: 3px; padding: 2px 4px; font-size: .78em; vertical-align: 1px; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes("state.tagTitleDisplayMode === 'separate'"),
      true,
    );
    assert.strictEqual(
      html.includes('function renderInlineTitle(title, tags, appendMissing)'),
      true,
    );
    assert.strictEqual(
      html.includes('function renderTagLabel(label, svg)'),
      true,
    );
    assert.strictEqual(
      html.includes('<tspan class="tag-namespace">'),
      true,
    );
    assert.strictEqual(
      html.includes('<span class="tag-namespace">'),
      true,
    );
    assert.strictEqual(
      html.includes('<span class="tag-value">'),
      true,
    );
    assert.strictEqual(
      html.includes('function renderTaskTitle(renderedTitle, references)'),
      true,
    );
    assert.strictEqual(
      html.includes('renderTaskTitle(item.renderedTitle, item.titleTags)'),
      true,
    );
    assert.strictEqual(html.includes('class="tag-open inline-tag"'), true);
    assert.strictEqual(
      html.includes('.overview-tabs button.active { border-bottom-color:'),
      false,
    );
    assert.strictEqual(
      html.includes('data-action="set-mode" data-mode="markdown"'),
      true,
    );
    assert.strictEqual(
      html.includes('data-action="set-mode" data-mode="html"'),
      true,
    );
    assert.strictEqual(html.includes('function formatEntityTitle(kind, name)'), true);
    assert.strictEqual(
      html.includes("formatEntityTitle(state.entity.kind, state.entity.name)"),
      true,
    );
    assert.strictEqual(html.includes("const relationships = '';"), true);
    assert.strictEqual(
      html.includes('title="Source: show the original Markdown"'),
      true,
    );
    assert.strictEqual(
      html.includes('title="Rendered: show formatted Markdown"'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '<div class="toolbar-toggle-group" role="group" aria-label="Content format">',
      ),
      true,
    );
    assert.strictEqual(html.includes('>Source</button>'), false);
    assert.strictEqual(html.includes('>Rendered</button>'), false);
    assert.strictEqual(html.includes('data-action="set-tab"'), true);
    assert.strictEqual(
      html.includes('.overview-tabs { display: inline-flex; gap: 0;'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.overview-tabs-row { margin-top: 20px; padding-bottom: 8px; border-bottom: 2px solid var(--line); }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes('<div class="overview-tabs-row"><div class="overview-tabs"'),
      true,
    );
    assert.strictEqual(
      html.includes('.overview-tabs button + button { margin-left: -2px; }'),
      true,
    );
    assert.strictEqual(
      html.includes('.overview-tabs button.active { position: relative; z-index: 1; }'),
      true,
    );
    assert.strictEqual(html.includes('data-action="search-notes"'), true);
    assert.strictEqual(html.includes('data-action="search-tasks"'), true);
    assert.strictEqual(html.includes('aria-label="Search current notes"'), true);
    assert.strictEqual(html.includes('aria-label="Search current tasks"'), true);
    assert.strictEqual(html.includes('function filterOverviewEntries(kind, query, total)'), true);
    assert.strictEqual(
      html.includes('.card[hidden], .task[hidden] { display: none; }'),
      true,
    );
    assert.strictEqual(html.includes('function updateTaskFilterCounts(query)'), true);
    assert.strictEqual(
      html.includes('if (kind === \'tasks\') updateTaskFilterCounts(normalizedQuery);'),
      true,
    );
    assert.strictEqual(
      html.includes('counts[entry.classList.contains(\'completed\') ? \'completed\' : \'active\'] += 1;'),
      true,
    );
    assert.strictEqual(html.includes('data-search-entry="notes"'), true);
    assert.strictEqual(html.includes('data-search-entry="tasks"'), true);
    assert.strictEqual(html.includes('Search:<input class="overview-search"'), false);
    assert.strictEqual(html.includes('.overview-search { width: min(250px, 44vw); border-color: var(--line-strong); }'), true);
    assert.strictEqual(
      html.includes("filter === 'all' ? 'All' : filter === 'active' ? 'Open' : 'Done'"),
      true,
    );
    assert.strictEqual(html.includes('class="view-options"'), true);
    assert.strictEqual(
      html.includes(
        'header > .toolbar .view-options { position: absolute; top: 0; right: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        'header > .toolbar { width: 100%; padding-right: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        'input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes('<summary aria-label="View options" title="View options">'),
      true,
    );
    assert.strictEqual(
      html.includes("viewOptions && viewOptions.open && !event.target.closest('.view-options')"),
      true,
    );
    assert.strictEqual(
      html.includes("viewOptions.querySelector('summary').focus()"),
      true,
    );
    assert.strictEqual(
      html.includes('.toolbar { display: flex; justify-content: flex-end;'),
      true,
    );
    assert.strictEqual(html.includes('note entries'), false);
    assert.strictEqual(html.includes('data-action="save-filter"'), true);
    assert.strictEqual(
      html.includes('aria-label="Save this combined tag filter"'),
      true,
    );
    assert.strictEqual(html.includes("type: 'saveTagOverviewFilter'"), true);
    assert.strictEqual(html.includes('data-action="toggle-task"'), true);
    assert.strictEqual(
      html.includes('function renderRelationshipTree(associations, rootTag)'),
      true,
    );
    assert.strictEqual(
      html.includes('function renderRelationshipGraph(associations, rootTag)'),
      true,
    );
    assert.strictEqual(html.includes('Tag associations'), true);
    assert.strictEqual(html.includes('<span>Associated tags</span>'), true);
    assert.strictEqual(html.includes('Open associated tag'), true);
    assert.strictEqual(html.includes('data-action="set-relationship-view"'), true);
    assert.strictEqual(html.includes('data-view="tree"'), true);
    assert.strictEqual(html.includes('data-view="graph"'), true);
    assert.strictEqual(html.includes('class="relationship-tree-group"'), true);
    assert.strictEqual(html.includes('class="relationship-node"'), true);
    assert.strictEqual(html.includes('data-filter-tag-key'), true);
    assert.strictEqual(html.includes('const filterTags = state.filterTags'), true);
    assert.strictEqual(
      html.includes('function renderOverviewTagLink(tag, text)'),
      true,
    );
    assert.strictEqual(
      html.includes('renderTagLabel(tag.label)'),
      true,
    );
    assert.strictEqual(
      html.includes('function renderTagControl(tag, content, extraClass)'),
      false,
    );
    assert.strictEqual(html.includes('data-context-action="rename-tag"'), true);
    assert.strictEqual(
      html.includes('function openTagContextMenu(event, target)'),
      true,
    );
    assert.strictEqual(
      html.includes("document.addEventListener('contextmenu'"),
      true,
    );
    assert.strictEqual(html.includes("type: 'renameTag'"), true);
    assert.strictEqual(
      html.includes('class="overview-tag-link" data-action="open-tag"'),
      true,
    );
    assert.strictEqual(html.includes('class="overview-filter-tag"'), true);
    assert.strictEqual(html.includes('class="overview-title-joiner"> AND </span>'), true);
    assert.strictEqual(html.includes('class="saved-view-name"'), true);
    assert.strictEqual(html.includes('state.savedViewName'), true);
    assert.strictEqual(html.includes('escapeHtml(state.savedViewName)'), true);
    assert.strictEqual(html.includes("state.tag.label + ' Overview'"), false);
    assert.strictEqual(html.includes('<h1 aria-label="'), true);
    assert.strictEqual(html.includes('escapeHtml(titleAriaLabel)'), true);
    assert.strictEqual(
      html.includes(
        "filterTags.map(function (tag) { return renderOverviewTagLink(tag, tag.label); }).join(' · ')",
      ),
      true,
    );
    assert.strictEqual(
      html.includes('.overview-title-joiner { color: var(--amber);'),
      true,
    );
    assert.strictEqual(html.includes('function renderFilteredOverviewTag'), true);
    assert.strictEqual(html.includes('class="title-filter-remove"'), true);
    assert.strictEqual(html.includes('nextFilterTagKeys'), true);
    assert.strictEqual(html.includes('data-filter-tag-keys'), true);
    assert.strictEqual(html.includes('filter-context'), false);
    assert.strictEqual(html.includes('Clear relationship filter'), false);
    assert.strictEqual(html.includes('Clear filter'), false);
    assert.strictEqual(html.includes('class="relationship-count"'), true);
    assert.strictEqual(
      html.includes(
        '.tag-open.relationship-tag:hover, .tag-open.relationship-tag:focus-visible { color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(html.includes('.relationship-workspace { margin-top: 16px; overflow: hidden;'), true);
    assert.strictEqual(
      html.includes(
        '.relationship-tree-root .tag-open.relationship-tag, .relationship-tree-item .tag-open.relationship-tag',
      ),
      true,
    );
    assert.strictEqual(html.includes("type: 'toggleTask'"), true);
    assert.strictEqual(html.includes('data-action="set-task-filter"'), true);
    assert.strictEqual(
      html.includes(
        '<div class="task-filter-toggle" role="group" aria-label="Task status filter">',
      ),
      true,
    );
    assert.strictEqual(html.includes('class="task-filter-icon"'), true);
    assert.strictEqual(html.includes("'Open' : 'Done'"), true);
    assert.strictEqual(
      html.includes(
        '.task.completed .task-title { color: var(--muted); text-decoration: line-through; }',
      ),
      true,
    );
  });

  test('renders formatted related-note relevance explanations', () => {
    const html = getSidebarNotesHtml(
      { cspSource: 'vscode-webview://deckard' },
      '1.0.0',
    );

    assertWebviewScriptParses(html);
    assert.strictEqual(html.includes('<p class="eyebrow">DECKARD</p>'), true);
    assert.strictEqual(html.includes('<span class="version">v1.0.0</span>'), true);
    assert.strictEqual(html.includes('DECKARD / RELATED NOTES'), false);
    assert.strictEqual(html.includes('class="reason"'), false);
    assert.strictEqual(html.includes('note.reasons'), true);
    assert.strictEqual(html.includes('const relevanceReasons = note.reasons'), true);
    assert.strictEqual(
      html.includes('class="relevance-tooltip" role="tooltip"'),
      true,
    );
    assert.strictEqual(html.includes('Association weight'), true);
    assert.strictEqual(html.includes('Specificity adjustment'), true);
    assert.strictEqual(
      html.includes('.note:hover, .note:focus-within { z-index: 20;'),
      true,
    );
    assert.strictEqual(
      html.includes('.note-title .inline-tag { color: var(--text); }'),
      true,
    );
    assert.strictEqual(
      html.includes('.active-filter-tag { color: var(--text); font-weight: 700; }'),
      true,
    );
    assert.strictEqual(
      html.includes('.active-file .tag-list button { color: var(--text); }'),
      true,
    );
    assert.strictEqual(
      html.includes('<span class="section-label">Related notes</span>'),
      true,
    );
    assert.strictEqual(
      html.includes('function renderTagLabel(label)'),
      true,
    );
    assert.strictEqual(
      html.includes('.tag-namespace { opacity: .62; }'),
      true,
    );
    assert.strictEqual(html.includes('.tag-weight-rail {'), true);
    assert.strictEqual(
      html.includes(
        '.tag-weight-rail-segment { display: block; width: 4px; height: 3px; border-radius: 1px; background: var(--muted); opacity: .65; }',
      ),
      true,
    );
    assert.strictEqual(html.includes('function renderWeightRail(level, title)'), true);
    assert.strictEqual(html.includes('Related Notes weight'), true);
    assert.strictEqual(html.includes('tag-weight-pips'), false);
    assert.strictEqual(html.includes('tag-weight-pip'), false);
    assert.strictEqual(html.includes('tag-weight-legend'), false);
    assert.strictEqual(
      html.includes('class="tag-namespace"'),
      true,
    );
    assert.strictEqual(
      html.includes('class="tag-value"'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.inline-tag { display: inline-block; margin-left: 3px; padding: 1px 4px; border-width: 1px; color: var(--cyan); font-size: .85em; vertical-align: 1px; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.heading-path-joiner { color: var(--cyan-bright, #63F2FF); font-weight: 700; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        'note.headingPath.map(function (part) { return escapeHtml(part); }).join(\'<span class="heading-path-joiner"> &gt; </span>\')',
      ),
      true,
    );
    assert.strictEqual(html.includes("note.dailyDate ? 'Daily note '"), false);
    assert.strictEqual(html.includes('set-related-notes-sort'), true);
    assert.strictEqual(html.includes('related-notes-sort-control'), true);
    assert.strictEqual(html.includes('related-notes-sort-icon'), true);
    assert.strictEqual(
      html.includes("state.tagTitleDisplayMode === 'separate'"),
      true,
    );
    assert.strictEqual(html.includes('function renderInlineTitle(title, tags)'), true);
    assert.strictEqual(html.includes("renderTag(tag, 'inline-tag')"), true);
    assert.strictEqual(html.includes('>Relevance</option>'), true);
    assert.strictEqual(html.includes('>Newest</option>'), true);
    assert.strictEqual(html.includes('>Oldest</option>'), true);
    assert.strictEqual(html.includes('>Most accessed</option>'), true);
    assert.strictEqual(
      html.includes('function renderSidebarRelationships(snapshot)'),
      true,
    );
    assert.strictEqual(
      html.includes('class="sidebar-relationship-branch"'),
      true,
    );
    assert.strictEqual(
      html.includes('class="sidebar-relationship-namespace"'),
      false,
    );
    assert.strictEqual(html.includes('Associated tags'), true);
    assert.strictEqual(
      html.includes('function renderSidebarAssociations(relationships, overviewTagKey)'),
      true,
    );
    assert.strictEqual(html.includes('data-action="add-overview-filter"'), true);
    assert.strictEqual(html.includes('data-add-tag-key'), true);
    assert.strictEqual(html.includes('class="sidebar-add-filter"'), true);
    assert.strictEqual(html.includes('Open associated tag'), true);
    assert.strictEqual(
      html.includes('class="sidebar-association-tooltip" role="tooltip"'),
      true,
    );
    assert.strictEqual(html.includes("aria-label=\"Association strength ' + percentage + ' percent\""), true);
    assert.strictEqual(html.includes("' + percentage + '%</span>"), true);
    assert.strictEqual(html.includes('Total weight'), true);
    assert.strictEqual(
      html.includes('border-left: 2px solid var(--cyan);'),
      false,
    );
    assert.strictEqual(html.includes('class="relevance-score"'), true);
    assert.strictEqual(html.includes('const relevance = state.tagOverview'), true);
    assert.strictEqual(html.includes('note.relevanceScore'), true);
    assert.strictEqual(html.includes('data-filter-tag-key'), false);
    assert.strictEqual(html.includes('state.tagOverviewFilter'), true);
    assert.strictEqual(html.includes('active-filter-label'), false);
    assert.strictEqual(html.includes('active-filter-joiner'), true);
    assert.strictEqual(
      html.includes("renderTag(state.tagOverview, 'active-filter-tag')"),
      true,
    );
    assert.strictEqual(
      html.includes('const tagOverviewName = state.tagOverviewFilter'),
      false,
    );
    assert.strictEqual(
      html.includes('function renderTagControl(tag, content, extraClass)'),
      false,
    );
    assert.strictEqual(html.includes('data-context-action="rename-tag"'), true);
    assert.strictEqual(
      html.includes('function openTagContextMenu(event, target)'),
      true,
    );
    assert.strictEqual(
      html.includes("document.addEventListener('contextmenu'"),
      true,
    );
    assert.strictEqual(
      html.includes('const filterTagKeys = snapshot.tagOverviewFilters'),
      true,
    );
    assert.strictEqual(
      html.includes(
        "renderTag(snapshot.tagOverview, 'tag-open relationship-tag')",
      ),
      false,
    );
    assert.strictEqual(
      html.includes(
        '.sidebar-relationships .tag-open.relationship-tag:hover',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.sidebar-relationships { margin-top: 8px; overflow: visible;',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.sidebar-relationships .tag-open.relationship-tag {\n  position: relative;',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.sidebar-relationships .sidebar-relationship-branch > summary',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.sidebar-relationships .sidebar-relationship-items .tag-open.relationship-tag::before',
      ),
      false,
    );
  });

  test('renders Help navigation for quick-start and advanced sections', () => {
    const html = getHelpHtml(
      {
        cspSource: 'vscode-webview://deckard',
        asWebviewUri: (resource) => resource,
      },
      vscode.Uri.file('/deckard'),
    );

    assert.strictEqual(html.includes('href="#quick-start"'), true);
    assert.strictEqual(html.includes('href="#commands"'), true);
    assert.strictEqual(html.includes('href="#advanced"'), true);
    assert.strictEqual(html.includes('<section id="quick-start">'), true);
    assert.strictEqual(html.includes('<section id="commands">'), true);
    assert.strictEqual(html.includes('<section id="advanced">'), true);
    assert.strictEqual(html.includes('Tag associations'), true);
    assert.strictEqual(html.includes('Associated tags'), true);
    assert.strictEqual(html.includes('.step, .card { min-width: 0;'), true);
    assert.strictEqual(html.includes('code { overflow-wrap: anywhere;'), true);
    assert.strictEqual(
      html.includes('.cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }'),
      true,
    );

    for (const command of [
      'Deckard: Open Dashboard',
      'Deckard: Show Stats',
      'Deckard: Open Help',
      'Deckard: Reindex Workspace',
      'Deckard: Create Daily Note',
      'Deckard: Extract Tagged Heading',
      'Deckard: Show Tag Overview',
      'Deckard: Search Workspace Knowledge',
      'Deckard: Link Current Heading to Entity',
      'Deckard: Move Inline Tags to Front Matter',
    ]) {
      assert.strictEqual(html.includes(command), true);
    }

    for (const setting of [
      'deckard.notesFolder',
      'deckard.dailyNoteTemplate',
      'deckard.parseInlineTags',
      'deckard.highlightNoteSections',
      'deckard.autoSelectNoteSections',
      'deckard.tagTitleDisplayMode',
      'deckard.enableHeadingTagRelationships',
      'deckard.enableTagAutocomplete',
      'deckard.enableKeywordLinks',
      'deckard.entityNamespaceAliases',
      'deckard.personMarker',
    ]) {
      assert.strictEqual(html.includes(setting), true);
    }

    assert.strictEqual(html.includes('Favorites always appear before'), true);
    assert.strictEqual(html.includes('Move to top'), true);
    assert.strictEqual(html.includes('#follow-up'), true);
    assert.strictEqual(html.includes('Saved tag views'), true);
    assert.strictEqual(html.includes('Tasks/Notes/Tags tabs'), true);
    assert.strictEqual(html.includes('Sort: Rank/Created/Updated'), true);
    assert.strictEqual(html.includes('Browse tags'), true);
    assert.strictEqual(html.includes('resources/deckard.svg'), true);
    assert.strictEqual(html.includes('favorite-heart-outline.svg'), true);
    assert.strictEqual(html.includes('favorite-heart-filled.svg'), true);
    assert.strictEqual(
      html.includes('When no Markdown editor is active'),
      false,
    );
    assert.strictEqual(html.includes('M2 2h5v5H2zm7 0h5v3H9'), true);
    assert.strictEqual(html.includes('class="favorite-heart filled"'), true);
  });

  test('accepts only valid sidebar navigation messages', () => {
    assert.deepStrictEqual(parseSidebarMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'openSource',
        filePath: 'notes/related.md',
        line: 4,
      }),
      { type: 'openSource', filePath: 'notes/related.md', line: 4 },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({ type: 'openTag', tagKey: 'work' }),
      { type: 'openTag', tagKey: 'work' },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', '#second'],
      }),
      {
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', '#second'],
      },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({ type: 'renameTag', tagKey: '#work' }),
      { type: 'renameTag', tagKey: '#work' },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'openTag',
        tagKey: '#child',
        filterTagKey: '#parent',
      }),
      { type: 'openTag', tagKey: '#child', filterTagKey: '#parent' },
    );
    assert.strictEqual(
      parseSidebarMessage({
        type: 'openTag',
        tagKey: '#child',
        filterTagKey: 42,
      }),
      undefined,
    );
    assert.deepStrictEqual(parseSidebarMessage({ type: 'openDashboard' }), {
      type: 'openDashboard',
    });
    assert.deepStrictEqual(parseSidebarMessage({ type: 'createDailyNote' }), {
      type: 'createDailyNote',
    });
    assert.deepStrictEqual(parseSidebarMessage({ type: 'openHelp' }), {
      type: 'openHelp',
    });
    assert.deepStrictEqual(
      parseSidebarMessage({ type: 'clearEntryRelatedNotes' }),
      { type: 'clearEntryRelatedNotes' },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({ type: 'setRelatedNotesSort', mode: 'access' }),
      { type: 'setRelatedNotesSort', mode: 'access' },
    );
    assert.strictEqual(
      parseSidebarMessage({ type: 'setRelatedNotesSort', mode: 'random' }),
      undefined,
    );
    assert.strictEqual(
      parseSidebarMessage({
        type: 'openSource',
        filePath: 'notes/a.md',
        line: 0,
      }),
      undefined,
    );
  });
});
