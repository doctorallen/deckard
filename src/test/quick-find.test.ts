import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { SearchStore } from '../core/storage/searchStore';
import { PersistedPreferences, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createQuerySuggestions } from '../ui/state/dashboardState';
import {
  buildQuickFindResults,
  fuzzyScore,
  QuickFindResults,
} from '../ui/state/quickFindState';
import { isNoteName } from '../ui/commands/quickFind';

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

/**
 * Runs Quick Find over real parsed notes and a real in-memory text index, so
 * the ranking is checked against what the extension would actually do.
 */
function createFinder(notes: Record<string, string>) {
  const files = Object.entries(notes).map(([filePath, content]) =>
    parseMarkdown(filePath, content, { updatedAt: 1 }),
  );
  const index: WorkspaceIndex = buildWorkspaceIndex(
    new Map(files.map((file) => [file.filePath, file])),
  );
  const store = new SearchStore(undefined);
  store.replace(files);
  const conditions = createQuerySuggestions(index).conditions;
  return {
    index,
    find: (
      input: string,
      preferences: PersistedPreferences = new PreferencesStore(new MemoryMemento()).value,
    ): QuickFindResults =>
      buildQuickFindResults(
        index,
        preferences,
        input,
        (text) => store.searchEntries(text, { limit: 200 }),
        { conditions },
      ),
    dispose: () => store.dispose(),
  };
}

suite('Quick Find', () => {
  test('lists a note titled with the words above one that only mentions them', () => {
    const finder = createFinder({
      'a.md': '# Weekly review\nThe vendor sent the elevator quote.',
      'b.md': '# Vendor contract\nSigned today.',
    });
    try {
      const results = finder.find('vendor');
      assert.deepStrictEqual(
        results.notes.map((note) => note.label),
        ['Vendor contract', 'Weekly review'],
      );
      assert.strictEqual(results.notes[0].line, 1);
    } finally {
      finder.dispose();
    }
  });

  test('finds a title from its initials and abbreviations', () => {
    const finder = createFinder({
      'a.md': '# Vendor contract\nSigned today.',
      'b.md': '# Harbor schedule\nDocking windows.',
    });
    try {
      assert.deepStrictEqual(
        finder.find('vcon').notes.map((note) => note.label),
        ['Vendor contract'],
      );
    } finally {
      finder.dispose();
    }
  });

  test('narrows with tags and shorthands exactly as a query does', () => {
    const finder = createFinder({
      'atlas.md': '# Atlas #project/atlas\n- [ ] Send the manifest\n- [x] Book the dock',
      'harbor.md': '# Harbor\n- [ ] Send the roster',
    });
    try {
      const results = finder.find('#project/atlas is:open');
      assert.deepStrictEqual(results.tasks.map((task) => task.label), ['Send the manifest']);
      assert.deepStrictEqual(results.notes, []);
    } finally {
      finder.dispose();
    }
  });

  test('completes a tag while it is typed, and does not narrow to nothing', () => {
    const finder = createFinder({
      'atlas.md': '# Atlas #project/atlas\nPlanning.',
    });
    try {
      const results = finder.find('planning #proj');
      assert.strictEqual(results.tags[0]?.tagKey, '#project/atlas');
      assert.strictEqual(results.tags[0]?.completion, 'planning #project/atlas ');
      // The words before the unfinished tag still find their notes.
      assert.deepStrictEqual(results.notes.map((note) => note.label), ['Atlas']);
    } finally {
      finder.dispose();
    }
  });

  test('finds a tag from its last segment', () => {
    const finder = createFinder({
      'atlas.md': '# Planning #project/atlas',
    });
    try {
      assert.strictEqual(finder.find('atlas').tags[0]?.tagKey, '#project/atlas');
    } finally {
      finder.dispose();
    }
  });

  test('offers a condition for a value typed without its field', () => {
    const finder = createFinder({ 'a.md': '# A\n- [ ] Task' });
    try {
      const conditions = finder.find('overd').conditions;
      assert.strictEqual(conditions[0]?.label, 'is:overdue');
      assert.strictEqual(conditions[0]?.completion, 'is:overdue ');
    } finally {
      finder.dispose();
    }
  });

  test('keeps the results of the finished words while the last one is typed', () => {
    const finder = createFinder({
      'a.md': '# Plan\n- [ ] Send the manifest',
    });
    try {
      const results = finder.find('manifest is:ov');
      assert.strictEqual(results.message, undefined);
      assert.deepStrictEqual(results.tasks.map((task) => task.label), ['Send the manifest']);
      assert.strictEqual(results.conditions[0]?.label, 'is:overdue');
    } finally {
      finder.dispose();
    }
  });

  test('suggests a correction for a misspelled word', () => {
    const finder = createFinder({ 'a.md': '# Plan\nThe manifest is ready.' });
    try {
      assert.strictEqual(finder.find('manifst ').suggestion, 'manifest ');
    } finally {
      finder.dispose();
    }
  });

  test('opens on recent searches, favorite and recently opened tags', async () => {
    const finder = createFinder({
      'atlas.md': '# Atlas #project/atlas',
      'harbor.md': '# Harbor #project/harbor',
    });
    const store = new PreferencesStore(new MemoryMemento());
    try {
      await store.recordRecentQuery('#project/atlas is:open');
      await store.recordTagAccess('#project/harbor');
      const results = finder.find('', store.value);
      assert.deepStrictEqual(results.recent.map((item) => item.query), [
        '#project/atlas is:open',
      ]);
      assert.deepStrictEqual(results.tags.map((item) => item.tagKey), ['#project/harbor']);
    } finally {
      finder.dispose();
    }
  });

  test('scores characters that start words and follow each other highest', () => {
    const initials = fuzzyScore('vc', 'vendor contract') ?? 0;
    const scattered = fuzzyScore('vc', 'every cocoa') ?? 0;
    assert.ok(initials > scattered);
    assert.strictEqual(fuzzyScore('xyz', 'vendor contract'), undefined);
  });

  test('offers to create a note only for words that read as a name', () => {
    assert.strictEqual(isNoteName('Vendor contract'), true);
    assert.strictEqual(isNoteName('#project/atlas'), false);
    assert.strictEqual(isNoteName('is:open'), false);
    assert.strictEqual(isNoteName('atlas OR harbor'), false);
    assert.strictEqual(isNoteName('"exact words"'), false);
  });
});
