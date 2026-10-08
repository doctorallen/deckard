import * as assert from 'assert';

import { readSheet, themeSheet } from './sheets';

/**
 * Help's headings read in order at every Display step and in every theme:
 * the page's title over a release or a section, over what is under it.
 * Plain type shrinks every page's title to a section's size, so Help sets
 * its own.
 */
suite('Help headings', () => {
  /** The font size, in px, a sheet's rule for `selector` declares, if any. */
  const sizeIn = (sheet: string, selector: string): number | undefined => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|[}\\n])\\s*${escaped} \\{[^}]*font-size: (\\d+)px`).exec(sheet);
    return match ? Number(match[1]) : undefined;
  };

  test('h1 is over h2 and h2 over h3, at Full and under plain type', () => {
    const help = readSheet('help/page.css');
    const h2 = sizeIn(help, 'h2');
    assert.strictEqual(h2, 19);
    // h3 is --text-lg, a pixel over the reader's own size: under h2 for any
    // VS Code font size below 17px.
    assert.match(help, /\nh3 \{[^}]*font-size: var\(--text-lg\)/);
    const full = [sizeIn(help, 'h1'), sizeIn(themeSheet('corpo'), 'h1')];
    for (const h1 of full) {
      assert.ok(h1 !== undefined && h1 > h2, `a Full h1 of ${h1}px is over h2`);
    }
    // display.css takes h1 to --text-lg under plain; Help's own rule, more
    // specific, keeps it over h2.
    assert.match(readSheet('shared/display.css'), /body\[data-styling=plain\] h1 \{ font-size: var\(--text-lg\); \}/);
    const plain = sizeIn(help, 'body[data-styling=plain] main h1');
    assert.ok(plain !== undefined && plain > h2, `a plain h1 of ${plain}px is over h2`);
  });
});
