import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import { noteTitle } from '../../domain/index/backlinks';
import { setFrontmatterField, type FrontmatterRefusal } from '../../domain/types/frontmatterWriter';
import type { FieldEditValue } from '../protocol/fields';
import { planNoteFieldWrite } from '../state/noteFields';
import { openResultAt } from './navigation';
import { reportFailure } from './notify';
import type { WorkspaceWriteHistory } from './workspaceWrites';

/**
 * A field edit from the Note page (docs/implementation/30-databases.md
 * § Writes): one front-matter key of one note, written through the editor's
 * copy of the note so what the reader has not saved stays, as one write
 * Undo Last Change takes back, and offered with an Undo.
 */

/** What a field edit reads and writes through. */
export interface NoteFieldWrites {
  indexer: Pick<IndexReader<vscode.Uri>, 'getSnapshot' | 'getUri'>;
  history: WorkspaceWriteHistory;
}

/** Why the writer left a key alone, in a sentence. */
const REFUSALS: Readonly<Record<FrontmatterRefusal, string>> = {
  'block-scalar': 'is a block of lines',
  nested: 'holds keys of its own',
  unreadable: 'is written in a way Deckard cannot rewrite safely',
  'bad-key': 'is not a key front matter can have',
};

/**
 * Writes one field of a typed note, as the Note page asked: checked against
 * the index as it is now, then against the note as its document holds it.
 * A value the writer cannot rewrite safely opens the editor at its line
 * instead, and says why. True when the note was written.
 */
export async function writeNoteField(
  writes: NoteFieldWrites,
  request: { filePath: string; key: string; value: FieldEditValue },
): Promise<boolean> {
  const plan = planNoteFieldWrite(writes.indexer.getSnapshot(), request, Date.now());
  if ('error' in plan) {
    void vscode.window.showInformationMessage(plan.error);
    return false;
  }
  const uri = writes.indexer.getUri(request.filePath);
  if (!uri) {
    return false;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const edit = setFrontmatterField(document.getText(), plan.key, plan.write);
  if (edit.kind === 'unchanged') {
    return false;
  }
  if (edit.kind === 'refused') {
    await openResultAt(request.filePath, edit.line, { pin: true });
    void vscode.window.showInformationMessage(
      `${plan.key} in "${noteTitle(request.filePath)}" ${REFUSALS[edit.reason]}, so Deckard opened it to change by hand.`,
    );
    return false;
  }
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(
    uri,
    new vscode.Range(new vscode.Position(edit.start, 0), new vscode.Position(edit.start + edit.deleted, 0)),
    edit.lines.map((line) => `${line}${eol}`).join(''),
  );
  // One note the reader changed on purpose, so nothing to preview.
  const result = await writes.history.write(workspaceEdit, { label: plan.label, preview: 'never' });
  if (!result.applied) {
    void reportFailure({ outcome: `VS Code did not accept the change, so "${noteTitle(request.filePath)}" keeps its ${plan.key}.` });
    return false;
  }
  result.handle.offerUndo(plan.said, { guard: 'latest', done: `Put ${plan.key} back as it was.` });
  return true;
}
