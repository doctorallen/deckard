import * as assert from 'assert';

import * as fs from 'fs';
import * as path from 'path';

import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';

const guideFolder = path.resolve(__dirname, '..', '..', 'docs', 'guide');

/** A guide page's Markdown, with its `<kbd>` marks taken out, so keys read as Help writes them. */
const readGuide = (page: string): string =>
  fs.readFileSync(path.join(guideFolder, `${page}.md`), 'utf8').replace(/<\/?kbd>/g, '');

/**
 * What Help says against what the guide says, for a card whose words have
 * fallen behind the guide's: Help is the quick glance, but what it lists
 * it lists whole.
 */
suite('Help content', () => {
  test('the Favorites and order card names every way to rank a tag, the keys the guide gives too', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      const card = page.findAll('.card').find((each) => each.querySelector('h3')?.textContent === 'Favorites and order');
      const text = card?.textContent ?? '';
      for (const key of ['Alt+Up', 'Alt+Down']) {
        assert.ok(readGuide('home-and-stats').includes(key), `the guide: ${key}`);
      }
      for (const way of ['dragged', 'Move to top', 'Move to bottom', 'Alt+Up', 'Alt+Down']) {
        assert.ok(text.includes(way), `Help: ${way}`);
      }
    } finally {
      page.dispose();
    }
  });
});
