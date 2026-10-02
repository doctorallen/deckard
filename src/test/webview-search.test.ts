import * as assert from 'assert';

import { buildBlockExcerpt } from '../domain/markdown/blockExcerpt';
import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import type { ParsedFile } from '../core/types';
import type { SearchPageSnapshot } from '../ui/protocol/searchPage';
import type { TagOverviewCard } from '../ui/protocol/shared';
import { createSearchPageSnapshot, findSnippetStart } from '../ui/state/dashboardState';
import { getComponentScript } from '../ui/webview/components';
import { renderMarkdown } from '../ui/webview/rendering';
import { normalizeBody } from '../../test/harness/domSnapshot';
import * as corpus from './indexCorpus';
import { renderPage } from './pages';
import { createPreferences, TestPreferences } from './preferenceServices';
import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The search page's shared parts (src/webview/shared: blockExcerpt and
 * searchCard) against what they replace: a note excerpt drawn from its block
 * tokens must be the DOM markdown-it and the sanitizer made of it, over every
 * excerpt the sample workspace, the development notes, and the fixtures
 * hold; and a card must be the DOM the search page's template drew, as
 * test:dom normalizes both.
 *
 * Three differences are decided (Q8 of docs/implementation/20-webviews.md):
 * a link to anything but http, https, or mailto draws as its words;
 * `~~strikethrough~~`, which the sanitizer stripped to its words, draws its
 * line; and Markdown inside a `[[wiki link]]` stays as written. They are
 * undone before comparing: markdown-it is shown the wiki links with their
 * punctuation escaped, as scripts/compare-card-markdown.js shows it.
 */

/** The template script's tag menu, by name, with the tag it is open on. */
const LEGACY_MENU = 'openContextMenu, openTagContextMenu, closeTagContextMenu, setParkedTags, parkTagMenuItem, contextKey: function () { return tagContextKey; }';

/** A page running the template script, with its tag menu on `window.legacy`. */
function legacyPage(): WebviewPage {
  const script = `(function () {\n  const vscode = acquireVsCodeApi();\n${getComponentScript('replicant')}\n  window.legacy = { ${LEGACY_MENU} };\n}());`;
  return openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${script}</script></body></html>`);
}

/** A page with the shared parts on `window.shared`. */
function corePage(): WebviewPage {
  const bundle = bundleShared(['blockExcerpt', 'searchCard', 'tagMenu', 'menuKeys']);
  return openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${bundle}</script></body></html>`);
}

type Shared = Record<string, (...args: unknown[]) => unknown>;

/** Web and mail links, the only ones a token can carry. */
const SAFE_HREF = /^(?:https?|mailto):/i;

/** A wiki link with Markdown punctuation inside it, which markdown-it reads and the tokens keep as written. */
const MARKDOWN_IN_WIKI_LINK = /\[\[[^\]\n]*[*_~`&\\<[][^\]\n]*\]\]/;

/** Markdown with each wiki link's punctuation escaped, which markdown-it then draws as the literal text the tokens keep. */
function withLiteralWikiLinks(markdown: string): string {
  return markdown.replace(/!?\[\[[^\]\n]*\]\]/g, (link) => link.replace(/[!-/:-@[-`{-~]/g, '\\$&'));
}

/** Takes an element out, leaving what it held in its place. */
function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

/** A section's card body, as dashboardState's private getSectionBody reads it. */
function sectionBody(rawContent: string): string {
  const lines = rawContent.split(/\r?\n/);
  return lines.length > 1 ? lines.slice(1).join('\n').replace(/^\n/, '') : '';
}

/** A note's text after its front matter, as dashboardState's getFrontmatterBody reads it. */
function frontmatterBody(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end >= 0 ? lines.slice(end + 1).join('\n').replace(/^\n/, '') : content;
}

/** Every snippet a search could show of a body: from each line a searched word could be on. */
function snippetsOf(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const snippets = new Set<string>();
  for (const line of lines) {
    const word = line.trim().toLowerCase();
    const start = word ? findSnippetStart(lines, [word]) : undefined;
    if (start !== undefined) {
      snippets.add(lines.slice(start).join('\n'));
    }
  }
  return [...snippets];
}

