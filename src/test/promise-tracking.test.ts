import * as assert from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { MemoryStore } from './preferenceServices';
import { indexOf } from './typedWorkspace';
import { PromiseDismissals } from '../core/storage/promiseDismissals';
import { formatLocalDate } from '../domain/notes/periodicNotes';
import { notAPromiseCommand, trackPromiseCommand } from '../ui/commands/trackPromise';
import { PromiseTracking } from '../ui/providers/promiseTracking';

suite('Said they would in the editor', () => {
  test('offers to track a promise in today\'s note, none in another, and remembers Not a promise', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'deckard-promises-'));
    const line = '- @sam-okafor says the loader retry fix lands tomorrow';
    const today = path.join(folder, `${formatLocalDate(new Date())}.md`);
    const other = path.join(folder, 'Loader.md');
    writeFileSync(today, `# Today\n${line}\n- Lunch\n`);
    writeFileSync(other, `# Loader\n${line}\n`);
    const index = indexOf({
      'People/Sam Okafor.md': '---\ndescribes: "@sam-okafor"\n---\n# Sam Okafor\n',
    });
    const marks = new PromiseDismissals(new MemoryStore());
    const tracking = new PromiseTracking({ getSnapshot: () => index, isNotesFile: () => true }, marks);
    const configuration = vscode.workspace.getConfiguration('deckard');
    try {
      const document = await vscode.workspace.openTextDocument(today);
      const actions = tracking.provideCodeActions(document, new vscode.Range(1, 3, 1, 3));
      const titles = actions.map((action) => action.title);
      assert.strictEqual(titles.length, 3, JSON.stringify(titles));
      assert.match(titles[0], /^Track as waiting on Sam, due .+/);
      assert.deepStrictEqual(titles.slice(1), ['Track as waiting on Sam…', 'Not a promise']);
      assert.ok(actions.every((action) => action.kind?.value === vscode.CodeActionKind.QuickFix.value));
      assert.deepStrictEqual(tracking.provideCodeActions(document, new vscode.Range(2, 0, 2, 0)), []);
      const lenses = tracking.provideCodeLenses(document).map((lens) => lens.command?.title);
      assert.match(lenses[0] ?? '', /^Track: Sam · .+/);
      assert.strictEqual(lenses[1], 'Not a promise');

      // Another note with the same line is left alone.
      const elsewhere = await vscode.workspace.openTextDocument(other);
      assert.deepStrictEqual(tracking.provideCodeActions(elsewhere, new vscode.Range(1, 0, 1, 0)), []);
      assert.deepStrictEqual(tracking.provideCodeLenses(elsewhere), []);

      // Track writes one line under it, and the line is then tracked.
      assert.ok(actions[0].edit && (await vscode.workspace.applyEdit(actions[0].edit)));
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      assert.strictEqual(
        document.lineAt(2).text,
        `  - [w] Loader retry fix lands 📅 ${formatLocalDate(tomorrow)} 👤 @sam-okafor`,
      );
      assert.strictEqual(document.lineAt(3).text, '- Lunch');
      assert.deepStrictEqual(tracking.provideCodeActions(document, new vscode.Range(1, 0, 1, 0)), []);

      // Not a promise is remembered for the line in its note.
      await vscode.workspace.applyEdit(
        (() => {
          const edit = new vscode.WorkspaceEdit();
          edit.delete(document.uri, new vscode.Range(2, 0, 3, 0));
          return edit;
        })(),
      );
      assert.strictEqual(tracking.provideCodeActions(document, new vscode.Range(1, 0, 1, 0)).length, 3);
      await notAPromiseCommand(marks, document.uri.toString(), line);
      assert.deepStrictEqual(tracking.provideCodeActions(document, new vscode.Range(1, 0, 1, 0)), []);
      assert.deepStrictEqual(tracking.provideCodeLenses(document), []);

      // The setting turns the offers off.
      await vscode.workspace.applyEdit(
        (() => {
          const edit = new vscode.WorkspaceEdit();
          edit.insert(document.uri, new vscode.Position(3, 0), '- @lena ships the deck tomorrow\n');
          return edit;
        })(),
      );
      assert.strictEqual(tracking.provideCodeActions(document, new vscode.Range(3, 0, 3, 0)).length, 3);
      await configuration.update('editor.trackPromises', false, vscode.ConfigurationTarget.Global);
      assert.deepStrictEqual(tracking.provideCodeActions(document, new vscode.Range(3, 0, 3, 0)), []);
    } finally {
      await configuration.update('editor.trackPromises', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      tracking.dispose();
      marks.dispose();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('the lens\'s Track writes once, in today\'s note only, for the day it said, while the setting is on', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'deckard-promises-'));
    const line = '- @sam-okafor says the loader retry fix lands tomorrow';
    const today = path.join(folder, `${formatLocalDate(new Date())}.md`);
    const other = path.join(folder, 'Loader.md');
    writeFileSync(today, `# Today\r\n${line}\r\n- Lunch\r\n`);
    writeFileSync(other, `# Loader\n${line}\n`);
    const index = { getSnapshot: () => indexOf({}) };
    const configuration = vscode.workspace.getConfiguration('deckard');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    try {
      // A note that is not today's daily note is never written to.
      const elsewhere = await vscode.workspace.openTextDocument(other);
      const at = { documentUri: elsewhere.uri.toString(), line: 1, text: line };
      assert.strictEqual(await trackPromiseCommand(index, at), undefined);
      assert.strictEqual(elsewhere.getText(), `# Loader\n${line}\n`);

      const document = await vscode.workspace.openTextDocument(today);
      const lens = { documentUri: document.uri.toString(), line: 1, text: line, due: formatLocalDate(tomorrow) };
      // A day other than the one the lens said is not written.
      assert.strictEqual(await trackPromiseCommand(index, { ...lens, due: '2099-01-01' }), undefined);
      // Off, nothing is written.
      await configuration.update('editor.trackPromises', false, vscode.ConfigurationTarget.Global);
      assert.strictEqual(await trackPromiseCommand(index, lens), undefined);
      await configuration.update('editor.trackPromises', true, vscode.ConfigurationTarget.Global);
      assert.strictEqual(document.lineCount, 4);

      // A second click on a lens drawn before the first wrote finds it tracked.
      const written = `  - [w] Loader retry fix lands 📅 ${formatLocalDate(tomorrow)} 👤 @sam-okafor`;
      assert.strictEqual(await trackPromiseCommand(index, lens), written);
      assert.strictEqual(await trackPromiseCommand(index, lens), undefined);
      assert.deepStrictEqual(
        document.getText().split('\r\n'),
        ['# Today', line, written, '- Lunch', ''],
      );
    } finally {
      await configuration.update('editor.trackPromises', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
