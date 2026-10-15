import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { getTypeIndex } from '../domain/types/typeIndex';
import { fileLine, fileLineUnder, FileThisActions, type FileThisWrites, setFieldFromLine } from '../ui/commands/fileThis';
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
      // Nor is a heading or a blank line filed, under Notes or under any heading, before a heading is asked for.
      said.length = 0;
      await fileLine(writes, daily.toString(), 1, 'Teams/FX.md');
      await fileLineUnder(writes, daily.toString(), 3);
      assert.deepStrictEqual(said, [
        ['The line changed since the lightbulb read it, so nothing was written.'],
        ['The line changed since the lightbulb read it, so nothing was written.'],
      ]);
      assert.strictEqual(await read(hub), NOTES['Teams/FX.md']);
    } finally {
      window.showInformationMessage = info;
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });

  test('Add … to a field that holds several keeps what the hub’s editor holds unsaved, and Set refuses when the hub changed', async () => {
    const notes: Record<string, string> = {
      ...NOTES,
      'Types/Team.md': lines(
        '---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '',
        '| Field | Kind       | Words            |',
        '| ----- | ---------- | ---------------- |',
        '| lead  | Person     | leads, now leads |',
        '| owns  | Area, many | took over        |',
      ),
      'Types/Area.md': lines('---', 'deckard-type: area', 'rows: "#area/*"', '---', '# Area'),
      'Teams/FX.md': lines('---', 'describes: "#team/fx"', 'lead: "@alex-rivera"', 'owns: ["#area/options"]', '---', '# FX', ''),
      'notes/areas.md': lines('- #area/options #area/credit #area/swaps', ''),
      'journal/2026-10-14.md': lines('# 2026-10-14', '- #team/fx took over #area/swaps', '- @priya-natarajan now leads #team/fx', ''),
    };
    const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-file-this-${Date.now()}`));
    for (const [filePath, content] of Object.entries(notes)) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, filePath), Buffer.from(content, 'utf8'));
    }
    const relative = (uri: vscode.Uri): string => path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
    const parse = (filePath: string, content: string) => parseMarkdown(filePath, content, undefined, { typeNote: filePath.startsWith('Types/') });
    const index: WorkspaceIndex = buildWorkspaceIndex(new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parse(filePath, content)])));
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
      history: new WorkspaceWriteHistory(),
      preferences: createPreferences(new MemoryStore()) as never,
    };
    const daily = vscode.Uri.joinPath(root, 'journal/2026-10-14.md');
    const hub = vscode.Uri.joinPath(root, 'Teams/FX.md');
    const window = vscode.window as unknown as Record<string, unknown>;
    const quiet = { info: window.showInformationMessage, warning: window.showWarningMessage };
    const warned: unknown[][] = [];
    window.showInformationMessage = async () => undefined;
    window.showWarningMessage = async (...args: unknown[]) => {
      warned.push(args);
      return undefined;
    };
    try {
      // Credit added to FX's owns in its editor, not saved, so the index holds Options alone.
      const editor = await vscode.window.showTextDocument(hub, { preview: false });
      await editor.edit((builder) => builder.replace(new vscode.Range(3, 0, 3, 100), 'owns: ["#area/options", "#area/credit"]'));
      await setFieldFromLine(writes, daily.toString(), 1, '#team/fx', 'owns', '#area/swaps');
      assert.strictEqual(editor.document.lineAt(3).text, 'owns: ["#area/options", "#area/credit", "#area/swaps"]');

      // The lead changed in the editor since the index read Alex: Set says so and writes nothing.
      await editor.edit((builder) => builder.replace(new vscode.Range(2, 0, 2, 100), 'lead: "@sam-okafor"'));
      const before = editor.document.getText();
      await setFieldFromLine(writes, daily.toString(), 2, '#team/fx', 'lead', '@priya-natarajan');
      assert.strictEqual(editor.document.getText(), before);
      assert.match(String(warned[warned.length - 1]?.[0]), /^FX\.md changed after Deckard last read it, so nothing was written\./);
    } finally {
      window.showInformationMessage = quiet.info;
      window.showWarningMessage = quiet.warning;
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });
});
