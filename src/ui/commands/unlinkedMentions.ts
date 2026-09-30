import * as vscode from 'vscode';

import { ParsedFile, WorkspaceIndex } from '../../core/types';
import { noteTitle } from '../../domain/index/backlinks';
import { LinkService } from '../../services/linkService';
import { createLinkService, toWorkspaceEdit } from './linkMaintenancePorts';
import { WorkspaceWriteHistory } from './workspaceWrites';

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
 * Which mentions are still there to link is LinkService's decision. The
 * write is one write to the history: previewed as
 * `deckard.previewWorkspaceWrites` asks, and taken back by `Deckard: Undo
 * Last Change`.
 */
export async function linkMentions(
  indexer: MentionIndexSource,
  history: WorkspaceWriteHistory,
  documentUri: vscode.Uri,
  links: LinkService<vscode.Uri> = createLinkService(indexer),
): Promise<void> {
  await indexer.ready;
  const document = await vscode.workspace.openTextDocument(documentUri);
  const file = indexer.parse(documentUri, document.getText());
  const title = noteTitle(file.filePath);
  const plan = await links.planMentionLinks(file);
  if (plan.kind === 'none') {
    void vscode.window.showInformationMessage(
      `No note mentions ${title} without a link any more.`,
    );
    return;
  }

  const written = await history.write(toWorkspaceEdit(plan.edits), {
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
