import * as assert from 'assert';

import { PreferencesStore } from '../core/storage/preferences';
import { PersistedPreferences } from '../core/types';
import { createSearchPageSnapshot } from '../ui/state/dashboardState';
import {
  parseDashboardMessage,
  parseSearchPageMessage,
  parseSidebarMessage,
} from '../ui/webview/messages';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { indexWithParking } from './parkedFixture';
import { openWebviewPage, WebviewPage } from './webviewPage';

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

function openPage(query: string, parkedTags: string[]): WebviewPage {
  const index = indexWithParking(
    {
      'notes/Atlas.md': '# Atlas #project/atlas\nThe plan.\n',
      'notes/Old.md': '---\ntags: [project/old]\n---\n# Old #project/atlas\n',
    },
    { tags: ['parked', 'project/old'] },
  );
  const snapshot = createSearchPageSnapshot(index, defaults(), query);
  return openWebviewPage(getSearchPageHtml({ cspSource: 'vscode-webview://deckard' }), {
    ...snapshot,
    parkedTags,
  });
}

function rightClick(page: WebviewPage, selector: string): void {
  page.find(selector).dispatchEvent(
    new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
  );
}

function menuLabels(page: WebviewPage): string[] {
  return page.findAll('#tag-context-menu .menu-label').map((item) => item.textContent ?? '');
}

suite('Park and Unpark from the pages', () => {
  test('a tag menu offers Park tag, and posts it with the tag', () => {
    const page = openPage('#project/atlas', ['#parked']);
    try {
      rightClick(page, '.card [data-tag-key="#project/atlas"]');
      assert.deepStrictEqual(menuLabels(page), ['Rename tag', 'Park tag']);
      page.click('#tag-context-menu [data-context-action="park-tag"]');
      assert.deepStrictEqual(page.lastPosted('parkTag'), { type: 'parkTag', tagKey: '#project/atlas' });
    } finally {
      page.dispose();
    }
  });

  test('a listed tag offers Unpark tag instead', () => {
    const page = openPage('#project/atlas', ['#project/atlas']);
    try {
      rightClick(page, '.card [data-tag-key="#project/atlas"]');
      assert.deepStrictEqual(menuLabels(page), ['Rename tag', 'Unpark tag']);
      page.click('#tag-context-menu [data-context-action="unpark-tag"]');
      assert.deepStrictEqual(page.lastPosted('unparkTag'), { type: 'unparkTag', tagKey: '#project/atlas' });
    } finally {
      page.dispose();
    }
  });

  test('a card menu offers Park note or Unpark note', () => {
    const page = openPage('#project/atlas', ['#parked', '#project/old']);
    try {
      const cards = page.findAll('article.card');
      assert.deepStrictEqual(cards.map((card) => card.getAttribute('data-parked')), ['false', 'true']);
      rightClick(page, 'article.card[data-parked="false"]');
      assert.deepStrictEqual(menuLabels(page), ['Pin to Home', 'Park note']);
      page.click('#tag-context-menu [data-context-action="park-note"]');
      assert.deepStrictEqual(page.lastPosted('parkNote'), { type: 'parkNote', filePath: 'notes/Atlas.md' });
      rightClick(page, 'article.card[data-parked="true"]');
      assert.deepStrictEqual(menuLabels(page), ['Pin to Home', 'Unpark note']);
      page.click('#tag-context-menu [data-context-action="park-note"]');
      assert.deepStrictEqual(page.lastPosted('unparkNote'), { type: 'unparkNote', filePath: 'notes/Old.md' });
    } finally {
      page.dispose();
    }
  });

  test("a parked tag's page says so, with Unpark", () => {
    const page = openPage('#project/old', ['#parked', '#project/old']);
    try {
      assert.match(page.text('.tag-notes') ?? '', /^Parked\. Its notes and tasks are left out of the Tasks view, the Task board, and Related Notes\./);
      page.click('[data-action="unpark-tag"]');
      assert.deepStrictEqual(page.lastPosted('unparkTag'), { type: 'unparkTag', tagKey: '#project/old' });
    } finally {
      page.dispose();
    }
    const unparked = openPage('#project/atlas', ['#parked']);
    try {
      assert.doesNotMatch(unparked.text('body') ?? '', /Parked\. Its notes/);
    } finally {
      unparked.dispose();
    }
  });

  test('the hosts accept park messages and nothing else like them', () => {
    assert.deepStrictEqual(parseSearchPageMessage({ type: 'parkTag', tagKey: '#a' }), { type: 'parkTag', tagKey: '#a' });
    assert.deepStrictEqual(parseSearchPageMessage({ type: 'unparkNote', filePath: 'a.md' }), { type: 'unparkNote', filePath: 'a.md' });
    assert.strictEqual(parseSearchPageMessage({ type: 'parkNote', filePath: '' }), undefined);
    assert.strictEqual(parseSearchPageMessage({ type: 'parkTag', tagKey: '#a', extra: 1 }), undefined);
    assert.deepStrictEqual(parseSidebarMessage({ type: 'unparkTag', tagKey: '#a' }), { type: 'unparkTag', tagKey: '#a' });
    assert.deepStrictEqual(parseDashboardMessage({ type: 'parkTag', tagKey: '#a' }), { type: 'parkTag', tagKey: '#a' });
    assert.strictEqual(parseDashboardMessage({ type: 'parkTag', tagKey: 3 }), undefined);
  });
});
