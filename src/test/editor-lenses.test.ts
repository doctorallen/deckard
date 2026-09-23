import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { findTaskDependencies } from '../ui/state/editorLensState';

suite('Editor lenses', () => {
  suite('task dependencies', () => {
    const index = createIndex({
      'notes/Plan.md': [
        '# Plan',
        '- [ ] Draft the memo 🆔 memo',
        '- [ ] Send the memo ⛔ memo 🆔 send',
        '- [ ] Book the room ⛔ room',
        '- [ ] Just a task',
        '- [x] Old step 🆔 old',
        '- [ ] After the old step ⛔ old',
      ].join('\n'),
      'notes/Other.md': [
        '# Other',
        '- [ ] Review the memo ⛔ memo',
        '- [x] Done already ⛔ send',
        '- [ ] Follow up ⛔ send, send',
      ].join('\n'),
    });
    const plan = index.files.get('notes/Plan.md') as ParsedFile;
    const byLine = new Map(
      findTaskDependencies(plan, index).map((task) => [task.line, task]),
    );
    const titles = (tasks: { title: string }[]) =>
      tasks.map((task) => task.title.trim()).sort();

    test('counts the open tasks that wait on a task, across notes', () => {
      assert.deepStrictEqual(titles(byLine.get(1)?.blocking ?? []), [
        'Review the memo',
        'Send the memo',
      ]);
      assert.deepStrictEqual(byLine.get(1)?.waitingOn, []);
    });

    test('counts what a task waits on, and what it holds up, once each', () => {
      const send = byLine.get(2);
      assert.deepStrictEqual(titles(send?.waitingOn ?? []), ['Draft the memo']);
      // The done task no longer waits, and naming "send" twice is one wait.
      assert.deepStrictEqual(titles(send?.blocking ?? []), ['Follow up']);
    });

    test('names a ⛔ id no task carries', () => {
      assert.deepStrictEqual(byLine.get(3)?.missingIds, ['room']);
    });

    test('shows nothing for a task with no dependency, or none still open', () => {
      assert.ok(!byLine.has(4), 'a plain task');
      assert.ok(!byLine.has(5), 'a done task blocks nothing');
      assert.ok(!byLine.has(6), 'waiting only on a done task');
    });

    test('shows nothing for a note without dependencies', () => {
      const note = parseMarkdown('notes/Loose.md', '# Loose\n- [ ] One\n- [ ] Two');
      assert.deepStrictEqual(findTaskDependencies(note, index), []);
    });

    test('reads the note being edited, not the index, for its own tasks', () => {
      // An unsaved edit that completes the memo draft frees the send.
      const edited = parseMarkdown(
        'notes/Plan.md',
        plan.content.replace('- [ ] Draft the memo', '- [x] Draft the memo'),
      );
      const send = findTaskDependencies(edited, index).find(
        (task) => task.line === 2,
      );
      assert.deepStrictEqual(send?.waitingOn ?? [], []);
    });
  });
});

function createIndex(files: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(files).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}
