import * as assert from 'assert';

import { buildBlockExcerpt } from '../domain/markdown/blockExcerpt';
import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { normalizeBody } from '../../test/harness/domSnapshot';
import * as corpus from './indexCorpus';
import { renderMarkdown } from './legacyMarkdown';
import { createPreferences, TestPreferences } from './preferenceServices';
import { bundleShared } from './sharedBundle';
import { templateRecords } from './templateRecords';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { createSearchPageSnapshot, findSnippetStart } from '../ui/state/searchPageState';
import type { ParsedFile } from '../domain/model';

/**
 * The search page's shared parts (src/webview/shared: blockExcerpt and
 * tagMenu) against what they replace: a note excerpt drawn from its block
 * tokens must be the DOM markdown-it and the sanitizer made of it (as
 * legacyMarkdown.ts writes it, since the sanitizer left), over every
 * excerpt the sample workspace, the development notes, and the fixtures
 * hold, and the tag menu the one the template script opened, as test:dom
 * normalizes both. The template script was deleted in Phase 6 step 7; the
 * menu it opened is its recording (templateRecords.ts). The cards were held to the search page's template here
 * until the page moved; the page itself is now held by test:dom and the
 * recorded suites.
 *
 * Three differences are decided (Q8 of docs/implementation/20-webviews.md):
 * a link to anything but http, https, or mailto draws as its words;
 * `~~strikethrough~~`, which the sanitizer stripped to its words, draws its
 * line; and Markdown inside a `[[wiki link]]` stays as written. They are
 * undone before comparing: markdown-it is shown the wiki links with their
 * punctuation escaped.
 */

/** The menus the template script opened, by case. */
const openedByTemplate = templateRecords('webview-search');

/** A menu as the template left it: the menu, the tag it was about, and the text of what had focus. */
interface MenuRecord {
  readonly menu: string;
  readonly tag: string;
  readonly focus: string;
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
    // A tag on the page, with focus on it, as a keyboard opens the menu.
    core.find('#app').innerHTML = '<button class="tag-open" data-tag-key="#project/atlas">#project/atlas</button><article class="card" tabindex="0"></article>';
    const tag = core.find('[data-tag-key]') as HTMLElement;
    const event = (): MouseEvent => new core.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 30 });
    const same = (what: string): void => {
      const before = openedByTemplate<MenuRecord>(what);
      assert.strictEqual(normalizeBody(core.find('#tag-context-menu')), before.menu, what);
      assert.strictEqual(String(shared().tagContextKey()), before.tag, `${what}: the tag it is about`);
      assert.strictEqual(core.document.activeElement?.textContent, before.focus, `${what}: focus`);
    };
    for (const parked of [[], ['#PROJECT/atlas'], ['#other']]) {
      shared().setParkedTags(parked);
      shared().openTagContextMenu(event(), tag);
      same(`a tag, with ${JSON.stringify(parked)} parked`);
      assert.strictEqual(JSON.stringify(shared().parkTagMenuItem('#project/atlas')), openedByTemplate(`the park item, with ${JSON.stringify(parked)} parked`));
    }
    shared().openContextMenu(event(), [{ action: 'pin-note', label: 'Pin to Home' }, { action: 'park-note', label: 'Park note' }]);
    same('a card\'s menu');
    shared().closeTagContextMenu();
    same('closed');
    shared().openContextMenu(event(), []);
    same('no items opens nothing');
  });

  test('a hub note\'s body reaches the page as tokens too', () => {
    const index = buildWorkspaceIndex(new Map([
      ['notes/atlas.md', parseMarkdown('notes/atlas.md', '---\ndescribes: project/atlas\n---\n# Atlas\nThe hub note **body**, with a [link](https://example.com).')],
      ['notes/one.md', parseMarkdown('notes/one.md', '# One #project/atlas\nProse.')],
    ]));
    const store: TestPreferences = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      const hub = createSearchPageSnapshot(index, store.reader.value, '#project/atlas', { queryContext: createQueryContext(Date.now()) }).hub;
      assert.ok(hub, 'the tag has a hub note');
      assert.deepStrictEqual(hub.bodyTokens, buildBlockExcerpt(hub.rawContent));
    } finally {
      store.repository.dispose();
    }
  });
});
