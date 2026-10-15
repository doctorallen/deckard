import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { WrittenBeforeMemory } from '../core/storage/writtenBeforeMemory';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { ParsedFile, WorkspaceIndex } from '../domain/model';
import { linkHere } from '../ui/commands/writtenBefore/register';
import { WrittenBeforeHints } from '../ui/providers/writtenBefore';

/** A key-value store in memory, as the workspace's state is. */
function memoryStore(): ConstructorParameters<typeof WrittenBeforeMemory>[0] {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback?: T) => (values.has(key) ? (values.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => void values.set(key, value),
  };
}

/** Lines about other things, so the words the notes share are as rare as in a workspace of notes. */
const OTHER_LINES = Array.from({ length: 200 }, (_, at) => `- Offsite item ${at}: rooms, catering, and the agenda`).join('\n');

/** The notes, written to a folder of their own and indexed by their full paths. */
async function writeNotes(): Promise<{ index: WorkspaceIndex; today: vscode.Uri; older: vscode.Uri }> {
  const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-written-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  await vscode.workspace.fs.createDirectory(root);
  const notes: Record<string, string> = {
    '2026-03-12.md': '# 2026-03-12\n## Rates desk standup #team/rates\n- Same lag in the curve feed, fixed by restarting the loader\n',
    'offsite.md': `# Offsite\n${OTHER_LINES}\n`,
    'today.md': '# Today\n## Rates desk #team/rates\n- Short line\n- The curve feed lagged again this morning after the loader restarted\n- Nothing like anything written before at all here today\n',
  };
  const files = new Map<string, ParsedFile>();
  const uris: Record<string, vscode.Uri> = {};
  for (const [name, text] of Object.entries(notes)) {
    uris[name] = vscode.Uri.joinPath(root, name);
    await vscode.workspace.fs.writeFile(uris[name], Buffer.from(text, 'utf8'));
    files.set(uris[name].fsPath, parseMarkdown(uris[name].fsPath, text));
  }
  return { index: buildWorkspaceIndex(files), today: uris['today.md'], older: uris['2026-03-12.md'] };
}

/** Hints over an index that never changes, registered, and ready. */
async function createHints(index: WorkspaceIndex): Promise<WrittenBeforeHints> {
  const hints = new WrittenBeforeHints(
    {
      ready: Promise.resolve(),
      onDidUpdate: () => ({ dispose: () => undefined }),
      getSnapshot: () => index,
      getFilePath: (uri) => uri.fsPath,
      isNotesFile: () => true,
      parse: (uri, content) => parseMarkdown(uri.fsPath, content),
    },
    new WrittenBeforeMemory(memoryStore()),
    vscode.Uri.file(path.join(__dirname, '..', '..')),
  ).register();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return hints;
}

suite('You\'ve written this before in the editor', () => {
  test('says so on the cursor\'s line only, and its hover offers Open, Link it here, and Not the same', async () => {
    const { index, today } = await writeNotes();
    const hints = await createHints(index);
    try {
      const editor = await vscode.window.showTextDocument(today);
      const at = (line: number) => new vscode.Selection(line, 0, line, 0);
      editor.selection = at(3);
      hints.update();
      assert.strictEqual(hints.current?.line, 3, 'the cursor\'s line has an older line like it');
      assert.deepStrictEqual(hints.current?.rows.map((row) => [path.basename(row.filePath), row.line, row.heading, [...row.sharedTags]]), [
        ['2026-03-12.md', 3, 'Rates desk standup', ['#team/rates']],
      ]);
      const hover = hints.provideHover(editor.document, new vscode.Position(3, 4));
      const text = (hover?.contents[0] as vscode.MarkdownString | undefined)?.value ?? '';
      assert.match(text, /^\*\*Written before\*\* · 1 close match/);
      assert.match(text, /\*\*curve\*\* \*\*feed\*\*/, 'the shared words are marked');
      for (const command of ['deckard.openNote', 'deckard.writtenBefore.linkHere', 'deckard.writtenBefore.notSame']) {
        assert.ok(text.includes(`command:${command}?`), command);
      }
      assert.strictEqual(hints.provideHover(editor.document, new vscode.Position(2, 0)), undefined, 'a short line has none');
      editor.selection = at(2);
      hints.update();
      assert.strictEqual(hints.current, undefined, 'the hint leaves with the cursor');
    } finally {
      hints.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('Link it here appends a link to the older line\'s heading, and nothing when the line changed', async () => {
    const { index, today, older } = await writeNotes();
    const document = await vscode.workspace.openTextDocument(today);
    const lineText = document.lineAt(3).text;
    assert.strictEqual(await linkHere(index, { documentUri: today, line: 3, lineText }, { filePath: older.fsPath, line: 3 }), true);
    assert.strictEqual(document.lineAt(3).text, `${lineText} (see [[2026-03-12#Rates desk standup]])`);
    const window = vscode.window as unknown as Record<string, unknown>;
    const shown = window.showErrorMessage;
    window.showErrorMessage = async () => undefined;
    try {
      assert.strictEqual(await linkHere(index, { documentUri: today, line: 3, lineText }, { filePath: older.fsPath, line: 3 }), false);
    } finally {
      window.showErrorMessage = shown;
    }
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });
});
