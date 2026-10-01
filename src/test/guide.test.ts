import * as assert from 'assert';

import * as fs from 'fs';
import * as path from 'path';

import { GUIDE_IMAGE_BASE, GUIDE_PAGES, guideSlug, HELP_READ_MORE, renderGuidePage, resolveGuideLink } from '../ui/webview/guide';
import { parseHelpMessage } from '../ui/webview/messages';
import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';

const guideFolder = path.resolve(__dirname, '..', '..', 'docs', 'guide');
const read = (page: string): string => fs.readFileSync(path.join(guideFolder, `${page}.md`), 'utf8');

/** The anchors GitHub gives a page's headings, outside fenced code. */
function anchorsOf(page: string): Set<string> {
  const anchors = new Set<string>();
  let fenced = false;
  read(page).split('\n').forEach((line) => {
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
    } else if (!fenced && /^#{1,6} /.test(line)) {
      anchors.add(guideSlug(line.replace(/^#+/, '')));
    }
  });
  return anchors;
}

suite('The guide', () => {
  test('lists every page in docs/guide, and no page that is not there', () => {
    const files = fs.readdirSync(guideFolder).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3));
    assert.deepStrictEqual([...files].sort(), Object.keys(GUIDE_PAGES).sort());
    Object.entries(GUIDE_PAGES).forEach(([page, title]) => {
      assert.strictEqual(read(page).split('\n')[0], `# ${title}`, `${page} is titled as Help names it`);
    });
  });

  test('every Help section reads more on a page, and at a heading, that exist', () => {
    Object.entries(HELP_READ_MORE).forEach(([section, target]) => {
      assert.ok(target.page in GUIDE_PAGES, `${section} names a page`);
      if (target.anchor) {
        assert.ok(anchorsOf(target.page).has(target.anchor), `${target.page} has #${target.anchor}`);
      }
    });
  });

  test('every link between pages lands on a page and a heading that exist', () => {
    const broken: string[] = [];
    Object.keys(GUIDE_PAGES).forEach((page) => {
      const text = read(page).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = resolveGuideLink(match[1]);
        if (target.kind === 'page' && target.anchor && !anchorsOf(target.page).has(target.anchor)) {
          broken.push(`${page}: ${match[1]}`);
        } else if (target.kind === 'anchor' && !anchorsOf(page).has(target.anchor)) {
          broken.push(`${page}: ${match[1]}`);
        }
      }
    });
    assert.deepStrictEqual(broken, []);
  });

  test('draws a page for the panel: anchors, links kept inside, screenshots from GitHub', () => {
    const html = renderGuidePage([
      '# Tasks',
      '## Task metadata',
      'See [the board](task-board.md#group-by-tag), [below](#task-metadata), [the changelog](../../CHANGELOG.md), and [the license](../../LICENSE).',
      '![The board.](../images/task-board.png)',
      '<img src="../images/agenda.png" alt="Tasks view." width="220">',
      '<script>alert(1)</script>',
    ].join('\n\n'));
    assert.match(html, /<h2 id="task-metadata">Task metadata<\/h2>/);
    assert.match(html, /<a href="#" data-guide-page="task-board" data-guide-anchor="group-by-tag">the board<\/a>/);
    assert.match(html, /<a href="#" data-guide-anchor="task-metadata">below<\/a>/);
    assert.match(html, /<a href="#" data-action="open-changelog">the changelog<\/a>/);
    assert.match(html, /<a href="https:\/\/github\.com\/doctorallen\/deckard\/blob\/master\/LICENSE">the license<\/a>/);
    assert.ok(html.includes(`src="${GUIDE_IMAGE_BASE}task-board.png"`));
    assert.ok(html.includes(`src="${GUIDE_IMAGE_BASE}agenda.png"`));
    assert.ok(!html.includes('<script'), 'nothing runs from a page');
  });

  test('Help asks only for a page by name', () => {
    assert.deepStrictEqual(parseHelpMessage({ type: 'openGuide', page: 'tasks', anchor: 'task-metadata' }), {
      type: 'openGuide',
      page: 'tasks',
      anchor: 'task-metadata',
    });
    assert.strictEqual(parseHelpMessage({ type: 'openGuide', page: '../../package' }), undefined);
    assert.strictEqual(parseHelpMessage({ type: 'openGuide', page: 'tasks', anchor: 'a"b' }), undefined);
  });

  test('Read more asks for its page, which shows in place of Help, and Back returns', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      const sections = page.findAll('article section[id]').map((section) => section.id);
      const withoutReadMore = sections.filter(
        (id) => id !== 'whats-new' && page.findAll(`#${id} .read-more [data-guide-page]`).length === 0,
      );
      assert.deepStrictEqual(withoutReadMore, [], 'every section but What’s new reads more');
      page.click('#query .read-more a');
      assert.deepStrictEqual(page.lastPosted('openGuide'), { type: 'openGuide', page: 'search', anchor: 'query-language' });
      page.window.dispatchEvent(new page.window.MessageEvent('message', {
        data: { type: 'guide', page: 'search', title: 'Search', html: renderGuidePage(read('search')) },
      }));
      assert.strictEqual((page.find('main > article') as HTMLElement).hidden, true, 'Help steps aside');
      assert.strictEqual(page.text('#guide-view h1'), 'Search');
      page.click('#guide-view [data-guide-anchor="query-language"]');
      page.click('#guide-view [data-action="guide-back"]');
      assert.strictEqual((page.find('main > article') as HTMLElement).hidden, false, 'and comes back');
      assert.strictEqual((page.find('#guide-view') as HTMLElement).hidden, true);
    } finally {
      page.dispose();
    }
  });
});
