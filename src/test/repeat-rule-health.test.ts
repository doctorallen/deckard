import * as assert from 'assert';

import * as vscode from 'vscode';

import { RepeatRuleHealth } from '../ui/providers/repeatRuleHealth';

suite('Repeat rule health', () => {
  test('warns in the editor, fixes only the rule, and can be turned off', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '- [ ] Water plants 🔁 every tuesdya 📅 2026-09-29\n',
    });
    const health = new RepeatRuleHealth(() => true);
    const configuration = vscode.workspace.getConfiguration('deckard');
    try {
      health.check(document);
      const [diagnostic] = health.read(document.uri);
      assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Warning);
      assert.strictEqual(diagnostic.code, 'unreadable-repeat');
      assert.strictEqual(document.getText(diagnostic.range), 'every tuesdya');

      const [fix] = health.provideCodeActions(document, {
        diagnostics: [diagnostic],
        only: undefined,
        triggerKind: vscode.CodeActionTriggerKind.Invoke,
      });
      assert.strictEqual(fix.title, 'Change the rule to "every tuesday"');
      assert.strictEqual(fix.isPreferred, true);
      assert.ok(fix.edit && (await vscode.workspace.applyEdit(fix.edit)));
      assert.strictEqual(document.getText(), '- [ ] Water plants 🔁 every tuesday 📅 2026-09-29\n');

      await vscode.workspace.applyEdit(
        (() => {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, 1, 0), '- [ ] Again 🔁 whenever\n');
          return edit;
        })(),
      );
      await configuration.update('editor.repeatDiagnostics', false, vscode.ConfigurationTarget.Global);
      health.check(document);
      assert.deepStrictEqual(health.read(document.uri), []);
    } finally {
      await configuration.update('editor.repeatDiagnostics', undefined, vscode.ConfigurationTarget.Global);
      health.dispose();
    }
  });
});
