import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { PinnedNote } from '../domain/model';
import { pinKey } from '../core/storage/preferencesSchema';
import { readNoteActionState } from '../ui/commands/noteActions';
import { ActivePinContext, setNotePinnedCommand } from '../ui/commands/pinNote';

/**
 * A note with unsaved lines is pinned at the heading the cursor is under in
 * the editor, not the one at that line in the note as last saved.
 */
suite('Pin Note to Home in a note with unsaved lines', () => {
  const saved = '# Plan\n## Budget\nNumbers.\n## Hiring\nPeople.\nMore.\n';
  // Three lines added under Plan and not saved: "Numbers.", under Budget,
  // is now on line 6, which in the saved note is under Hiring.
  const unsaved = '# Plan\nOne.\nTwo.\nThree.\n## Budget\nNumbers.\n## Hiring\nPeople.\nMore.\n';
  const index = buildWorkspaceIndex(new Map([['notes/plan.md', parseMarkdown('notes/plan.md', saved)]]));
  const uri = vscode.Uri.file('/w/notes/plan.md');
  const editor = {
    document: { uri, isDirty: true, version: 2, getText: () => unsaved, lineAt: (line: number) => ({ text: unsaved.split('\n')[line] }) },
    selection: { active: { line: 5 } },
  } as unknown as vscode.TextEditor;
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: () => 'notes/plan.md',
    isNotesFile: () => true,
    onDidUpdate: () => ({ dispose: () => undefined }),
  };

  test('Pin Note to Home pins the heading the cursor is under', async () => {
    const window = vscode.window as unknown as Record<string, unknown>;
    const kept = Object.getOwnPropertyDescriptor(window, 'activeTextEditor');
    const showInformationMessage = window.showInformationMessage;
    const pinned: PinnedNote[] = [];
    Object.defineProperty(window, 'activeTextEditor', { configurable: true, get: () => editor });
    window.showInformationMessage = async () => undefined;
    try {
      const pin = await setNotePinnedCommand({
        indexer,
        preferences: { isPinned: () => false, pinNote: async (made) => void pinned.push(made), unpinNote: async () => undefined },
        pinned: true,
      });
      assert.strictEqual(pin?.heading, 'Budget');
      assert.deepStrictEqual(pinned.map((made) => made.heading), ['Budget']);
    } finally {
      if (kept) {
        Object.defineProperty(window, 'activeTextEditor', kept);
      } else {
        delete window.activeTextEditor;
      }
      window.showInformationMessage = showInformationMessage;
    }
  });

  test('the palette offers Unpin on a heading pinned already', () => {
    const commands = vscode.commands as unknown as Record<string, unknown>;
    const executeCommand = commands.executeCommand;
    const set: unknown[] = [];
    commands.executeCommand = async (...call: unknown[]) => void set.push(call);
    const budget = pinKey({ filePath: 'notes/plan.md', heading: 'Budget', headingLevel: 2, occurrence: 0 });
    const context = new ActivePinContext(indexer, {
      pins: { isPinned: (key) => key === budget },
      reader: { onDidChange: () => ({ dispose: () => undefined }) },
    });
    try {
      context.sync(editor);
    } finally {
      context.dispose();
      commands.executeCommand = executeCommand;
    }
    assert.deepStrictEqual(set.at(-1), ['setContext', 'deckard.activeNotePinned', true]);
  });

  test('Note Actions offers Unpin on a heading pinned already', () => {
    const budget = pinKey({ filePath: 'notes/plan.md', heading: 'Budget', headingLevel: 2, occurrence: 0 });
    const state = readNoteActionState(
      { index: indexer, preferences: { isPinned: (key) => key === budget } },
      editor,
    );
    assert.strictEqual(state.pinned, true);
  });
});
