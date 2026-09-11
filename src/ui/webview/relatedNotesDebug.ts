import * as vscode from 'vscode';

import {
  EntryRelatedNotesDiagnostic,
  SidebarNotesView,
} from './sidebarNotes';
import { getRelatedNotesDebugHtml } from './relatedNotesDebugHtml';

/**
 * Displays the full evidence calculation for one Markdown entry.
 */
export class RelatedNotesDebugPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  public constructor(
    private readonly sidebarNotes: SidebarNotesView,
    private readonly extensionUri: vscode.Uri,
  ) {}

  public async show(
    documentUri: vscode.Uri,
    sourceLine: number,
  ): Promise<void> {
    const diagnostic = await this.sidebarNotes.getEntryDiagnostic(
      documentUri,
      sourceLine,
    );
    if (!diagnostic) {
      void vscode.window.showWarningMessage(
        'Deckard could not find that tagged note entry. Save the file and try again.',
      );
      return;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'deckard.relatedNotesDebug',
        'Deckard: Related Notes Debug',
        vscode.ViewColumn.Active,
        { enableFindWidget: true, retainContextWhenHidden: true },
      );
      this.panel.iconPath = vscode.Uri.joinPath(
        this.extensionUri,
        'resources',
        'deckard.svg',
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    this.panel.title = `Deckard: Related Notes Debug — ${diagnostic.title}`;
    this.panel.webview.html = getRelatedNotesDebugHtml(
      this.panel.webview,
      diagnostic,
    );
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  public dispose(): void {
    this.panel?.dispose();
  }
}
