import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import { escapeHtml, escapeHtmlText } from '../shared/html';

suite('Host-side HTML escaping', () => {
  test('the five characters HTML reads as markup become entities', () => {
    assert.strictEqual(
      escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`),
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
  });

  test('an ampersand is escaped once, so an entity in the text stays readable as text', () => {
    assert.strictEqual(escapeHtml('&lt; and &amp;'), '&amp;lt; and &amp;amp;');
  });

  test('text with nothing to escape is returned as it was', () => {
    assert.strictEqual(escapeHtml('Plain text, with ’curly’ quotes'), 'Plain text, with ’curly’ quotes');
    assert.strictEqual(escapeHtml(''), '');
  });

  test('the page reads back exactly the text given, in text and in either quoted attribute', () => {
    const text = `It's "quoted" <b>&amp;</b> & more`;
    const { document } = new JSDOM(
      `<p id="text">${escapeHtml(text)}</p>`
        + `<p id="double" title="${escapeHtml(text)}"></p>`
        + `<p id="single" title='${escapeHtml(text)}'></p>`,
    ).window;
    assert.strictEqual(document.getElementById('text')?.textContent, text);
    assert.strictEqual(document.getElementById('double')?.getAttribute('title'), text);
    assert.strictEqual(document.getElementById('single')?.getAttribute('title'), text);
  });

  test('text alone escapes the three characters that start markup, and leaves quotes as written', () => {
    assert.strictEqual(escapeHtmlText(`It's "quoted" <b>&amp;</b>`), `It's "quoted" &lt;b&gt;&amp;amp;&lt;/b&gt;`);
  });
});
