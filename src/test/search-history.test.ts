import * as assert from 'assert';

import { SearchHistory, SearchHistoryEntry } from '../ui/state/searchHistory';
import { parseSearchPageMessage } from '../ui/webview/messages';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

const at = (query: string, notePage = 1, taskPage = 1): SearchHistoryEntry => ({
  query,
  notePage,
  taskPage,
});

suite('Search history', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  test('goes back to a search before it was refined, and forward again', () => {
    const history = new SearchHistory();
    history.leave(at('#person/mara-vale', 2));

    const refined = at('#person/mara-vale #team/wardens');
    assert.deepStrictEqual(history.back(refined), at('#person/mara-vale', 2));
    assert.deepStrictEqual(history.forward(at('#person/mara-vale', 2)), refined);
  });

  test('has nowhere to go before the first search or after the last', () => {
    const history = new SearchHistory();
    assert.strictEqual(history.back(at('#a')), undefined);
    assert.strictEqual(history.forward(at('#a')), undefined);

    history.leave(at('#a'));
    assert.deepStrictEqual(history.back(at('#b')), at('#a'));
    assert.strictEqual(history.back(at('#a')), undefined);
  });

  test('a new search after going back ends the searches ahead of it', () => {
    const history = new SearchHistory();
    history.leave(at('#a'));
    history.leave(at('#b'));
    history.back(at('#c'));

    history.leave(at('#b'));
    assert.strictEqual(history.forward(at('#d')), undefined);
    assert.deepStrictEqual(history.back(at('#d')), at('#b'));
    assert.deepStrictEqual(history.back(at('#b')), at('#a'));
  });

  test('accepts only a step back or forward from the page', () => {
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'navigateSearchHistory', direction: 'back' }),
      { type: 'navigateSearchHistory', direction: 'back' },
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'navigateSearchHistory', direction: 'forward' }),
      { type: 'navigateSearchHistory', direction: 'forward' },
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'navigateSearchHistory', direction: 'up' }),
      undefined,
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'navigateSearchHistory', direction: 'back', query: '#a' }),
      undefined,
    );
  });

  test('the mouse\'s back and forward buttons ask the host to step', () => {
    page = openWebviewPage(getSearchPageHtml({ cspSource: 'vscode-webview://deckard' }));
    const press = (button: number): boolean =>
      page!.document.body.dispatchEvent(
        new page!.window.MouseEvent('mouseup', { bubbles: true, cancelable: true, button }),
      );

    assert.strictEqual(press(3), false, 'the frame does not also act on back');
    assert.deepStrictEqual(page.lastPosted('navigateSearchHistory'), {
      type: 'navigateSearchHistory',
      direction: 'back',
    });
    press(4);
    assert.deepStrictEqual(page.lastPosted('navigateSearchHistory'), {
      type: 'navigateSearchHistory',
      direction: 'forward',
    });

    const before = page.posted.length;
    press(0);
    press(1);
    assert.strictEqual(page.posted.length, before, 'other buttons are left alone');
  });
});
