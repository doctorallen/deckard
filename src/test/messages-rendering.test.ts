import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  parseDashboardMessage,
  parseSearchPageMessage,
  parseSidebarMessage,
} from '../ui/webview/messages';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getHelpHtml } from '../ui/webview/helpHtml';
import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { getRelatedNotesDebugHtml } from '../ui/webview/relatedNotesDebugHtml';
import { renderMarkdown } from '../ui/webview/rendering';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { deckardThemes, getDeckardTheme, getDeckardThemeCss } from '../ui/webview/themes';

function assertWebviewScriptParses(html: string): void {
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
}

/** Deckard's own manifest, which the Help page is built from. */
function extension(): vscode.Extension<unknown> {
  const found = vscode.extensions.all.find(
    (candidate) => candidate.packageJSON.name === 'deckard-notes',
  );
  assert.ok(found, 'Deckard is installed in the test host');
  return found;
}

suite('Webview contracts', () => {
  test('renders tag-clustered graph relationships', () => {
    const html = getNotesGraphHtml({
      cspSource: 'vscode-webview://deckard',
    });

    assertWebviewScriptParses(html);
    // The graph's controls are driven in the Notes Graph behavior suite.
    // What is left here is its clustering and force model, still held to its
    // source text: the page draws into a canvas, which jsdom has no context
    // for, and these functions are locked inside the page script where no
    // test can call them. Lifting them into a module of their own is what
    // turns these checks into tests of the algorithm.
    assert.strictEqual(
      html.includes('The graph uses prevalence-aware visual communities'),
      true,
    );
    assert.strictEqual(
      html.includes('var targetClusterSize = Math.max(3, Math.sqrt(sourceCount))'),
      true,
    );
    assert.strictEqual(html.includes('primaryClusterSize[bestMembership.tagIndex] += 1'), true);
    assert.strictEqual(html.includes('strength *= isPrimaryMembership ? 3 : 0.08'), true);
    assert.strictEqual(html.includes('var clusterGravity ='), true);
        assert.strictEqual(html.includes("node.kind === 'note' && !settings.showNotes"), true);
                                                            [
      'search',
      'show-notes',
      'show-tasks',
      'show-tags',
      'show-orphans',
      'tag-search',
      'clear-tags',
      'node-size',
      'link-thickness',
      'link-density',
      'tag-specificity',
      'bridge-strength',
      'show-all-links',
      'label-threshold',
      'center-strength',
      'cluster-cohesion',
      'community-spacing',
      'repel-strength',
      'link-strength',
      'link-distance',
      'zoom-out',
      'zoom-in',
      'zoom-fit',
      'reset-graph-settings',
    ].forEach((id) => {
      assert.strictEqual(new RegExp(`id="${id}"[^>]*title="[^"]+"`).test(html), true);
    });
        assert.strictEqual(
      html.indexOf('id="reset-graph-settings"') >
        html.indexOf('class="graph-zoom-controls"'),
      true,
    );
    assert.strictEqual(html.includes('function resetGraphSettings()'), true);
    assert.strictEqual(
      html.includes("input[type='search']::-webkit-search-cancel-button { cursor: pointer; }"),
      true,
    );
    assert.strictEqual(html.includes('vx.fill(0);'), true);
    assert.strictEqual(html.includes('vy.fill(0);'), true);
    assert.strictEqual(html.includes('reheat(1);'), true);
    assert.strictEqual(html.includes('function selectSalientEdges('), true);
    assert.strictEqual(html.includes('function tagMembershipScore('), true);
    assert.strictEqual(html.includes('function buildCommunities('), true);
    assert.strictEqual(html.includes('function isPhysicalNode('), true);
    assert.strictEqual(html.includes('function tickCommunityAnchors('), true);
    assert.strictEqual(html.includes('communityEdges = communityData.edges'), true);
    assert.strictEqual(html.includes('strong links / '), true);
    assert.strictEqual(html.includes("message.type === 'selectNode'"), true);
    assert.strictEqual(html.includes('selectedNeighbors[index]'), true);
  });

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
    assert.strictEqual(
      parseDashboardMessage({ type: 'setTaskFilter', filter: 'active' }),
      undefined,
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
    // Home's widgets: a quick-add task is one line of text.
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'quickAdd', text: 'Call Ren', extra: 1 }),
      { type: 'quickAdd', text: 'Call Ren' },
    );
    assert.strictEqual(parseDashboardMessage({ type: 'quickAdd', text: '  ' }), undefined);
    assert.strictEqual(parseDashboardMessage({ type: 'quickAdd', text: 'a\nb' }), undefined);
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'unpinNote', filePath: 'notes/a.md' }),
      { type: 'unpinNote', filePath: 'notes/a.md' },
    );
    assert.strictEqual(parseDashboardMessage({ type: 'pinNote', filePath: 7 }), undefined);
    assert.strictEqual(parseDashboardMessage({ type: 'createTagHub', tagKey: '' }), undefined);
    assert.deepStrictEqual(parseDashboardMessage({ type: 'openDailyNote' }), { type: 'openDailyNote' });
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTagSort', mode: 'custom' }),
      { type: 'setTagSort', mode: 'custom' },
    );
    // Tasks are chosen on the Task Board now, not with a Dashboard tag picker.
    assert.strictEqual(
      parseDashboardMessage({ type: 'setTaskTags', tagKeys: ['work'] }),
      undefined,
    );
    // The Search tab narrows notes with its search, not a tag picker.
    assert.strictEqual(
      parseDashboardMessage({ type: 'setNoteTags', tagKeys: ['work'] }),
      undefined,
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
    assert.strictEqual(
      parseDashboardMessage({ type: 'setTaskSort', mode: 'updated' }),
      undefined,
    );
    // Notes are listed on search pages now, which sort and render them.
    assert.strictEqual(
      parseDashboardMessage({ type: 'setNoteSort', mode: 'access' }),
      undefined,
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setRenderMode', mode: 'html' }),
      undefined,
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'saveDashboardSearch' }),
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
    assert.strictEqual(
      parseDashboardMessage({
        type: 'setDashboardColumns',
        section: 'notes',
        columns: 2,
      }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setDashboardMode', mode: 'home' }),
      { type: 'setDashboardMode', mode: 'home' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setDashboardMode', mode: 'notes' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'setDashboardSearch',
        field: 'tags',
        query: 'atlas',
      }),
      { type: 'setDashboardSearch', field: 'tags', query: 'atlas' },
    );
    assert.strictEqual(
      parseDashboardMessage({
        type: 'setDashboardSearch',
        field: 'notes',
        query: 'atlas',
      }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'setDashboardWidgets',
        widgets: [
          { id: 'a', kind: 'tasks', width: 'full', count: 3, query: 'is:open', extra: true },
          { id: 'b', kind: 'unknown', width: 'half' },
          'not a widget',
        ],
      }),
      {
        type: 'setDashboardWidgets',
        widgets: [{ id: 'a', kind: 'tasks', width: 'full', count: 3, query: 'is:open' }],
      },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setDashboardWidgets', widgets: 'all' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'resetDashboardWidgets' }),
      { type: 'resetDashboardWidgets' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'openSearch', query: '#project/atlas' }),
      { type: 'openSearch', query: '#project/atlas' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'openSearch', query: 42 }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'openTaskBoard', query: 'is:open' }),
      { type: 'openTaskBoard', query: 'is:open' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'openTaskBoard' }),
      { type: 'openTaskBoard' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'openView', view: 'agenda' }),
      { type: 'openView', view: 'agenda' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'openView', view: 'settings' }),
      undefined,
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

  test('accepts only supported search page messages', () => {
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'setRenderMode', mode: 'html' }),
      {
        type: 'setRenderMode',
        mode: 'html',
      },
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'saveTagOverviewFilter' }),
      { type: 'saveTagOverviewFilter' },
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'setResultPage', kind: 'tasks', page: 3 }),
      { type: 'setResultPage', kind: 'tasks', page: 3 },
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setResultPage', kind: 'everything', page: 3 }),
      undefined,
    );
    // A page number is a whole number of at least one, whatever a page that
    // had been tampered with might ask for.
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setResultPage', kind: 'notes', page: 0 }),
      undefined,
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setResultPage', kind: 'notes', page: 1.5 }),
      undefined,
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setResultPage', kind: 'notes', page: '2' }),
      undefined,
    );
    assert.strictEqual(
      parseSearchPageMessage({
        type: 'saveTagOverviewFilter',
        tagKeys: ['#untrusted', '#browser-data'],
      }),
      undefined,
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setRenderMode', mode: 'unsafe' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({
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
      parseSearchPageMessage({
        type: 'toggleTask',
        taskId: 'task-1',
        completed: 'yes',
      }),
      undefined,
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setTaskFilter', filter: 'active' }),
      undefined,
      'the search is the filter; the page keeps none of its own',
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'openTag', tagKey: 'other' }),
      { type: 'openTag', tagKey: 'other' },
    );
    // Opening a tag opens its page; tags added to a search are in its text.
    assert.deepStrictEqual(
      parseSearchPageMessage({
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', '#second'],
      }),
      { type: 'openTag', tagKey: '#focus' },
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'openTag', tagKey: '' }),
      undefined,
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setOverviewRefinement', refinement: 'x' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'setSearchColumns', section: 'notes', columns: 3 }),
      { type: 'setSearchColumns', section: 'notes', columns: 3 },
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'setSearchColumns', section: 'tags', columns: 3 }),
      undefined,
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'clearOverviewQuery' }),
      { type: 'clearOverviewQuery' },
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({
        type: 'renameTag',
        tagKey: '#child',
      }),
      { type: 'renameTag', tagKey: '#child' },
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({
        type: 'setTagOverviewSort',
        mode: 'access',
      }),
      { type: 'setTagOverviewSort', mode: 'access' },
    );
    assert.strictEqual(
      parseSearchPageMessage({
        type: 'setTagOverviewSort',
        mode: 'random',
      }),
      undefined,
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({
        type: 'setTagOverviewLayout',
        layout: 'split',
      }),
      { type: 'setTagOverviewLayout', layout: 'split' },
    );
    assert.strictEqual(
      parseSearchPageMessage({
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

  test('renders accessible Home and Tags dashboard modes with focused controls', () => {
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
        assert.strictEqual(
      html.includes(
        'input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }',
      ),
      true,
    );
        // Rows take their hover border from the shared .row surface.
    assert.strictEqual(
      html.includes('.row:hover, .card:hover, .task:hover { border-color: var(--amber); }'),
      true,
    );
            assert.strictEqual(html.includes('.is-draggable { cursor: grab; touch-action: none; }'), true);
            assert.strictEqual(
      html.includes(
        '.saved-filter-row:hover { background: var(--panel-raised); transform: translateX(3px); }',
      ),
      true,
    );
                    assert.strictEqual(
      html.includes('.tag-namespace { opacity: .62; }'),
      true,
    );
            assertWebviewScriptParses(html);
        assert.strictEqual(
      html.includes(
        '.task-title .inline-tag { color: var(--text); font: inherit; text-transform: none; }',
      ),
      true,
    );
                                                                // The mark is a filter icon, and the Search tab keeps it from another tab.
    assert.strictEqual(html.includes('<path d="M2 3h12L9 8v4l-2 1V8L2 3Z"/></svg></span>'), true);
    // A tag reads as written, whatever the heading or theme around it does.
    assert.strictEqual(html.includes('.tag-open, .inline-tag { text-transform: none; }'), true);
    // A tag in a title is a hairline link, not a control chip.
    assert.strictEqual(html.includes('.card-title .tag-open, .note .tag-list button { min-height: 0; padding: 3px 7px; border: 1px solid var(--line); background: transparent; line-height: 1.35; }'), true);
                                                                                // The gear is the one every page draws, after the totals.
    assert.strictEqual(
      html.indexOf("const metrics = '<div class=\"metrics\"") <
        html.indexOf('const dashboardOptions = renderViewOptions(['),
      true,
    );
                    assert.strictEqual(html.includes('.dashboard-header-actions .view-options { order: 2; }'), true);
                                            // A style attribute is refused by the page's policy, so columns are set by script.
    assert.strictEqual(html.includes('style="grid-template-columns: repeat('), false);
        assert.strictEqual(html.includes('.catalog-search { width: min(220px, 40vw); border-color: var(--cyan-bright); }'), true);
    assert.strictEqual(html.includes('.tag-list { display: grid; grid-template-columns: repeat(var(--dashboard-columns, 1), 1fr); gap: 7px; }'), true);
                                                        assert.strictEqual(html.includes('.tag-group { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px dashed var(--slate-border); }'), true);
    assert.strictEqual(
      html.includes(
        '.dashboard-tabs-row { padding-bottom: 8px; border-bottom: 2px solid var(--slate-border); }',
      ),
      true,
    );
        assert.strictEqual(html.includes('.dashboard-tabs { display: inline-flex; margin-top: 18px; }'), true);
    assert.strictEqual(
      html.includes('.dashboard-tabs button[aria-selected="true"] { position: relative; z-index: 1; }'),
      true,
    );
                        assert.strictEqual(html.includes("kinds: {\n      tag: { selector: '.tag-row[data-tag-key]', key: 'tagKey' },"), true);
                                                                                                                                                                                                                                                    assert.strictEqual(html.includes('.home-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'), true);
    assert.strictEqual(html.includes('.home-widget.is-full { grid-column: 1 / -1; }'), true);
    // The syntax hint under a search box shows while the box is in use and
    // not at rest, where it competed with the results under it.
    assert.strictEqual(
      html.includes('.query-workspace:not(:focus-within):not([data-has-text]) .query-hint { display: none; }'),
      true,
      'the hint rests only while the box is idle and empty',
    );
    // The file and line under a task were once a literal grey at 1.85:1 on
    // the panel, which six of the eight themes inherited. The muted token is
    // what every theme declares for secondary text.
    assert.strictEqual(
      html.includes('.task-meta { display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted);'),
      true,
      'task provenance takes the muted token, never a literal colour',
    );
                                              });

  test('draws a tag the same way in every theme', () => {
    // A tag is a button, so a theme that shouts its controls shouted its tags.
    for (const theme of deckardThemes) {
      const shouting = (getDeckardThemeCss(theme).match(/[^{}]+\{[^}]*\}/g) ?? []).filter(
        (rule) =>
          /\.tag-open|\.inline-tag/.test(rule.slice(0, rule.indexOf('{'))) &&
          /text-transform:\s*uppercase/.test(rule.slice(rule.indexOf('{'))),
      );
      assert.deepStrictEqual(shouting, [], `${theme} uppercases a tag`);
    }
  });

  test('Corpo takes every color from the VS Code theme and drops the chrome', () => {
    const corpo = getDeckardThemeCss('corpo');
    assert.strictEqual(corpo.includes('--bg: var(--vscode-editor-background);'), true);
    assert.strictEqual(corpo.includes('--text: var(--vscode-foreground);'), true);
    assert.strictEqual(corpo.includes('--grid-line: transparent;'), true);
    assert.strictEqual(corpo.includes('body { background: var(--vscode-editor-background); }'), true);
    // Every overlay is opaque: VS Code's hover color is often semi-transparent.
    assert.strictEqual(corpo.includes('.sidebar-association-tooltip, .query-suggestions { clip-path: none;'), true);
    // A page VS Code gives no backdrop paints its own, or it renders blank.
    assert.strictEqual(corpo.includes('body:has(.sidebar-header)'), true);
    assert.strictEqual(corpo.includes('.inline-tag, .task-title .inline-tag { border-color: var(--vscode-widget-border'), true);
    // The page's color scheme follows VS Code's, or a light theme gets a dark backdrop.
    assert.strictEqual(corpo.includes(':root:has(> body.vscode-light)'), true);
    // A chosen tab takes VS Code's button colors, which are readable together.
    assert.strictEqual(corpo.includes('.dashboard-tabs button[aria-selected="true"]'), true);
    assert.strictEqual(corpo.includes('.metric::before { display: none; }'), true);
    assert.strictEqual(corpo.includes('background: var(--vscode-button-background); color: var(--vscode-button-foreground);'), true);
    // Nothing is fixed to a color, so light and dark VS Code themes both work.
    assert.doesNotMatch(corpo, /#[0-9a-f]{3,8}\b|rgba?\(/i);
    assert.strictEqual(corpo.includes('translateX'), false, 'rows do not slide on hover');
    // The gear keeps the look every page shares rather than a button's.
    assert.strictEqual(corpo.includes('.view-options summary'), false);
  });

  test('defines theme overrides for each selectable webview theme', () => {
    assert.deepStrictEqual(deckardThemes, [
      'corpo',
      'replicant',
      'oblivion',
      'lcars',
      'synthwave',
      'tomcat',
      'fellowship',
      'cooper',
    ]);
    assert.strictEqual(
      getDeckardThemeCss('replicant').includes(
        '.entity-row:hover, .tag-row:hover, .card:hover, .note:hover, .task:hover, .task-row:hover',
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
        '.card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('oblivion').includes('#3fb6c9'),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('oblivion').includes(
        '.entity-row:hover, .tag-row:hover, .card:hover, .note:hover, .task:hover, .task-row:hover',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('oblivion').includes(
        '.card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }',
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
        '.note .tag-list button, .search-notice button { background: var(--cyan); color: #050505; }',
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
        '.saved-filter-remove.saved-filter-remove { color: #050505; }',
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
    // The heart is drawn in the toggle's own color, so no theme colors it
    // apart: a theme that did would strand it when the toggle is hovered.
    assert.strictEqual(
      deckardThemes.some((theme) => getDeckardThemeCss(theme).includes('.favorite-heart {')),
      false,
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
    const cooper = getDeckardThemeCss('cooper');
    assert.strictEqual(cooper.includes('--bg-dark: #030405'), true);
    assert.strictEqual(cooper.includes('--amber: #dca24a'), true, "Gargantua's gold");
    // A tag's resting color never outranks the fill a theme gives it on hover.
    assert.strictEqual(/\.card \.tag-open, \.note-row \.tag-open \{ color/.test(cooper), false);
    // A hovered tag keeps Cooper's inverted button colors, not a dark ground under dark text.
    assert.strictEqual(cooper.includes('.tag-open:hover, .note .tag-list button:hover { transform: translateX(3px); }'), true);
    assert.strictEqual(/\.tag-open:hover[^{]*\{[^}]*background: var\(--panel-raised\)/.test(cooper), false);
    // The glow is drawn once over the whole panel, not tiled down a short page.
    assert.strictEqual(cooper.includes('html { min-height: 100%; }'), true);
    assert.strictEqual(cooper.includes('background-repeat: no-repeat, repeat, repeat;'), true);
    assert.strictEqual(
      cooper.includes('radial-gradient(circle at 1px 1px'),
      true,
      'a starfield behind the page',
    );
    assert.strictEqual(
      cooper.includes('letter-spacing: .22em; text-transform: uppercase;'),
      true,
    );
    assert.strictEqual(
      cooper.includes(
        'main { border-color: var(--slate-border); border-top-color: var(--line-strong);',
      ),
      true,
      "a page's top rule is recolored, not replaced",
    );
    assert.strictEqual(/main \{[^}]*border-top:/.test(cooper), false);
    // Strength steps are gold against faint empty ones, not two pale greys.
    assert.strictEqual(cooper.includes('.tag-weight-rail-segment.filled { background: var(--amber); }'), true);
  });

  test('renders the Dashboard with a centered maximum width and no outer frame', () => {
    const html = getDashboardHtml(
      {
        cspSource: 'vscode-webview://deckard',
        asWebviewUri: (resource) => resource,
      },
      vscode.Uri.file('/deckard'),
    );

    // The shared shell centres main without a frame; the Dashboard widens it.
    assert.strictEqual(
      html.includes(
        'main { position: relative; max-width: 1000px; margin: 0 auto; padding: 24px; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes('main { width: 100%; max-width: 1180px; }'),
      true,
    );
    // A theme may restyle main; the page and the shared sheet give it no frame.
    const themeCss = getDeckardThemeCss(getDeckardTheme());
    assert.strictEqual(html.includes(themeCss), true);
    const pageCss = html.replace(themeCss, '');
    assert.strictEqual(
      /(^|[\s}])main\s*\{[^}]*\bborder(-[a-z]+)?\s*:/.test(pageCss),
      false,
    );
  });

  test('renders search page tabs and side-by-side layouts', () => {
    const html = getSearchPageHtml({
      cspSource: 'vscode-webview://deckard',
    });

    assertWebviewScriptParses(html);
    assert.strictEqual(
      html.includes('grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);'),
      true,
    );
                            assert.strictEqual(
      html.includes('.segmented > * + * { margin-left: calc(var(--edge) * -1); }'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.inline-tag {\n  min-height: 24px;\n  margin-left: 3px;\n  padding: 2px 4px;\n  font-size: .78em;\n  vertical-align: 1px;\n}',
      ),
      true,
    );
                                                                                assert.strictEqual(
      html.includes("vscode.postMessage({ type: 'createHubNote' })"),
      true,
    );
    assert.deepStrictEqual(parseSearchPageMessage({ type: 'createHubNote' }), {
      type: 'createHubNote',
    });
    assert.strictEqual(
      parseSearchPageMessage({ type: 'createHubNote', tagKey: '#other' }),
      undefined,
    );
                        // The Notes and Tasks tabs are the shared result tabs.
    assert.strictEqual(html.includes("{ id: 'notes', label: 'Notes', count: notesCount },"), true);
    // Both tabs count what their pane shows.
    assert.strictEqual(html.includes("{ id: 'tasks', label: 'Tasks', count: tasksCount },"), true);
                    assert.strictEqual(
      html.includes('.segmented { display: inline-flex; }'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.overview-tabs-row { margin-top: 20px; padding-bottom: 8px; border-bottom: 2px solid var(--line); }',
      ),
      true,
    );
        assert.strictEqual(
      html.includes('.segmented > .active { position: relative; z-index: 1; }'),
      true,
    );
                            // The closer spelling a search page offers, and the batch it carries of
    // a broad one, are held to what the page does: see the Search page
    // behavior suite.
    assert.strictEqual(html.includes('clearedText: function () { return state ? state.originQuery : \'\'; }'), true);
    assert.strictEqual(html.includes('refineElsewhere: function () { return Boolean(state && state.refineInSidebar); }'), true);
        
                
            assert.strictEqual(
      html.includes(
        'header > .toolbar .view-options { position: absolute; top: 0; right: 0; }',
      ),
      true,
    );
    // A short header is tall enough to hold the gear.
    assert.strictEqual(html.includes('header > .toolbar { margin-top: 36px; }'), true);
        assert.strictEqual(
      html.includes(
        'header > .toolbar { width: 100%; margin-top: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        'input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }',
      ),
      true,
    );
                                                                                                                                                                                    // Tasks are the shared task rows, marked so typed words can hide them.
    assert.strictEqual(html.includes("renderTaskListRow(item, { titleDisplay: state.tagTitleDisplayMode })"), true);
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
                                        // Writing a link to a result is held to what the sidebar does; see the
    // Related Notes behavior suite. The rule that keeps the button out of the
    // way is style, which only a rendered page can be asked about.
    assert.strictEqual(
      html.includes('.note:hover .insert-link, .note:focus-within .insert-link, .insert-link:focus-visible { opacity: 1; }'),
      true,
    );
        assert.strictEqual(
      html.includes('.note-title .inline-tag { color: var(--text); }'),
      true,
    );
    assert.strictEqual(
      html.includes('.active-file .tag-list button:not(:hover):not(:focus-visible) { color: var(--text); }'),
      true,
    );
                                assert.strictEqual(
      html.includes('.tag-namespace { opacity: .62; }'),
      true,
    );
        assert.strictEqual(
      html.includes(
        '.tag-weight-rail-segment { display: block; width: 4px; height: 3px; border-radius: 1px; background: var(--muted); opacity: .3; }',
      ),
      true,
    );
                                // Inline tags keep the sidebar's compact size; colour, margin and
    // alignment come from the shared .tag-open and .inline-tag rules.
    assert.strictEqual(
      html.includes(
        '.inline-tag { display: inline-block; min-height: 0; padding: 1px 4px; border-width: 1px; font-size: .85em; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); font-size: 11px; text-align: left; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.inline-tag {\n  min-height: 24px;\n  margin-left: 3px;\n  padding: 2px 4px;\n  font-size: .78em;\n  vertical-align: 1px;\n}',
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
                                                                                                                                                      });

  test('keeps the Help page in step with what Deckard contributes', () => {
    // The commands and settings tables are built from the manifest, so this
    // holds the page to it rather than to a copy of its words: a command or
    // a setting added later is in the guide the moment it is contributed.
    const manifest = extension().packageJSON.contributes;
    const html = getHelpHtml(
      {
        cspSource: 'vscode-webview://deckard',
        asWebviewUri: (resource) => resource,
      },
      vscode.Uri.file('/deckard'),
      manifest,
    );

    const commands: { command: string; title: string }[] =
      manifest?.commands ?? [];
    assert.ok(commands.length > 0);
    for (const command of commands.filter((entry) =>
      entry.title.startsWith('Deckard:'),
    )) {
      assert.ok(
        html.includes(command.title.replace('Deckard: ', '')),
        `Help lists ${command.title}`,
      );
    }

    const settings: string[] = (manifest?.configuration ?? []).flatMap(
      (group: { properties?: Record<string, unknown> }) =>
        Object.keys(group.properties ?? {}),
    );
    assert.ok(settings.length > 0);
    for (const setting of settings) {
      assert.ok(html.includes(setting), `Help lists ${setting}`);
    }

    // Every section the navigation offers is a section of the page.
    const links = [...html.matchAll(/href="#([a-z-]+)"/g)].map(
      (match) => match[1],
    );
    assert.ok(links.length >= 20, 'the guide is navigable in parts');
    for (const link of new Set(links)) {
      assert.ok(
        html.includes(`<section id="${link}">`),
        `#${link} is a section`,
      );
    }
    for (const section of ['quick-start', 'commands', 'advanced', 'query', 'tasks']) {
      assert.ok(links.includes(section), `the navigation offers #${section}`);
    }
  });

  test('renders the Help page as a reference, tables and all', () => {
    const html = getHelpHtml(
      {
        cspSource: 'vscode-webview://deckard',
        asWebviewUri: (resource) => resource,
      },
      vscode.Uri.file('/deckard'),
      extension().packageJSON.contributes,
    );

    assert.ok(html.includes('<caption>Fields</caption>'), 'the query fields');
    assert.ok(
      html.includes('<caption>Markers, in the order Deckard writes them</caption>'),
      'the task markers',
    );
    assert.ok(html.includes('deckard.noteBoundaries'), 'what counts as a note');
    assert.ok(html.includes('resources/deckard.svg'), 'the logo it ships with');
    assert.ok(html.includes('Associated tags'), 'how tags relate');
    assert.ok(html.includes('#follow-up'), 'a tag anyone can write');
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
    // A tag opens its own page; the old filter arguments are dropped.
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', '#second'],
      }),
      { type: 'openTag', tagKey: '#focus' },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({ type: 'renameTag', tagKey: '#work' }),
      { type: 'renameTag', tagKey: '#work' },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'refineActiveSearch',
        facetId: 'related',
        clause: '#team/harbor',
        mode: 'exclude',
        extra: 'dropped',
      }),
      {
        type: 'refineActiveSearch',
        facetId: 'related',
        clause: '#team/harbor',
        mode: 'exclude',
      },
    );
    assert.strictEqual(
      parseSidebarMessage({
        type: 'refineActiveSearch',
        facetId: 'related',
        clause: '#team/harbor',
        mode: 'replace',
      }),
      undefined,
    );
    assert.strictEqual(
      parseSidebarMessage({ type: 'refineActiveSearch', facetId: 'related', clause: '', mode: 'and' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseSidebarMessage({ type: 'setActiveSearch', query: '#project/atlas' }),
      undefined,
    );
    assert.strictEqual(
      parseSidebarMessage({ type: 'setActiveSearch', query: 7 }),
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
