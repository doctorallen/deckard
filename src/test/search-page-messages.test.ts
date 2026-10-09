import * as assert from 'assert';

import { narrowSearchPageMessage } from '../ui/webview/pages/searchPage/messages';

// A search page's narrowing table, with the payloads parseSearchPageMessage
// was held to before it moved, from messages-rendering, parked-commands,
// bulk-edit, search-history, and pinned-notes: each accepted message, and
// each refused one.
suite('Search page messages', () => {
  test('accepts only supported search page messages', () => {
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'setRenderMode', mode: 'html' }),
      {
        type: 'setRenderMode',
        mode: 'html',
      },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'saveTagOverviewFilter', query: '#project/atlas planning' }),
      { type: 'saveTagOverviewFilter', query: '#project/atlas planning' },
    );
    // Save names the search the box holds, which the page must say.
    assert.strictEqual(narrowSearchPageMessage({ type: 'saveTagOverviewFilter' }), undefined);
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'saveTagOverviewFilter', query: 'x'.repeat(2001) }),
      undefined,
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'setResultPage', kind: 'tasks', page: 3 }),
      { type: 'setResultPage', kind: 'tasks', page: 3 },
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setResultPage', kind: 'everything', page: 3 }),
      undefined,
    );
    // A page number is a whole number of at least one, whatever a page that
    // had been tampered with might ask for.
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setResultPage', kind: 'notes', page: 0 }),
      undefined,
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setResultPage', kind: 'notes', page: 1.5 }),
      undefined,
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setResultPage', kind: 'notes', page: '2' }),
      undefined,
    );
    assert.strictEqual(
      narrowSearchPageMessage({
        type: 'saveTagOverviewFilter',
        query: '#project/atlas',
        tagKeys: ['#untrusted', '#browser-data'],
      }),
      undefined,
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setRenderMode', mode: 'unsafe' }),
      undefined,
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({
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
      narrowSearchPageMessage({
        type: 'toggleTask',
        taskId: 'task-1',
        completed: 'yes',
      }),
      undefined,
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setTaskFilter', filter: 'active' }),
      undefined,
      'the search is the filter; the page keeps none of its own',
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'openTag', tagKey: 'other' }),
      { type: 'openTag', tagKey: 'other' },
    );
    // Opening a tag opens its page; tags added to a search are in its text.
    assert.deepStrictEqual(
      narrowSearchPageMessage({
        type: 'openTag',
        tagKey: '#focus',
        filterTagKeys: ['#first', '#second'],
      }),
      { type: 'openTag', tagKey: '#focus' },
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'openTag', tagKey: '' }),
      undefined,
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setOverviewRefinement', refinement: 'x' }),
      undefined,
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'setSearchColumns', section: 'notes', columns: 3 }),
      { type: 'setSearchColumns', section: 'notes', columns: 3 },
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'setSearchColumns', section: 'tags', columns: 3 }),
      undefined,
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'clearOverviewQuery' }),
      { type: 'clearOverviewQuery' },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({
        type: 'renameTag',
        tagKey: '#child',
      }),
      { type: 'renameTag', tagKey: '#child' },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({
        type: 'setTagOverviewSort',
        mode: 'access',
      }),
      { type: 'setTagOverviewSort', mode: 'access' },
    );
    assert.strictEqual(
      narrowSearchPageMessage({
        type: 'setTagOverviewSort',
        mode: 'random',
      }),
      undefined,
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({
        type: 'setTagOverviewLayout',
        layout: 'split',
      }),
      { type: 'setTagOverviewLayout', layout: 'split' },
    );
    assert.strictEqual(
      narrowSearchPageMessage({
        type: 'setTagOverviewLayout',
        layout: 'stacked',
      }),
      undefined,
    );
  });

  test('accepts a request for a hub note, and nothing more', () => {
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'createHubNote' }), {
      type: 'createHubNote',
    });
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'createHubNote', tagKey: '#other' }),
      undefined,
    );
  });

  test('accepts park messages and nothing else like them', () => {
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'parkTag', tagKey: '#a' }), { type: 'parkTag', tagKey: '#a' });
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'unparkNote', filePath: 'a.md' }), { type: 'unparkNote', filePath: 'a.md' });
    assert.strictEqual(narrowSearchPageMessage({ type: 'parkNote', filePath: '' }), undefined);
    assert.strictEqual(narrowSearchPageMessage({ type: 'parkTag', tagKey: '#a', extra: 1 }), undefined);
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'unparkTag', tagKey: '#a' }), { type: 'unparkTag', tagKey: '#a' });
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'parkNote', filePath: 'a.md' }), { type: 'parkNote', filePath: 'a.md' });
    assert.strictEqual(narrowSearchPageMessage({ type: 'parkNote', filePath: 'a.md', extra: 1 }), undefined);
    assert.strictEqual(narrowSearchPageMessage({ type: 'parkNote', filePath: 'a'.repeat(4097) }), undefined);
    assert.strictEqual(narrowSearchPageMessage({ type: 'parkTag', tagKey: '' }), undefined);
  });

  test('accepts the edit the page posts, and nothing else', () => {
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'editResults', kind: 'tasks' }),
      { type: 'editResults', kind: 'tasks' },
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'editResults', kind: 'everything' }),
      undefined,
    );
  });

  test('accepts only a step back or forward from the page', () => {
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'navigateSearchHistory', direction: 'back' }),
      { type: 'navigateSearchHistory', direction: 'back' },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'navigateSearchHistory', direction: 'forward' }),
      { type: 'navigateSearchHistory', direction: 'forward' },
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'navigateSearchHistory', direction: 'up' }),
      undefined,
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'navigateSearchHistory', direction: 'back', query: '#a' }),
      undefined,
    );
  });

  test('accepts the pin a search result posts', () => {
    assert.deepStrictEqual(
      narrowSearchPageMessage({
        type: 'pinNote',
        filePath: 'notes/atlas.md',
        line: 5,
      }),
      { type: 'pinNote', filePath: 'notes/atlas.md', line: 5 },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'unpinNote', filePath: 'notes/atlas.md' }),
      { type: 'unpinNote', filePath: 'notes/atlas.md' },
    );
    assert.strictEqual(
      narrowSearchPageMessage({ type: 'pinNote', filePath: '' }),
      undefined,
    );
  });

  test('runs a search no longer than a search may be, remembered unless the page says not', () => {
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'setOverviewQuery', query: '#a' }),
      { type: 'setOverviewQuery', query: '#a', remember: true },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'setOverviewQuery', query: '#a', remember: false }),
      { type: 'setOverviewQuery', query: '#a', remember: false },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'setOverviewQuery', query: 'x'.repeat(2000), extra: 1 }),
      { type: 'setOverviewQuery', query: 'x'.repeat(2000), remember: true },
      'one field the host does not read is let through',
    );
    for (const message of [
      { type: 'setOverviewQuery', query: 'x'.repeat(2001) },
      { type: 'setOverviewQuery', query: 3 },
      { type: 'setOverviewQuery', query: '#a', remember: 'no' },
      { type: 'setOverviewQuery', query: '#a', remember: true, extra: 1 },
    ]) {
      assert.strictEqual(narrowSearchPageMessage(message), undefined, JSON.stringify(message).slice(0, 80));
    }
  });

  test('accepts a short draft of short words, and a page size the page offers', () => {
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'previewSearch', words: ['ledger', 'x'.repeat(100)] }),
      { type: 'previewSearch', words: ['ledger', 'x'.repeat(100)] },
    );
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'previewSearch', words: [] }), { type: 'previewSearch', words: [] });
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'setResultsPerPage', size: 50 }), { type: 'setResultsPerPage', size: 50 });
    for (const message of [
      { type: 'previewSearch', words: Array(13).fill('w') },
      { type: 'previewSearch', words: [''] },
      { type: 'previewSearch', words: ['x'.repeat(101)] },
      { type: 'previewSearch', words: [3] },
      { type: 'previewSearch', words: 'ledger' },
      { type: 'setResultsPerPage', size: 7 },
      { type: 'setResultsPerPage', size: '10' },
    ]) {
      assert.strictEqual(narrowSearchPageMessage(message), undefined, JSON.stringify(message).slice(0, 80));
    }
  });

  test('merges two different keys of a sensible length', () => {
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'mergeTags', sourceKey: '#a', targetKey: '#b', extra: 1 }),
      { type: 'mergeTags', sourceKey: '#a', targetKey: '#b' },
    );
    for (const message of [
      { type: 'mergeTags', sourceKey: '#a', targetKey: '#a' },
      { type: 'mergeTags', sourceKey: '', targetKey: '#a' },
      { type: 'mergeTags', sourceKey: '#a', targetKey: 'x'.repeat(501) },
    ]) {
      assert.strictEqual(narrowSearchPageMessage(message), undefined, JSON.stringify(message).slice(0, 80));
    }
  });

  test('keeps only the fields the host reads, and refuses what no page sends', () => {
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'chooseTheme', extra: 1 }), { type: 'chooseTheme' });
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'openSource', filePath: 'notes/a.md', line: 3, beside: false, pin: true, extra: 1 }),
      { type: 'openSource', filePath: 'notes/a.md', line: 3, pin: true },
    );
    assert.deepStrictEqual(
      narrowSearchPageMessage({ type: 'exportResults', kind: 'notes', extra: 1 }),
      { type: 'exportResults', kind: 'notes' },
    );
    assert.deepStrictEqual(narrowSearchPageMessage({ type: 'setZenMode', enabled: false }), { type: 'setZenMode', enabled: false });
    for (const message of [
      undefined,
      'openHelp',
      { type: 'openHelp', section: 'periodic' },
      { type: 'excludeHubLinks', now: true },
      { type: 'setZenMode', enabled: 'on' },
      { type: 'exportResults', kind: 'tags' },
      { type: 'openSource', filePath: 'notes/a.md', line: 0 },
      { type: 'openSource', filePath: 'notes/a.md', line: 1, beside: 'yes' },
      { type: 'openSearch', query: '#a' },
      { type: 'constructor' },
      { type: 'toString' },
    ]) {
      assert.strictEqual(narrowSearchPageMessage(message), undefined, JSON.stringify(message));
    }
  });

  test("accepts a type's page's messages, each naming its type, and nothing like them", () => {
    const accepted = [
      { type: 'setTypeSort', typeKey: 'team', column: 'lead', direction: 'desc' },
      { type: 'setTypeSort', typeKey: 'team' },
      { type: 'setTypeColumns', typeKey: 'team', columns: ['title', 'lead'] },
      { type: 'setTypeGroup', typeKey: 'team', field: 'tier' },
      { type: 'setTypeGroup', typeKey: 'team' },
      { type: 'addTypeRow', typeKey: 'team' },
      { type: 'openTypeNote', typeKey: 'team' },
      { type: 'createTypeFromTag', namespace: 'team' },
      { type: 'renameTypeField', typeKey: 'team', field: 'lead' },
      { type: 'editTypeField', typeKey: 'team', field: 'lead' },
      { type: 'renameTypeOption', typeKey: 'team', field: 'tier', option: 'gold' },
      { type: 'createRowHub', typeKey: 'area', rowId: '#area/fx' },
      { type: 'copyRowValue', typeKey: 'person', rowId: '@dana' },
    ];
    for (const message of accepted) {
      assert.deepStrictEqual(narrowSearchPageMessage(message), message, JSON.stringify(message));
    }
    for (const message of [
      { type: 'setTypeSort', typeKey: 'team', column: 'lead', direction: 'up' },
      { type: 'setTypeSort', column: 'lead' },
      { type: 'setTypeColumns', typeKey: 'team', columns: 'lead' },
      { type: 'setTypeColumns', typeKey: 'team', columns: Array.from({ length: 61 }, (_, at) => `c${at}`) },
      { type: 'addTypeRow', typeKey: '' },
      { type: 'addTypeRow', typeKey: 'team', title: 'Rates' },
      { type: 'createTypeFromTag', namespace: 'team', extra: true },
      { type: 'renameTypeOption', typeKey: 'team', field: 'tier' },
      { type: 'createRowHub', typeKey: 'area', rowId: '' },
    ]) {
      assert.strictEqual(narrowSearchPageMessage(message), undefined, JSON.stringify(message));
    }
  });
});
