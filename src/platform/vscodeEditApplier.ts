import * as vscode from 'vscode';

import type {
  EditApplier,
  HistoryWriteOptions,
  HistoryWriter,
  HistoryWriteResult,
  NoteEdit,
  NoteText,
  TextPosition,
  TextRange,
} from '../ports/editApplier';

/**
 * Notes as VS Code's editor holds them. Each call goes to the VS Code API it
 * names: a note is opened with `openTextDocument`, changed with one
 * `applyEdit`, and saved through the document an editor already has open
 * for it, else the one opened for it.
 */
export function createVscodeEditApplier(): EditApplier<vscode.Uri> {
  return {
    open: async (uri) => toNoteText(await vscode.workspace.openTextDocument(uri)),
    apply: (edits) => vscode.workspace.applyEdit(toWorkspaceEdit(edits)),
    save: async (uri, beforeSave) => {
      const document =
        vscode.workspace.textDocuments.find(
          (openDocument) => openDocument.uri.toString() === uri.toString(),
        ) ?? (await vscode.workspace.openTextDocument(uri));
      beforeSave?.(document.uri.toString());
      return document.save();
    },
  };
}

/**
 * Writes through a write history whose `write` takes a VS Code
 * `WorkspaceEdit`, as Deckard's does: the edits become one `WorkspaceEdit`,
 * in the order given, and the history's result comes back as it is.
 */
export function createVscodeHistoryWriter<H>(history: {
  write(
    edit: vscode.WorkspaceEdit,
    options: HistoryWriteOptions,
  ): PromiseLike<HistoryWriteResult<H>>;
}): HistoryWriter<vscode.Uri, H> {
  return {
    write: (edits, options) => history.write(toWorkspaceEdit(edits), options),
  };
}

/** A document as a note's text, read from the document each time it is asked. */
function toNoteText(document: vscode.TextDocument): NoteText {
  return {
    get eol() {
      return document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    },
    get lineCount() {
      return document.lineCount;
    },
    lineAt: (line) => document.lineAt(line).text,
    getText: (range) => (range ? document.getText(toRange(range)) : document.getText()),
    offsetAt: (position) => document.offsetAt(toPosition(position)),
    positionAt: (offset) => fromPosition(document.positionAt(offset)),
  };
}

/** The edits as one `WorkspaceEdit`, each replacement in the order given. */
function toWorkspaceEdit(edits: readonly NoteEdit<vscode.Uri>[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  for (const { uri, replacements } of edits) {
    for (const { range, text } of replacements) {
      edit.replace(uri, toRange(range), text);
    }
  }
  return edit;
}

function toRange(range: TextRange): vscode.Range {
  return new vscode.Range(toPosition(range.start), toPosition(range.end));
}

function toPosition(position: TextPosition): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

function fromPosition(position: vscode.Position): TextPosition {
  return { line: position.line, character: position.character };
}
