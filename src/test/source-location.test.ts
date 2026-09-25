import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createSearchPageSnapshot } from '../ui/state/dashboardState';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

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

suite('Where an entry is written', () => {
  let page: WebviewPage | undefined;
  let store: PreferencesStore | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.dispose();
    store = undefined;
  });

  test('names a note and a task by file and line', () => {
    const index = buildWorkspaceIndex(
      new Map([
        [
          'notes/2026-09-22.md',
          parseMarkdown(
            'notes/2026-09-22.md',
            [
              '# Harbor check-in #team/harbor',
              'Prose.',
              '- [ ] Verify the consent language #team/harbor',
            ].join('\n'),
          ),
        ],
      ]),
    );
    store = new PreferencesStore(new MemoryMemento());
    page = openWebviewPage(
      getSearchPageHtml({ cspSource: 'vscode-webview://deckard' }),
      createSearchPageSnapshot(index, store.value, '#team/harbor', {}),
    );

    assert.strictEqual(page.text('.card .source'), '2026-09-22 / line 1');
    // The card is the note's top heading, so it has no path to add.
    assert.strictEqual(page.findAll('.card .heading-path').length, 0);
    // A task says where it is, then the headings above it with their tags
    // stripped, so a heading's tags never read as the task's own.
    assert.deepStrictEqual(
      page.findAll('.task-row .task-source').map((span) => span.textContent),
      ['2026-09-22 / line 3', 'Harbor check-in'],
    );
  });
});
