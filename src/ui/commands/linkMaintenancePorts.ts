import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../core/types';
import {
  LinkNoteService,
  LinkService,
  LiveNotes,
  NoteEdit,
  NoteFiles,
} from '../../services/linkService';
import { findUnlinkedMentions } from '../state/editorLensState';
import { resolveSourceUri } from './navigation';

/**
 * What the link services read and write through, in VS Code: the notes as
 * the editor or the disk has them, and the file system a note is made in.
 * The composition root hands its own to the commands it registers; these
 * serve the callers that are handed none, such as the Stats page.
 */

/**
 * The notes as VS Code has them: a path resolved against the workspace
 * folders, and a note read through its document, so an open note's unsaved
 * text is what is read.
 */
export const vscodeLiveNotes: LiveNotes<vscode.Uri> = {
  uriOf: (filePath) => resolveSourceUri(filePath),
  read: async (uri) => (await vscode.workspace.openTextDocument(uri)).getText(),
};

/** VS Code's file system, as far as making a note for a link needs it. */
export const vscodeNoteFiles: NoteFiles<vscode.Uri> = {
  joinPath: (base, ...segments) => vscode.Uri.joinPath(base, ...segments),
  stat: (uri) => vscode.workspace.fs.stat(uri),
  createDirectory: (uri) => vscode.workspace.fs.createDirectory(uri),
  writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
  delete: (uri) => vscode.workspace.fs.delete(uri, { useTrash: false }),
};

/** Making notes for links through VS Code's file system. It keeps no state. */
export const vscodeLinkNotes = new LinkNoteService(vscodeNoteFiles);

/** A LinkService over an index and the notes as VS Code has them. */
export function createLinkService(
  index: { getSnapshot(): WorkspaceIndex },
): LinkService<vscode.Uri> {
  return new LinkService({ index, notes: vscodeLiveNotes, findUnlinkedMentions });
}

/** One workspace edit that makes every edit, in order. */
export function toWorkspaceEdit(edits: readonly NoteEdit<vscode.Uri>[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  edits.forEach((each) =>
    edit.replace(
      each.uri,
      new vscode.Range(each.line, each.startColumn, each.line, each.endColumn),
      each.text,
    ),
  );
  return edit;
}
