import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { addedTaskLine, addTask, changeTask, changeTaskLine, describeChange } from '../ui/commands/assistantWrites';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { readAddTaskInput, readChangeTaskInput } from '../ui/state/assistantWriteInput';

suite('Assistant writes', () => {
  const NOW = Date.UTC(2026, 8, 21, 12);

  test('reads an add-task call, and refuses what an assistant should not send', () => {
    assert.deepStrictEqual(readAddTaskInput({ text: '  Call  Ren ' }), { text: 'Call Ren' });
    assert.deepStrictEqual(readAddTaskInput({ text: 'x', note: ' notes/a.md ' }), { text: 'x', note: 'notes/a.md' });
    for (const junk of [undefined, 'text', { text: '' }, { text: 42 }, { text: 'x'.repeat(501) }, { note: 'a.md' }]) {
      assert.strictEqual(readAddTaskInput(junk), undefined, JSON.stringify(junk));
    }
  });

  test('reads a change-task call: a note and a line, and at least one change', () => {
    assert.deepStrictEqual(
      readChangeTaskInput({ note: 'notes/a.md', line: 3, complete: true, due: '2026-09-30', priority: 'high', assignee: '@ren' }),
      { note: 'notes/a.md', line: 3, complete: true, due: '2026-09-30', priority: 'high', assignee: '@ren' },
    );
    assert.deepStrictEqual(readChangeTaskInput({ note: 'a.md', line: 1, due: null }), { note: 'a.md', line: 1, due: null }, 'null clears');
    for (const junk of [
      { note: 'a.md', line: 1 },
      { note: 'a.md', line: 0, complete: true },
      { note: 'a.md', line: 1.5, complete: true },
      { note: '', line: 1, complete: true },
      { note: 'a.md', line: 1, due: 'tomorrow' },
      { note: 'a.md', line: 1, priority: 'urgent' },
      { note: 'a.md', line: 1, assignee: 'two words' },
      { note: 'a.md', line: 1, complete: 'yes' },
      { note: 'a.md', line: 1, title: '' },
    ]) {
      assert.strictEqual(readChangeTaskInput(junk), undefined, JSON.stringify(junk));
    }
  });

  test('an added task is a task line', () => {
    assert.strictEqual(addedTaskLine('Call Ren 📅 2026-09-30'), '- [ ] Call Ren 📅 2026-09-30');
    assert.strictEqual(addedTaskLine('- [ ] already one'), '- [ ] already one');
  });

  test('changes touch only what they name, in the order Deckard writes fields', () => {
    const line = '- [ ] Call Ren about the budget 📅 2026-09-30 ⏫ #project/atlas';
    assert.strictEqual(changeTaskLine({ line, changes: { due: '2026-10-02' }, now: NOW }).text, '- [ ] Call Ren about the budget #project/atlas ⏫ 📅 2026-10-02');
    assert.strictEqual(changeTaskLine({ line, changes: { priority: null }, now: NOW }).text, '- [ ] Call Ren about the budget #project/atlas 📅 2026-09-30');
    assert.strictEqual(changeTaskLine({ line, changes: { assignee: '@ren' }, now: NOW }).text, '- [ ] Call Ren about the budget #project/atlas ⏫ 📅 2026-09-30 👤 @ren');
    assert.strictEqual(changeTaskLine({ line, changes: { title: 'Call Ren' }, now: NOW }).text, '- [ ] Call Ren ⏫ 📅 2026-09-30');
  });

  test('completing writes the done date, reopening takes it away, and the same state is a no-op', () => {
    const open = '- [ ] Ship it 📅 2026-09-30';
    const done = changeTaskLine({ line: open, changes: { complete: true }, now: NOW }).text;
    assert.strictEqual(done, '- [x] Ship it 📅 2026-09-30 ✅ 2026-09-21');
    assert.strictEqual(changeTaskLine({ line: done, changes: { complete: false }, now: NOW }).text, open);
    assert.strictEqual(changeTaskLine({ line: open, changes: { complete: false }, now: NOW }).text, open, 'already open');
  });

  test('completing a repeating task starts the next one above it', () => {
    const line = '- [ ] Water the plants 🔁 every week 📅 2026-09-21';
    const written = changeTaskLine({ line, changes: { complete: true }, now: NOW, fallbackFormat: 'emoji', eol: '\n' });
    assert.strictEqual(written.next, '- [ ] Water the plants 🔁 every week 📅 2026-09-28');
    assert.strictEqual(
      written.text,
      '- [ ] Water the plants 🔁 every week 📅 2026-09-28\n- [x] Water the plants 🔁 every week 📅 2026-09-21 ✅ 2026-09-21',
    );
  });

  test('completing a repeating task gives the next one its steps back, unchecked', async () => {
    const note = '/notes/review.md';
    const lines = [
      '# Review',
      '- [ ] Weekly review 🔁 every week 📅 2026-09-21',
      '  - [ ] Inbox zero',
      '  - [x] Clear the desk ✅ 2026-09-14',
      '',
    ];
    const index = buildWorkspaceIndex(new Map([[note, parseMarkdown(note, lines.join('\n'))]]));
    const document = {
      eol: vscode.EndOfLine.LF,
      getText: () => lines.join('\n'),
      lineAt: (line: number) => ({ text: lines[line], range: new vscode.Range(line, 0, line, lines[line].length) }),
    };
    const workspace = vscode.workspace as unknown as Record<string, unknown>;
    const { openTextDocument } = workspace;
    workspace.openTextDocument = async () => document;
    let answer;
    try {
      answer = await changeTask(
        { ready: Promise.resolve(), getSnapshot: () => index },
        { write: async () => ({ applied: true }) } as unknown as WorkspaceWriteHistory,
        { note, line: 2, complete: true },
        NOW,
      );
    } finally {
      workspace.openTextDocument = openTextDocument;
    }
    assert.strictEqual(answer.isError, undefined);
    assert.ok(
      answer.text.includes(
        [
          '- [ ] Weekly review 🔁 every week 📅 2026-09-28',
          '  - [ ] Inbox zero',
          '  - [ ] Clear the desk',
          '- [x] Weekly review 🔁 every week 📅 2026-09-21 ✅ 2026-09-21',
        ].join('\n'),
      ),
      answer.text,
    );
  });

  test('a Dataview line stays a Dataview line', () => {
    const line = '- [ ] Ship it [due:: 2026-09-30]';
    assert.strictEqual(changeTaskLine({ line, changes: { priority: 'high' }, now: NOW }).text, '- [ ] Ship it [priority:: high] [due:: 2026-09-30]');
  });

  test('says when today\'s daily note cannot be made, rather than naming no note', async () => {
    const index = buildWorkspaceIndex(new Map());
    const history = new WorkspaceWriteHistory();
    const answer = await addTask(
      { ready: Promise.resolve(), getSnapshot: () => index },
      history,
      { text: 'Call Ren' },
      () => Promise.reject(new Error('EACCES: permission denied')),
    );
    assert.deepStrictEqual(answer, {
      text: "Today's daily note could not be made, so nothing was written.",
      isError: true,
    });
    assert.strictEqual(history.lastWrite, undefined);
  });

  test('says what it is about to do, in words a preview can carry', () => {
    assert.strictEqual(describeChange({ complete: true, due: '2026-10-01' }), 'complete it, make it due 2026-10-01');
    assert.strictEqual(describeChange({ priority: null, assignee: null }), 'clear its priority, take it from whoever it was for');
  });
});
