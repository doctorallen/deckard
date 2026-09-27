import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { ActiveNoteContext } from '../ui/commands/activeNoteContext';

/** Opens a file with the given text, written to a scratch folder. */
async function open(name: string, text: string): Promise<vscode.TextEditor> {
  const uri = vscode.Uri.file(path.join(os.tmpdir(), `deckard-active-${Date.now()}`, name));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  return vscode.window.showTextDocument(uri);
}

suite('Active note context keys', () => {
  test('says a note is a daily note by its name or its first heading, and only a note', async () => {
    const set: Array<[string, boolean]> = [];
    let notes = true;
    const context = new ActiveNoteContext(
      { isNotesFile: () => notes, getFilePath: (uri) => path.basename(uri.fsPath) },
      (key, value) => set.push([key, value]),
    );
    try {
      const last = (key: string) => set.filter(([name]) => name === key).at(-1)?.[1];
      context.sync(await open('2026-09-25.md', 'Friday\n'));
      assert.strictEqual(last('deckard.isNote'), true);
      assert.strictEqual(last('deckard.isDailyNote'), true);
      context.sync(await open('Atlas.md', '# Atlas\n'));
      assert.strictEqual(last('deckard.isDailyNote'), false);
      context.sync(await open('friday.md', '# Friday 2026-09-25\n'));
      assert.strictEqual(last('deckard.isDailyNote'), true);
      // A Markdown file outside the notes folder is not a note at all.
      notes = false;
      context.sync(await open('2026-09-26.md', ''));
      assert.strictEqual(last('deckard.isNote'), false);
      assert.strictEqual(last('deckard.isDailyNote'), false);
    } finally {
      context.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
});
