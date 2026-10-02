import * as assert from 'assert';

import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The searched words marked in a page's results (src/webview/shared/
 * markWords.ts), as the search page and Related Notes mark them: each word
 * as the reader wrote it, and only in text.
 */

type MarkWords = (root: Element | null, words: readonly unknown[], options?: { wordStart?: boolean }) => () => void;

suite('Marking the searched words', () => {
  let page: WebviewPage;
  suiteSetup(() => {
    const bundle = bundleShared(['markWords']);
    page = openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><script>${bundle}</script></body></html>`);
  });
  suiteTeardown(() => {
    page.dispose();
  });

  const markWords = (): MarkWords => (page.window as unknown as { shared: { markWords: MarkWords } }).shared.markWords;

  /** A paragraph of `text`, marked for `words`; returns the words marked and the paragraph's text. */
  const mark = (text: string, words: readonly string[], options?: { wordStart?: boolean }): { marked: string[]; text: string } => {
    const root = page.find('#app');
    root.textContent = '';
    const paragraph = page.document.createElement('p');
    paragraph.textContent = text;
    root.append(paragraph);
    markWords()(root, words, options);
    return {
      marked: Array.from(root.querySelectorAll('mark'), (element) => String(element.textContent)),
      text: String(root.textContent),
    };
  };

  test('a word with a character a pattern reads specially is marked as written', () => {
    assert.deepStrictEqual(mark('axb and a.b', ['a.b']).marked, ['a.b'], '"a.b" does not mark "axb"');
    assert.deepStrictEqual(mark('one (two) three', ['(two)']).marked, ['(two)']);
    assert.deepStrictEqual(mark('price $5 or 5', ['$5']).marked, ['$5']);
    assert.deepStrictEqual(mark('a|b and a or b', ['a|b']).marked, ['a|b'], '"a|b" is one word, not a choice');
    assert.deepStrictEqual(mark('back\\slash', ['k\\s']).marked, ['k\\s']);
  });

  test('a word a pattern cannot read is marked rather than thrown', () => {
    for (const options of [undefined, { wordStart: true }]) {
      const result = mark('Learning c++ and [x] or *', ['c++', '[x', '*'], options);
      assert.deepStrictEqual(result.marked, ['c++', '[x'], 'a word of one character is never marked');
      assert.strictEqual(result.text, 'Learning c++ and [x] or *', 'the text reads as before');
    }
  });

  test('a word is found in the text the reader sees, never in the HTML it is written as', () => {
    const cases: Array<[string, string[], string[]]> = [
      ['Tom & Jerry, an ample cast', ['amp'], ['amp']],
      ['a < b, a > c, salt and ghetto', ['lt', 'gt'], ['lt']],
      ['She said "quote" and it\'s 2039', ['quot', '039'], ['quot', '039']],
      ['R&D and <b> as written', ['r&d', '<b>'], ['R&D', '<b>']],
    ];
    for (const [text, words, expected] of cases) {
      const result = mark(text, words);
      assert.deepStrictEqual(result.marked, expected, `${words.join(', ')} in ${text}`);
      assert.strictEqual(result.text, text, 'the text reads as before');
    }
  });
});
