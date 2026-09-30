import * as vscode from 'vscode';

import { isTaskLine } from '../../domain/markdown/taskDraft';
import { pinKey } from '../../core/storage/preferences';
import { WorkspaceIndex } from '../../core/types';
import { createPinForLine } from '../state/pinnedNotes';

/** Where the cursor is, which decides what a note's actions are. */
export interface NoteActionState {
  onTaskLine: boolean;
  pinned: boolean;
  /** The cursor is in a heading or a line that carries a tag. */
  inTaggedEntry: boolean;
  /** The cursor is under a heading, which Focus Section folds around. */
  underHeading: boolean;
}

/** One row of Note Actions, and the command it runs. */
export interface NoteActionItem extends vscode.QuickPickItem {
  command: string;
  args?: unknown[];
}

/**
 * The actions a note offers where the cursor is, in the order they are
 * listed: the task first, since a task line is the most specific place to
 * be, then the note's neighbors, then Home.
 */
export function buildNoteActionItems(
  state: NoteActionState,
  target: { uri: string; line: number },
): NoteActionItem[] {
  const items: NoteActionItem[] = [];
  if (state.onTaskLine) {
    items.push(
      { label: '$(check) Toggle Task Done', command: 'deckard.toggleTaskDone' },
      { label: '$(edit) Edit Task…', command: 'deckard.editTask' },
    );
  } else {
    items.push({ label: '$(add) Add Task…', command: 'deckard.addTask' });
  }
  items.push(
    state.inTaggedEntry
      ? {
          label: '$(references) Open Related Notes',
          detail: 'For the heading the cursor is in',
          command: 'deckard.showEntryRelatedNotes',
          args: [target.uri, target.line],
        }
      : { label: '$(references) Open Related Notes', command: 'deckard.relatedNotes.focus' },
    {
      label: '$(type-hierarchy) Open Notes Graph Around This Note',
      command: 'deckard.showNotesGraphAroundNote',
    },
    { label: '$(arrow-right) Move to…', command: 'deckard.moveTo' },
  );
  if (state.underHeading) {
    items.push({ label: '$(target) Focus Section', command: 'deckard.focusSection' });
  }
  items.push(
    state.pinned
      ? { label: '$(pinned) Unpin Note from Home', command: 'deckard.unpinNote' }
      : { label: '$(pin) Pin Note to Home', command: 'deckard.pinNote' },
  );
  return items;
}

/** What Note Actions reads from Deckard. */
export interface NoteActionDeps {
  index: {
    getSnapshot(): WorkspaceIndex;
    getFilePath(uri: vscode.Uri): string;
  };
  preferences: { isPinned(key: string): boolean };
}

/** Reads where the cursor is in the note the editor shows. */
export function readNoteActionState(
  deps: NoteActionDeps,
  editor: vscode.TextEditor,
): NoteActionState {
  const line = editor.selection.active.line;
  const filePath = deps.index.getFilePath(editor.document.uri);
  const index = deps.index.getSnapshot();
  const file = index.files.get(filePath);
  const oneBased = line + 1;
  const containing = (file?.sections ?? []).filter(
    (section) => section.startLine <= oneBased && section.endLine >= oneBased,
  );
  const pin = createPinForLine(index, filePath, oneBased);
  return {
    onTaskLine: isTaskLine(editor.document.lineAt(line).text),
    pinned: pin !== undefined && deps.preferences.isPinned(pinKey(pin)),
    inTaggedEntry: containing.some((section) => section.tags.length > 0),
    underHeading:
      containing.some((section) => !section.isInline) ||
      hasHeadingAbove(editor.document, line),
  };
}

/** Whether a heading is written at or above a line, for a note not yet read. */
function hasHeadingAbove(document: vscode.TextDocument, line: number): boolean {
  for (let at = line; at >= 0; at -= 1) {
    if (/^#{1,6}[ \t]/.test(document.lineAt(at).text)) {
      return true;
    }
  }
  return false;
}

/**
 * Lists what can be done with the note in the editor from where the cursor
 * is, and runs the one chosen: the Deckard button in a note's title bar.
 */
export async function noteActionsCommand(deps: NoteActionDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a note to act on it.');
    return;
  }
  const state = readNoteActionState(deps, editor);
  const items = buildNoteActionItems(state, {
    uri: editor.document.uri.toString(),
    line: editor.selection.active.line + 1,
  });
  const name = editor.document.uri.path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Note';
  const chosen = await vscode.window.showQuickPick(items, {
    title: name,
    placeHolder: 'Choose what to do with this note',
  });
  if (chosen) {
    await vscode.commands.executeCommand(chosen.command, ...(chosen.args ?? []));
  }
}