/** Every excerpt a card could draw of the notes: bodies, snippets, and whole notes after their front matter. */
function excerptsOf(files: readonly ParsedFile[]): Set<string> {
  const excerpts = new Set<string>();
  for (const file of files) {
    for (const section of file.sections) {
      const body = sectionBody(section.rawContent);
      excerpts.add(body);
      snippetsOf(body).forEach((snippet) => excerpts.add(snippet));
    }
    excerpts.add(frontmatterBody(file.content));
  }
  excerpts.delete('');
  return excerpts;
}

/** Excerpts that reach each construct the tree draws, written by hand. */
const CONSTRUCTS = [
  'One line.\nA second line, after a soft break.',
  'Hard break  \nafter two spaces.',
  '# Heading\n\nSetext\n======\n\n### Third',
  '- a\n- b\n  - nested\n  - nested two\n- c',
  '- a\n\n- loose\n\n  with two paragraphs',
  '1. one\n2. two\n\n3) other list',
  '5. starts at five\n6. six',
  '- a\n  ```js\n  code in an item\n  ```\n- b',
  '- a\n  > quoted in a tight item\n- b',
  '- a\n  # heading in a tight item\n- \n- after an empty item',
  '-\n  > a quote that opens an item',
  '> quoted\n> lines\n>\n> - list in a quote\n\n>',
  '```\nfenced\n  indented\n```\n\n    indented code\n\n```py\nwith info\n```',
  '```\n\nleading blank line\n```',
  '---\n\n***\n\nAfter rules.',
  '| a | b |\n| --- | :-: |\n| **c** | `d` |\n| e |',
  '| only | header |\n| --- | --- |',
  '- x\n  | t | u |\n  | - | - |\n  | 1 | 2 |',
  '[web](https://example.com "Title") and [mail](mailto:a@b.c) and <https://auto.link>',
  '[a note](notes/other.md), [js](javascript:alert(1)), and [none]()',
  '[ref][r]\n\n[r]: https://example.com/ref',
  '~~struck~~ and **~~both~~**',
  '![an image](https://example.com/x.png) beside text',
  'Entities: &copy; &amp; &#169; &lt;tag&gt; \\*escaped\\*',
  '[[Wiki link]] and ![[embed]] and [[*not em*]]',
  '<div>html is text</div>\n\n<script>alert(1)</script>',
  '**bold _and em_** `code` *em*',
];

