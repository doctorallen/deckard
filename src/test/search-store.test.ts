import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { SearchStore } from '../core/storage/searchStore';

suite('Local search store', () => {
  test('persists and searches saved Markdown text locally', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-search-'));
    const store = new SearchStore(vscode.Uri.file(directory));
    try {
      store.replace([
        parseMarkdown(
          'atlas.md',
          '# Atlas #project/atlas\nDiscussed staffing with @alex-smith.',
        ),
      ]);

      assert.deepStrictEqual(store.search('staffing').map((result) => result.filePath), [
        'atlas.md',
      ]);
      assert.strictEqual(store.search('nonexistent').length, 0);
    } finally {
      store.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
