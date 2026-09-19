import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { SearchPageSnapshot } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createSearchPageSnapshot } from '../ui/state/dashboardState';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * What a search page does, driven as VS Code drives it: the host's state goes
 * in, and the page is asked what it drew and what it posted back.
 *
 * These replace the checks that matched the page's script as text. A line of
 * script can be reformatted, or moved into a module and bundled, without any
 * of this changing; a line that stops running fails here and passed there.
 */
suite('Search page behavior', () => {
  let page: WebviewPage | undefined;
  let store: PreferencesStore | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.dispose();
    store = undefined;
  });

  const open = (
    notes: Record<string, string>,
    query: string,
    options: Parameters<typeof createSearchPageSnapshot>[3] = {},
  ): { page: WebviewPage; snapshot: SearchPageSnapshot } => {
    const index = buildWorkspaceIndex(
      new Map(
        Object.entries(notes).map(([path, content]) => [
          path,
          parseMarkdown(path, content),
        ]),
      ),
    );
    store = new PreferencesStore(new MemoryMemento());
    const snapshot = createSearchPageSnapshot(
      index,
      store.value,
      query,
      options,
    );
    page = openWebviewPage(
      getSearchPageHtml({ cspSource: 'vscode-webview://deckard' }),
      snapshot,
    );
    return { page, snapshot };
  };

  /** A search of `count` notes that all carry one tag. */
  const openMany = (
    count: number,
    options: Parameters<typeof createSearchPageSnapshot>[3],
  ): { page: WebviewPage; snapshot: SearchPageSnapshot } => {
    const notes: Record<string, string> = {};
    for (let index = 0; index < count; index += 1) {
      notes[`notes/note-${index}.md`] = `# Note ${index} #project/atlas\nProse.`;
    }
    return open(notes, '#project/atlas', options);
  };

  test('draws the notes and tasks a search found', () => {
    const { page } = open(
      {
        'notes/atlas.md': [
          '# Atlas #project/atlas',
          'The lift is still stuck.',
          '- [ ] Chase the vendor #project/atlas',
        ].join('\n'),
        'notes/other.md': '# Other\nNothing to do with it.',
      },
      '#project/atlas',
    );

    // A search of one entity tag is that entity's page, titled as the
    // entity rather than as the tag that names it.
    assert.strictEqual(page.text('h1'), 'Project: Atlas');
    assert.strictEqual(page.findAll('.card').length, 1, 'only the match is drawn');
    assert.strictEqual(page.findAll('.task-row').length, 1);
    assert.strictEqual(page.text('[data-search-count="tasks"]'), '1');
  });

  test('opens the note a card names, at its line', () => {
    const { page } = open(
      { 'notes/atlas.md': 'Intro.\n\n# Atlas #project/atlas\nThe lift.' },
      '#project/atlas',
    );

    page.click('.card');

    assert.deepStrictEqual(page.lastPosted('openSource'), {
      type: 'openSource',
      filePath: 'notes/atlas.md',
      line: 3,
    });
  });

  test('offers a closer spelling, and searches for it when pressed', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas\nThe elevator is stuck.' },
      'elevatr',
      {
        suggestWords: (words: readonly string[]) =>
          new Map(
            words
              .filter((word) => word === 'elevatr')
              .map((word) => [word, 'elevator']),
          ),
      },
    );

    assert.match(page.text('.did-you-mean') ?? '', /Nothing matched/);
    assert.match(page.text('.did-you-mean button') ?? '', /elevator/);

    page.click('.did-you-mean button');

    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), {
      type: 'setOverviewQuery',
      query: 'elevator',
    });
  });

  test('says nothing about spelling when the search found something', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas\nThe elevator is stuck.' },
      'elevator',
      {
        suggestWords: () => new Map([['elevator', 'elevators']]),
      },
    );

    assert.strictEqual(page.document.querySelector('.did-you-mean'), null);
  });

  test('draws one page of results and counts the whole search', () => {
    const { page } = openMany(8, { pageSize: 3 });

    assert.strictEqual(page.findAll('.card').length, 3, 'one page is drawn');
    assert.strictEqual(
      page.text('[data-search-count="notes"]'),
      '8',
      'the count is of the whole search, not the page',
    );
    assert.strictEqual(page.text('.pagination .page-range'), '1\u20133 of 8');
  });

  test('turns to the page a number names', () => {
    const { page } = openMany(8, { pageSize: 3 });

    page.click('.pagination .page-number[data-page="3"]');

    assert.deepStrictEqual(page.lastPosted('setResultPage'), {
      type: 'setResultPage',
      kind: 'notes',
      page: 3,
    });
  });

  test('steps to the next page, and marks the one being read', () => {
    const { page } = openMany(8, { pageSize: 3, notePage: 2 });

    assert.strictEqual(page.text('.pagination .page-range'), '4\u20136 of 8');
    assert.strictEqual(
      page.find('.pagination .page-number.is-current').textContent,
      '2',
    );
    assert.strictEqual(
      page.find('.pagination .page-number.is-current').getAttribute('aria-current'),
      'page',
    );

    page.click('.pagination .page-step[aria-label^="Next"]');

    assert.strictEqual(page.lastPosted('setResultPage')?.page, 3);
  });

  test('offers no way off either end of the pages', () => {
    const first = openMany(8, { pageSize: 3 }).page;
    assert.ok(
      first.find('.pagination .page-step[aria-label^="Previous"]').hasAttribute('disabled'),
      'the first page cannot go back',
    );
    assert.ok(
      !first.find('.pagination .page-step[aria-label^="Next"]').hasAttribute('disabled'),
    );
    first.dispose();

    const last = openMany(8, { pageSize: 3, notePage: 3 }).page;
    assert.strictEqual(last.text('.pagination .page-range'), '7\u20138 of 8');
    assert.ok(
      last.find('.pagination .page-step[aria-label^="Next"]').hasAttribute('disabled'),
      'the last page cannot go on',
    );
  });

  test('leaves out pages it cannot fit, keeping the ends and the way on', () => {
    const { page } = openMany(60, { pageSize: 2, notePage: 15 });

    const offered = page
      .findAll('.pagination [data-kind="notes"].page-number')
      .map((button) => button.textContent);
    assert.deepStrictEqual(offered, ['1', '14', '15', '16', '30']);
    assert.strictEqual(page.findAll('.pagination .page-gap').length, 2);
  });

  test('shows no pagination for a search that fits on one page', () => {
    const { page } = openMany(3, { pageSize: 10 });

    assert.strictEqual(page.document.querySelector('.pagination'), null);
  });

  test('keeps its search for a window reload', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas #project/atlas\nProse.' },
      '#project/atlas',
    );

    assert.deepStrictEqual(page.savedState(), {
      query: '#project/atlas',
      origin: '',
    });
  });

  test('opens the page of a tag written on a card, not the note', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas #project/atlas #risk/vendor\nProse.' },
      '#project/atlas',
    );
    const tag = page
      .findAll('.card [data-action="open-tag"]')
      .find((button) =>
        String(button.getAttribute('data-tag-key')).includes('risk/vendor'),
      );
    assert.ok(tag, 'the card shows the other tag it carries');

    tag.dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    assert.match(String(page.lastPosted('openTag')?.tagKey), /risk\/vendor/);
    assert.strictEqual(
      page.lastPosted('openSource'),
      undefined,
      'pressing a tag does not also open the note behind it',
    );
  });
});

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as
      | T
      | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}
