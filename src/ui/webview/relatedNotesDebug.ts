import * as vscode from 'vscode';
import { reportFailure } from '../commands/notify';

import type { RelatedNotesDebugPageToHost } from '../protocol/relatedNotesDebug';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import { RelatedNotesDebugController } from './pages/relatedNotesDebug/relatedNotesDebugController';
import { SidebarNotesView } from './sidebarNotes';
import { ThemePreview } from './themePreview';

/** What the Related Notes evidence page reads and draws with. */
export interface RelatedNotesDebugPanelOptions {
  /** Related Notes, which works out the evidence for an entry. */
  sidebarNotes: SidebarNotesView;
  extensionUri: vscode.Uri;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
}

/**
 * Displays the full evidence calculation for one Markdown entry.
 *
 * The page is `RelatedNotesDebugController`, run by a `WebviewHost` in one
 * panel; this is the name the extension knows it by.
 */
export class RelatedNotesDebugPanel implements vscode.Disposable {
  private readonly sidebarNotes: SidebarNotesView;
  private readonly controller: RelatedNotesDebugController;
  private readonly page: PanelAdapter<never, RelatedNotesDebugPageToHost>;

  /** Builds the page; nothing is shown until `show`. */
  public constructor({ sidebarNotes, extensionUri, themePreview }: RelatedNotesDebugPanelOptions) {
    this.sidebarNotes = sidebarNotes;
    this.controller = new RelatedNotesDebugController(extensionUri);
    this.page = new PanelAdapter(
      new WebviewHost<never, RelatedNotesDebugPageToHost>(this.controller, { themePreview }),
      {
        viewType: 'deckard.relatedNotesDebug',
        title: 'Deckard: Related Notes Debug',
        extensionUri,
        icon: ['resources', 'deckard.svg'],
      },
    );
  }

  /**
   * Shows the evidence for the entry at `sourceLine`, in a new panel or in
   * place of what the open one shows, or says the entry is not there.
   */
  public async show(
    documentUri: vscode.Uri,
    sourceLine: number,
  ): Promise<void> {
    const diagnostic = await this.sidebarNotes.getEntryDiagnostic(
      documentUri,
      sourceLine,
    );
    if (!diagnostic) {
      void reportFailure({
        outcome: 'Deckard could not find that entry in the note as it is now.',
        fix: 'Save the note so Deckard reads it again, then try again.',
      });
      return;
    }

    this.controller.setDiagnostic(diagnostic);
    const open = this.page.panel;
    const panel = open ?? this.page.open();
    if (open) {
      this.page.host.renderHtml();
    }
    panel.title = `Deckard: Related Notes Debug — ${diagnostic.title}`;
    panel.reveal(vscode.ViewColumn.Active);
  }

  /** Closes the page, if it is open. */
  public dispose(): void {
    this.page.dispose();
  }
}
