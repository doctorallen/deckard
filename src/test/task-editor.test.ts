import * as assert from 'assert';

import { readPerson } from '../domain/markdown/parser';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import {
  formatTaskDraft,
  parseTaskDraft,
} from '../domain/markdown/taskDraft';
import {
  appendTag,
  completeDraft,
  createEditorRows,
  editTaskCommand,
  setDraftDate,
  setDraftDependencies,
  TaskEditorActions,
  writeEditedTask,
} from '../ui/commands/taskEditor';
import { describeCompletion } from '../ui/commands/taskActions';

/** A Monday morning, so a weekday answer is easy to read. */
const now = new Date(2026, 8, 21, 9, 0, 0).getTime();

/** What each row of the editor reads as: its field, and its value. */
function rows(line: string): string[] {
  return createEditorRows(parseTaskDraft(line))
    .filter((row) => row.field || row.done)
    .map((row) => `${row.label.replace(/^\$\([a-z-]+\) /, '')}: ${row.description ?? ''}`);
}

suite('Task editor', () => {
  test('lists every field with what the task says now', () => {
    assert.deepStrictEqual(
      rows('- [ ] Chase the contractor ⏫ 🔁 every week 📅 2026-09-25 ⛔ b2'),
      [
        'Description: Chase the contractor',
        'Status: Open',
        'Due: Friday 2026-09-25',
        'Scheduled: Not set',
        'Start: Not set',
        'Priority: high',
        'Repeats: every week',
        'Assignee: Nobody named',
        'Blocked by: b2',
        'Add a tag: Written at the end of the description',
        'Write the task: Enter',
      ],
    );
  });

  test('reads an empty task as one waiting to be written', () => {
    assert.deepStrictEqual(rows('- [ ] ').slice(0, 2), [
      'Description: Empty',
      'Status: Open',
    ]);
  });

  test('completing writes the done date, and reopening takes it back', () => {
    const open = parseTaskDraft('- [ ] Filed the report');
    const done = completeDraft(open, now);
    assert.strictEqual(done.completed, true);
    assert.strictEqual(done.done, '2026-09-21');
    assert.strictEqual(
      formatTaskDraft(done),
      '- [x] Filed the report ✅ 2026-09-21',
    );

    const reopened = completeDraft(done, now);
    assert.strictEqual(reopened.completed, false);
    assert.strictEqual(reopened.done, undefined);
    assert.strictEqual(formatTaskDraft(reopened), '- [ ] Filed the report');

    const already = completeDraft(
      parseTaskDraft('- [ ] Filed the report ✅ 2026-09-18'),
      now,
    );
    assert.strictEqual(
      already.done,
      '2026-09-18',
      'a done date already written is the one it keeps',
    );
  });

  test('marking a repeating task done writes its next occurrence above it', () => {
    const before = parseTaskDraft('- [ ] Water the plants 🔁 every week 📅 2026-09-21');
    const done = completeDraft(before, now);
    const written = writeEditedTask({ before, edited: done, now, eol: '\n' });
    assert.strictEqual(
      written.text,
      '- [ ] Water the plants 🔁 every week 📅 2026-09-28\n- [x] Water the plants 🔁 every week 📅 2026-09-21 ✅ 2026-09-21',
    );
    assert.strictEqual(written.next, '- [ ] Water the plants 🔁 every week 📅 2026-09-28');

    // Reopening writes the one line, and so does editing a task already done.
    const reopened = writeEditedTask({ before: done, edited: completeDraft(done, now), now, eol: '\n' });
    assert.strictEqual(reopened.text, '- [ ] Water the plants 🔁 every week 📅 2026-09-21');
    assert.strictEqual(
      writeEditedTask({ before: done, edited: { ...done, description: 'Water the ferns' }, now, eol: '\n' }).next,
      undefined,
    );
  });

  test('a completion says in one message what it started, or what it could not read', () => {
    assert.deepStrictEqual(
      describeCompletion('Water the plants', '- [ ] Water the plants 📅 2026-10-02'),
      {
        text: 'Completed "Water the plants", and started the next one, due 2026-10-02.',
        severity: 'info',
      },
    );
    assert.deepStrictEqual(describeCompletion('Howl', undefined, 'every blue moon'), {
      text: 'Completed "Howl". Deckard could not read its repeat rule "every blue moon", so no next one was added.',
      severity: 'warning',
    });
    assert.deepStrictEqual(describeCompletion('Plain'), {
      text: 'Completed "Plain".',
      severity: 'info',
    });
  });

  test('completing writes no done date when the setting is off', () => {
    const before = parseTaskDraft('- [ ] Ship it');
    assert.strictEqual(
      writeEditedTask({ before, edited: completeDraft(before, now, false), now, eol: '\n' }).text,
      '- [x] Ship it',
    );
  });

  test('takes a date in words, and refuses what is not one', () => {
    const draft = parseTaskDraft('- [ ] Chase the contractor');
    assert.strictEqual(
      formatTaskDraft(setDraftDate({ draft, field: 'due', written: 'friday', now }) ?? draft),
      '- [ ] Chase the contractor 📅 2026-09-25',
    );
    assert.strictEqual(
      formatTaskDraft(setDraftDate({ draft, field: 'scheduled', written: 'in 2 days', now }) ?? draft),
      '- [ ] Chase the contractor ⏳ 2026-09-23',
    );
    assert.strictEqual(
      setDraftDate({ draft, field: 'due', written: 'whenever', now }),
      undefined,
      'nothing is guessed, so the field keeps what it had',
    );
    assert.strictEqual(
      formatTaskDraft(
        setDraftDate({ draft: parseTaskDraft('- [ ] Chase 📅 2026-09-25'), field: 'due', written: '', now }) ??
          draft,
      ),
      '- [ ] Chase',
      'an empty answer clears the date',
    );
  });

  test('reads what a task waits for as a list of ids', () => {
    const draft = setDraftDependencies(
      parseTaskDraft('- [ ] Ship it'),
      ' b2 , c3 ,, ',
    );
    assert.deepStrictEqual(draft.dependsOn, ['b2', 'c3']);
    assert.strictEqual(formatTaskDraft(draft), '- [ ] Ship it ⛔ b2, c3');
    assert.deepStrictEqual(setDraftDependencies(draft, '').dependsOn, []);
  });

  test('reads a person however they are written', () => {
    assert.strictEqual(readPerson('@dana'), '@dana');
    assert.strictEqual(readPerson('dana'), '@dana', 'a bare name takes the marker');
    assert.strictEqual(readPerson('#person/ren-kade'), '#person/ren-kade');
    assert.strictEqual(readPerson('  @dana  '), '@dana');
    assert.strictEqual(
      readPerson('#project/atlas'),
      undefined,
      'a tag that is not a person names nobody',
    );
    assert.strictEqual(readPerson('@dana and @ren-kade'), undefined);
    assert.strictEqual(readPerson(''), undefined);
  });

  test('the editor shows who a task is for beside its other fields', () => {
    const rows = createEditorRows(
      parseTaskDraft('- [ ] Chase the contractor @dana with @ren-kade'),
    );
    assert.strictEqual(
      rows.find((row) => row.field === 'assignee')?.description,
      'Nobody named',
      'a person in the words is mentioned, not asked',
    );
    assert.strictEqual(
      createEditorRows(
        parseTaskDraft('- [ ] Chase the contractor @ren-kade 👤 @dana'),
      ).find((row) => row.field === 'assignee')?.description,
      '@dana',
    );
  });

  test('adds a tag to the words, once, and only a real one', () => {
    assert.strictEqual(
      appendTag('Chase the contractor', '#project/atlas'),
      'Chase the contractor #project/atlas',
    );
    assert.strictEqual(
      appendTag('Chase the contractor #project/atlas', '#project/atlas'),
      'Chase the contractor #project/atlas',
    );
    assert.strictEqual(
      appendTag('Chase the contractor', 'project/atlas'),
      'Chase the contractor',
      'a tag needs its marker',
    );
    assert.strictEqual(appendTag('', '@dana'), '@dana');
  });

  test('offers the editor on a task line, and on no other line', () => {
    const actions = new TaskEditorActions();
    try {
      const document = {
        uri: vscode.Uri.file('/notes/atlas.md'),
        lineAt: (line: number) => ({
          text: line === 0 ? '- [ ] Chase the contractor' : '# Atlas',
        }),
      } as unknown as vscode.TextDocument;
      const at = (line: number): vscode.Range =>
        new vscode.Range(line, 0, line, 0);
      assert.deepStrictEqual(
        actions.provideCodeActions(document, at(0)).map((action) => action.title),
        ['Edit task…', 'Break into steps…'],
      );
      assert.deepStrictEqual(actions.provideCodeActions(document, at(1)), []);
    } finally {
      actions.dispose();
    }
  });

  test('writes the line it was given back when nothing changed', async () => {
    const root = vscode.Uri.file(
      path.join(os.tmpdir(), `deckard-editor-${Date.now()}`),
    );
    await vscode.workspace.fs.createDirectory(root);
    const uri = vscode.Uri.joinPath(root, 'atlas.md');
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from('# Atlas\n\n- [ ] Chase the contractor 📅 2026-09-25\n', 'utf8'),
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(2, 0, 2, 0);

    // The quick pick cannot be driven from a test, so the command is checked
    // where it does not open one: outside a Markdown note.
    const other = await vscode.workspace.openTextDocument({
      content: 'not markdown',
      language: 'plaintext',
    });
    await vscode.window.showTextDocument(other);
    assert.strictEqual(await editTaskCommand(undefined, now), undefined);

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
  });
});
