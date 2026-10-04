import * as assert from 'assert';

import { getPageTailCss } from '../ui/webview/components';

suite('Display choices on the page body', () => {
  test('the body is marked only for a choice that isn\'t the default, after zen', () => {
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: false }).bodyAttribute, '');
    assert.strictEqual(
      getPageTailCss({ theme: 'cooper', zen: true }).bodyAttribute,
      ' class="zen" data-styling="plain" data-help="hidden" data-density="compact"',
      'zen with no choices given draws as Zen does',
    );
    assert.strictEqual(
      getPageTailCss({ theme: 'cooper', zen: false, display: { styling: 'plain', help: 'hidden' } }).bodyAttribute,
      ' data-styling="plain" data-help="hidden"',
      'Quiet',
    );
    assert.strictEqual(
      getPageTailCss({ theme: 'cooper', zen: false, display: { counts: 'hidden', fileAndLine: 'never', dates: 'date' } }).bodyAttribute,
      ' data-counts="hidden" data-file-line="never" data-dates="date"',
      'the preferences',
    );
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: false, display: { cards: 'flat' } }).bodyAttribute, ' data-cards="flat"');
    assert.strictEqual(
      getPageTailCss({ theme: 'lcars', zen: true, display: { cards: 'flat', tags: 'text' } }).bodyAttribute,
      ' class="zen" data-cards="flat" data-tags="text"',
    );
  });
});
