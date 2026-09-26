import * as assert from 'assert';

import * as vscode from 'vscode';

import { listQueryBlockItems, placeQueryBlock, writeQueryBlock } from '../ui/commands/insertQueryBlock';

/**
 * Deckard: Insert Query Block… writes a live block of a search at the
 * cursor, apart from the text around it, in one edit.
 */
suite('Insert Query Block', () => {
  const documentOf = (lines: string[]) => ({
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] }),
  });
  const block = '```deckard\n#a\n```\n';

  test('goes on a blank line where the cursor is', () => {
    const placed = placeQueryBlock(documentOf(['# Note', '', '', 'After']), 2, block);
    assert.deepStrictEqual(placed, { line: 2, text: block, endsAt: 5 });
  });

  test('after a line being written, with a blank line either side', () => {
    const placed = placeQueryBlock(documentOf(['# Note', 'Some words', 'More']), 1, block);
    assert.strictEqual(placed.line, 2);
    assert.strictEqual(placed.text, `\n${block}\n`);
    assert.strictEqual(placed.endsAt, 6);
  });

  test('lists saved searches first, then recent ones not already saved', () => {
    const items = listQueryBlockItems({
      savedFilters: [{ id: 's', name: 'Atlas work', tagKeys: [], query: '#project/atlas is:open' }],
      recentQueries: ['#project/atlas is:open', 'is:overdue', 'is:overdue'],
    });
    assert.deepStrictEqual(items.map((item) => item.label), ['Saved searches', 'Atlas work', 'Recent searches', 'is:overdue']);
    assert.strictEqual(items[1].description, '#project/atlas is:open');
  });

  test('writes the block in one edit, so one Undo takes it back', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Note\nWords here\n' });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 3, 1, 3);
    const version = document.version;
    assert.ok(await writeQueryBlock(editor, '#project/atlas'));
    assert.strictEqual(document.version, version + 1, 'one edit, so one Undo');
    assert.strictEqual(document.getText(), '# Note\nWords here\n\n```deckard\n#project/atlas\n```\n');
    assert.strictEqual(editor.selection.active.line, 6);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
