import * as assert from 'assert';

import * as vscode from 'vscode';

import { PreferencesStore } from '../core/storage/preferences';
import { SearchStore } from '../core/storage/searchStore';
import { PersistedPreferences } from '../core/types';
import { formatCapture } from '../ui/commands/capture';
import { WikiLinkCompletionProvider } from '../ui/commands/linkSuggestions';
import { createQuerySuggestions, createSearchPageSnapshot } from '../ui/state/dashboardState';
import { buildQuickFindResults } from '../ui/state/quickFindState';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { indexWithParking } from './parkedFixture';
import { openWebviewPage } from './webviewPage';
import { createQueryContext } from '../domain/query/queryContext';

function defaults(values: Partial<PersistedPreferences> = {}): PersistedPreferences {
  const store = new PreferencesStore({
    get: () => undefined,
    keys: () => [],
    update: async () => undefined,
  } as never);
  const value = { ...store.value, ...values };
  store.dispose();
  return value;
}

/** An archived note whose title matches the search better than the live one. */
function workspace() {
  return indexWithParking(
    {
      'archive/Vendor.md': '# Vendor #vendor/old\nThe vendor, the vendor, the vendor.\n- [ ] Vendor call\n',
      'notes/Weekly.md': '# Weekly vendor review #vendor/new\nOne line about the vendor.\n- [ ] Ask the vendor again\n',
    },
    { folders: ['archive'] },
  );
}

suite('Searches keep parked notes, last', () => {
  test('a search page lists a parked note and task after the rest, and marks them', () => {
    const index = workspace();
    const page = createSearchPageSnapshot(index, defaults(), 'vendor', { queryContext: createQueryContext(Date.now()) });
    assert.deepStrictEqual(
      page.sections.map((card) => [card.filePath, card.parked === true]),
      [
        ['notes/Weekly.md', false],
        ['archive/Vendor.md', true],
      ],
    );
    assert.deepStrictEqual(
      page.tasks.map((item) => [item.task.filePath, item.parked === true]),
      [
        ['notes/Weekly.md', false],
        ['archive/Vendor.md', true],
      ],
    );
  });

  test('Refine offers Parked and Not parked when the results mix them', () => {
    const index = workspace();
    const mixed = createSearchPageSnapshot(index, defaults(), 'vendor', { queryContext: createQueryContext(Date.now()) });
    const facet = mixed.query.facets.find((candidate) => candidate.id === 'parked');
    assert.deepStrictEqual(
      facet?.values.map((value) => [value.label, value.clause, value.count]),
      [
        ['Parked', 'is:parked', 2],
        ['Not parked', '-is:parked', 2],
      ],
    );
    const only = createSearchPageSnapshot(index, defaults(), '#vendor/new', { queryContext: createQueryContext(Date.now()) });
    assert.ok(!only.query.facets.some((candidate) => candidate.id === 'parked'));
  });

  test('the Tags facet leaves out a tag only parked notes carry, unless asked', () => {
    const index = workspace();
    const tagsOf = (query: string): string[] =>
      createSearchPageSnapshot(index, defaults(), query, { queryContext: createQueryContext(Date.now()) })
        .query.facets.find((candidate) => candidate.id === 'tags')
        ?.values.map((value) => value.clause) ?? [];
    assert.ok(!tagsOf('vendor').includes('#vendor/old'));
    assert.ok(tagsOf('vendor').includes('#vendor/new'));
    assert.ok(tagsOf('text ~ vendor OR is:parked').includes('#vendor/old'));
  });

  test('Find ranks a parked title match after a weaker unparked one, and says Parked', () => {
    const index = workspace();
    const store = new SearchStore(undefined);
    store.replace(index.files.values());
    try {
      const results = buildQuickFindResults(
        index,
        defaults(),
        'vendor',
        (text) => store.searchEntries(text, { limit: 200 }),
        {
          queryContext: createQueryContext(Date.now()),
          conditions: createQuerySuggestions(index, [], createQueryContext(Date.now())).conditions,
          formatCapture: (text) => formatCapture(text, Date.now()),
        },
      );
      assert.deepStrictEqual(
        results.notes.map((note) => [note.filePath, note.description]),
        [
          ['notes/Weekly.md', 'Weekly.md'],
          ['archive/Vendor.md', 'Vendor.md · Parked'],
        ],
      );
    } finally {
      store.dispose();
    }
  });

  test('[[ offers a parked note after the rest', async () => {
    const index = indexWithParking(
      { 'archive/Atlas.md': '# Atlas\n', 'notes/Atlas plan.md': '# Atlas plan\n' },
      { folders: ['archive'] },
    );
    const provider = new WikiLinkCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () => index,
    });
    const document = {
      uri: vscode.Uri.file('/tmp/deckard/notes/case.md'),
      lineAt: () => ({ text: 'See [[atlas' }),
    } as unknown as vscode.TextDocument;
    const items = await provider.provideCompletionItems(document, new vscode.Position(0, 11));
    assert.deepStrictEqual(
      items.map((item) => [item.label, item.detail]),
      [
        ['Atlas plan', 'notes/Atlas plan.md'],
        ['Atlas', 'archive/Atlas.md · Parked'],
      ],
    );
    provider.dispose();
  });

  test('a search page says Parked on a parked card and task, and nowhere else', () => {
    const snapshot = createSearchPageSnapshot(workspace(), defaults(), 'vendor', { queryContext: createQueryContext(Date.now()) });
    const page = openWebviewPage(getSearchPageHtml({ cspSource: 'vscode-webview://deckard' }), snapshot);
    try {
      const cards = page.findAll('article.card');
      assert.deepStrictEqual(
        cards.map((card) => [card.getAttribute('data-parked'), card.querySelector('.parked-label')?.textContent ?? '']),
        [
          ['false', ''],
          ['true', 'Parked'],
        ],
      );
      assert.strictEqual(page.findAll('.task-row .parked-label').length, 1);
    } finally {
      page.dispose();
    }
  });
});
