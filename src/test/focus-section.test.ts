import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  findHeadingLineAbove,
  SECTION_FOCUSED,
  SectionFocus,
} from '../ui/commands/focusSection';

/** Records what Focus Section runs and says, and runs none of it. */
function spy() {
  const ran: unknown[][] = [];
  const said: string[] = [];
  return {
    ran,
    said,
    deps: {
      execute: (command: string, ...args: unknown[]) => {
        ran.push([command, ...args]);
        return Promise.resolve(undefined);
      },
      inform: (message: string) => {
        said.push(message);
      },
    },
  };
}

suite('Focus Section', () => {
  test('finds the heading a line is under, outside code', () => {
    const lines = ['# Plan', 'text', '```', '# not a heading', '```', 'more'];
    assert.strictEqual(findHeadingLineAbove(lines, 5), 0);
    assert.strictEqual(findHeadingLineAbove(['no heading', 'here'], 1), undefined);
  });

  test('folds all but the section, opens its sub-headings, and says so in a key', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# One\ntext\n## Two\nmore\n# Three\n',
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(3, 1, 3, 1);
    const watch = spy();
    const focus = new SectionFocus(watch.deps);
    try {
      assert.strictEqual(await focus.focus(undefined), true);
      assert.deepStrictEqual(watch.ran, [
        ['editor.foldAllExcept'],
        ['editor.unfoldRecursively'],
        ['setContext', SECTION_FOCUSED, true],
      ]);
      assert.strictEqual(editor.selection.active.line, 2, 'the cursor is on the heading');

      await focus.focus(1);
      assert.strictEqual(editor.selection.active.line, 0, 'a heading from the Outline is used as given');

      watch.ran.length = 0;
      await focus.unfoldAll();
      assert.deepStrictEqual(watch.ran, [['editor.unfoldAll'], ['setContext', SECTION_FOCUSED, false]]);
    } finally {
      focus.dispose();
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });

  test('says where to put the cursor when no heading is above it', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: 'Just prose\n' });
    await vscode.window.showTextDocument(document);
    const watch = spy();
    const focus = new SectionFocus(watch.deps);
    try {
      assert.strictEqual(await focus.focus(undefined), false);
      assert.deepStrictEqual(watch.said, ['Put the cursor under a heading to focus its section.']);
      assert.deepStrictEqual(watch.ran, []);
    } finally {
      focus.dispose();
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });
});
