import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

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

  test('a scan that changes many notes leaves none of their old text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-search-'));
    const store = new SearchStore(vscode.Uri.file(directory));
    const notes = (word: string, updatedAt: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        parseMarkdown(`note-${index}.md`, `# Note ${index}\n${word}.`, { updatedAt }),
      );
    try {
      store.replace(notes('staffing', 1, 300));
      store.replace(notes('budget', 2, 250));

      assert.strictEqual(store.search('budget', 1000).length, 250, 'every edit is indexed');
      assert.strictEqual(store.search('staffing', 1000).length, 0, 'no old text is left');
    } finally {
      store.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('a rescan finds an edit to a note that states its own updated date', () => {
    const store = new SearchStore(undefined);
    // The edit keeps the note's size and its `updated:` date; only the file's
    // own modified time shows that it changed.
    const note = (word: string, modified: number) =>
      parseMarkdown(
        'atlas.md',
        `---\nupdated: 2026-09-01\n---\n# Atlas\n${word} plan.`,
        { createdAt: 1, updatedAt: modified },
      );
    try {
      store.replace([note('alpha', 1)]);
      store.replace([note('omega', 2)]);

      assert.deepStrictEqual(store.search('omega').map((r) => r.filePath), ['atlas.md']);
      assert.deepStrictEqual(store.search('alpha'), []);
    } finally {
      store.dispose();
    }
  });

  test('saving and removing single notes replaces their text', () => {
    const store = new SearchStore(undefined);
    try {
      store.replace([
        parseMarkdown('atlas.md', '# Atlas\nStaffing plan.', { updatedAt: 1 }),
        parseMarkdown('vendor.md', '# Vendor\nStaffing contract.', { updatedAt: 1 }),
      ]);
      store.upsert(parseMarkdown('atlas.md', '# Atlas\nBudget review.', { updatedAt: 2 }));
      store.upsert(parseMarkdown('harbor.md', '# Harbor\nBudget roster.', { updatedAt: 1 }));
      store.remove('vendor.md');

      const paths = (query: string) =>
        store.search(query).map((result) => result.filePath).sort();
      assert.deepStrictEqual(paths('budget'), ['atlas.md', 'harbor.md']);
      assert.deepStrictEqual(paths('staffing'), [], 'old and removed text is gone');
    } finally {
      store.dispose();
    }
  });

  test('replaces a cache written in an older layout', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-search-'));
    const old = new DatabaseSync(join(directory, 'deckard-search.sqlite'));
    old.exec(`
      CREATE TABLE notes (file_path TEXT PRIMARY KEY NOT NULL, content TEXT NOT NULL, updated_at INTEGER) STRICT;
      CREATE VIRTUAL TABLE notes_fts USING fts5(file_path UNINDEXED, content);
      INSERT INTO notes VALUES ('atlas.md', 'Staffing plan.', 1);
      INSERT INTO notes_fts VALUES ('atlas.md', 'Staffing plan.');
    `);
    old.close();

    const store = new SearchStore(vscode.Uri.file(directory));
    try {
      assert.deepStrictEqual(store.search('staffing'), [], 'the old cache is dropped');
      store.replace([parseMarkdown('atlas.md', '# Atlas\nBudget review.', { updatedAt: 2 })]);
      store.upsert(parseMarkdown('atlas.md', '# Atlas\nStaffing review.', { updatedAt: 3 }));
      assert.deepStrictEqual(store.search('staffing').map((r) => r.filePath), ['atlas.md']);
      assert.deepStrictEqual(store.search('budget'), []);
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
