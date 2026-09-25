import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createDeckardStatsSnapshot } from '../ui/state/dashboardState';
import { parseStatsMessage } from '../ui/webview/messages';
import { getStatsHtml } from '../ui/webview/statsHtml';
import { openWebviewPage } from './webviewPage';

suite('Stats messages', () => {
  test('accepts the messages its rows post', () => {
    assert.deepStrictEqual(
      parseStatsMessage({ type: 'openTag', tagKey: '#project/relay' }),
      { type: 'openTag', tagKey: '#project/relay' },
    );
    assert.deepStrictEqual(
      parseStatsMessage({
        type: 'openSource',
        filePath: 'notes/first.md',
        line: 3,
      }),
      { type: 'openSource', filePath: 'notes/first.md', line: 3 },
    );
  });

  test('keeps only the fields the host reads', () => {
    assert.deepStrictEqual(
      parseStatsMessage({
        type: 'openTag',
        tagKey: '#project/relay',
        filterTagKeys: ['#risk/vendor'],
      }),
      { type: 'openTag', tagKey: '#project/relay' },
    );
  });

  test('rejects anything its rows could not have posted', () => {
    for (const message of [
      undefined,
      'openTag',
      { type: 'openTag', tagKey: '' },
      { type: 'openSource', filePath: 'notes/first.md', line: 0 },
      { type: 'openSource', filePath: 'notes/first.md', line: 1.5 },
      { type: 'toggleTask', taskId: 'a', completed: true },
    ]) {
      assert.strictEqual(
        parseStatsMessage(message),
        undefined,
        JSON.stringify(message),
      );
    }
  });
});

suite('Stats: notes that could not be read', () => {
  const index = () =>
    buildWorkspaceIndex(new Map([['notes/good.md', parseMarkdown('notes/good.md', '# Good #project/atlas')]]));
  const preferences = () =>
    new PreferencesStore({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never).value;
  const webview = { cspSource: 'vscode-webview://deckard', asWebviewUri: (r: vscode.Uri) => r } as unknown as vscode.Webview;

  test('the snapshot lists each one with what opens it', () => {
    const snapshot = createDeckardStatsSnapshot(index(), preferences(), [
      { filePath: 'notes/bad.md', reason: 'EACCES: permission denied' },
    ]);
    assert.deepStrictEqual(snapshot.unreadable, [
      { filePath: 'notes/bad.md', reason: 'EACCES: permission denied', open: { type: 'openSource', filePath: 'notes/bad.md', line: 1 } },
    ]);
    assert.deepStrictEqual(createDeckardStatsSnapshot(index(), preferences()).unreadable, []);
  });

  test('the page says so where a reader looks, and a row opens the note', () => {
    const page = openWebviewPage(
      getStatsHtml(webview),
      createDeckardStatsSnapshot(index(), preferences(), [{ filePath: 'notes/bad.md', reason: 'EACCES: permission denied' }]),
    );
    try {
      const text = page.document.body.textContent ?? '';
      assert.match(text, /Notes Deckard could not read/);
      assert.match(text, /1 note is in the workspace but not in the index/);
      assert.match(text, /notes\/bad\.md/);
      assert.match(text, /EACCES: permission denied/);
      page.click('[data-list="unreadable"][data-index="0"]');
      assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'notes/bad.md', line: 1 });
    } finally {
      page.dispose();
    }
  });

  test('the page says when the index was refreshed in words, with the time on hover', () => {
    const page = openWebviewPage(getStatsHtml(webview), { ...createDeckardStatsSnapshot(index(), preferences()), updatedAt: Date.now() - 5 * 60 * 1000 });
    try {
      assert.match(page.text('.updated') ?? '', /^Index last refreshed: 5 minutes ago/);
      assert.ok(page.find('.updated span[title]').getAttribute('title')?.includes('2'), 'the exact time is on hover');
    } finally {
      page.dispose();
    }
  });

  test('the page says nothing when every note was read', () => {
    const page = openWebviewPage(getStatsHtml(webview), createDeckardStatsSnapshot(index(), preferences()));
    try {
      // The page's own script mentions the panel by name, so read the DOM,
      // not the text of everything under body.
      assert.strictEqual(page.findAll('[data-list="unreadable"]').length, 0);
      assert.strictEqual(page.findAll('.view-panel.unreadable').length, 0);
    } finally {
      page.dispose();
    }
  });
});
