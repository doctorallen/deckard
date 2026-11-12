import * as assert from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { moveToCommand, MoveToActions } from '../ui/commands/moveTo';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { createTaskWrites } from './taskWrites';

const lines = (...text: string[]): string => text.join('\n');

/** A row of the picker, as Move to… lists it. */
interface Row {
  label: string;
  kind?: vscode.QuickPickItemKind;
  description?: string;
  destination?: { kind: string };
}

/**
 * Stands in for VS Code's quick picks, answering the first with the row
 * `choose` picks and recording the rows it showed. Returns those rows, and
 * a way to put VS Code's own back.
 */
function answerPick(choose: (rows: Row[]) => Row | undefined): { shown: Row[][]; restore: () => void } {
  const window = vscode.window as unknown as Record<string, unknown>;
  const { createQuickPick } = window;
  const shown: Row[][] = [];
  window.createQuickPick = () => {
    const accepted: (() => void)[] = [];
    const hidden: (() => void)[] = [];
    const pick = {
      items: [] as Row[],
      activeItems: [] as Row[],
      selectedItems: [] as Row[],
      onDidAccept: (handler: () => void) => accepted.push(handler),
      onDidHide: (handler: () => void) => hidden.push(handler),
      hide: () => hidden.splice(0).forEach((handler) => handler()),
      dispose: () => undefined,
      show: () =>
        setTimeout(() => {
          shown.push([...pick.items]);
          const answer = choose(pick.items);
          if (!answer) {
            pick.hide();
            return;
          }
          pick.activeItems = [answer];
          pick.selectedItems = [answer];
          accepted.forEach((handler) => handler());
        }, 0),
    };
    return pick;
  };
  return { shown, restore: () => (window.createQuickPick = createQuickPick) };
}

suite('Move to… on a heading', () => {
  let directory: string;

  setup(async () => {
    directory = mkdtempSync(join(tmpdir(), 'deckard-move-section-'));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  test('moves the section under another note’s heading, offered first as mentioned, and Undo restores both notes', async () => {
    const notes: Record<string, string> = {
      '2026-11-12.md': lines(
        '# 2026-11-12',
        '',
        '## Standup',
        '- Nothing blocked',
        '',
        '## Ledger cutover plan',
        'Talked it through; see [[Ledger migration]].',
        '',
        '### Steps',
        '- [ ] Freeze writes',
        '',
        '## Lunch',
        '- Tacos',
        '',
      ),
      'Ledger migration.md': lines('# Ledger migration', '', '## Plan', '- Draft the runbook', '', '## Risks', '- None yet', ''),
    };
    // Written with `/`, as an index keeps its paths, on Windows too.
    const paths = Object.fromEntries(
      Object.entries(notes).map(([name, text]) => {
        const file = join(directory, name).split('\\').join('/');
        writeFileSync(file, text);
        return [name, file];
      }),
    );
    const index = buildWorkspaceIndex(
      new Map(Object.entries(notes).map(([name, text]) => [paths[name], parseMarkdown(paths[name], text)])),
    );
    const pathOf = (uri: vscode.Uri): string => {
      const wanted = uri.fsPath.split('\\').join('/').toLowerCase();
      return [...index.files.keys()].find((key) => key.toLowerCase() === wanted) ?? wanted;
    };
    const indexer = {
      ready: Promise.resolve(),
      getSnapshot: () => index,
      isNotesFile: () => true,
      getFilePath: pathOf,
      parse: (uri: vscode.Uri, text: string) => parseMarkdown(pathOf(uri), text),
    };
    const history = new WorkspaceWriteHistory();
    const writes = createTaskWrites(history, undefined, { getFilePath: pathOf });
    const preferences = { reader: { value: {} }, usage: { recordRecentHeading: async () => undefined } };
    const day = vscode.Uri.file(paths['2026-11-12.md']);
    const migration = vscode.Uri.file(paths['Ledger migration.md']);
    const text = async (uri: vscode.Uri) => (await vscode.workspace.openTextDocument(uri)).getText();

    const editor = await vscode.window.showTextDocument(day, { preview: false });
    editor.selection = new vscode.Selection(5, 0, 5, 0);
    assert.deepStrictEqual(
      new MoveToActions(indexer as never)
        .provideCodeActions(editor.document, new vscode.Range(5, 0, 5, 0))
        .map((action) => [action.title, action.kind?.value]),
      [['Move section to…', 'refactor.move']],
    );

    const window = vscode.window as unknown as Record<string, unknown>;
    const info = window.showInformationMessage;
    const said: unknown[][] = [];
    window.showInformationMessage = async (...args: unknown[]) => void said.push(args);
    const pick = answerPick((rows) => rows.find((row) => row.label === 'Plan'));
    try {
      await moveToCommand(indexer as never, preferences as never, writes);
    } finally {
      pick.restore();
      window.showInformationMessage = info;
    }

    const [rows] = pick.shown;
    assert.deepStrictEqual(
      rows.slice(0, 6).map((row) => [row.label, row.description]),
      [
        ['Mentioned in this section', undefined],
        ['Ledger migration', paths['Ledger migration.md']],
        ['Plan', paths['Ledger migration.md']],
        ['Risks', paths['Ledger migration.md']],
        ['$(file) Ledger migration', 'at the end of the note'],
        ['', undefined],
      ],
    );
    assert.ok(!rows.some((row) => row.label === 'Ledger cutover plan' || row.label === 'Steps'), 'never into itself');
    assert.strictEqual(
      await text(migration),
      lines(
        '# Ledger migration',
        '',
        '## Plan',
        '- Draft the runbook',
        '',
        '### Ledger cutover plan',
        'Talked it through; see [[Ledger migration]].',
        '',
        '#### Steps',
        '- [ ] Freeze writes',
        '',
        '## Risks',
        '- None yet',
        '',
      ),
    );
    assert.strictEqual(
      await text(day),
      lines('# 2026-11-12', '', '## Standup', '- Nothing blocked', '', '[[Ledger migration#Ledger cutover plan]]', '', '## Lunch', '- Tacos', ''),
    );
    assert.deepStrictEqual(said[0]?.slice(0, 1), ['Moved "Ledger cutover plan" to Ledger migration › Plan.']);

    await history.undo();
    assert.strictEqual(await text(day), notes['2026-11-12.md']);
    assert.strictEqual(await text(migration), notes['Ledger migration.md']);
  });
});
