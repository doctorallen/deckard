import * as assert from 'assert';

import { contextPagesKeys, pageIconContextKey, PAGES_AS_LIST_CONTEXT_KEY } from '../ui/views/contextPagesTitleBar';

suite('Context: the pages in its title bar', () => {
  test('shows each kept page as an icon in the title bar, until the reader chooses the list', () => {
    const keys = contextPagesKeys({ contextPagesHidden: ['stats'] });
    assert.strictEqual(keys[PAGES_AS_LIST_CONTEXT_KEY], false);
    assert.strictEqual(keys[pageIconContextKey('home')], true);
    assert.strictEqual(keys[pageIconContextKey('help')], true);
    assert.strictEqual(keys[pageIconContextKey('stats')], false, 'a page left out has no icon');
    assert.strictEqual(Object.keys(keys).length, 9, 'the list key and one a page');

    const list = contextPagesKeys({ contextPagesStyle: 'list' });
    assert.strictEqual(list[PAGES_AS_LIST_CONTEXT_KEY], true);
    assert.ok(Object.entries(list).every(([key, value]) => key === PAGES_AS_LIST_CONTEXT_KEY || value === false), 'as a list, no icon in the title bar');
  });
});
