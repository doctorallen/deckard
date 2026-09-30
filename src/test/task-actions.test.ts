import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { updateTaskLine } from '../ui/commands/taskActions';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';

/** Stands in for VS Code's messages, and gives back what was said. */
function listen(): { said: string[]; restore: () => void } {
  const window = vscode.window as unknown as Record<string, unknown>;
  const names = ['showWarningMessage', 'showErrorMessage', 'showInformationMessage'];
  const originals = names.map((name) => window[name]);
  const said: string[] = [];
  names.forEach((name) => {
    window[name] = (text: string) => {
      said.push(text);
      return Promise.resolve(undefined);
    };
  });
  return {
    said,
    restore: () => names.forEach((name, at) => (window[name] = originals[at])),
  };
}

suite('Task line edits', () => {
  // The history these edits write to, which no other suite shares.
  const writes = { history: new WorkspaceWriteHistory(), keepRank: () => undefined };

  test('says so when the task is no longer where it was', async () => {
    const uri = vscode.Uri.file(path.join(os.tmpdir(), `deckard-task-${Date.now()}.md`));
    const content = '# Plan\n\n- [ ] Ship it\n';
    const task = parseMarkdown(uri.fsPath, content).tasks[0];
    // The note has been cut short since it was read.
    await vscode.workspace.fs.writeFile(uri, Buffer.from('# Plan\n', 'utf8'));
    const messages = listen();
    try {
      assert.strictEqual(
        await updateTaskLine(writes, task, (line) => line.replace('[ ]', '[x]')),
        false,
      );
      assert.deepStrictEqual(messages.said, [
        `${path.basename(uri.fsPath)} changed after Deckard last read it, so nothing was written.`,
      ]);
    } finally {
      messages.restore();
      await vscode.workspace.fs.delete(uri);
    }
  });
});
