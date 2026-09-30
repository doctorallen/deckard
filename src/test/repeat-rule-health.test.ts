import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseRecurrence, suggestRecurrence } from '../domain/markdown/taskMetadata';
import {
  describeRepeatRuleProblem,
  findRepeatRuleProblems,
  RepeatRuleHealth,
} from '../ui/commands/repeatRuleHealth';

suite('Repeat rule health', () => {
  test('suggests the nearest rules Deckard can read', () => {
    assert.strictEqual(suggestRecurrence('every tuesdya')[0], 'every tuesday');
    assert.strictEqual(suggestRecurrence('weekly')[0], 'every week');
    assert.strictEqual(suggestRecurrence('biweekly')[0], 'every 2 weeks');
    assert.strictEqual(suggestRecurrence('tuesday')[0], 'every tuesday');
    assert.strictEqual(suggestRecurrence('every mnth when done')[0], 'every month when done');
    assert.deepStrictEqual(suggestRecurrence('whenever'), []);
    assert.deepStrictEqual(suggestRecurrence('every week'), [], 'a rule it reads needs nothing');
    for (const rule of ['weekly', 'weekends', 'evry wek', 'every month on the scond tuesday']) {
      const suggestions = suggestRecurrence(rule);
      assert.ok(suggestions.length <= 3, rule);
      assert.ok(suggestions.every((suggestion) => parseRecurrence(suggestion)), rule);
    }
  });

  test('marks the rule on an open task only, over the rule\'s own text', () => {
    const lines = [
      '- [ ] Water plants 🔁 every tuesdya 📅 2026-09-29',
      '- [x] Done 🔁 whenever',
      '- [ ] Fine 🔁 every week',
      '- [ ] Dataview [repeat:: whenever]',
      '```',
      '- [ ] In code 🔁 whenever',
      '```',
    ];
    const problems = findRepeatRuleProblems(lines);
    assert.deepStrictEqual(
      problems.map((problem) => [problem.line, lines[problem.line].slice(problem.start, problem.end)]),
      [
        [0, 'every tuesdya'],
        [3, 'whenever'],
      ],
    );
    assert.strictEqual(
      describeRepeatRuleProblem(problems[0]),
      'Deckard cannot read the repeat rule "every tuesdya", so completing this task will not start the next one. Try "every tuesday".',
    );
    assert.strictEqual(
      describeRepeatRuleProblem(problems[1]),
      'Deckard cannot read the repeat rule "whenever", so completing this task will not start the next one. Write a rule such as "every week", "every month on the 15th", or "every weekday".',
    );
  });

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
