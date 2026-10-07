import * as assert from 'assert';

import * as fs from 'fs';
import * as path from 'path';

import { GUIDE_CONTENTS, GUIDE_PAGES, guideSlug, HELP_SECTIONS, helpPlace, WHATS_NEW } from '../ui/webview/guide';
import { GUIDE_IMAGE_BASE, resolveGuideLink } from '../ui/webview/pages/help/guideLinks';
import { renderGuidePage } from '../ui/webview/pages/help/guidePage';
import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';

const guideFolder = path.resolve(__dirname, '..', '..', 'docs', 'guide');
const read = (page: string): string => fs.readFileSync(path.join(guideFolder, `${page}.md`), 'utf8');
/** Deckard's manifest, whose commands the guide names. */
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string; title: string; category?: string }>;
    menus: { commandPalette: Array<{ command: string; when?: string }> };
  };
};

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

/** The entities the Markdown engine writes in text. */
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };

/** HTML's text as a reader sees it: no tags, entities read back. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_whole, name: string) => ENTITIES[name]);
}

/** Text's words, letters and digits only, so markup and punctuation drop out on both sides. */
function wordsOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * A line of prose as it reads once rendered: no list marker, no link target
 * or image, and no HTML tag, except inside code, which shows as written.
 */
function proseLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .split(/(`+[^`]*`+)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_whole, name: string) => ENTITIES[name]),
    )
    .join('');
}

/** A page's source as it reads once rendered: prose lines as `proseLine` reads them, fenced code as written, fences gone. */
function proseOf(source: string): string {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of source.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
        fence = undefined;
      } else {
        lines.push(line);
      }
    } else if (marker) {
      fence = marker;
    } else {
      lines.push(proseLine(line));
    }
  }
  return lines.join('\n');
}

/** A page's headings outside fenced code: the anchor GitHub gives each, and its words. */
function headingsOf(source: string): Array<{ id: string; words: string }> {
  const headings: Array<{ id: string; words: string }> = [];
  let fenced = false;
  source.split('\n').forEach((line) => {
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
    } else if (!fenced && /^#{1,6} /.test(line)) {
      const text = line.replace(/^#+/, '');
      headings.push({ id: guideSlug(text), words: wordsOf(proseLine(text)).join(' ') });
    }
  });
  return headings;
}

suite('The guide', () => {
  test('lists every page in docs/guide, and no page that is not there', () => {
    const files = fs.readdirSync(guideFolder).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3));
    assert.deepStrictEqual([...files].sort(), Object.keys(GUIDE_PAGES).sort());
    Object.entries(GUIDE_PAGES).forEach(([page, title]) => {
      assert.strictEqual(read(page).split('\n')[0], `# ${title}`, `${page} is titled as Help names it`);
    });
  });

  test('Help lists the pages as the guide\u2019s contents do, in its groups and order', () => {
    const contents: Array<{ group: string; pages: string[] }> = [];
    for (const line of read('README').split('\n')) {
      const group = /^## (.+)$/.exec(line)?.[1];
      const link = /^- \[([^\]]+)\]\(([^)]+)\)/.exec(line);
      if (group) {
        contents.push({ group, pages: [] });
      } else if (link && contents.length > 0) {
        const page = link[2] === '../../CHANGELOG.md' ? WHATS_NEW : link[2].replace(/\.md$/, '');
        if (page !== WHATS_NEW) {
          assert.strictEqual(link[1], GUIDE_PAGES[page], `the contents name ${page} by its title`);
        }
        contents[contents.length - 1].pages.push(page);
      }
    }
    assert.deepStrictEqual(contents, GUIDE_CONTENTS);
    const listed = GUIDE_CONTENTS.flatMap(({ pages }) => pages);
    assert.deepStrictEqual(Object.keys(GUIDE_PAGES).filter((page) => page !== 'README' && !listed.includes(page)), [], 'every page is in the contents');
  });

  test('every place Help was opened at by name leads to a page, and a heading, that exist', () => {
    Object.entries(HELP_SECTIONS).forEach(([section, target]) => {
      assert.ok(target.page in GUIDE_PAGES, `${section} names a page`);
      if (target.anchor) {
        assert.ok(anchorsOf(target.page).has(target.anchor), `${target.page} has #${target.anchor}`);
      }
    });
    assert.deepStrictEqual(helpPlace('periodic'), { page: 'daily-notes' }, 'the calendar page\u2019s Help');
    assert.deepStrictEqual(helpPlace('task-views'), { page: 'task-board' }, 'the Task Board\u2019s Help');
    assert.deepStrictEqual(helpPlace('links'), { page: 'notes-and-links', anchor: 'markdown-format' }, 'the note page\u2019s Help');
    assert.deepStrictEqual(helpPlace('whats-new'), { page: WHATS_NEW });
    assert.deepStrictEqual(helpPlace('settings'), { page: 'settings' }, 'a page by its file name');
    assert.deepStrictEqual(helpPlace('no-such-place'), { page: 'README' });
    assert.deepStrictEqual(helpPlace(undefined), { page: 'README' });
  });

  test('names only commands Deckard contributes', () => {
    const titles = new Set(manifest.contributes.commands.filter((command) => command.category === 'Deckard').map((command) => command.title));
    const unknown: string[] = [];
    Object.keys(GUIDE_PAGES).forEach((page) => {
      for (const match of read(page).matchAll(/(?:`|\*\*)Deckard: ([^`*]+)(?:`|\*\*)/g)) {
        if (!titles.has(match[1]) && match[1] !== 'whole workspace') {
          unknown.push(`${page}: ${match[1]}`);
        }
      }
    });
    assert.deepStrictEqual(unknown, []);
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

  test('draws a page for the panel through the Markdown extension: anchors, links kept inside, screenshots from GitHub', async () => {
    const html = await renderGuidePage([
      '# Tasks',
      '## Task metadata',
      'See [the board](task-board.md#group-by-tag), [below](#task-metadata), [the changelog](../../CHANGELOG.md), and [the license](../../LICENSE).',
      '![The board.](../images/task-board.png)',
      '<img src="../images/agenda.png" alt="Tasks view." width="220">',
      '<script>document.body.setAttribute("data-ran", "")</script>',
    ].join('\n\n'));
    assert.match(html, /<h2 [^>]*\bid="task-metadata"[^>]*>Task metadata<\/h2>/);
    assert.match(html, /<a href="#" data-guide-page="task-board" data-guide-anchor="group-by-tag">the board<\/a>/);
    assert.match(html, /<a href="#" data-guide-anchor="task-metadata">below<\/a>/);
    assert.match(html, /<a href="#" data-action="open-changelog">the changelog<\/a>/);
    assert.match(html, /<a href="https:\/\/github\.com\/doctorallen\/deckard\/blob\/master\/LICENSE">the license<\/a>/);
    assert.ok(html.includes(`src="${GUIDE_IMAGE_BASE}task-board.png"`));
    assert.ok(html.includes(`src="${GUIDE_IMAGE_BASE}agenda.png"`));
    assert.ok(!html.includes('markdown-mermaid'), 'the preview\u2019s Mermaid settings are left out');
    const page = openWebviewPage(renderPage('help'));
    try {
      page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'guide', page: 'tasks', title: 'Tasks', html } }));
      assert.strictEqual(page.text('#guide-view h2'), 'Task metadata');
      assert.strictEqual(page.document.body.hasAttribute('data-ran'), false, 'nothing runs from a page');
    } finally {
      page.dispose();
    }
  });

  test('every page renders through the Markdown extension with its words and its headings\u2019 anchors', async () => {
    const problems: string[] = [];
    for (const page of Object.keys(GUIDE_PAGES)) {
      const source = read(page);
      const html = await renderGuidePage(source);
      const headings = [...html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g)].map((match) => ({
        id: /\bid="([^"]*)"/.exec(match[2])?.[1],
        words: wordsOf(visibleText(match[3])).join(' '),
      }));
      const written = headingsOf(source);
      if (JSON.stringify(headings.map(({ id }) => id)) !== JSON.stringify(written.map(({ id }) => id))) {
        problems.push(`${page}: anchors ${headings.map(({ id }) => id).join(', ')}`);
      }
      if (JSON.stringify(headings.map(({ words }) => words)) !== JSON.stringify(written.map(({ words }) => words))) {
        problems.push(`${page}: headings ${headings.map(({ words }) => words).join(' | ')}`);
      }
      const shown = wordsOf(visibleText(html));
      const expected = wordsOf(proseOf(source));
      const at = expected.findIndex((word, index) => shown[index] !== word);
      if (at >= 0 || shown.length !== expected.length) {
        const from = Math.max(0, at < 0 ? expected.length : at);
        problems.push(`${page}: shows "${shown.slice(from, from + 8).join(' ')}" where it says "${expected.slice(from, from + 8).join(' ')}"`);
      }
    }
    assert.deepStrictEqual(problems, []);
  });

  test('the commands page names every command the palette offers', () => {
    const hidden = new Set(manifest.contributes.menus.commandPalette.filter((entry) => entry.when === 'false').map((entry) => entry.command));
    const commands = read('commands');
    const missing = manifest.contributes.commands
      .filter((command) => command.category === 'Deckard' && !hidden.has(command.command))
      .map((command) => command.title)
      .filter((title) => !commands.includes(`**Deckard: ${title}**`));
    assert.deepStrictEqual(missing, []);
  });

  test('a link in a guide page asks for its page, and one to a heading goes to it', async () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      page.window.dispatchEvent(new page.window.MessageEvent('message', {
        data: { type: 'guide', page: 'search', title: 'Search', html: await renderGuidePage(read('search')) },
      }));
      assert.strictEqual(page.text('#guide-view h1'), 'Search');
      page.click('#guide-view [data-guide-page="search-pages"]:not([data-guide-anchor])');
      assert.deepStrictEqual(page.lastPosted('openGuide'), { type: 'openGuide', page: 'search-pages' });
      const revealed: string[] = [];
      page.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
        revealed.push(this.id);
      };
      page.click('#guide-view [data-guide-anchor="query-language"]');
      assert.deepStrictEqual(revealed, ['query-language']);
    } finally {
      page.dispose();
    }
  });
});
