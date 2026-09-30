import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { ActiveSearch } from '../ui/webview/activeSearch';
import { SidebarNotesView } from '../ui/webview/sidebarNotes';
import { ThemePreview } from '../ui/webview/themePreview';

class MemoryMemento {
  private readonly values = new Map<string, unknown>();
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }
  public keys(): readonly string[] {
    return [...this.values.keys()];
  }
  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/**
 * Add, beside a tag the similar notes use, against the real editor: it
 * writes where the cursor is, saves, and can be taken back.
 */
suite('Adding a suggested tag', () => {
  test('writes it on the heading the cursor is under, and Undo takes it back unless the line changed', async () => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-add-tag-${Date.now()}`));
    await vscode.workspace.fs.createDirectory(root);
    const uri = vscode.Uri.joinPath(root, 'today.md');
    const content = '# Vendor audit\nNorthwind deliveries on the northern route are late again.\n';
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    const others = new Map([
      ['a.md', parseMarkdown('a.md', '# Northwind audit #risk/vendor\nNorthwind deliveries on the northern route.')],
      ['b.md', parseMarkdown('b.md', '# Late pallets #risk/vendor\nNorthwind deliveries were late on the route.')],
    ]);
    const build = async (): Promise<WorkspaceIndex> => {
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      return buildWorkspaceIndex(new Map([...others, [uri.fsPath, parseMarkdown(uri.fsPath, text)]]));
    };
    let index = await build();
    const updates = new vscode.EventEmitter<WorkspaceIndex>();
    const indexer = {
      ready: Promise.resolve(),
      getSnapshot: () => index,
      getFilePath: (target: vscode.Uri) => target.fsPath,
      onDidUpdate: updates.event,
      refresh: async () => {
        index = await build();
      },
    };
    const history = new WorkspaceWriteHistory();
    const view = new SidebarNotesView({
      indexer: indexer as never,
      preferences: new PreferencesStore(new MemoryMemento() as never),
      activeSearch: new ActiveSearch(),
      onOpenTag: () => undefined,
      extensionVersion: 'test',
      history,
      themePreview: new ThemePreview(),
    });
    const send = (message: unknown) =>
      (view as unknown as { handleMessage(value: unknown): Promise<void> }).handleMessage(message);
    const window = vscode.window as unknown as Record<string, unknown>;
    const info = window.showInformationMessage;
    const warning = window.showWarningMessage;
    const shown: unknown[][] = [];
    let answer: string | undefined;
    window.showInformationMessage = async (...args: unknown[]) => {
      shown.push(args);
      return args[1] === 'Undo' ? answer : undefined;
    };
    window.showWarningMessage = async (...args: unknown[]) => {
      shown.push(args);
      return undefined;
    };
    try {
      const editor = await vscode.window.showTextDocument(uri);
      editor.selection = new vscode.Selection(1, 3, 1, 3);
      await send({ type: 'addSuggestedTag', tagKey: '#risk/vendor' });
      const read = async () => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      assert.strictEqual(await read(), '# Vendor audit #risk/vendor\nNorthwind deliveries on the northern route are late again.\n');
      assert.strictEqual(history.lastWrite?.label, '#risk/vendor on "Vendor audit"');
      assert.deepStrictEqual(shown[0], ['Added #risk/vendor to "Vendor audit".', 'Undo']);

      // A tag no longer offered, now that the note has one, writes nothing.
      await send({ type: 'addSuggestedTag', tagKey: '#risk/vendor' });
      assert.strictEqual(shown.length, 1);

      // Undo from the message puts the line back.
      await history.undo();
      index = await build();
      answer = 'Undo';
      await send({ type: 'addSuggestedTag', tagKey: '#risk/vendor' });
      await settle();
      await settle();
      assert.strictEqual(await read(), content);

      // A line edited after the tag was added is left as it is: Undo is
      // chosen only once the heading has been changed by hand.
      index = await build();
      window.showInformationMessage = async (...args: unknown[]) => {
        shown.push(args);
        await new Promise((resolve) => setTimeout(resolve, 200));
        return args[1] === 'Undo' ? 'Undo' : undefined;
      };
      await send({ type: 'addSuggestedTag', tagKey: '#risk/vendor' });
      const edited = new vscode.WorkspaceEdit();
      edited.insert(uri, new vscode.Position(0, 2), 'Big ');
      await vscode.workspace.applyEdit(edited);
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.deepStrictEqual(shown[shown.length - 1], [
        'Line 1 changed after the tag was added, so Deckard left it as it is.',
      ]);
      assert.ok(editor.document.lineAt(0).text.startsWith('# Big Vendor audit #risk/vendor'));
    } finally {
      window.showInformationMessage = info;
      window.showWarningMessage = warning;
      view.dispose();
      updates.dispose();
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });
});
