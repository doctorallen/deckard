import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  parseDashboardMessage,
  parseSidebarMessage,
  parseTagOverviewMessage,
} from '../ui/webview/messages';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getHelpHtml } from '../ui/webview/helpHtml';
import { renderMarkdown } from '../ui/webview/rendering';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { shouldOpenDashboardForSidebarReveal } from '../ui/webview/sidebarNotes';
import { getTagOverviewHtml } from '../ui/webview/tagOverviewHtml';
import { deckardThemes, getDeckardThemeCss } from '../ui/webview/themes';

suite('Webview contracts', () => {
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
      parseDashboardMessage({ type: 'setTaskSort', mode: 'updated' }),
      { type: 'setTaskSort', mode: 'updated' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setTaskSort', mode: 'random' }),
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

  test('accepts only supported tag overview messages', () => {
    assert.deepStrictEqual(
      parseTagOverviewMessage({ type: 'setRenderMode', mode: 'html' }),
      {
        type: 'setRenderMode',
        mode: 'html',
      },
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

  test('renders task-row pointer and hover affordances', () => {
    const html = getDashboardHtml({ cspSource: 'vscode-webview://deckard' });

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
        '<div class="task-filter-toggle" role="group" aria-label="Task status filter">',
      ),
      true,
    );
    assert.strictEqual(html.includes('class="task-filter-icon"'), true);
    assert.strictEqual(html.includes("'Active tasks'"), true);
    assert.strictEqual(html.includes('class="tag-open"'), false);
    assert.strictEqual(
      html.includes("const entityRow = event.target.closest('.entity-row');"),
      true,
    );
  });

  test('defines theme overrides for each selectable webview theme', () => {
    assert.deepStrictEqual(deckardThemes, [
      'replicant',
      'oblivion',
      'lcars',
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
        '.note:hover { border-color: var(--amber); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('replicant').includes(
        '.card .tag-open { color: var(--text); }',
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
        '.card .tag-open { color: var(--text); }',
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
        '.task-row .task-title, .task .task-title { color: var(--cyan); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-title { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); } .task-row .task-title a, .task .task-title a { color: inherit; } .task-row .task-meta, .task .source { color: var(--muted); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-meta { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); }',
      ),
      true,
    );
    assert.strictEqual(
      getDeckardThemeCss('lcars').includes(
        '.overview-tabs { gap: 2px; } .overview-tabs button { border-radius: 0; } .overview-tabs button:first-child { border-radius: 15px 0 0 0; } .overview-tabs button:last-child { border-radius: 0 0 15px 0; }',
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
    const html = getDashboardHtml({
      cspSource: 'vscode-webview://deckard',
    });

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
        '<div class="toolbar-toggle-group" role="group" aria-label="Content layout">',
      ),
      true,
    );
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
    assert.strictEqual(html.includes('data-action="toggle-task"'), true);
    assert.strictEqual(html.includes("type: 'toggleTask'"), true);
    assert.strictEqual(html.includes('data-action="set-task-filter"'), true);
    assert.strictEqual(
      html.includes(
        '<div class="task-filter-toggle" role="group" aria-label="Task status filter">',
      ),
      true,
    );
    assert.strictEqual(html.includes('class="task-filter-icon"'), true);
    assert.strictEqual(html.includes("'Completed tasks'"), true);
    assert.strictEqual(
      html.includes(
        '.task.completed .task-title { color: var(--muted); text-decoration: line-through; }',
      ),
      true,
    );
  });

  test('does not render related-note reasons', () => {
    const html = getSidebarNotesHtml(
      { cspSource: 'vscode-webview://deckard' },
      '1.0.0',
    );

    assert.strictEqual(html.includes('class="reason"'), false);
    assert.strictEqual(html.includes('note.reasons'), false);
    assert.strictEqual(html.includes('set-related-notes-sort'), true);
    assert.strictEqual(html.includes('related-notes-sort-control'), true);
    assert.strictEqual(html.includes('related-notes-sort-icon'), true);
    assert.strictEqual(html.includes('>Most tags</option>'), true);
    assert.strictEqual(html.includes('>Newest</option>'), true);
    assert.strictEqual(html.includes('>Oldest</option>'), true);
    assert.strictEqual(html.includes('>Most accessed</option>'), true);
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
    assert.strictEqual(html.includes('resources/deckard.svg'), true);
    assert.strictEqual(
      html.includes('When no Markdown editor is active'),
      true,
    );
    assert.strictEqual(html.includes('M2 2h5v5H2zm7 0h5v3H9'), true);
    assert.strictEqual(
      html.includes(
        'M2 1H6V3H10V1H14V3H16V8H14V10H12V12H10V14H6V12H4V10H2V8H0V3H2Z',
      ),
      true,
    );
  });

  test('suppresses automatic Dashboard opening for active Markdown notes', () => {
    assert.strictEqual(
      shouldOpenDashboardForSidebarReveal({
        uri: vscode.Uri.file('/deckard/note.md'),
      }),
      false,
    );
    assert.strictEqual(
      shouldOpenDashboardForSidebarReveal({
        uri: vscode.Uri.file('/deckard/notes.txt'),
      }),
      true,
    );
    assert.strictEqual(shouldOpenDashboardForSidebarReveal(undefined), true);
  });

  test('accepts only valid sidebar navigation messages', () => {
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
