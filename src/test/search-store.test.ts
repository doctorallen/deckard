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

  test('ranks an entry titled with a word above one that only mentions it', () => {
    const store = new SearchStore(undefined);
    try {
      store.replace([
        parseMarkdown('a.md', '# Weekly review\nThe vendor sent the elevator quote.', { updatedAt: 1 }),
        parseMarkdown('b.md', '# Vendor contract\nSigned today.', { updatedAt: 1 }),
      ]);

      const result = store.searchEntries('vendor');
      assert.deepStrictEqual(
        result.matches.map((match) => match.filePath),
        ['b.md', 'a.md'],
      );
      assert.strictEqual(result.matches[0].kind, 'section');
      assert.strictEqual(result.matches[0].line, 1);
      assert.strictEqual(result.partial, false);
    } finally {
      store.dispose();
    }
  });

  test('requires every word, and falls back to any word as a partial match', () => {
    const store = new SearchStore(undefined);
    try {
      store.replace([
        parseMarkdown('a.md', '# Vendor\nRisk of delay.', { updatedAt: 1 }),
        parseMarkdown('b.md', '# Vendor\nOn schedule.', { updatedAt: 1 }),
      ]);

      const both = store.searchEntries('vendor risk');
      assert.deepStrictEqual(both.matches.map((match) => match.filePath), ['a.md']);
      assert.strictEqual(both.partial, false);

      const either = store.searchEntries('vendor budget');
      assert.deepStrictEqual(
        either.matches.map((match) => match.filePath).sort(),
        ['a.md', 'b.md'],
      );
      assert.strictEqual(either.partial, true);
    } finally {
      store.dispose();
    }
  });

  test('matches the last word as it is being typed', () => {
    const store = new SearchStore(undefined);
    try {
      store.replace([parseMarkdown('a.md', '# Elevator\nQuote received.', { updatedAt: 1 })]);

      assert.strictEqual(store.searchEntries('eleva').matches.length, 1);
      assert.strictEqual(
        store.searchEntries('eleva', { prefixLastTerm: false }).matches.length,
        0,
      );
    } finally {
      store.dispose();
    }
  });

  test('indexes tasks and front-matter-only files as their own entries', () => {
    const store = new SearchStore(undefined);
    try {
      store.replace([
        parseMarkdown('a.md', '# Plan\n- [ ] Send the manifest to Ren', { updatedAt: 1 }),
        parseMarkdown('b.md', '---\ntags: [harbor]\n---\nDock schedule.', { updatedAt: 1 }),
      ]);

      const task = store.searchEntries('manifest').matches.find((match) => match.kind === 'task');
      assert.strictEqual(task?.filePath, 'a.md');
      assert.strictEqual(task?.line, 2);
      const file = store.searchEntries('dock').matches[0];
      assert.deepStrictEqual([file.kind, file.id], ['file', 'b.md']);
    } finally {
      store.dispose();
    }
  });

  test('suggests a close spelling when nothing matches', () => {
    const store = new SearchStore(undefined);
    try {
      store.replace([parseMarkdown('a.md', '# Vendor\nElevator contract.', { updatedAt: 1 })]);

      // One word matches, so the entry is offered as a partial match, with
      // the misspelled word corrected beside it.
      const result = store.searchEntries('elevatr contract', { prefixLastTerm: false });
      assert.strictEqual(result.partial, true);
      assert.strictEqual(result.matches.length, 1);
      assert.strictEqual(result.suggestion, 'elevator contract');

      const nothing = store.searchEntries('elevatr', { prefixLastTerm: false });
      assert.deepStrictEqual(nothing.matches, []);
      assert.strictEqual(nothing.suggestion, 'elevator');
      assert.strictEqual(store.searchEntries('zzzz').suggestion, undefined);
    } finally {
      store.dispose();
    }
  });
});
