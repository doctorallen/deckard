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

  test('draws the batch it was sent and counts the whole search', () => {
    const notes: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1) {
      notes[`notes/note-${index}.md`] = `# Note ${index} #project/atlas\nProse.`;
    }
    const { page } = open(notes, '#project/atlas', { noteLimit: 3 });

    assert.strictEqual(page.findAll('.card').length, 3, 'only the batch is drawn');
    assert.strictEqual(
      page.text('[data-search-count="notes"]'),
      '8',
      'the count is of the whole search, not the batch',
    );

    page.click('[data-action="show-more-entries"]');

    assert.deepStrictEqual(page.lastPosted('showMoreEntries'), {
      type: 'showMoreEntries',
      kind: 'notes',
    });
  });

  test('asks for nothing more once it has the whole search', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas #project/atlas\nProse.' },
      '#project/atlas',
    );

    assert.strictEqual(
      page.document.querySelector('[data-action="show-more-entries"]'),
      null,
    );
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
