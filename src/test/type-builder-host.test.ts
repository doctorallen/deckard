import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { getTypeIndex } from '../domain/types/typeIndex';
import { editType, type TypeBuilderWrites } from '../ui/commands/typeBuilder';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { TypeNoteEditor } from '../ui/providers/typeNoteEditor';

const lines = (...text: string[]): string => text.join('\n');

/** The notes, written to a folder of their own: an org type with one field, and a team type. */
const NOTES: Record<string, string> = {
  'Types/Org.md': lines('---', 'deckard-type: org', 'rows: "#org/*"', '---', '# Org', '', '| Field | Kind |', '| --- | --- |', '| lead | Person |', '', 'Every org.', ''),
  'Types/Team.md': lines('---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '', '| Field | Kind |', '| ----- | ---- |', '| lead  | Person |'),
};

/** One answer a stubbed pick or input gives when it shows: an item by its label, typed text, or Back. */
type Answer = { pick: string } | { type: string } | 'back';

/**
 * Stubs VS Code's quick picks and input boxes to answer from a script, in
 * order, and records each one's title; returns what puts them back.
 */
function scriptQuickInput(script: Answer[], titles: string[]): () => void {
  const window = vscode.window as unknown as Record<string, unknown>;
  const { createQuickPick, createInputBox } = window;
  const next = (): Answer => {
    const answer = script.shift();
    assert.ok(answer, 'the form asked more than the script answers');
    return answer;
  };
  const events = () => {
    const handlers = { accept: [] as (() => void)[], hide: [] as (() => void)[], button: [] as ((button: unknown) => void)[], value: [] as ((value: string) => void)[] };
    return {
      handlers,
      onDidAccept: (handler: () => void) => handlers.accept.push(handler),
      onDidHide: (handler: () => void) => handlers.hide.push(handler),
      onDidTriggerButton: (handler: (button: unknown) => void) => handlers.button.push(handler),
      onDidChangeValue: (handler: (value: string) => void) => handlers.value.push(handler),
      hide: () => handlers.hide.forEach((handler) => handler()),
      dispose: () => undefined,
    };
  };
  window.createQuickPick = () => {
    const base = events();
    const pick = {
      ...base,
      title: '',
      items: [] as Array<{ label: string }>,
      activeItems: [] as unknown[],
      selectedItems: [] as unknown[],
      show: () =>
        setTimeout(() => {
          titles.push(pick.title);
          const answer = next();
          if (answer === 'back') {
            base.handlers.button.forEach((handler) => handler(vscode.QuickInputButtons.Back));
            return;
          }
          assert.ok('pick' in answer, `${pick.title} is a pick, not an input`);
          const item = pick.items.find((each) => each.label.replace(/^\$\([^)]*\) /, '') === answer.pick);
          assert.ok(item, `${pick.title} has no ${answer.pick}: ${pick.items.map((each) => each.label).join(', ')}`);
          pick.selectedItems = [item];
          base.handlers.accept.forEach((handler) => handler());
        }, 0),
    };
    return pick;
  };
  window.createInputBox = () => {
    const base = events();
    const input = {
      ...base,
      title: '',
      value: '',
      show: () =>
        setTimeout(() => {
          titles.push(input.title);
          const answer = next();
          if (answer === 'back') {
            base.handlers.button.forEach((handler) => handler(vscode.QuickInputButtons.Back));
            return;
          }
          assert.ok('type' in answer, `${input.title} is an input, not a pick`);
          input.value = answer.type;
          base.handlers.accept.forEach((handler) => handler());
        }, 0),
    };
    return input;
  };
  return () => {
    window.createQuickPick = createQuickPick;
    window.createInputBox = createInputBox;
  };
}

suite('Type builder, in the editor', () => {
  test('adds a field through its steps, Back included, moves another, writes each as it goes, and Undo takes the last back', async () => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-type-builder-${Date.now()}`));
    for (const [filePath, content] of Object.entries(NOTES)) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, filePath), Buffer.from(content, 'utf8'));
    }
    const relative = (uri: vscode.Uri): string => path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
    const parse = (filePath: string, content: string) => parseMarkdown(filePath, content, undefined, { typeNote: filePath.startsWith('Types/') });
    const index: WorkspaceIndex = buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([filePath, content]) => [filePath, parse(filePath, content)])));
    const history = new WorkspaceWriteHistory();
    const writes: TypeBuilderWrites = {
      indexer: {
        ready: Promise.resolve(),
        getSnapshot: () => index,
        getTypeIndex: () => getTypeIndex(index),
        getFilePath: relative,
        getUri: (filePath: string) => vscode.Uri.joinPath(root, filePath),
        parse: (uri: vscode.Uri, content: string) => parse(relative(uri), content),
        getNotesFolderUri: () => root,
        getTemplatesFolderUri: () => undefined,
        getTypesFolderUri: () => vscode.Uri.joinPath(root, 'Types'),
      },
      history,
    };
    const org = vscode.Uri.joinPath(root, 'Types/Org.md');
    const read = async (uri: vscode.Uri) => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const titles: string[] = [];
    const restore = scriptQuickInput(
      [
        { pick: 'Add field…' },
        { type: 'Distribution  List' },
        { pick: 'Person' },
        { pick: 'Several people' },
        'back',
        { pick: 'Several people' },
        { type: 'on distribution list for' },
        { pick: 'lead' },
        { pick: 'Move down' },
        { pick: 'Done' },
      ],
      titles,
    );
    try {
      await editType(writes, 'org');
      assert.deepStrictEqual(titles, [
        'Org · Types/Org.md',
        'Add a field to Org',
        'Distribution List · Kind',
        'Distribution List · Person',
        'Distribution List · On the other side',
        'Distribution List · Person',
        'Distribution List · On the other side',
        'Org · Types/Org.md',
        'Org · lead',
        'Org · Types/Org.md',
      ]);
      const table = lines(
        '| Field             | Kind         | Reverse                  |',
        '| ----------------- | ------------ | ------------------------ |',
        '| Distribution List | Person, many | on distribution list for |',
        '| lead              | Person       |                          |',
      );
      assert.strictEqual(await read(org), lines('---', 'deckard-type: org', 'rows: "#org/*"', '---', '# Org', '', table, '', 'Every org.', ''));
      await history.undo();
      assert.ok((await read(org)).includes('| lead              | Person       |                          |\n| Distribution List |'), 'Undo puts lead back above');

      // The lens over the table, and Format Document on a ragged one.
      const editor = new TypeNoteEditor(writes.indexer);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, 'Types/Team.md'));
      assert.deepStrictEqual(editor.provideCodeLenses(document).map((lens) => lens.command?.title), ['Edit Type…', 'Add field…', '1 field, 0 rows']);
      assert.strictEqual(editor.provideCodeLenses(await vscode.workspace.openTextDocument({ content: '# Not a type', language: 'markdown' })).length, 0);
      const [format] = editor.provideDocumentFormattingEdits(document);
      assert.strictEqual(format.newText, lines('| Field | Kind   |', '| ----- | ------ |', '| lead  | Person |'));
      const hover = editor.provideHover(document, new vscode.Position(6, 10));
      assert.ok(String((hover?.contents[0] as vscode.MarkdownString).value).includes('Add `, many`'), 'the Kind header lists the kinds');
    } finally {
      restore();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      try {
        await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
      } catch {
        // Windows may still hold the folder of a note VS Code showed; the temp folder is left behind.
      }
    }
  });
});
