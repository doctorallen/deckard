import * as assert from 'assert';

import { renderablePages } from './pages';
import { expandSheet, linkedSheets, readSheet, sheetSource } from './sheets';

/**
 * What a page's own sheet may and may not do beside the shared ones.
 *
 * The Notes Graph carried a copy of the base palette for months: it was the
 * palette as first written, so after the base sheet desaturated its accents
 * the graph alone kept drawing the old ones, and nothing said so. A page
 * declares tokens of its own; the ones the base sheet owns it reads.
 */
suite('Page sheets', () => {
  const pages = renderablePages(['dashboard', 'searchPage', 'sidebarNotes', 'notesGraph', 'help', 'stats', 'taskBoard', 'calendar', 'relatedNotesDebug']);
  const tokens = (css: string): string[] =>
    [...css.matchAll(/(--[a-z][\w-]*)\s*:/g)].map((match) => match[1]);

  test('no page sheet redeclares a token the base sheet owns', () => {
    const base = expandSheet('shared/base.css');
    const owned = new Set(tokens(base));
    assert.ok(owned.has('--text') && owned.has('--cyan-bright') && owned.has('--font-mono'), 'the base sheet owns the palette');
    for (const [name, render] of pages) {
      const [sheet, ...tail] = linkedSheets(render());
      assert.match(tail.join(' '), /^themes\/[a-z]+\.css tail\.css$/, `${name}: links its theme and the tail after its own sheet`);
      assert.match(
        readSheet(sheetSource(sheet)),
        /^\/\*[\s\S]*?\*\/\s*@import "\.\.\/shared\/base\.css";/,
        `${name}: its sheet imports the base sheet first`,
      );
      const own = expandSheet(sheetSource(sheet)).replace(base, '');
      const redeclared = [...new Set(tokens(own).filter((token) => owned.has(token)))];
      assert.deepStrictEqual(redeclared, [], `${name}: redeclares a base token`);
    }
  });
});
