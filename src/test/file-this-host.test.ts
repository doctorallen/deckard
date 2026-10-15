import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { getTypeIndex } from '../domain/types/typeIndex';
import { fileLine, FileThisActions, type FileThisWrites, setFieldFromLine } from '../ui/commands/fileThis';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { createPreferences, MemoryStore } from './preferenceServices';

const lines = (...text: string[]): string => text.join('\n');

/** The notes, written to a folder of their own: two types, a team's hub, a person's, and a daily note. */
const NOTES: Record<string, string> = {
  'Types/Person.md': lines('---', 'deckard-type: person', 'rows: "@*"', '---', '# Person', '', '| Field | Kind | Words |', '| ----- | ---- | ----- |', '| team | Team | joined |'),
  'Types/Team.md': lines('---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '', '| Field | Kind   | Words            |', '| ----- | ------ | ---------------- |', '| lead  | Person | leads, now leads |'),
  'Teams/FX.md': lines('---', 'describes: "#team/fx"', 'lead: "@alex-rivera"', '---', '# FX', 'The FX desk.', ''),
  'People/Priya Natarajan.md': lines('---', 'describes: "@priya-natarajan"', '---', '# Priya Natarajan', ''),
  'People/Alex Rivera.md': lines('---', 'describes: "@alex-rivera"', '---', '# Alex Rivera', ''),
  'journal/2026-10-14.md': lines('# 2026-10-14', '## Org news', '- @priya-natarajan now leads #team/fx', ''),
};

suite('File this, in the editor', () => {
  test('offers Set lead and filing on a line, writes each through the history, and Undo takes it back', async () => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-file-this-${Date.now()}`));
    for (const [filePath, content] of Object.entries(NOTES)) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, filePath), Buffer.from(content, 'utf8'));
    }
    const relative = (uri: vscode.Uri): string => path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
    const parse = (filePath: string, content: string) => parseMarkdown(filePath, content, undefined, { typeNote: filePath.startsWith('Types/') });
    const index: WorkspaceIndex = buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([filePath, content]) => [filePath, parse(filePath, content)])));
    const history = new WorkspaceWriteHistory();
    const writes: FileThisWrites = {
      indexer: {
        ready: Promise.resolve(),
        getSnapshot: () => index,
        getTypeIndex: () => getTypeIndex(index),
        getFilePath: relative,
        getUri: (filePath: string) => vscode.Uri.joinPath(root, filePath),
        isNotesFile: () => true,
        parse: (uri: vscode.Uri, content: string) => parse(relative(uri), content),
        getNotesFolderUri: () => root,
        getTemplatesFolderUri: () => undefined,
        getTypesFolderUri: () => vscode.Uri.joinPath(root, 'Types'),
      },
      history,
      preferences: createPreferences(new MemoryStore()) as never,
    };
    const daily = vscode.Uri.joinPath(root, 'journal/2026-10-14.md');
    const hub = vscode.Uri.joinPath(root, 'Teams/FX.md');
    const read = async (uri: vscode.Uri) => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const window = vscode.window as unknown as Record<string, unknown>;
    const info = window.showInformationMessage;
    const said: unknown[][] = [];
    window.showInformationMessage = async (...args: unknown[]) => {
      said.push(args);
      return undefined;
    };
    try {
      const document = await vscode.workspace.openTextDocument(daily);
      // The hub open in an editor, as a reader filing into it might have it,
      // so each Undo puts it back through the editor.
      await vscode.window.showTextDocument(hub, { preview: false });
      const actions = new FileThisActions(writes).provideCodeActions(document, new vscode.Range(2, 0, 2, 0));
      assert.deepStrictEqual(actions.map((action) => [action.title, action.kind?.value]), [
        ['Set FX’s lead to Priya Natarajan (was Alex Rivera)', 'refactor.deckard.setField'],
        ['Add this line to Priya Natarajan’s notes', 'refactor.deckard.fileLine'],
        ['Add this line to FX’s notes', 'refactor.deckard.fileLine'],
        ['File under…', 'refactor.deckard.fileLine'],
      ]);
      assert.deepStrictEqual(new FileThisActions(writes).provideCodeActions(document, new vscode.Range(1, 0, 1, 0)), [], 'nothing on a heading');

      // Filed: the hub gets the line, dated, with its link; the daily note stays as it was.
      await fileLine(writes, daily.toString(), 2, 'Teams/FX.md');
      assert.strictEqual(await read(hub), lines('---', 'describes: "#team/fx"', 'lead: "@alex-rivera"', '---', '# FX', 'The FX desk.', '', '## Notes', '', '- 2026-10-14: @priya-natarajan now leads #team/fx ([[2026-10-14#Org news]])', ''));
      assert.strictEqual(await read(daily), NOTES['journal/2026-10-14.md']);
      assert.deepStrictEqual(said[0], ['Added the line to FX’s notes.', 'Open', 'Undo']);
      await history.undo();
      assert.strictEqual(await read(hub), NOTES['Teams/FX.md']);

      // Set: only the field's key changes in the hub's front matter.
      await setFieldFromLine(writes, daily.toString(), 2, '#team/fx', 'lead', '@priya-natarajan');
      assert.strictEqual(await read(hub), NOTES['Teams/FX.md'].replace('lead: "@alex-rivera"', 'lead: "@priya-natarajan"'));
      assert.deepStrictEqual(said[said.length - 1], ['Set FX’s lead to Priya Natarajan.', 'Undo']);
      await history.undo();
      assert.strictEqual(await read(hub), NOTES['Teams/FX.md']);

      // A line that no longer says it writes nothing.
      await setFieldFromLine(writes, daily.toString(), 1, '#team/fx', 'lead', '@priya-natarajan');
      assert.deepStrictEqual(said[said.length - 1], ['The line changed since the lightbulb read it, so nothing was written.']);
      assert.strictEqual(await read(hub), NOTES['Teams/FX.md']);
    } finally {
      window.showInformationMessage = info;
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });
});
