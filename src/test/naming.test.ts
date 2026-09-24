import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The naming table in docs/components.md, as a test: buttons are sentence
 * case, commands say Open rather than Show and end with an ellipsis when they
 * will ask, and no label uses a synonym the table retired.
 */
const root = path.resolve(__dirname, '..', '..');
const webviews = path.join(root, 'src', 'ui', 'webview');

/** Words that keep a capital inside a button label: places and products. */
const PROPER = new Set(['Home', 'Tags', 'Deckard', 'Markdown', 'CSV', 'MCP', 'Zen', 'Notes', 'Tasks', 'Task', 'Board']);
/** Labels the table retired, and what replaced them. */
const RETIRED: Array<[RegExp, string]> = [
  [/>Bulk Edit</, 'Bulk edit'],
  [/>Clear the search</, 'Clear'],
  [/>Clear search</, 'Clear'],
  [/>Apply</, 'Save'],
  [/>Rank order</, 'Sort by rank'],
  [/>Reset graph settings</, 'Reset graph'],
  [/>Customize Home</, 'Customize'],
];

function staticButtonLabels(source: string): string[] {
  // Labels written as literal text between a button's tags; labels built from
  // data are checked where they are built.
  return [...source.matchAll(/<button[^>]*>([A-Za-z][A-Za-z ’'-]{0,40})<\/button>/g)].map((m) => m[1]);
}

suite('Naming', () => {
  const sources = fs
    .readdirSync(webviews)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [name, fs.readFileSync(path.join(webviews, name), 'utf8')] as const);

  test('buttons are sentence case', () => {
    const offenders: string[] = [];
    for (const [name, source] of sources) {
      for (const label of staticButtonLabels(source)) {
        const words = label.split(/\s+/).slice(1);
        if (words.some((word) => /^[A-Z]/.test(word) && !PROPER.has(word.replace(/[’'s]+$/, '')))) {
          offenders.push(`${name}: "${label}"`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [], 'a second word takes a capital only for a place or a product');
  });

  test('retired labels stay retired', () => {
    const offenders: string[] = [];
    for (const [name, source] of sources) {
      for (const [pattern, replacement] of RETIRED) {
        if (pattern.test(source)) {
          offenders.push(`${name}: ${pattern.source} → use "${replacement}"`);
        }
      }
    }
    assert.deepStrictEqual(offenders, []);
  });

  test('commands open rather than show, and say when they will ask', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const titles = manifest.contributes.commands.map((command) => command.title);
    assert.deepStrictEqual(
      titles.filter((title) => /^Deckard: Show /.test(title)),
      [],
      'a command that opens a page or view says Open',
    );
    assert.deepStrictEqual(
      titles.filter((title) => /\(.*\)/.test(title)),
      [],
      'a title is a name; what it does goes in Help',
    );
    const tagPage = titles.filter((title) => /Tag's Search Page/.test(title));
    assert.ok(tagPage.length >= 2, 'the palette and the context menu both offer it');
    assert.ok(
      tagPage.every((title) => title.endsWith('…') && title.replace(/^Deckard: /, '') === tagPage[0].replace(/^Deckard: /, '')),
      'under one title, ending with the ellipsis of a command that asks',
    );
  });
});
