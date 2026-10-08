import * as vscode from 'vscode';

import { isTaskLine } from '../../domain/markdown/taskDraft';
import { createPinForLine } from '../../domain/notes/pins';
import { WorkspaceIndex } from '../../domain/model';
import { pinKey } from '../../core/storage/preferencesSchema';
import { findHeadingLineAbove } from './focusSection';
import { NOTE_ACTIONS, noteActionApplies } from './noteActionTable';
import { readIndexAsEdited } from './pinNote';

/** Where the cursor is, which decides what a note's actions are. */
export interface NoteActionState {
  onTaskLine: boolean;
  pinned: boolean;
  /** The note is parked, so Unpark is offered rather than Park. */
  parked: boolean;
  /** The cursor is in a heading or a line that carries a tag. */
  inTaggedEntry: boolean;
  /** The cursor is under a heading, which the heading's actions act on. */
  underHeading: boolean;
}

/** One row of Note Actions, and the command it runs. */
export interface NoteActionItem extends vscode.QuickPickItem {
  command: string;
  args?: unknown[];
}

/**
 * The actions a note offers where the cursor is, from the one table the
 * editor's Deckard submenu and the note page's ⋯ list too, in its order:
 * the task, the heading, the note, then keeping it on Home or parking it.
 * A separator ends each group, as in the submenu.
 */
export function buildNoteActionItems(state: NoteActionState): NoteActionItem[] {
  const items: NoteActionItem[] = [];
  let group: string | undefined;
  for (const action of NOTE_ACTIONS) {
    if (!noteActionApplies(action.when, state)) {
      continue;
    }
    if (group !== undefined && action.group !== group) {
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, command: '' });
    }
    group = action.group;
    items.push({
      label: `$(${action.icon}) ${action.title}`,
      command: action.command,
      // Related Notes is for the heading the cursor is in, inside a tagged entry.
      ...(action.command === 'deckard.openRelatedNotes' && state.inTaggedEntry ? { detail: 'For the heading the cursor is in' } : {}),
    });
  }
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
  // The cursor's line is the editor's, so an unsaved note is read as shown.
  const index = readIndexAsEdited(deps.index.getSnapshot(), filePath, editor.document);
  const file = index.files.get(filePath);
  const oneBased = line + 1;
  const containing = (file?.sections ?? []).filter(
    (section) => section.startLine <= oneBased && section.endLine >= oneBased,
  );
  const pin = createPinForLine(index, filePath, oneBased);
  return {
    onTaskLine: isTaskLine(editor.document.lineAt(line).text),
    pinned: pin !== undefined && deps.preferences.isPinned(pinKey(pin)),
    parked: index.parked?.files.has(filePath) ?? false,
    inTaggedEntry: containing.some((section) => section.tags.length > 0),
    underHeading:
      containing.some((section) => !section.isInline) ||
      hasHeadingAbove(editor.document, line),
  };
}

/**
 * Whether a heading is written at or above a line, for a note not yet read,
 * by Focus Section's own rule, so it is offered only where it will act: a
 * heading as the parser reads one, `#` alone and a heading indented by up
 * to three spaces included, and never a line in fenced code or front matter.
 */
export function hasHeadingAbove(document: Pick<vscode.TextDocument, 'lineAt' | 'lineCount'>, line: number): boolean {
  // The whole note, so front matter the cursor is inside is still found closed.
  const lines = Array.from({ length: document.lineCount }, (_, at) => document.lineAt(at).text);
  return findHeadingLineAbove(lines, line) !== undefined;
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
  const items = buildNoteActionItems(readNoteActionState(deps, editor));
  const name = editor.document.uri.path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Note';
  const chosen = await vscode.window.showQuickPick(items, {
    title: name,
    placeHolder: 'Choose what to do with this note',
  });
  if (chosen) {
    await vscode.commands.executeCommand(chosen.command, ...(chosen.args ?? []));
  }
}

/**
 * Open Related Notes, as Note Actions, the editor's submenu and the note
 * page's ⋯ list it: for the heading the cursor is in, inside a tagged
 * entry; otherwise the Context view, which follows the note in front, an
 * editor's or a note page's.
 */
export async function openRelatedNotesCommand(deps: NoteActionDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor && readNoteActionState(deps, editor).inTaggedEntry) {
    await vscode.commands.executeCommand('deckard.showEntryRelatedNotes', editor.document.uri.toString(), editor.selection.active.line + 1);
    return;
  }
  await vscode.commands.executeCommand('deckard.relatedNotes.focus');
}
