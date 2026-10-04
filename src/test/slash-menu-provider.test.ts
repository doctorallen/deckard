import * as assert from 'assert';

import * as vscode from 'vscode';

import { SlashMenuProvider } from '../ui/providers/slashMenu';

/** A note holding `text`, as the provider reads it. */
function createDocument(text: string): vscode.TextDocument {
  const lines = text.split(/\r?\n/);
  return {
    uri: vscode.Uri.file('/tmp/deckard/notes/Check-in.md'),
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line] }),
  } as unknown as vscode.TextDocument;
}

suite('The / menu in the editor', () => {
  const provider = new SlashMenuProvider(
    { getTemplatesFolderUri: () => undefined },
    () => new Date(2026, 9, 3, 9),
  );
  const suggest = (text: string, line = 0): Thenable<vscode.CompletionItem[]> =>
    provider.provideCompletionItems(createDocument(text), new vscode.Position(line, text.split('\n')[line].length));
  const labelOf = (item: vscode.CompletionItem): string =>
    typeof item.label === 'string' ? item.label : item.label.label;

  test('offers the blocks after a / alone at a line’s start, over the / typed', async () => {
    const items = await suggest('Notes\n  /ta', 1);
    const task = items.find((item) => labelOf(item) === 'Task');
    assert.ok(task);
    assert.strictEqual((task.insertText as vscode.SnippetString).value, '- [ ] $0');
    assert.strictEqual(task.filterText, '/Task todo checkbox');
    assert.ok(task.range instanceof vscode.Range);
    assert.strictEqual(task.range.start.character, 2, 'the / is replaced, the indentation kept');
    const today = items.find((item) => labelOf(item) === 'Today’s note');
    assert.strictEqual((today?.insertText as vscode.SnippetString).value, '[[2026-10-03]]$0');
    assert.strictEqual(items.find((item) => labelOf(item) === 'Embed a note')?.command?.command, 'editor.action.triggerSuggest');
  });

  test('offers nothing for a / that does not start its line, or inside fenced code', async () => {
    assert.deepStrictEqual(await suggest('see notes/'), []);
    assert.deepStrictEqual(await suggest('- [ ] Call /'), []);
    assert.deepStrictEqual(await suggest('```\n/\n```', 1), []);
  });
});
