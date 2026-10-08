import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createNotePageSnapshot } from '../ui/state/notePageState';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { readSheet, themeSheet } from './sheets';

/**
 * The reader's own words read as written, in every theme and at every
 * step: no capitals and no letter-spacing on what a note wrote, while a
 * theme keeps its look on Deckard's own chrome. Under plain type, the
 * chrome reads as written too.
 */
suite('Note text is never transformed', () => {
  let page: WebviewPage | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  /** Every rule in a sheet whose selector names `pattern` and which sets `property`. */
  const rulesSetting = (sheet: string, pattern: RegExp, property: string): string[] =>
    (sheet.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^}]*\}/g) ?? [])
      .filter((rule) => pattern.test(rule.slice(0, rule.indexOf('{'))) && rule.slice(rule.indexOf('{')).includes(property))
      .map((rule) => rule.trim());

  test('one rule keeps marked text as written, above a theme\'s heading and button rules', () => {
    assert.match(readSheet('shared/typography.css'), /body \.note-text, body \.note-text \* \{ text-transform: none; letter-spacing: normal; \}/);
    // Cooper's capitals are on its chrome, as plain selectors the rule outranks.
    assert.ok(themeSheet('cooper').includes('button, select { text-transform: uppercase; }'));
  });

  test('a note\'s embeds and its own tables are not set in capitals; a query\'s columns are Deckard\'s', () => {
    const sheet = readSheet('shared/noteBlocks.css');
    assert.deepStrictEqual(rulesSetting(sheet, /\.note-embed-title/, 'text-transform'), []);
    assert.deepStrictEqual(rulesSetting(sheet, /\.note-embed-title/, 'letter-spacing'), []);
    assert.deepStrictEqual(
      rulesSetting(sheet, /\.note-table th/, 'text-transform'),
      ['.note-query .note-table th { text-transform: uppercase; letter-spacing: .06em; }'],
    );
  });

  test('plain type takes capitals and spacing off every element, chrome included, as Corpo does', () => {
    const sheet = readSheet('shared/display.css');
    assert.match(sheet, /body\[data-styling=plain\] \* \{ text-transform: none !important; letter-spacing: normal !important; \}/);
    assert.ok(themeSheet('corpo').includes('body * { text-transform: none !important; letter-spacing: normal !important; }'));
  });

  test('the Note page marks every place it draws the note\'s own words', () => {
    const index = buildWorkspaceIndex(new Map([
      ['hubs/Atlas.md', parseMarkdown('hubs/Atlas.md', [
        '# Atlas',
        '',
        '## Decision',
        '',
        '```deckard view=table columns=due',
        '#project/atlas is:task',
        '```',
        '',
        '![[Review#Notes]]',
        '',
        '| Owner | Due |',
        '| - | - |',
        '| Dana | soon |',
      ].join('\n'))],
      ['notes/Review.md', parseMarkdown('notes/Review.md', '# Review #project/atlas\n\n## Notes\nSee [[Atlas]].\n- [ ] Follow up #project/atlas')],
    ]));
    const snapshot = createNotePageSnapshot(index, 'hubs/Atlas.md', {
      queryContext: createQueryContext(new Date(2026, 9, 3).getTime()),
      history: { back: false, forward: false },
      visit: 1,
    });
    page = openWebviewPage(renderPage('notePage', { state: snapshot }));
    const marked = (selector: string): void => {
      const found = page?.findAll(selector) ?? [];
      assert.ok(found.length, `${selector} is drawn`);
      for (const element of found) {
        assert.ok(element.closest('.note-text'), `${selector} is marked as the note's words`);
      }
    };
    marked('h1');
    marked('.note-heading');
    marked('.note-query .note-query-title');
    marked('.note-embed-title');
    marked('.note-backlink-title');
    marked('.note-backlink-line');
    const headers = page.findAll('.note-table th');
    assert.deepStrictEqual(
      headers.map((cell) => [cell.textContent, Boolean(cell.closest('.note-text'))]),
      [['Task', false], ['Due', false], ['Owner', true], ['Due', true]],
      'the query\'s columns are chrome; the note\'s own header is its words',
    );
  });
});
