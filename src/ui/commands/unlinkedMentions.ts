import * as vscode from 'vscode';

import { ParsedFile, WorkspaceIndex } from '../../core/types';
import { noteTitle } from '../../core/workspace/backlinks';
import { findUnlinkedMentions } from '../state/editorLensState';
import { resolveSourceUri } from './navigation';
import { applyWorkspaceWrite } from './workspaceWrites';

/** The command the Link mentions lens runs. */
export const LINK_MENTIONS_COMMAND = 'deckard.linkMentions';

interface MentionIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  parse(uri: vscode.Uri, content: string): ParsedFile;
  refresh(): Promise<void>;
}

/**
 * Turns every unlinked mention of a note into a `[[link]]` to it, keeping the
 * name as it was written: `atlas` becomes `[[atlas]]`, which opens `Atlas.md`
 * because links match names without regard to case.
 *
 * The mentions are found again from the index rather than taken from the
 * lens, and each is compared with what its line says now, so a mention edited
 * since the index read it is left alone. The write is one
 * `applyWorkspaceWrite()`: previewed as `deckard.previewWorkspaceWrites` asks,
 * and taken back by `Deckard: Undo Last Change`.
 */
export async function linkMentions(
  indexer: MentionIndexSource,
  documentUri: vscode.Uri,
): Promise<void> {
  await indexer.ready;
  const document = await vscode.workspace.openTextDocument(documentUri);
  const file = indexer.parse(documentUri, document.getText());
  const title = noteTitle(file.filePath);
  const mentions = findUnlinkedMentions(file, indexer.getSnapshot());

  const edit = new vscode.WorkspaceEdit();
  let linked = 0;
  const uris = new Map<string, vscode.Uri | undefined>();
  for (const mention of mentions) {
    if (!uris.has(mention.filePath)) {
      uris.set(mention.filePath, await resolveSourceUri(mention.filePath));
    }
    const uri = uris.get(mention.filePath);
    if (!uri) {
      continue;
    }
    const target = await vscode.workspace.openTextDocument(uri);
    const range = new vscode.Range(
      mention.line,
      mention.startColumn,
      mention.line,
      mention.endColumn,
    );
    if (
      mention.line >= target.lineCount ||
      target.getText(range) !== mention.text
    ) {
      continue;
    }
    edit.replace(uri, range, `[[${mention.text}]]`);
    linked += 1;
  }
  if (linked === 0) {
    void vscode.window.showInformationMessage(
      `No note mentions ${title} without a link any more.`,
    );
    return;
  }

  const written = await applyWorkspaceWrite(edit, {
    label: `links to ${title}`,
    description: `Link a mention of ${title}`,
  });
  if (!written.applied || written.notes.length === 0) {
    return;
  }
  try {
    await indexer.refresh();
  } catch {
    // The watcher picks the notes up; the links themselves are written.
  }
  // The preview can leave changes out, so what landed is counted by note.
  const notes = written.notes.length;
  void vscode.window.showInformationMessage(
    `Linked the mentions of ${title} in ${notes === 1 ? '1 note' : `${notes} notes`}.`,
  );
}
