import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences, TestPreferences } from './preferenceServices';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { createQueryContext } from '../domain/query/queryContext';
import { PersistedPreferences } from '../domain/model';
import { DashboardSnapshot } from '../ui/protocol/dashboard';

/**
 * What the Dashboard does with the workspace it is given, driven as VS Code
 * drives it. These replace the checks that matched its script as text; see
 * `webviewPage.ts`.
 */
suite('Dashboard behavior', () => {
  let page: WebviewPage | undefined;
  let store: TestPreferences | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.repository.dispose();
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
    store = createPreferences(new MemoryMemento());
    const preferences = { ...store.reader.value, ...changes };
    const snapshot: DashboardSnapshot = {
      ...createDashboardSnapshot({ index, preferences, queryContext: createQueryContext(Date.now()) }),
      ...(preferences.dashboardViewState.mode === 'home'
        ? {
            widgets: createDashboardWidgets(index, preferences, {
              queryContext: createQueryContext(Date.now()),
            }),
          }
        : {}),
    };
    page = openWebviewPage(
      renderPage('dashboard'),
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

  test('groups and names a tag by the namespace the parser reads, not its key as written', () => {
    const index = buildWorkspaceIndex(new Map([['notes/acme.md', parseMarkdown('notes/acme.md', '# Acme #org/acme')]]));
    // The index keys its tags canonically, so a key written another way can
    // only be made by hand. Aliases are applied once, where text comes in,
    // so a key is read as keyed; its case is still read as the parser reads it.
    const acme = index.tags.get('#org/acme')!;
    index.tags.set('#Org/Beta', { ...acme, key: '#Org/Beta', label: '#Org/Beta' });
    store = createPreferences(new MemoryMemento());
    const preferences = { ...store.reader.value, dashboardViewState: { mode: 'browse' as const, tagSearchQuery: '' } };
    page = openWebviewPage(renderPage('dashboard'), {
      ...createDashboardSnapshot({ index, preferences, queryContext: createQueryContext(Date.now()) }),
    });

    const kinds = page.findAll('.entity-kind').map((kind) => kind.textContent);
    assert.deepStrictEqual(kinds, ['org', 'org']);
    const options = page.findAll('[data-action="set-tag-namespace"] option').map((option) => option.getAttribute('value'));
    assert.deepStrictEqual(options.filter((value) => value && value !== '/'), ['org'], 'one namespace to filter by');
  });

  test('leads with what is due today, then overdue, then done this week, each a search', () => {
    const { page, snapshot } = open();
    const labels = page
      .findAll('.metrics .metric-label')
      .map((label) => label.textContent);
    assert.deepStrictEqual(labels, ['Due today', 'Overdue', 'Done this week']);
    const values = page
      .findAll('.metrics .metric-value')
      .map((value) => Number(value.textContent));
    const glance = snapshot.taskGlance!;
    assert.deepStrictEqual(values, [glance.today, glance.overdue, glance.doneThisWeek]);
    assert.deepStrictEqual(
      page.findAll('.metrics .metric-open').map((tile) => tile.getAttribute('data-query')),
      ['is:today', 'is:overdue -is:needs-date', 'done >= this-week'],
    );
    assert.strictEqual(page.find('.metrics')?.getAttribute('aria-label'), 'Tasks at a glance');
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
    // Try next, with nothing to suggest, draws nothing at all.
    assert.strictEqual(
      page.findAll('.home-widget').length,
      snapshot.widgets?.filter((widget) => widget.kind !== 'tryNext' || widget.tryNext).length,
    );
  });

  test('a widget that leads somewhere makes its title the link, and only while Home is at rest', () => {
    const { page } = open({
      dashboardWidgets: [
        { id: 'a', kind: 'agenda', width: 'half' },
        { id: 'q', kind: 'quickAdd', width: 'half' },
      ],
    });
    const link = page.find('.home-widget[data-widget-id="a"] h2.home-widget-title > button.home-widget-link');
    assert.strictEqual(link.getAttribute('data-action'), 'open-view');
    assert.strictEqual(link.getAttribute('data-view'), 'agenda');
    assert.match(link.textContent ?? '', /^Tasks view \d+›$/);
    assert.strictEqual(link.querySelector('.home-widget-link-mark')?.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(page.document.querySelector('.home-widget-actions'), null, 'no separate button beside the title');
    assert.strictEqual(page.document.querySelector('.home-widget[data-widget-id="q"] .home-widget-link'), null, 'Quick add leads nowhere');

    // While arranging, a press on the title starts a drag.
    page.click('[data-action="customize-home"]');
    assert.strictEqual(page.document.querySelector('.home-widget-link'), null);
    assert.ok(page.find('.home-widget[data-widget-id="a"] .home-widget-actions'), 'the controls keep the header');
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

  test('sends each tag\'s name and count, and draws the Tags tab only when it is open', () => {
    const { page, snapshot } = open();
    assert.deepStrictEqual(Object.keys(snapshot.tags[0]).sort(), ['count', 'isFavorite', 'key', 'label', 'namespace']);
    assert.deepStrictEqual(Object.keys(snapshot.entities[0] ?? { count: 0, isFavorite: false, key: '', kind: '', label: '' }).sort(), ['count', 'isFavorite', 'key', 'kind', 'label']);
    assert.strictEqual(page.findAll('.tag-row').length, 0, 'Home builds no tag rows');
    page.click('[data-action="set-dashboard-mode"][data-dashboard-mode="browse"]');
    assert.ok(page.findAll('.tag-row').length > 0, 'the Tags tab draws them when opened');
  });

  test('a large workspace\'s Dashboard snapshot stays small', () => {
    const notes: Record<string, string> = {};
    for (let file = 0; file < 40; file += 1) {
      notes[`notes/n${file}.md`] = Array.from({ length: 50 }, (_, tag) => `## E${tag} #t${file}-${tag} #shared`).join('\n');
    }
    const index = buildWorkspaceIndex(new Map(Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)])));
    store = createPreferences(new MemoryMemento());
    const size = JSON.stringify(createDashboardSnapshot({ index, preferences: store.reader.value, queryContext: createQueryContext(Date.now()) })).length;
    assert.ok(index.tags.size >= 2000, `${index.tags.size} tags`);
    assert.ok(size < 300 * 1024, `${Math.round(size / 1024)} KB`);
  });

  test('a removed widget can be put back where it was, for a moment', () => {
    const { page } = open({
      dashboardWidgets: [
        { id: 'a', kind: 'topTags', width: 'full', count: 3 },
        { id: 'b', kind: 'topTags', width: 'half', count: 5 },
      ],
    });
    page.click('[data-action="customize-home"]');
    page.click('[data-action="remove-widget"][data-widget-id="a"]');
    const removed = page.lastPosted('setDashboardWidgets')?.widgets as Array<{ id: string }>;
    assert.deepStrictEqual(removed.map((widget) => widget.id), ['b']);
    assert.match(page.text('#undo-toast .undo-notice') ?? '', /^Removed .+\. Undo$/);
    assert.strictEqual(page.document.activeElement, page.find('[data-action="undo-remove-widget"]'), 'focus is on Undo');
    page.click('[data-action="undo-remove-widget"]');
    const back = page.lastPosted('setDashboardWidgets')?.widgets as Array<Record<string, unknown>>;
    assert.deepStrictEqual(back.map((widget) => widget.id), ['a', 'b'], 'back at its place');
    assert.deepStrictEqual(back[0], { id: 'a', kind: 'topTags', width: 'full', count: 3 }, 'with its width and options');
    assert.strictEqual(page.findAll('.undo-notice').length, 0);
  });

  test('Reset widgets asks the host, which confirms in a modal', () => {
    const { page } = open();
    page.click('[data-action="customize-home"]');
    page.click('[data-action="reset-widgets"]');
    assert.deepStrictEqual(page.lastPosted('resetDashboardWidgets'), { type: 'resetDashboardWidgets' });
    assert.strictEqual(page.findAll('.home-reset-confirm').length, 0, 'no inline confirmation');
  });

  test('tells the host what + Add widget offers, and adds one the host sends, customizing first', () => {
    const { page } = open();
    const choices = page.lastPosted('widgetChoices')?.choices as Array<{ value: string }>;
    assert.ok(choices.some((choice) => choice.value === 'topTags'), 'the list the select offers');
    page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'addWidget', value: 'topTags' } }));
    assert.ok(page.find('.home-edit-bar'), 'Home is customizing');
    const widgets = page.lastPosted('setDashboardWidgets')?.widgets as Array<{ kind: string }>;
    const at = widgets[0].kind === 'tryNext' ? 1 : 0;
    assert.strictEqual(widgets[at].kind, 'topTags', 'added first, after Try next, where it is seen');
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

  test('keeps Customize Home beside the tabs, arranged or not, and not while arranging', () => {
    const { page, snapshot } = open();
    assert.strictEqual(page.text('.dashboard-customize'), 'Customize Home');
    assert.strictEqual(page.document.querySelector('.home-hint-bar'), null, 'no line to put away');
    page.send({ ...snapshot, homeArranged: true });
    assert.ok(page.find('.dashboard-customize'), 'still there once Home is arranged');
    page.click('.dashboard-customize');
    assert.strictEqual(page.document.querySelector('.dashboard-customize'), null, 'arranging has its own Finish');
  });

  test('an empty workspace is offered today\'s note and the sample tour', () => {
    const { page, snapshot } = open();
    page.send({ ...snapshot, totalNoteCount: 0 });
    assert.match(page.text('.home-start p') ?? '', /work sample/);
    assert.ok(page.find('.home-start [data-view="sampleWorkspace"]'));
    // Creating today's note is the one thing an empty Home commits.
    assert.deepStrictEqual(page.findAll('.primary').map((button) => button.getAttribute('data-action')), ['open-daily-note']);
    // Get Started takes the grid's place: no widget says it has nothing to show.
    assert.strictEqual(page.document.querySelector('.home-grid'), null);
    // Customizing draws the grid it arranges, and puts Get Started away.
    page.click('[data-action="customize-home"]');
    assert.ok(page.find('.home-grid'));
    assert.strictEqual(page.document.querySelector('.home-start'), null);
  });

  test('Try next draws one card, or nothing at all', () => {
    const { page, snapshot } = open();
    const tryNext = { id: 'tryNext', kind: 'tryNext', width: 'full', title: 'Try next' };
    page.send({ ...snapshot, widgets: [tryNext, ...(snapshot.widgets ?? [])] });
    assert.strictEqual(page.document.querySelector('.home-widget[data-widget-id="tryNext"]'), null, 'no empty box');

    const suggestion = { id: 'taskBoard', key: 'taskBoard', text: 'You have 42 open tasks.', action: { label: 'Open Task board' } };
    page.send({ ...snapshot, widgets: [{ ...tryNext, tryNext: suggestion }, ...(snapshot.widgets ?? [])] });
    assert.strictEqual(page.text('.try-next-text'), 'You have 42 open tasks.');
    assert.deepStrictEqual(
      page.findAll('.try-next-actions button').map((button) => button.textContent),
      ['Open Task board', 'Not now', 'Do not suggest this'],
    );
    // A suggestion leads somewhere; it commits nothing, so nothing is filled.
    assert.deepStrictEqual(page.findAll('.primary, .try-next-actions .active'), []);
    page.click('[data-action="run-try-next"]');
    assert.deepStrictEqual(page.lastPosted('runTryNext'), { type: 'runTryNext', key: 'taskBoard' });
    page.click('[data-action="snooze-try-next"]');
    assert.deepStrictEqual(page.lastPosted('snoozeTryNext'), { type: 'snoozeTryNext', key: 'taskBoard' });
    page.click('[data-action="retire-try-next"]');
    assert.deepStrictEqual(page.lastPosted('retireTryNext'), { type: 'retireTryNext', key: 'taskBoard' });
  });

  test('the gear leads back to the walkthrough', () => {
    const { page } = open();
    page.click('[data-action="open-view"][data-view="walkthrough"]');
    assert.deepStrictEqual(page.lastPosted('openView'), { type: 'openView', view: 'walkthrough' });
  });

  test('after an update, says so in the hint line first', () => {
    const { page, snapshot } = open();
    page.send({ ...snapshot, whatsNew: { version: '1.23' } });
    assert.strictEqual(page.text('.home-hint-bar span'), 'Updated to Deckard 1.23.');
    page.click('[data-action="open-whats-new"]');
    assert.ok(page.lastPosted('openWhatsNew'));
    page.click('[data-action="dismiss-whats-new"]');
    assert.ok(page.lastPosted('dismissWhatsNew'));

    page.send({ ...snapshot });
    assert.strictEqual(page.document.querySelector('.home-hint-bar'), null, 'and says nothing once it is dismissed');
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
