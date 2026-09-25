import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { DashboardSnapshot, PersistedPreferences } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * What the Dashboard does with the workspace it is given, driven as VS Code
 * drives it. These replace the checks that matched its script as text; see
 * `webviewPage.ts`.
 */
suite('Dashboard behavior', () => {
  let page: WebviewPage | undefined;
  let store: PreferencesStore | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.dispose();
    store = undefined;
  });

  test('the mark on a searched Tags tab is sized by the tab, not the select corner', () => {
    const { page } = open({ dashboardViewState: { mode: 'home', tagSearchQuery: 'atlas' } });
    const mark = page.find('.dashboard-tabs .tab-search-mark svg');
    // The shared filter icon's class places it absolutely at a select's
    // corner; with the mark's own 100% sizing it once filled the page.
    assert.strictEqual(mark.classList.contains('control-icon-svg'), false);
    assert.strictEqual(mark.classList.contains('tab-search-mark-icon'), true);
  });

  test('a saved search shows its name, and keeps its criteria in the row', () => {
    const { page } = open({
      dashboardViewState: { mode: 'home', tagSearchQuery: '' },
      savedFilters: [{ id: 'f', name: 'Fun dip', tags: [], query: 'tag = #project/atlas', page: 'dashboard' } as never],
      dashboardWidgets: [{ id: 's', kind: 'savedSearches', width: 'half' }],
    });
    const row = page.find('.saved-filter-row[data-saved-filter-id="f"]');
    assert.strictEqual(row.querySelector('.saved-filter-name')?.textContent, 'Fun dip');
    // The criteria are the row's own child, so the frame they open in under
    // the pointer is inherited from the row, hover colors included.
    const criteria = row.querySelector(':scope > .saved-filter-tags');
    assert.ok(criteria, 'the criteria sit directly in the row');
    assert.match(criteria?.textContent ?? '', /tag = #project\/atlas/);
  });

  const NOTES: Record<string, string> = {
    'notes/one.md': [
      '# One #project/atlas #risk/vendor',
      'The lift is stuck.',
      '- [ ] Chase it #project/atlas',
    ].join('\n'),
    'notes/two.md': '# Two #project/atlas\nMore prose.',
  };

  const open = (
    changes: Partial<PersistedPreferences> = {},
    notes: Record<string, string> = NOTES,
  ): { page: WebviewPage; snapshot: DashboardSnapshot } => {
    const index = buildWorkspaceIndex(
      new Map(
        Object.entries(notes).map(([path, content]) => [
          path,
          parseMarkdown(path, content),
        ]),
      ),
    );
    store = new PreferencesStore(new MemoryMemento());
    const preferences = { ...store.value, ...changes };
    const snapshot: DashboardSnapshot = {
      ...createDashboardSnapshot(index, preferences),
      ...(preferences.dashboardViewState.mode === 'home'
        ? {
            widgets: createDashboardWidgets(index, preferences, {
              now: Date.now(),
              upcomingDays: 7,
              tagTitleDisplayMode: 'inline',
            }),
          }
        : {}),
    };
    page = openWebviewPage(
      getDashboardHtml(
        {
          cspSource: 'vscode-webview://deckard',
          asWebviewUri: (resource) => resource,
        },
        vscode.Uri.file('/deckard'),
      ),
      snapshot,
    );
    return { page, snapshot };
  };

  /** A workspace with enough tags for a widget to have pages of them. */
  const MANY_TAGS: Record<string, string> = {
    'notes/many.md': [
      '# Many',
      ...Array.from(
        { length: 9 },
        (_, index) => `## Entry ${index} #topic/t${index}`,
      ),
    ].join('\n'),
  };

  /** Frequent tags lists the tags a reader opens, so they have to have been. */
  const TAG_VISITS: Record<string, number> = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`#topic/t${index}`, 9 - index]),
  );

  const browsing = (changes: Partial<PersistedPreferences> = {}) =>
    open({
      dashboardViewState: { mode: 'browse', tagSearchQuery: '' },
      ...changes,
    });

  test('counts notes, tasks, and tags, in those words', () => {
    const { page, snapshot } = open();
    const labels = page
      .findAll('.metrics .metric-label')
      .map((label) => label.textContent);
    assert.deepStrictEqual(labels, ['notes', 'tasks', 'tags']);
    const values = page
      .findAll('.metrics .metric-value')
      .map((value) => Number(value.textContent));
    assert.deepStrictEqual(values, [
      snapshot.totalNoteCount,
      snapshot.totalTaskCount,
      snapshot.tags.length,
    ]);
  });

  test('moves between Home and Tags, and marks where the reader is', () => {
    const { page } = open();

    assert.strictEqual(
      page.find('[data-dashboard-mode="home"]').getAttribute('aria-selected'),
      'true',
    );

    page.click('[data-dashboard-mode="browse"]');

    assert.deepStrictEqual(page.lastPosted('setDashboardMode'), {
      type: 'setDashboardMode',
      mode: 'browse',
    });
  });

  test('opens the page of a tag in the list', () => {
    const { page } = browsing();

    page.click('.tag-row');

    assert.ok(String(page.lastPosted('openTag')?.tagKey).startsWith('#'));
  });

  test('keeps favorites above the rest, and favorites from the row', () => {
    const { page } = browsing({ favoriteTags: ['#risk/vendor'] });

    assert.deepStrictEqual(
      page.findAll('[data-tag-group]').map((group) => group.getAttribute('data-tag-group')),
      ['favorites', 'other'],
    );

    page.click('[data-action="favorite-tag"]');
    assert.ok(page.lastPosted('toggleFavorite') ?? page.lastPosted('favoriteTag'));
  });

  test('narrows the tag list as it is typed, and says what it is showing', () => {
    const { page } = browsing();

    const total = page.findAll('.tag-row').length;
    assert.ok(total > 1, 'the workspace has more than one tag');

    const search = page.find('.catalog-search') as HTMLInputElement;
    search.value = 'vendor';
    search.dispatchEvent(new page.window.Event('input', { bubbles: true }));

    const shown = page.findAll('.tag-row').filter((row) => !row.hasAttribute('hidden'));
    assert.strictEqual(shown.length, 1);
    // The whole tag list is on the page, so narrowing it is the page's own
    // business and the count it reports is of every tag it holds.
    assert.match(page.document.body.textContent ?? '', /Showing 1 of \d+ tags matching/);

    page.click('[data-action="clear-tag-search"]');
    assert.strictEqual(
      page.findAll('.tag-row').filter((row) => !row.hasAttribute('hidden')).length,
      total,
    );
  });

  test('sorts and lays out the tag list', () => {
    const { page } = browsing();

    const sort = page.find('[data-action="set-sort"]') as HTMLSelectElement;
    sort.value = 'count';
    sort.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('setTagSort'), {
      type: 'setTagSort',
      mode: 'count',
    });

    page.click('[data-action="set-columns"]');
    assert.strictEqual(page.lastPosted('setDashboardColumns')?.section, 'tags');
  });

  test('a pinned note opens at the entry it pinned, and lets go of it', () => {
    const { page } = open(
      {
        dashboardWidgets: [
          { id: 'p', kind: 'pinnedNotes', width: 'full', count: 5 },
        ],
        pinnedNotes: [
          {
            filePath: 'notes/one.md',
            heading: 'Deeper #project/atlas',
            headingLevel: 2,
            occurrence: 0,
          },
        ],
      },
      {
        'notes/one.md': [
          '# One #project/atlas',
          'Prose.',
          '## Deeper #project/atlas',
          'More prose.',
        ].join('\n'),
      },
    );

    const row = page.document.querySelector('.home-list [data-action]');
    assert.ok(row, 'the pin has a row');
    page.click('.home-list [data-action="open-source"]');
    assert.deepStrictEqual(page.lastPosted('openSource'), {
      type: 'openSource',
      filePath: 'notes/one.md',
      line: 3,
    });

    page.click('[data-action="unpin-note"]');
    const unpinned = page.lastPosted('unpinNote') as
      | { pinKey?: string }
      | undefined;
    assert.ok(unpinned?.pinKey, 'the row says which pin to let go of');
    assert.ok(
      !/[\u0000-\u001f]/.test(unpinned.pinKey),
      'a key travels through an HTML attribute, so it has to be printable',
    );
  });

  test('draws the widgets Home is set to show', () => {
    const { page, snapshot } = open();

    assert.ok((snapshot.widgets?.length ?? 0) > 0, 'Home starts with widgets');
    assert.strictEqual(
      page.findAll('.home-widget').length,
      snapshot.widgets?.length,
    );
  });

  test('shows a widget its first few entries until paging is turned on', () => {
    const { page } = open({
      dashboardWidgets: [
        { id: 'p', kind: 'topTags', width: 'full', count: 3 },
      ],
    });

    assert.strictEqual(
      page.document.querySelector('.home-widget-paging'),
      null,
      'a widget that is not paged has no pager',
    );
    // A widget's own settings live behind its gear, which Home shows while
    // it is being rearranged.
    page.click('[data-action="customize-home"]');
    page.click('.home-widget-options summary');
    assert.ok(
      page.document.querySelector('[data-action="set-widget-count"]'),
      'and offers how many to show',
    );
    assert.ok(
      page.document.querySelector('[data-action="set-widget-paged"][data-value="on"]'),
      'and offers to page it',
    );
  });

  test('turns paging on for a widget', () => {
    const { page } = open({
      dashboardWidgets: [{ id: 'p', kind: 'topTags', width: 'full', count: 3 }],
    });

    page.click('[data-action="customize-home"]');
    page.click('.home-widget-options summary');
    page.click('[data-action="set-widget-paged"][data-value="on"]');

    const posted = page.lastPosted('setDashboardWidgets');
    const widgets = posted?.widgets as Array<Record<string, unknown>>;
    assert.deepStrictEqual(
      widgets.find((widget) => widget.id === 'p'),
      { id: 'p', kind: 'topTags', width: 'full', count: 3, paged: true, page: 1 },
    );
  });

  test('a paged widget walks its entries with a chevron either way', () => {
    const { page, snapshot } = open(
      {
        tagAccessCounts: TAG_VISITS,
        dashboardWidgets: [
          { id: 'p', kind: 'topTags', width: 'full', count: 2, paged: true, page: 1 },
        ],
      },
      MANY_TAGS,
    );
    const total = snapshot.widgets?.[0].paging?.total ?? 0;
    assert.ok(total > 2, 'the workspace has more tags than one page holds');

    assert.strictEqual(page.text('.home-widget-paging .page-range'), '1\u20132 of ' + total);
    // The count reads with the steps it belongs to.
    assert.ok(
      page.find('.home-widget-steps .page-range'),
      'the range sits beside the chevrons',
    );
    // A widget is walked a page at a time, so it offers no page numbers.
    assert.strictEqual(page.document.querySelector('.page-number'), null);

    const steps = page.findAll('.home-widget-steps button');
    assert.strictEqual(steps.length, 2);
    assert.ok(steps[0].hasAttribute('disabled'), 'the first page cannot go back');
    assert.ok(!steps[1].hasAttribute('disabled'));

    steps[1].dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    const widgets = page.lastPosted('setDashboardWidgets')?.widgets as Array<
      Record<string, unknown>
    >;
    assert.strictEqual(widgets.find((widget) => widget.id === 'p')?.page, 2);
  });

  test('a paged widget chooses how many it holds, and starts again when it changes', () => {
    const { page } = open(
      {
        tagAccessCounts: TAG_VISITS,
        dashboardWidgets: [
          { id: 'p', kind: 'topTags', width: 'full', count: 2, paged: true, page: 3 },
        ],
      },
      MANY_TAGS,
    );

    const select = page.find('[data-action="set-widget-page-size"]') as HTMLSelectElement;
    // A size the control does not otherwise offer is still the one in use.
    assert.strictEqual(select.value, '2');

    select.value = '10';
    select.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    const widgets = page.lastPosted('setDashboardWidgets')?.widgets as Array<
      Record<string, unknown>
    >;
    const changed = widgets.find((widget) => widget.id === 'p');
    assert.strictEqual(changed?.count, 10);
    assert.strictEqual(changed?.page, 1, 'a different page size is a different list');
  });

  test('says Home can be arranged until it has been, or the line is put away', () => {
    const { page, snapshot } = open();
    assert.ok(
      page.document.querySelector('.home-hint-bar'),
      'a Home still holding its first widgets says it can be arranged',
    );

    page.send({ ...snapshot, homeArranged: true });
    assert.strictEqual(
      page.document.querySelector('.home-hint-bar'),
      null,
      'an arranged Home no longer says so',
    );
    assert.ok(
      page.document.querySelector('[data-action="customize-home"]'),
      'and Customize is still on the page, in the gear',
    );

    page.send({ ...snapshot, homeArranged: false });
    page.click('[data-action="dismiss-home-hint"]');
    assert.strictEqual(
      page.document.querySelector('.home-hint-bar'),
      null,
      'putting the line away removes it',
    );
    assert.strictEqual(
      (page.savedState() as { homeHintDismissed?: boolean }).homeHintDismissed,
      true,
      'and is remembered across a reload',
    );
    page.send({ ...snapshot, homeArranged: false });
    assert.strictEqual(
      page.document.querySelector('.home-hint-bar'),
      null,
      'so a later state does not bring it back',
    );
  });

  test('offers to rearrange Home, and to put it back', () => {
    const { page } = open();

    assert.strictEqual(
      page.document.querySelector('[data-action="finish-customizing"]'),
      null,
    );

    page.click('[data-action="customize-home"]');

    assert.ok(
      page.document.querySelector('[data-action="finish-customizing"]'),
      'the reader is told how to stop rearranging',
    );
    assert.ok(
      page.document.querySelector('[data-action="reset-widgets"]') ??
        page.document.querySelector('[data-action="add-widget"]'),
      'rearranging offers the controls that change what Home holds',
    );
  });
});

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as
      | T
      | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}
