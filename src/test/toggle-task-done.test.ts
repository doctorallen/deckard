import * as assert from 'assert';

import * as vscode from 'vscode';

import { describeToggle, toggleTaskDoneCommand } from '../ui/commands/toggleTaskDone';
import { createTaskWrites } from './taskWrites';
import { selectedLines, toggleTaskLines } from '../domain/tasks/toggleLines';

/** Friday 2026-09-25, mid-morning. */
const now = new Date(2026, 8, 25, 10, 0, 0).getTime();
const options = { format: 'emoji' as const, eol: '\n' };

function lines(...texts: string[]): { line: number; text: string }[] {
  return texts.map((text, line) => ({ line, text }));
}

suite('Toggle Task Done', () => {
  test('completes an open task with its done date', () => {
    const result = toggleTaskLines(lines('- [ ] Send proposal'), now, options);
    assert.strictEqual(result.completed, true);
    assert.deepStrictEqual(
      result.lines.map((line) => line.after),
      ['- [x] Send proposal ✅ 2026-09-25'],
    );
    assert.deepStrictEqual(describeToggle(result), {
      text: 'Completed "Send proposal".',
      severity: 'info',
    });
  });

  test('writes a repeating task\'s next occurrence above it', () => {
    const result = toggleTaskLines(
      lines('- [ ] Water plants 🔁 every week 📅 2026-09-25'),
      now,
      options,
    );
    assert.strictEqual(
      result.lines[0].after,
      '- [ ] Water plants 🔁 every week 📅 2026-10-02\n- [x] Water plants 🔁 every week 📅 2026-09-25 ✅ 2026-09-25',
    );
    assert.strictEqual(
      describeToggle(result).text,
      'Completed "Water plants", and started the next one, due 2026-10-02.',
    );
  });

  test('completes the open ones when any is open, and leaves a done one alone', () => {
    const result = toggleTaskLines(
      lines('- [ ] One', '- [x] Two ✅ 2026-09-20'),
      now,
      options,
    );
    assert.strictEqual(result.completed, true);
    assert.deepStrictEqual(result.lines.map((line) => line.line), [0]);
  });

  test('reopens every task when all are done, taking the date off', () => {
    const result = toggleTaskLines(
      lines('- [x] One ✅ 2026-09-20', '* [X] Two'),
      now,
      options,
    );
    assert.strictEqual(result.completed, false);
    assert.deepStrictEqual(
      result.lines.map((line) => line.after),
      ['- [ ] One', '* [ ] Two'],
    );
    assert.strictEqual(describeToggle(result).text, 'Reopened 2 tasks.');
  });

  test('leaves prose alone, and says so for an unreadable rule', () => {
    assert.strictEqual(toggleTaskLines(lines('Just words'), now, options).lines.length, 0);
    const result = toggleTaskLines(lines('- [ ] Odd 🔁 whenever'), now, options);
    assert.strictEqual(result.lines[0].unreadRule, 'whenever');
    assert.strictEqual(describeToggle(result).severity, 'warning');
  });

  test('takes each line a selection touches once, but not a line it only ends at', () => {
    assert.deepStrictEqual(
      selectedLines([
        { start: { line: 1, character: 2 }, end: { line: 3, character: 0 } },
        { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
        { start: { line: 5, character: 1 }, end: { line: 5, character: 4 } },
      ]),
      [1, 2, 5],
    );
  });

  test('writes every cursor in one edit, so one Undo takes it back', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# Plan\n- [ ] One\nProse\n- [ ] Two 🔁 every day 📅 2026-09-25\n',
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selections = [
      new vscode.Selection(1, 0, 3, 3),
    ];
    const carried: [string, string][] = [];
    try {
      const version = document.version;
      const result = await toggleTaskDoneCommand(
        {
          paths: { getFilePath: () => 'plan.md' },
          tasks: createTaskWrites(undefined, (from, to) => carried.push([from, to])).tasks,
        },
        now,
      );
      assert.strictEqual(result?.lines.length, 2);
      assert.strictEqual(
        document.getText(),
        '# Plan\n- [x] One ✅ 2026-09-25\nProse\n- [ ] Two 🔁 every day 📅 2026-09-26\n- [x] Two 🔁 every day 📅 2026-09-25 ✅ 2026-09-25\n',
      );
      // An untitled note has no place in the index, so no rank moves.
      assert.deepStrictEqual(carried, []);
      // One edit, so one Undo takes every line back.
      assert.strictEqual(document.version, version + 1);
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });

  test('says where to put the cursor on a line with no task', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'Nothing to do\n',
    });
    await vscode.window.showTextDocument(document);
    const window = vscode.window as unknown as Record<string, unknown>;
    const original = window.showInformationMessage;
    const said: string[] = [];
    window.showInformationMessage = (text: string) => {
      said.push(text);
      return Promise.resolve(undefined);
    };
    try {
      assert.strictEqual(await toggleTaskDoneCommand({ paths: { getFilePath: () => 'plan.md' }, tasks: createTaskWrites().tasks }, now), undefined);
      assert.deepStrictEqual(said, ['Put the cursor on a task to mark it done.']);
      assert.strictEqual(document.getText(), 'Nothing to do\n');
    } finally {
      window.showInformationMessage = original;
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });
});
