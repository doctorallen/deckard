import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  findLinkProblems,
  findMissingNoteNames,
} from '../ui/commands/linkHealth';
import {
  findDailyNoteActions,
  findTaskDependencies,
} from '../ui/state/editorLensState';

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

  suite('daily notes', () => {
    const index = createIndex({
      'notes/2026-09-18.md': '# 2026-09-18\n- [ ] Call the vendor\n- [x] Done already',
      'notes/2026-09-21.md': '# 2026-09-21\n- [ ] Write the brief\n- [ ] Book travel',
      'notes/2026-09-22.md': '# 2026-09-22\n- [ ] Book travel\n',
      'notes/Plan.md': '# Plan\n- [ ] Not a daily task',
    });
    const note = (filePath: string) => index.files.get(filePath) as ParsedFile;

    test("offers today's note the unfinished tasks it does not already hold", () => {
      const actions = findDailyNoteActions(
        note('notes/2026-09-22.md'),
        index,
        '2026-09-22',
      );
      assert.deepStrictEqual(
        actions?.carryIn.map((task) => task.title.trim()),
        // "Book travel" was carried already; the done task stays behind.
        ['Call the vendor', 'Write the brief'],
      );
      assert.strictEqual(actions?.previous, '2026-09-21');
      assert.strictEqual(actions?.next, undefined);
    });

    test('offers an earlier daily note only its neighbors', () => {
      const actions = findDailyNoteActions(
        note('notes/2026-09-21.md'),
        index,
        '2026-09-22',
      );
      assert.deepStrictEqual(actions?.carryIn, []);
      assert.strictEqual(actions?.previous, '2026-09-18');
      assert.strictEqual(actions?.next, '2026-09-22');
    });

    test('reaches only as far back as the lookback allows', () => {
      const actions = findDailyNoteActions(
        note('notes/2026-09-22.md'),
        index,
        '2026-09-22',
        2,
      );
      assert.deepStrictEqual(
        actions?.carryIn.map((task) => task.title.trim()),
        ['Write the brief'],
      );
    });

    test('shows nothing for a note that is not a daily note', () => {
      assert.strictEqual(
        findDailyNoteActions(note('notes/Plan.md'), index, '2026-09-22'),
        undefined,
      );
    });

    test('shows nothing for a lone daily note with nothing to carry', () => {
      const alone = createIndex({ 'notes/2026-09-22.md': '# 2026-09-22\n' });
      assert.strictEqual(
        findDailyNoteActions(
          alone.files.get('notes/2026-09-22.md') as ParsedFile,
          alone,
          '2026-09-22',
        ),
        undefined,
      );
    });
  });

  suite('link problems', () => {
    const index = createIndex({
      'notes/Atlas.md': '# Atlas',
      'notes/a/Log.md': '# Log',
      'notes/b/Log.md': '# Log',
    });
    const names = (content: string) =>
      findMissingNoteNames(findLinkProblems(content, index, 'notes/Here.md'));

    test('names each missing note once, whatever its case', () => {
      assert.deepStrictEqual(
        names('[[Vendor]] and [[vendor#Terms]], then [[Budget|the budget]]'),
        ['Vendor', 'Budget'],
      );
    });

    test('does not offer to create a note for a name several notes share', () => {
      const problems = findLinkProblems('[[Log]]', index, 'notes/Here.md');
      assert.strictEqual(problems.length, 1, 'the link is still a problem');
      assert.deepStrictEqual(findMissingNoteNames(problems), []);
    });

    test('finds nothing to create when every link opens a note', () => {
      assert.deepStrictEqual(
        findLinkProblems('[[Atlas]] and [[#Heading]]', index, 'notes/Here.md'),
        [],
      );
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