suite('The search page\'s shared parts draw what its template drew', () => {
  let core: WebviewPage;
  suiteSetup(() => {
    core = corePage();
  });
  suiteTeardown(() => {
    core.dispose();
  });
  const shared = (): Shared => (core.window as unknown as { shared: Shared }).shared;

  /** A note excerpt as the template drew it, in a card's body. */
  const excerptBefore = (markdown: string): Element => {
    const container = core.document.createElement('div');
    container.innerHTML = `<div class="rendered">${renderMarkdown(markdown)}</div>`;
    container.querySelectorAll('a').forEach((link) => {
      if (!SAFE_HREF.test(link.getAttribute('href') ?? '')) {
        unwrap(link);
      }
    });
    return container;
  };
  /** The same excerpt drawn from its tokens, as a Preact page draws it. */
  const excerptNow = (markdown: string): Element => {
    const container = core.document.createElement('div');
    const blocks = JSON.parse(JSON.stringify(buildBlockExcerpt(markdown)));
    shared().render(shared().h(shared().NoteBody, { rawContent: markdown, blocks, renderMode: 'html' }), container);
    container.querySelectorAll('del').forEach(unwrap);
    return container;
  };

  test('every excerpt of the corpora, and each construct the tree draws', () => {
    const files = [
      ...corpus.parseNotes(corpus.sampleNotes()),
      ...corpus.parseNotes(corpus.developmentNotes()),
      ...corpus.parseNotes([...corpus.edgeCaseNotes(), ...corpus.randomNotes(1, 80), ...corpus.randomNotes(7, 80), ...corpus.randomNotes(42, 150)]),
    ];
    const excerpts = [...excerptsOf(files), ...CONSTRUCTS];
    assert.ok(excerpts.length > 2000, `${excerpts.length} excerpts`);
    const same = (markdown: string, legacy: string): boolean => normalizeBody(excerptNow(markdown)) === normalizeBody(excerptBefore(legacy));
    const differ = excerpts.filter((markdown) => !same(markdown, markdown)
      && !(MARKDOWN_IN_WIKI_LINK.test(markdown) && same(markdown, withLiteralWikiLinks(markdown))));
    const first = differ[0];
    assert.strictEqual(
      first === undefined ? '' : normalizeBody(excerptNow(first)),
      first === undefined ? '' : normalizeBody(excerptBefore(first)),
      `${differ.length} of ${excerpts.length} differ; the first is ${JSON.stringify(first)}`,
    );
  });

  test('a body as Markdown source, as the template escaped it into a <pre>', () => {
    for (const raw of ['plain', '\nled by a blank line', '\n\ntwo blank lines', 'a <b>tag</b> & an entity &amp;', 'carriage\r\nreturns\rtoo']) {
      const before = core.document.createElement('div');
      before.innerHTML = `<pre class="markdown">${raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
      const now = core.document.createElement('div');
      shared().render(shared().h(shared().NoteBody, { rawContent: raw, blocks: [], renderMode: 'markdown' }), now);
      assert.strictEqual(normalizeBody(now), normalizeBody(before), JSON.stringify(raw));
      assert.strictEqual(now.textContent, before.textContent, `the same text in the <pre>: ${JSON.stringify(raw)}`);
    }
  });

  test('the tag menu, on a tag parked and not, and the menu a page fills itself', () => {
    const legacy = legacyPage();
    try {
      const old = (legacy.window as unknown as { legacy: Shared }).legacy;
      const pages: Array<[WebviewPage, Shared]> = [[legacy, old], [core, shared()]];
      // A tag on each page, with focus on it, as a keyboard opens the menu.
      const tags = pages.map(([page]) => {
        const app = page.find('#app');
        app.innerHTML = '<button class="tag-open" data-tag-key="#project/atlas">#project/atlas</button><article class="card" tabindex="0"></article>';
        return page.find('[data-tag-key]') as HTMLElement;
      });
      const menuOf = (page: WebviewPage): string => normalizeBody(page.find('#tag-context-menu'));
      const open = (index: number, how: (helpers: Shared, event: MouseEvent, tag: HTMLElement) => void): void => {
        const [page, helpers] = pages[index];
        how(helpers, new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }), tags[index]);
      };
      const same = (what: string): void => {
        assert.strictEqual(menuOf(core), menuOf(legacy), what);
        assert.strictEqual(String(shared().tagContextKey()), String(old.contextKey()), `${what}: the tag it is about`);
        assert.strictEqual(core.document.activeElement?.textContent, legacy.document.activeElement?.textContent, `${what}: focus`);
      };
      for (const parked of [[], ['#PROJECT/atlas'], ['#other']]) {
        pages.forEach(([, helpers]) => helpers.setParkedTags(parked));
        [0, 1].forEach((index) => open(index, (helpers, event, tag) => helpers.openTagContextMenu(event, tag)));
        same(`a tag, with ${JSON.stringify(parked)} parked`);
        assert.strictEqual(JSON.stringify(shared().parkTagMenuItem('#project/atlas')), JSON.stringify(old.parkTagMenuItem('#project/atlas')));
      }
      [0, 1].forEach((index) => open(index, (helpers, event) => helpers.openContextMenu(event, [{ action: 'pin-note', label: 'Pin to Home' }, { action: 'park-note', label: 'Park note' }])));
      same('a card\'s menu');
      pages.forEach(([, helpers]) => helpers.closeTagContextMenu());
      same('closed');
      [0, 1].forEach((index) => open(index, (helpers, event) => helpers.openContextMenu(event, [])));
      same('no items opens nothing');
    } finally {
      legacy.dispose();
    }
  });

  suite('cards', () => {
    let store: TestPreferences | undefined;
    let legacy: WebviewPage | undefined;
    teardown(() => {
      legacy?.dispose();
      legacy = undefined;
      store?.repository.dispose();
      store = undefined;
    });

    const NOTES: Record<string, string> = {
      'notes/atlas.md': '---\ndescribes: project/atlas\nowner: "@dana"\n---\n# Atlas\nThe hub note **body**, with a [link](https://example.com).',
      'notes/one.md': '# One #project/atlas #risk/vendor\nThe lift is stuck.\n\n- [ ] Chase it #project/atlas',
      'notes/two.md': '# Plan\n## Two #project/atlas\nLine one.\nLine two.\nLine three.\nLine four.\n\nThe vendor paragraph, `code` and ~~struck~~.',
      'notes/three.md': '# Three #project/atlas\n',
      'notes/2026-09-22.md': '# 2026-09-22 #project/atlas\n> quoted\n\n| a | b |\n| - | - |\n| c | d |',
    };

    /** The search page's snapshot of a one-tag search, with what a test gives it. */
    const snapshotOf = (preferences: Record<string, unknown>, options: Record<string, unknown> = {}): SearchPageSnapshot => {
      const index = buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([path, content]) => [path, parseMarkdown(path, content)])));
      store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
      return createSearchPageSnapshot(index, { ...store.reader.value, ...preferences }, '#project/atlas', {
        queryContext: createQueryContext(Date.parse('2026-09-22T12:00:00Z')),
        ...options,
      });
    };

    /** Each card in turn as it can be: parked, pinned, listed for its hub, long, and led by a snippet. */
    const varied = (cards: readonly TagOverviewCard[]): TagOverviewCard[] => {
      const snippet = { rawContent: 'The vendor paragraph.', bodyTokens: buildBlockExcerpt('The vendor paragraph.'), renderedHtml: renderMarkdown('The vendor paragraph.'), line: 9 };
      const changes: Array<Partial<TagOverviewCard>> = [
        {},
        { parked: true, pinned: true },
        { via: 'hubLink', long: true },
        { snippet, long: true },
        { snippet: { ...snippet, rawContent: '', bodyTokens: [], renderedHtml: '' } },
        { rawContent: '', bodyTokens: [], renderedHtml: '' },
      ];
      return cards.flatMap((card) => changes.map((change) => JSON.parse(JSON.stringify({ ...card, ...change })) as TagOverviewCard));
    };

    const compareCards = (snapshot: SearchPageSnapshot, what: string): void => {
      const sections = varied(snapshot.sections);
      // A search of a tag alone marks no words, so the template's cards
      // are compared as it drew them.
      legacy = openWebviewPage(renderPage('searchPage'), { ...snapshot, sections, notePaging: { ...snapshot.notePaging, size: 500 } });
      const before = legacy.findAll('.card');
      assert.strictEqual(before.length, sections.length, what);
      sections.forEach((card, position) => {
        const now = core.document.createElement('div');
        const display = { renderMode: snapshot.renderMode, preview: snapshot.preview, titleDisplay: snapshot.tagTitleDisplayMode };
        shared().render(shared().h(shared().SearchCard, { card, position, display, opened: false }), now);
        now.querySelectorAll('del').forEach(unwrap);
        assert.strictEqual(normalizeBody(now.firstElementChild as Element), normalizeBody(before[position]), `${what}: card ${position}`);
      });
      legacy.dispose();
      legacy = undefined;
    };

    test('in every format, preview, and way of drawing tags', () => {
      for (const renderMode of ['html', 'markdown']) {
        for (const searchPreview of ['lines', 'full', 'none']) {
          for (const tagTitleDisplayMode of ['inline', 'separate']) {
            compareCards(snapshotOf({ renderMode, renderModeChosen: true, searchPreview }, { tagTitleDisplayMode }), `${renderMode}, ${searchPreview}, ${tagTitleDisplayMode}`);
          }
        }
      }
    });

    test('a hub note\'s body reaches the page as tokens too, and draws as its HTML did', () => {
      const snapshot = snapshotOf({});
      const hub = snapshot.hub;
      assert.ok(hub, 'the tag has a hub note');
      assert.deepStrictEqual(hub.bodyTokens, buildBlockExcerpt(hub.rawContent));
      legacy = openWebviewPage(renderPage('searchPage'), snapshot);
      const before = legacy.find('.hub .rendered');
      const now = core.document.createElement('div');
      shared().render(shared().h(shared().NoteBody, { rawContent: hub.rawContent, blocks: JSON.parse(JSON.stringify(hub.bodyTokens)), renderMode: 'html' }), now);
      assert.strictEqual(normalizeBody(now.firstElementChild as Element), normalizeBody(before));
    });
  });
});
