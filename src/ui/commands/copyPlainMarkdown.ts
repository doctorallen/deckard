import * as vscode from 'vscode';

import { isMarkdownFile } from '../../core/workspace/scanner';
import { WorkspaceIndex } from '../../domain/model';
import { toPlainMarkdown } from '../state/plainMarkdown';
import { readQueryContext } from './queryContext';
import { noteName } from './notify';

/**
 * Copy as Plain Markdown: the note in the editor, or what is selected in
 * it, written out for somewhere Deckard is not, onto the clipboard. Embeds
 * become the text they name, query blocks their results as they stand, and
 * links their words; see `toPlainMarkdown`.
 */
export async function copyAsPlainMarkdownCommand(indexer: { getSnapshot(): WorkspaceIndex }): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarkdownFile(editor.document.uri)) {
    void vscode.window.showInformationMessage('Open a note to copy it as plain Markdown.');
    return;
  }
  const document = editor.document;
  const whole = document.getText();
  const selected = editor.selections.filter((selection) => !selection.isEmpty);
  const text = selected.length ? selected.map((selection) => document.getText(selection)).join('\n\n') : whole;
  const markdown = toPlainMarkdown(
    text,
    {
      index: indexer.getSnapshot(),
      queryContext: readQueryContext(),
    },
    whole,
  );
  await vscode.env.clipboard.writeText(markdown);
  void vscode.window.showInformationMessage(
    selected.length
      ? 'Copied the selection as plain Markdown, its embeds, query results, and links written out.'
      : `Copied ${noteName(document.uri)} as plain Markdown, its embeds, query results, and links written out.`,
  );
}
