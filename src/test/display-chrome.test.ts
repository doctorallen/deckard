import * as assert from 'assert';

import { getPageTailCss } from '../ui/webview/components';

suite('Display choices on the page body', () => {
  test('the body is marked only for a choice that isn\'t the default, after zen', () => {
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: false }).bodyAttribute, '');
    assert.strictEqual(
      getPageTailCss({ theme: 'cooper', zen: true }).bodyAttribute,
      ' class="zen" data-level="zen" data-styling="plain" data-help="hidden" data-density="compact" data-cards="flat" data-tags="text" data-counts="hidden" data-file-line="never" data-dates="relative"',
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
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: false, display: { width: 'full' } }).bodyAttribute, ' data-width="full"', 'page width');
    assert.strictEqual(
      getPageTailCss({ theme: 'cooper', zen: false, display: { level: 'quiet', changed: 2, styling: 'plain' } }).bodyAttribute,
      ' data-level="quiet" data-changed="2" data-styling="plain"',
      'the step and how many of its settings the reader changed, for the gear',
    );
    assert.strictEqual(getPageTailCss({ theme: 'cooper', zen: false, display: { cards: 'flat' } }).bodyAttribute, ' data-cards="flat"');
    assert.strictEqual(
      getPageTailCss({ theme: 'lcars', zen: true, display: { cards: 'flat', tags: 'text' } }).bodyAttribute,
      ' class="zen" data-cards="flat" data-tags="text"',
    );
  });

  test('the date formats are marked only when set, as attribute text', () => {
    assert.strictEqual(
      getPageTailCss({ theme: 'cooper', zen: false, display: { dateFormat: 'DD/MM/YYYY', shortDateFormat: 'D MMM', dateLocale: 'de', weekStart: 1 } }).bodyAttribute,
      ' data-date-format="DD/MM/YYYY" data-short-date-format="D MMM" data-date-locale="de" data-week-start="1"',
    );
    assert.strictEqual(
      getPageTailCss({ theme: 'cooper', zen: false, display: { dateFormat: '[Day "D"] <MMM> & \'YY' } }).bodyAttribute,
      ' data-date-format="[Day &quot;D&quot;] &lt;MMM&gt; &amp; &#39;YY"',
      'a format is the reader\'s own text, so it is escaped',
    );
  });
});
