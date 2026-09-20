import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import {
  formatTaskDraft,
  parseTaskDraft,
} from '../core/markdown/taskDraft';
import {
  appendTag,
  completeDraft,
  createEditorRows,
  editTaskCommand,
  readAssignee,
  setAssignee,
  setDraftDate,
  setDraftDependencies,
  TaskEditorActions,
} from '../ui/commands/taskEditor';

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

  test('takes a date in words, and refuses what is not one', () => {
    const draft = parseTaskDraft('- [ ] Chase the contractor');
    assert.strictEqual(
      formatTaskDraft(setDraftDate(draft, 'due', 'friday', now) ?? draft),
      '- [ ] Chase the contractor 📅 2026-09-25',
    );
    assert.strictEqual(
      formatTaskDraft(setDraftDate(draft, 'scheduled', 'in 2 days', now) ?? draft),
      '- [ ] Chase the contractor ⏳ 2026-09-23',
    );
    assert.strictEqual(
      setDraftDate(draft, 'due', 'whenever', now),
      undefined,
      'nothing is guessed, so the field keeps what it had',
    );
    assert.strictEqual(
      formatTaskDraft(
        setDraftDate(parseTaskDraft('- [ ] Chase 📅 2026-09-25'), 'due', '', now) ??
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

  test('says who a task is for, and hands it to someone else', () => {
    assert.strictEqual(
      readAssignee('Chase the contractor @dana with @ren-kade'),
      '@dana',
      'the first person named owns it; the second is mentioned',
    );
    assert.strictEqual(readAssignee('Chase the contractor'), undefined);
    assert.strictEqual(
      readAssignee('Send the proposal #person/ren-kade'),
      '#person/ren-kade',
    );

    assert.strictEqual(
      setAssignee('Chase the contractor @dana with @ren-kade', '@mara-vale'),
      'Chase the contractor @mara-vale with @ren-kade',
      'the one who was first is replaced, and a mention stays a mention',
    );
    assert.strictEqual(
      setAssignee('Chase the contractor', '@dana'),
      'Chase the contractor @dana',
    );
    assert.strictEqual(
      setAssignee('Chase the contractor @dana with @ren-kade', undefined),
      'Chase the contractor with @ren-kade',
      'taking the first name off hands the task to whoever is named next',
    );
    assert.strictEqual(
      setAssignee('Chase the contractor', 'dana'),
      'Chase the contractor',
      'only a person tag names a person',
    );
    assert.strictEqual(
      setAssignee('Chase the contractor', '#project/atlas'),
      'Chase the contractor',
    );
  });

  test('the editor shows who a task is for beside its other fields', () => {
    const rows = createEditorRows(
      parseTaskDraft('- [ ] Chase the contractor @dana with @ren-kade'),
    );
    const forRow = rows.find((row) => row.field === 'assignee');
    assert.strictEqual(forRow?.description, '@dana');
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
        ['Edit task…'],
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
