import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import {
  countFirstIndex,
  describeFirstIndex,
  FIRST_INDEX_SUMMARY_SHOWN,
  shouldSummarize,
  summarizeFirstIndex,
} from '../ui/commands/firstIndex';
import { createQueryContext } from '../core/query/queryContext';

function memento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: <T>(key: string, fallback?: T) => (store.has(key) ? (store.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => void store.set(key, value),
  };
}

suite('First index summary', () => {
  test('says what it read, in as few words as the counts allow', () => {
    assert.strictEqual(
      describeFirstIndex({ notes: 412, openTasks: 1204, overdue: 17, tags: 185 }),
      'Deckard read 412 notes: 1,204 open tasks (17 overdue) and 185 tags.',
    );
    assert.strictEqual(
      describeFirstIndex({ notes: 412, openTasks: 1204, overdue: 0, tags: 185 }),
      'Deckard read 412 notes: 1,204 open tasks and 185 tags.',
    );
    assert.strictEqual(describeFirstIndex({ notes: 412, openTasks: 0, overdue: 0, tags: 185 }), 'Deckard read 412 notes and 185 tags.');
    assert.strictEqual(
      describeFirstIndex({ notes: 412, openTasks: 1204, overdue: 17, tags: 0 }),
      'Deckard read 412 notes: 1,204 open tasks (17 overdue).',
    );
    assert.strictEqual(describeFirstIndex({ notes: 412, openTasks: 0, overdue: 0, tags: 0 }), 'Deckard read 412 notes.');
    assert.strictEqual(
      describeFirstIndex({ notes: 1, openTasks: 1, overdue: 1, tags: 1 }),
      'Deckard read 1 note: 1 open task (1 overdue) and 1 tag.',
    );
  });

  test('counts as overdue only what the Tasks view calls overdue', () => {
    const now = new Date(2026, 9, 7, 9).getTime();
    const file = parseMarkdown(
      'a.md',
      '# A #project/atlas\n\n- [ ] Late 📅 2026-10-05\n- [ ] Long late 📅 2026-08-20\n- [ ] Undated\n- [x] Done 📅 2026-10-01\n',
    );
    const counts = countFirstIndex(buildWorkspaceIndex(new Map([['a.md', file]])), createQueryContext(now));
    assert.deepStrictEqual(counts, { notes: 1, openTasks: 3, overdue: 1, tags: 1 });
  });

  test('speaks once, for a workspace new to Deckard with notes in it, and not for the sample', () => {
    const gate = { newToDeckard: true, hasFolder: true, alreadyShown: false, notes: 3, isSample: false };
    assert.strictEqual(shouldSummarize(gate), true);
    assert.strictEqual(shouldSummarize({ ...gate, newToDeckard: false }), false);
    assert.strictEqual(shouldSummarize({ ...gate, alreadyShown: true }), false);
    assert.strictEqual(shouldSummarize({ ...gate, notes: 0 }), false);
    assert.strictEqual(shouldSummarize({ ...gate, isSample: true }), false);
  });

  test('an empty first index is remembered too, and a large one says how to leave folders out', async () => {
    const window = vscode.window as unknown as Record<string, unknown>;
    const original = window.showInformationMessage;
    const shown: unknown[][] = [];
    window.showInformationMessage = async (...args: unknown[]) => {
      shown.push(args);
      return undefined;
    };
    try {
      const empty = { workspaceState: memento() };
      const none = buildWorkspaceIndex(new Map());
      const gate = { newToDeckard: true, hasFolder: true, isSample: false };
      const options = { excludeHintShownKey: 'hint', excludeIsEmpty: true };
      assert.strictEqual(await summarizeFirstIndex(empty, none, gate, options), false);
      assert.strictEqual(empty.workspaceState.get(FIRST_INDEX_SUMMARY_SHOWN), true);
      assert.strictEqual(shown.length, 0);

      const files = new Map(
        Array.from({ length: 3000 }, (_, i) => [`n${i}.md`, parseMarkdown(`n${i}.md`, `# Note ${i}\n`)] as const),
      );
      const large = { workspaceState: memento() };
      assert.strictEqual(await summarizeFirstIndex(large, buildWorkspaceIndex(files), gate, options), true);
      assert.strictEqual(large.workspaceState.get('hint'), true, 'the exclude hint is not said again');
      assert.match(String(shown[0][0]), /^Deckard read 3,000 notes\. If some folders hold Markdown you do not want read, the "Exclude" setting leaves them out\.$/);
      assert.deepStrictEqual(shown[0].slice(1), ['Open Dashboard', 'Get Started', 'Leave Folders Out…']);
    } finally {
      window.showInformationMessage = original;
    }
  });
});
