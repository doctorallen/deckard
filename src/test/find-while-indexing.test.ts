import * as assert from 'assert';

import * as vscode from 'vscode';

import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import { parseMarkdown } from '../core/markdown/parser';
import { QuickFind } from '../ui/commands/quickFind';

/** Find opens at once while the first scan runs, and says how far it has got. */
suite('Find while indexing', () => {
  test('opens busy with the scan\'s progress, and lists results once ready', async () => {
    const progress = new vscode.EventEmitter<void>();
    let finish: () => void = () => undefined;
    const indexer = {
      hasIndexed: false,
      scanProgress: { completed: 412, total: 3760 } as { completed: number; total: number } | undefined,
      onDidProgress: progress.event,
      onDidUpdate: new vscode.EventEmitter<void>().event,
      ready: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      getSnapshot: () => buildWorkspaceIndex(new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas plan\nBody.')]])),
      searchEntries: () => ({ matches: [], partial: false }),
    };
    const store = new PreferencesStore({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const opened: string[] = [];
    const find = new QuickFind(indexer as never, store, {
      openTag: async () => undefined,
      openSavedFilter: async () => undefined,
      showSearch: async (query) => {
        opened.push(query);
      },
    });
    try {
      await find.show('atlas');
      const picker = (find as unknown as { picker: vscode.QuickPick<vscode.QuickPickItem & { indexing?: boolean }> }).picker;
      assert.strictEqual(picker.busy, true);
      assert.strictEqual(picker.value, 'atlas', 'what was typed is kept');
      assert.strictEqual(picker.items.length, 1);
      assert.match(picker.items[0].label, /Indexing this workspace: 412 of 3,760 notes read…/);
      indexer.scanProgress = { completed: 3000, total: 3760 };
      progress.fire();
      assert.match(picker.items[0].label, /3,000 of 3,760/);

      indexer.hasIndexed = true;
      indexer.scanProgress = undefined;
      finish();
      await indexer.ready;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(picker.busy, false);
      assert.ok(picker.items.every((item) => !item.indexing), 'the results take the line\'s place');
    } finally {
      find.dispose();
      store.dispose();
      progress.dispose();
    }
  });
});
