import * as assert from 'assert';

import { getPageTailCss } from '../ui/webview/components';

suite('Display choices on the page body', () => {
  test('the body is marked only for a choice that isn\'t the default, after zen', () => {
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: false }).bodyAttribute, '');
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: true }).bodyAttribute, ' class="zen"');
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: false, display: { cards: 'flat' } }).bodyAttribute, ' data-cards="flat"');
    assert.strictEqual(
      getPageTailCss({ theme: 'lcars', zen: true, display: { cards: 'flat', tags: 'text' } }).bodyAttribute,
      ' class="zen" data-cards="flat" data-tags="text"',
    );
  });
});
