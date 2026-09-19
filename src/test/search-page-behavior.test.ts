import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { SearchPageSize, SearchPageSnapshot } from '../core/types';
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
    options: Parameters<typeof createSearchPageSnapshot>[3] & {
      pageSize?: SearchPageSize;
    } = {},
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
      options.pageSize === undefined
        ? store.value
        : { ...store.value, searchPageSize: options.pageSize },
      query,
      options,
    );
    page = openWebviewPage(
      getSearchPageHtml({ cspSource: 'vscode-webview://deckard' }),
      snapshot,
    );
    return { page, snapshot };
  };

  /** A workspace with a hub note, a tagged note, and two tasks. */
  const NOTES: Record<string, string> = {
    'notes/atlas.md':
      '---\ndescribes: project/atlas\n---\n# Atlas\nThe hub note body.',
    'notes/one.md': [
      '# One #project/atlas #risk/vendor',
      'The lift is stuck.',
      '- [ ] Chase it #project/atlas',
      '- [x] Did it #project/atlas',
    ].join('\n'),
  };

  /** A search of `count` notes that all carry one tag. */
  const openMany = (
    count: number,
    options: Parameters<typeof open>[2],
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
    const { page } = openMany(25, { pageSize: 10 });

    assert.strictEqual(page.findAll('.card').length, 10, 'one page is drawn');
    assert.strictEqual(
      page.text('[data-search-count="notes"]'),
      '25',
      'the count is of the whole search, not the page',
    );
    assert.strictEqual(page.text('.pagination .page-range'), '1\u201310 of 25');
  });

  test('turns to the page a number names', () => {
    const { page } = openMany(25, { pageSize: 10 });

    page.click('.pagination .page-number[data-page="3"]');

    assert.deepStrictEqual(page.lastPosted('setResultPage'), {
      type: 'setResultPage',
      kind: 'notes',
      page: 3,
    });
  });

  test('steps to the next page, and marks the one being read', () => {
    const { page } = openMany(25, { pageSize: 10, notePage: 2 });

    assert.strictEqual(page.text('.pagination .page-range'), '11\u201320 of 25');
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
    const first = openMany(25, { pageSize: 10 }).page;
    assert.ok(
      first.find('.pagination .page-step[aria-label^="Previous"]').hasAttribute('disabled'),
      'the first page cannot go back',
    );
    assert.ok(
      !first.find('.pagination .page-step[aria-label^="Next"]').hasAttribute('disabled'),
    );
    first.dispose();

    const last = openMany(25, { pageSize: 10, notePage: 3 }).page;
    assert.strictEqual(last.text('.pagination .page-range'), '21\u201325 of 25');
    assert.ok(
      last.find('.pagination .page-step[aria-label^="Next"]').hasAttribute('disabled'),
      'the last page cannot go on',
    );
  });

  test('leaves out pages it cannot fit, keeping the ends and the way on', () => {
    const { page } = openMany(300, { pageSize: 10, notePage: 15 });

    const offered = page
      .findAll('.pagination [data-kind="notes"].page-number')
      .map((button) => button.textContent);
    assert.deepStrictEqual(offered, ['1', '14', '15', '16', '30']);
    assert.strictEqual(page.findAll('.pagination .page-gap').length, 2);
  });

  test('shows no pagination for a search smaller than the smallest page', () => {
    const { page } = openMany(3, { pageSize: 10 });

    assert.strictEqual(page.document.querySelector('.pagination'), null);
  });

  test('keeps the per-page chooser for a result that fills one large page', () => {
    // One page of 200 holds all 25, but the reader can still ask for ten to
    // a page, so the control has something to offer and stays.
    const { page } = openMany(25, { pageSize: 200 });

    assert.strictEqual(page.text('.pagination .page-range'), '1\u201325 of 25');
    assert.strictEqual(
      page.document.querySelector('.pagination .page-number'),
      null,
      'one page needs no page numbers',
    );
    assert.strictEqual(
      page.find('.pagination select').querySelectorAll('option').length,
      5,
    );
  });

  test('asks for a different page size, and marks the one in use', () => {
    const { page } = openMany(25, { pageSize: 10 });

    const select = page.find('.pagination select') as HTMLSelectElement;
    assert.strictEqual(select.value, '10');

    select.value = '50';
    select.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    assert.deepStrictEqual(page.lastPosted('setResultsPerPage'), {
      type: 'setResultsPerPage',
      size: 50,
    });
  });

  test('narrows the whole search by the words being typed, not the page', () => {
    // The word is on the last note of a 25-note search shown ten to a page,
    // so a page that searched only what it was holding would not find it.
    const notes: Record<string, string> = {};
    for (let index = 0; index < 25; index += 1) {
      notes[`notes/note-${index}.md`] =
        `# Note ${index} #project/atlas\n${index === 24 ? 'The elevator survey.' : 'Prose.'}`;
    }
    const { page } = open(notes, '#project/atlas', {
      pageSize: 10,
      previewWords: ['elevator'],
    });

    assert.strictEqual(page.findAll('.card').length, 1);
    assert.match(page.text('.card') ?? '', /elevator/);
    // The count is of what the draft finds, so it never reports a page's
    // worth of matches against a workspace's worth of results.
    assert.strictEqual(page.text('[data-search-count="notes"]'), '1');
    assert.strictEqual(page.document.querySelector('.pagination'), null);
  });

  test('says the draft found nothing only when the search found nothing', () => {
    const notes: Record<string, string> = {};
    for (let index = 0; index < 25; index += 1) {
      notes[`notes/note-${index}.md`] = `# Note ${index} #project/atlas\nProse.`;
    }
    const { page } = open(notes, '#project/atlas', {
      pageSize: 10,
      previewWords: ['elevator'],
    });

    assert.strictEqual(page.findAll('.card').length, 0);
    assert.strictEqual(page.text('[data-search-count="notes"]'), '0');
    assert.match(page.text('.empty') ?? '', /No notes match/);
  });

  test('switches the layout, the format, and the columns', () => {
    const { page } = open(NOTES, '#project/atlas');

    page.click('[data-action="set-layout"][data-layout="split"]');
    assert.deepStrictEqual(page.lastPosted('setTagOverviewLayout'), {
      type: 'setTagOverviewLayout',
      layout: 'split',
    });

    page.click('[data-action="set-mode"][data-mode="html"]');
    assert.deepStrictEqual(page.lastPosted('setRenderMode'), {
      type: 'setRenderMode',
      mode: 'html',
    });

    page.click('[data-action="set-columns"][data-section="notes"][data-value="3"]');
    assert.deepStrictEqual(page.lastPosted('setSearchColumns'), {
      type: 'setSearchColumns',
      section: 'notes',
      columns: 3,
    });
  });

  test('marks the control a reader is already using', () => {
    const { page } = open(NOTES, '#project/atlas');

    assert.strictEqual(
      page.find('[data-action="set-layout"][data-layout="tabs"]').getAttribute('aria-pressed'),
      'true',
    );
    assert.strictEqual(
      page.find('[data-action="set-layout"][data-layout="split"]').getAttribute('aria-pressed'),
      'false',
    );
  });

  test('moves between the notes and tasks tabs without asking the host', () => {
    const { page } = open(NOTES, '#project/atlas');

    const panel = (index: number) =>
      page.findAll('.overview-tab-panel')[index].hasAttribute('hidden');
    assert.strictEqual(panel(0), false, 'notes are shown first');
    assert.strictEqual(panel(1), true);

    page.click('[data-action="set-result-tab"][data-tab="tasks"]');

    assert.strictEqual(panel(0), true);
    assert.strictEqual(panel(1), false, 'tasks are shown now');
    assert.strictEqual(
      page.find('[data-action="set-result-tab"][data-tab="tasks"]').getAttribute('aria-selected'),
      'true',
    );
    assert.strictEqual(
      page.posted.length,
      0,
      'a tab is the page\'s own business, not the host\'s',
    );
  });

  test('sends the reader to the results waiting on the other tab', () => {
    // A task-only search lands on Tasks rather than an empty Notes tab.
    const { page } = open(NOTES, '#project/atlas is:open');

    assert.strictEqual(page.findAll('.card').length, 0);
    const other = page.find('[data-action="show-other-results"]');
    assert.match(other.textContent ?? '', /task/);

    page.click('[data-action="show-other-results"]');
    assert.strictEqual(
      page.findAll('.overview-tab-panel')[1].hasAttribute('hidden'),
      false,
    );
  });

  test('shows the note that describes a tag, and offers to write one', () => {
    const { page } = open(NOTES, '#project/atlas');
    assert.match(page.text('.hub') ?? '', /The hub note body/);

    page.dispose();
    const without = open(
      { 'notes/one.md': '# One #risk/vendor\nProse.' },
      '#risk/vendor',
    ).page;
    assert.match(without.text('.hub-empty') ?? '', /No note describes/);

    without.click('[data-action="create-hub"]');
    assert.deepStrictEqual(without.lastPosted('createHubNote'), {
      type: 'createHubNote',
    });
  });

  test('completes a task from its checkbox', () => {
    const { page } = open(NOTES, '#project/atlas', { taskFilter: 'all' });

    const box = page.find('[data-action="toggle-task"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    const posted = page.lastPosted('toggleTask');
    assert.strictEqual(posted?.completed, true);
    assert.ok(String(posted?.taskId).length > 0, 'the task is named by its id');
  });

  test('filters tasks by whether they are done', () => {
    const { page } = open(NOTES, '#project/atlas', { taskFilter: 'all' });

    page.click('[data-action="set-task-filter"][data-filter="completed"]');

    assert.deepStrictEqual(page.lastPosted('setTaskFilter'), {
      type: 'setTaskFilter',
      filter: 'completed',
    });
  });

  test('sorts the notes a search found', () => {
    const { page } = open(NOTES, '#project/atlas');

    const sort = page.find('[data-action="set-sort"]') as HTMLSelectElement;
    sort.value = 'updated';
    sort.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    assert.deepStrictEqual(page.lastPosted('setTagOverviewSort'), {
      type: 'setTagOverviewSort',
      mode: 'updated',
    });
  });

  test('renames a tag from its context menu', () => {
    const { page } = open(NOTES, '#project/atlas');

    page.find('.card [data-action="open-tag"]').dispatchEvent(
      new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    const menu = page.find('#tag-context-menu [data-context-action="rename-tag"]');
    menu.dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    assert.ok(String(page.lastPosted('renameTag')?.tagKey).length > 0);
  });

  test('keeps a search under a name', () => {
    const { page } = open(NOTES, '#project/atlas');

    page.click('[data-action="save-filter"]');

    assert.deepStrictEqual(page.lastPosted('saveTagOverviewFilter'), {
      type: 'saveTagOverviewFilter',
    });
  });

  test('draws a namespaced tag as its namespace and its value', () => {
    const { page } = open(NOTES, '#project/atlas');

    assert.strictEqual(page.text('.tag-namespace'), '#project/');
    assert.ok((page.text('.tag-value') ?? '').length > 0);
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
