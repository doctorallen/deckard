import * as assert from 'assert';

import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';

suite('Help’s tabs', () => {
  test('This page and the Tour ask the host for their content, and draw what it sends', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      assert.strictEqual(page.find('[data-help-tab][aria-selected="true"]').getAttribute('data-help-tab'), 'guide');
      page.posted.length = 0;
      page.click('[data-help-tab="page"]');
      assert.deepStrictEqual(page.posted, [{ type: 'helpTab', tab: 'page' }]);
      assert.strictEqual((page.find('#help-panel-page') as HTMLElement).hidden, false);
      assert.strictEqual((page.find('#help-panel-guide') as HTMLElement).hidden, true);
      page.window.dispatchEvent(new page.window.MessageEvent('message', {
        data: {
          type: 'helpPanel',
          tab: 'page',
          view: [
            { tag: 'button', attrs: { type: 'button', 'data-help-action': 'select', 'data-id': 'lanes' }, children: ['Lanes'] },
            {
              tag: 'select',
              attrs: { 'data-help-setting': 'theme' },
              children: [
                { tag: 'option', attrs: { value: 'mimic' }, children: ['Mimic'] },
                { tag: 'option', attrs: { value: 'cooper' }, children: ['Cooper'] },
              ],
            },
            { tag: 'input', attrs: { type: 'checkbox', 'data-help-setting': 'display.cardDetails', 'data-help-flag': 'created' } },
            { tag: 'button', attrs: { type: 'button', 'data-help-action': 'open-guide', 'data-page': 'task-board', 'data-anchor': 'lanes' }, children: ['Open in the guide'] },
          ],
        },
      }));
      page.posted.length = 0;
      page.click('[data-help-action="select"]');
      const select = page.find('select[data-help-setting]') as HTMLSelectElement;
      select.value = 'cooper';
      select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
      const flag = page.find('input[data-help-flag]') as HTMLInputElement;
      flag.checked = true;
      flag.dispatchEvent(new page.window.Event('change', { bubbles: true }));
      assert.deepStrictEqual(page.posted, [
        { type: 'helpAction', action: 'select', id: 'lanes' },
        { type: 'helpSetting', key: 'theme', value: 'cooper' },
        { type: 'helpSetting', key: 'display.cardDetails', value: { name: 'created', on: true } },
      ]);
      page.posted.length = 0;
      page.click('[data-help-action="open-guide"]');
      assert.strictEqual((page.find('#help-panel-guide') as HTMLElement).hidden, false, 'Open in the guide shows the Guide tab');
      assert.deepStrictEqual(page.posted, [{ type: 'helpTab', tab: 'guide' }, { type: 'openGuide', page: 'task-board', anchor: 'lanes' }]);
    } finally {
      page.dispose();
    }
  });

  test('the host can move Help to a tab, and the arrow keys move between them', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'reveal', page: '', tab: 'tour' } }));
      assert.strictEqual(page.find('[data-help-tab][aria-selected="true"]').getAttribute('data-help-tab'), 'tour');
      page.find('[data-help-tab="tour"]').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      assert.strictEqual(page.find('[data-help-tab][aria-selected="true"]').getAttribute('data-help-tab'), 'guide');
      assert.strictEqual(page.document.activeElement, page.find('[data-help-tab="guide"]'));
    } finally {
      page.dispose();
    }
  });
});
