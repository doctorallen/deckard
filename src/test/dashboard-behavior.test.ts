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
  ): { page: WebviewPage; snapshot: DashboardSnapshot } => {
    const index = buildWorkspaceIndex(
      new Map(
        Object.entries(NOTES).map(([path, content]) => [
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

  const browsing = (changes: Partial<PersistedPreferences> = {}) =>
    open({
      dashboardViewState: { mode: 'browse', tagSearchQuery: '' },
      ...changes,
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

  test('draws the widgets Home is set to show', () => {
    const { page, snapshot } = open();

    assert.ok((snapshot.widgets?.length ?? 0) > 0, 'Home starts with widgets');
    assert.strictEqual(
      page.findAll('.home-widget').length,
      snapshot.widgets?.length,
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
