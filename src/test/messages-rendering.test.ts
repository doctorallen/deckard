import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { createQueryContext } from '../domain/query/queryContext';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { getDeckardTheme } from '../ui/webview/themes';
import { readPageChrome } from '../ui/webview/host/pageChrome';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { linkedSheets, pageSheets, readSheet, themeSheet, withSheets } from './sheets';
import { deckardThemes } from '../ui/webview/themeNames';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';

/**
 * The Dashboard on its Tags tab, driven: its tags ranked by hand, and a
 * search kept from an earlier visit, so the tab is marked.
 */
function openDrivenDashboard(): WebviewPage {
  const index = buildWorkspaceIndex(new Map([
    ['notes/one.md', parseMarkdown('notes/one.md', '# One #project/atlas #risk/vendor\nProse.')],
  ]));
  const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
  const preferences = { ...store.reader.value, tagSortMode: 'custom' as const, dashboardViewState: { mode: 'browse' as const, tagSearchQuery: 'atlas' } };
  const snapshot = createDashboardSnapshot({ index, preferences, queryContext: createQueryContext(Date.now()) });
  store.repository.dispose();
  return openWebviewPage(renderPage('dashboard'), { ...snapshot, parkedTags: [] });
}

suite('Webview contracts', () => {
  test('distinguishes selected, parent, and child tag context in diagnostics', () => {
    const html = renderPage('relatedNotesDebug', {
      diagnostic: {
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
          state: 'noMatches',
        },
      },
    });

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

  test('renders accessible Home and Tags dashboard modes with focused controls', () => {
    const html = withSheets(renderPage('dashboard'));

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
    // A row's readout, a file name or a count, folds under the row under the
    // pointer as an entry's provenance does, and stays in the tree.
    assert.ok(html.includes('.home-row .home-row-detail,\n.tag-row .tag-count {'));
    assert.ok(html.includes('.home-row:hover .home-row-detail, .home-row:focus-within .home-row-detail,'));
    assert.ok(!/\.home-row-detail[^{]*\{[^}]*display: none/.test(html), 'a readout never leaves the accessibility tree');
    // A saved search reads by its name; its criteria open under the pointer.
    assert.ok(html.includes('.saved-filter-row .saved-filter-tags { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); margin: 0; }'));
    assert.ok(html.includes('.saved-filter-row:hover .saved-filter-tags, .saved-filter-row:focus-within .saved-filter-tags {'));
                    assert.strictEqual(
      html.includes('.tag-namespace { color: var(--muted); }'),
      true,
    );
        assert.strictEqual(
      html.includes(
        '.task-title .inline-tag { color: var(--text); font: inherit; text-transform: none; }',
      ),
      true,
    );
                                                                // The mark is a filter icon, and the Search tab keeps it from another tab.
    // It is drawn with a class of its own: the shared icon's class places it
    // absolutely at a select's corner, which in a tab floated it over the page.
    const page = openDrivenDashboard();
    try {
      const mark = page.find('.dashboard-tabs .tab-search-mark svg');
      assert.strictEqual(mark.getAttribute('class'), 'tab-search-mark-icon');
      assert.strictEqual(mark.getAttribute('viewBox'), '0 0 16 16');
      assert.strictEqual(mark.querySelector('path')?.getAttribute('d'), 'M2 3h12L9 8v4l-2 1V8L2 3Z');
      // The ⋯ is the one every page draws, after the totals.
      assert.deepStrictEqual(
        [...page.find('.dashboard-header-actions').children].map((child) => child.className),
        ['metrics', 'view-options page-menu'],
      );
      // Tags in their own rank are ranked rows: dragged, or moved from their menu.
      const row = page.find('.tag-row[data-tag-key]');
      assert.ok(row.classList.contains('is-draggable'));
      row.dispatchEvent(new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      assert.ok(page.find('#rank-context-menu [data-context-action="top"]'));
    } finally {
      page.dispose();
    }
    // A tag reads as written, whatever the heading or theme around it does.
    assert.strictEqual(html.includes('.tag-open, .inline-tag { text-transform: none; }'), true);
    // A tag on a card is written text, not a control chip.
    assert.strictEqual(html.includes('body .card button.tag-open:not(:hover):not(:focus-visible),'), true);
                    assert.strictEqual(html.includes('.dashboard-header-actions .view-options { order: 2; }'), true);
                                            // A style attribute is refused by the page's policy, so columns are set by script.
    assert.strictEqual(html.includes('style="grid-template-columns: repeat('), false);
        assert.strictEqual(html.includes('.catalog-search { width: min(220px, 40vw); border-color: var(--cyan-bright); }'), true);
    assert.strictEqual(html.includes('.tag-list { display: grid; grid-template-columns: repeat(var(--dashboard-columns, 1), 1fr); gap: 7px; }'), true);
                                                        assert.strictEqual(html.includes('.tag-group { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px dashed var(--slate-border); }'), true);
    assert.strictEqual(
      html.includes(
        '.dashboard-tabs-row { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid var(--slate-border); }',
      ),
      true,
    );
        assert.strictEqual(html.includes('.dashboard-tabs { display: inline-flex; margin-top: 18px; }'), true);
    assert.strictEqual(
      html.includes('.dashboard-tabs button[aria-selected="true"] { position: relative; z-index: var(--z-raised); }'),
      true,
    );
                                                                                                                                                                                                                                                    assert.strictEqual(html.includes('.home-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'), true);
    assert.strictEqual(html.includes('.home-widget.is-full { grid-column: 1 / -1; }'), true);
    // A hue carries one meaning: the state tokens, and the rules that use them.
    for (const token of ['--accent', '--danger', '--favorite', '--positive', '--focus']) {
      assert.ok(html.includes(`${token}: var(--`), `${token} is declared on :root`);
    }
    assert.ok(html.includes('.due-date.overdue { color: var(--danger); font-weight: 700; }'), 'overdue is danger');
    assert.ok(!/\.favorite-toggle \{[^}]*--favorite-red/.test(html), 'the heart is not drawn in the danger color');
    assert.ok(!/is-negated \{[^}]*--favorite-red/.test(html), 'a negated term is not an alarm');
    // Hover and chosen are two drawings, not one amber.
    assert.strictEqual(
      html.includes('button.active {\n  border-color: var(--chosen-bg);\n  background: var(--panel-raised);'),
      true,
      'a chosen control keeps its own ground and takes the accent as a border and a bar',
    );
    // Nothing a reader acts on is set below the smallest step of the scale.
    assert.ok(
      html.includes('--text-md: var(--vscode-font-size, 13px);'),
      'the type scale follows the editor',
    );
    assert.ok(
      html.includes('--text-xs: max(11px, calc(var(--text-md) - 2px));'),
      'and never goes under its floor',
    );
    // Every working size is a step of the scale, so it moves with the editor.
    assert.strictEqual(
      /font(-size)?: ?(\d{3} )?1[1-4]px/.test(html),
      false,
      'no rule on the page sets a working size in pixels',
    );
    assert.strictEqual(
      /font(-size)?: ?(9|10)px/.test(html),
      false,
      'no rule on the page sets text under the floor',
    );
    // The syntax hint under a search box stays: hidden at rest, it came and
    // went as focus moved to the grouping beside it.
    assert.strictEqual(
      /\.query-hint \{ display: none; \}/.test(html),
      false,
      'the hint is not hidden when the box is idle',
    );
    // The file and line under a task were once a literal gray at 1.85:1 on
    // the panel, which six of the eight themes inherited. The muted token is
    // what every theme declares for secondary text.
    assert.strictEqual(
      html.includes('.task-meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; color: var(--muted);'),
      true,
      'task provenance takes the muted token, never a literal color',
    );
                                              });

  test('draws a tag the same way in every theme', () => {
    // A tag is a button, so a theme that shouts its controls shouted its tags.
    for (const theme of deckardThemes) {
      const shouting = (themeSheet(theme).match(/[^{}]+\{[^}]*\}/g) ?? []).filter(
        (rule) =>
          /\.tag-open|\.inline-tag/.test(rule.slice(0, rule.indexOf('{'))) &&
          /text-transform:\s*uppercase/.test(rule.slice(rule.indexOf('{'))),
      );
      assert.deepStrictEqual(shouting, [], `${theme} uppercases a tag`);
    }
  });

  test('Corpo takes every color from the VS Code theme and drops the chrome', () => {
    const corpo = themeSheet('corpo');
    assert.strictEqual(corpo.includes('--bg: var(--vscode-editor-background);'), true);
    assert.strictEqual(corpo.includes('--text: var(--vscode-foreground);'), true);
    assert.strictEqual(corpo.includes('--grid-line: transparent;'), true);
    assert.strictEqual(corpo.includes('body { background: var(--vscode-editor-background); }'), true);
    // Every overlay is opaque: VS Code's hover color is often semi-transparent.
    assert.strictEqual(corpo.includes('.popover, .tag-filter-menu,'), true);
    assert.strictEqual(corpo.includes('.sidebar-association-tooltip, .query-suggestions { clip-path: none;'), true);
    // A page VS Code gives no backdrop paints its own, or it renders blank.
    assert.strictEqual(corpo.includes('body:has(> main[data-sidebar])'), true);
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
      themeSheet('replicant').includes(
        '.entity-row:hover, .tag-row:hover, .card:hover, .note:hover, .task:hover, .task-row:hover',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('replicant').includes(
        '.note:hover, .note-row:hover { border-color: var(--amber); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('replicant').includes(
        '.inline-tag, .inline-tag:hover, .inline-tag:focus-visible { transform: none; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('replicant').includes(
        '.card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('oblivion').includes('#3fb6c9'),
      true,
    );
    assert.strictEqual(
      themeSheet('oblivion').includes(
        '.entity-row:hover, .tag-row:hover, .card:hover, .note:hover, .task:hover, .task-row:hover',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('oblivion').includes(
        '.card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(themeSheet('lcars').includes('#211b25'), true);
    assert.strictEqual(
      themeSheet('lcars').includes('border-radius: 0 15px 15px 0'),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        'border-left: 7px solid var(--amber)',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes('background: var(--favorite-red)'),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes('.metrics { gap: 0; }'),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.dashboard-tabs-row { border-bottom-color: var(--line-strong); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.overview-tabs-row { border-bottom-color: var(--line-strong); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.metric::before { border-bottom-color: var(--amber); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.metric:nth-child(3n + 2)::before { border-bottom-color: var(--cyan); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.note .tag-list button, .search-notice button { background: var(--cyan); color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.active-file .tag-list button { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.inline-tag, .note-title .inline-tag, .task-title .inline-tag { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.saved-filter-remove.saved-filter-remove { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.active-name .active-filter-tag { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.sidebar-relationships { border: 0; border-left: 7px solid var(--amber); border-radius: 0;',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.sidebar-relationship-items { margin: 0 8px 5px; border-left: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.favorite-toggle { background: var(--cyan); color: #7a1f1f; }',
      ),
      true,
    );
    // The heart is drawn in the toggle's own color, so no theme colors it
    // apart: a theme that did would strand it when the toggle is hovered.
    assert.strictEqual(
      deckardThemes.some((theme) => themeSheet(theme).includes('.favorite-heart {')),
      false,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.task-row .task-title, .task .task-title, .note-row .card-title { color: var(--cyan); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-title { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); } .task-row .task-title a, .task .task-title a { color: inherit; } .task-row .task-meta, .task .source, .note-row .source { color: var(--muted); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-meta { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.note-row { border: 0; border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); clip-path: none; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.overview-tabs { gap: 0; } .overview-tabs button { border-radius: 0; } .overview-tabs button:first-child { border-radius: 15px 0 0 0; } .overview-tabs button:last-child { border-radius: 0 0 15px 0; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        'section[aria-labelledby="tags-heading"] .control-row { gap: 2px; } section[aria-labelledby="tags-heading"] .control-row .control-icon select { border-radius: 0; } section[aria-labelledby="tags-heading"] .control-row .control-icon:first-child select { border-radius: 15px 0 0 0; } section[aria-labelledby="tags-heading"] .control-row .control-icon:last-child select { border-radius: 0 0 15px 0; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.tag-filter summary, .tag-filter-search { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; } .tag-filter-search::placeholder { color: #050505; opacity: 1; } .tag-filter summary .control-icon-svg, .tag-filter-search-control .control-icon-svg, .tag-filter-clear { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        'input.tag-filter-search { border-color: var(--panel-deep); background: var(--cyan); color: #050505; } input.tag-filter-search::placeholder { color: #050505; opacity: 1; } input.tag-filter-search:focus { border-color: var(--panel-deep); background: var(--amber); color: #050505; } .selected-task-tag { background: var(--cyan); color: #050505; } .selected-task-tag::after { color: #050505; } button.clear-task-filters { border-color: var(--panel-deep); background: var(--cyan); color: #050505; } button.clear-task-filters:hover:where(:not(:disabled):not([aria-disabled="true"])), button.clear-task-filters:focus-visible { border-color: var(--panel-deep); background: var(--amber); color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.overview-search, .catalog-search, .task-search, .note-search { border: 2px solid var(--cyan-bright); border-radius: 0 15px 15px 0; background: var(--panel); box-shadow: inset 0 0 0 1px var(--cyan-bright); color: var(--text); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.dashboard-tabs button { border-radius: 0; } .dashboard-tabs button:first-child { border-radius: 15px 0 0 0; } .dashboard-tabs button:last-child { border-radius: 0 0 15px 0; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.save-filter.save-filter { border-color: var(--panel-deep); color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.dashboard-column-options button, .dashboard-column-options button:first-child, .dashboard-column-options button:last-child { border-radius: 0; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('lcars').includes('.sidebar-toolbar'),
      false,
      'the sidebar\'s actions are in its view title bar, not the page',
    );
    assert.strictEqual(
      themeSheet('lcars').includes(
        '.control-icon select:hover:where(:not(:disabled):not([aria-disabled="true"])) + .control-icon-svg, .related-notes-sort-icon { color: #050505; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('synthwave').includes('--bg-dark: #090713'),
      true,
    );
    assert.strictEqual(
      themeSheet('synthwave').includes('repeating-linear-gradient'),
      true,
    );
    assert.strictEqual(
      themeSheet('synthwave').includes(
        'background: var(--cyan); color: var(--bg-dark);',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('synthwave').includes(
        '.favorite-toggle.favorite { border-color: var(--favorite-red); background: var(--favorite-red); color: var(--bg-dark); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('tomcat').includes('--bg-dark: #010401'),
      true,
    );
    assert.strictEqual(
      themeSheet('tomcat').includes('repeating-linear-gradient'),
      true,
    );
    assert.strictEqual(
      themeSheet('tomcat').includes('inset 0 0 0 1px'),
      false,
    );
    assert.strictEqual(
      themeSheet('tomcat').includes(
        'box-shadow: inset 2px 0 0 var(--green)',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('tomcat').includes(
        '.favorite-toggle { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('fellowship').includes('--bg-dark: #d6cda9'),
      true,
    );
    assert.strictEqual(
      themeSheet('fellowship').includes(
        "--font-display: Georgia, 'Times New Roman', serif",
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('fellowship').includes(
        'body { background-image: none; }',
      ),
      true,
    );
    assert.strictEqual(
      themeSheet('fellowship').includes('gradient'),
      false,
    );
    assert.strictEqual(
      themeSheet('fellowship').includes('border-radius: 5px'),
      true,
    );
    assert.strictEqual(
      themeSheet('fellowship').includes('inset 0 0 0 1px'),
      false,
    );
    assert.strictEqual(
      themeSheet('tomcat').includes(
        '.favorite-toggle.favorite { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }',
      ),
      true,
    );
    const cooper = themeSheet('cooper');
    assert.strictEqual(cooper.includes('--bg-dark: #030405'), true);
    assert.strictEqual(cooper.includes('--amber: #dca24a'), true, "Gargantua's gold");
    // A tag's resting color never outranks the fill a theme gives it on hover.
    assert.strictEqual(/\.card \.tag-open, \.note-row \.tag-open \{ color/.test(cooper), false);
    // A hovered tag keeps Cooper's inverted button colors, not a dark ground under dark text.
    assert.strictEqual(cooper.includes('.tag-open:hover, .note .tag-list button:hover:where(:not(:disabled):not([aria-disabled="true"])) { transform: translateX(3px); }'), true);
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
    // Strength steps are gold against faint empty ones, not two pale grays.
    assert.strictEqual(cooper.includes('.tag-weight-rail-segment.filled { background: var(--amber); }'), true);
  });

  test('renders the Dashboard with a centered maximum width and no outer frame', () => {
    const css = pageSheets(renderPage('dashboard', { chrome: readPageChrome() }));

    // The shared shell centers main without a frame; the Dashboard widens it.
    assert.strictEqual(
      css.includes(
        'main { position: relative; max-width: 1000px; margin: 0 auto; padding: var(--space-5); }',
      ),
      true,
    );
    assert.strictEqual(
      css.includes('main { width: 100%; max-width: 1400px; }'),
      true,
    );
    // A theme may restyle main; the page and the shared sheet give it no frame.
    const themeCss = themeSheet(getDeckardTheme());
    assert.strictEqual(css.includes(themeCss), true, 'the page links the theme it draws in');
    const pageCss = css.replace(themeCss, '');
    assert.strictEqual(
      /(^|[\s}])main\s*\{[^}]*\bborder(-[a-z]+)?\s*:/.test(pageCss),
      false,
    );
  });

  test('renders search page tabs and side-by-side layouts', () => {
    const html = withSheets(renderPage('searchPage'));

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
      html.includes('.segmented { display: inline-flex; }'),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.overview-tabs-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 20px; padding-bottom: 8px; border-bottom: 2px solid var(--line); }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes('.segmented > .active { position: relative; z-index: var(--z-raised); }'),
      true,
    );
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

    // The page itself, driven. A tag no note describes offers a hub note.
    const index = buildWorkspaceIndex(new Map([
      ['notes/one.md', parseMarkdown('notes/one.md', '# One #risk/vendor\nProse.\n- [ ] Chase it #risk/vendor\n- [ ] And this #risk/vendor')],
    ]));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, store.reader.value, '#risk/vendor', { queryContext: createQueryContext(Date.now()) });
    const page = openWebviewPage(renderPage('searchPage'), { ...snapshot, originQuery: '#risk/vendor' });
    try {
      page.click('[data-action="create-hub"]');
      assert.deepStrictEqual(page.lastPosted('createHubNote'), { type: 'createHubNote' });
      // The Notes and Tasks tabs are the shared result tabs, and each counts
      // what its pane shows.
      const tabs = page.findAll('[role="tab"][data-action="set-result-tab"]');
      assert.deepStrictEqual(tabs.map((tab) => tab.textContent), ['Notes (1)', 'Tasks (2)']);
      assert.deepStrictEqual(tabs.map((tab) => tab.getAttribute('data-tab')), ['notes', 'tasks']);
      // Clearing returns the page to the search it was opened with, so the
      // field's × is not drawn while the box holds only that.
      assert.strictEqual((page.find('[data-action="clear-query"]') as HTMLElement).hidden, true);
      // While the sidebar shows this search's Refine, the page says so in its place.
      page.send({ ...snapshot, originQuery: '#risk/vendor', refineInSidebar: true });
      assert.match(page.text('.query-facets') ?? '', /In the Context sidebar\./);
      // Side by side, there are no tabs, and each pane's heading counts it.
      page.send({ ...snapshot, layout: 'split' });
      assert.strictEqual(page.findAll('[role="tab"]').length, 0);
      assert.deepStrictEqual(page.findAll('.overview-split .overview-pane-heading').map((heading) => heading.textContent), ['Notes (1)', 'Tasks (2)']);
    } finally {
      page.dispose();
      store.repository.dispose();
    }
  });

  test('renders formatted related-note relevance explanations', () => {
    const html = withSheets(renderPage('sidebarNotes'));

    // Each result explains its score: the reasons, then each signal's
    // weight to two places, and the adjustment for a common tag in points.
    const page = openWebviewPage(renderPage('sidebarNotes'), {
      activeFileName: 'today.md',
      activeTags: [],
      state: 'ready',
      notes: [{
        sectionId: 'section-1', filePath: 'notes/atlas.md', title: 'Actions', fileName: 'atlas.md', sourceLine: 12,
        headingPath: ['Atlas', 'Harbor', 'Pier', 'Actions'], titleTags: [], matchedTags: [], matchCount: 1, totalTagCount: 1, overlap: 1,
        relevanceScore: 84,
        reasons: ['Shares #project/atlas', 'Linked from this note'],
        relevanceEvidence: {
          directTagWeight: 1.5, associationWeight: 0.4, normalizedAssociationWeight: 0.4, appliedAssociationWeight: 0.4,
          entryLinkWeight: 0, fileLinkWeight: 0.25, lexicalWeight: 0, recencyWeight: 0, specificityPenalty: 0.2, lexicalTerms: [],
        },
      }],
    });
    try {
      assert.deepStrictEqual(
        page.findAll('.relevance-tooltip-header strong').map((cell) => cell.textContent),
        ['Relevance score', '84%'],
      );
      assert.deepStrictEqual(page.findAll('.relevance-tooltip li').map((reason) => reason.textContent), ['Shares #project/atlas', 'Linked from this note']);
      assert.deepStrictEqual(
        page.findAll('.relevance-weights > *').map((cell) => cell.textContent),
        ['Shared-tag weight', '1.50', 'Association weight', '0.40', 'File-link weight', '0.25', 'Specificity adjustment', '-20 pts'],
      );
      assert.strictEqual(page.text('.relevance-reason'), 'Shares #project/atlas', 'the first reason under the card');
      // Where the result sits, with the file's own name and the entry's left
      // off, each step joined by the chevron the rule below colors.
      assert.strictEqual(page.text('.heading-path'), 'Harbor > Pier');
      assert.strictEqual(page.findAll('.heading-path .heading-path-joiner').length, 1);
    } finally {
      page.dispose();
    }
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
      html.includes('.tag-namespace { color: var(--muted); }'),
      true,
    );
        assert.strictEqual(
      html.includes(
        '.tag-weight-rail-segment { display: block; width: 4px; height: 3px; border-radius: 1px; background: var(--muted); opacity: .3; }',
      ),
      true,
    );
                                // Inline tags keep the sidebar's compact size; color, margin and
    // alignment come from the shared .tag-open and .inline-tag rules.
    assert.strictEqual(
      html.includes(
        '.inline-tag { display: inline-block; min-height: 0; padding: 1px 4px; border-width: 1px; font-size: .85em; }',
      ),
      true,
    );
    assert.strictEqual(
      html.includes(
        '.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); font-size: var(--text-xs); text-align: left; }',
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
                                                                                                                                                      });

  test('every theme defers to a high contrast editor theme', () => {
    const contrast = readSheet('shared/highContrast.css');
    const block = /body\.vscode-high-contrast, body\.vscode-high-contrast-light \{([^}]*)\}/.exec(contrast);
    assert.ok(block, 'a high contrast block');
    assert.ok(block[1].includes('--text: var(--vscode-foreground);'), 'the text is the editor\'s own');
    assert.ok(block[1].includes('--grid-line: transparent;'), 'the grid goes');
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(block[1]), 'the block names no color of its own');
    assert.ok(contrast.includes('@media (forced-colors: active)'), 'forced colors are tidied too');
    // Laid down after the theme, and before zen, which stays the last layer.
    const page = renderPage('stats', { chrome: readPageChrome() });
    assert.ok(pageSheets(page).includes(contrast), 'every page carries the block');
    const linked = linkedSheets(page);
    assert.ok(linked.indexOf('tail.css') > linked.indexOf(`themes/${getDeckardTheme()}.css`), 'after the theme');
    const tail = readSheet('shared/tail.css');
    assert.ok(tail.indexOf('@import "./highContrast.css";') < tail.indexOf('@import "./display.css";'), 'before Display');
    for (const theme of deckardThemes) {
      assert.ok(!themeSheet(theme).includes('vscode-high-contrast {'), `${theme}: no theme second-guesses it`);
    }
  });
});
