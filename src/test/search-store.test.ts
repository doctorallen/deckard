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

  test('a later scan updates edited notes, drops deleted ones, and adds new ones', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-search-'));
    const store = new SearchStore(vscode.Uri.file(directory));
    try {
      store.replace([
        parseMarkdown('atlas.md', '# Atlas\nStaffing plan.', { updatedAt: 1 }),
        parseMarkdown('vendor.md', '# Vendor\nElevator contract.', { updatedAt: 1 }),
      ]);
      store.replace([
        parseMarkdown('atlas.md', '# Atlas\nBudget review.', { updatedAt: 2 }),
        parseMarkdown('harbor.md', '# Harbor\nStaffing roster.', { updatedAt: 1 }),
      ]);

      const paths = (query: string) =>
        store.search(query).map((result) => result.filePath);
      assert.deepStrictEqual(paths('budget'), ['atlas.md'], 'the edit is indexed');
      assert.deepStrictEqual(paths('staffing'), ['harbor.md'], 'the old text is gone');
      assert.deepStrictEqual(paths('elevator'), [], 'the deleted note is gone');
    } finally {
      store.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('keeps unchanged notes searchable across scans and sessions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-search-'));
    // An emoji makes the text's UTF-16 length differ from its character
    // count, which must not make an unchanged note look changed.
    const note = parseMarkdown(
      'atlas.md',
      '# Atlas\n- [ ] Staffing review 📅 2026-09-20',
      { updatedAt: 5 },
    );
    const first = new SearchStore(vscode.Uri.file(directory));
    try {
      first.replace([note]);
      first.replace([note]);
      assert.deepStrictEqual(first.search('staffing').map((r) => r.filePath), ['atlas.md']);
    } finally {
      first.dispose();
    }

    const reopened = new SearchStore(vscode.Uri.file(directory));
    try {
      assert.deepStrictEqual(reopened.search('staffing').map((r) => r.filePath), ['atlas.md']);
      reopened.replace([note]);
      assert.deepStrictEqual(reopened.search('staffing').map((r) => r.filePath), ['atlas.md']);
    } finally {
      reopened.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
