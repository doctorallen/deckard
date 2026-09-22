import * as vscode from 'vscode';
import { affectsPageChrome } from './components';

import { getHelpHtml, HelpManifest } from './helpHtml';

/**
 * Hosts Deckard's self-contained product guide in a reusable webview panel.
 */
export class HelpPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    /**
     * What the extension contributes, so the commands and settings tables
     * describe this version rather than a copy written beside them.
     */
    private readonly manifest: HelpManifest = {},
  ) {}

  public show(): void {
    if (!this.panel) {
      this.createPanel();
    }
    this.panel?.reveal(vscode.ViewColumn.Active);
  }

  public async restore(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }
    this.attachPanel(panel);
  }

  public dispose(): void {
    this.disposePanelListeners();
    this.panel?.dispose();
  }

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      'deckard.help',
      'Deckard Help',
      vscode.ViewColumn.Active,
      {
        enableFindWidget: true,
        retainContextWhenHidden: true,
      },
    );
    this.attachPanel(panel);
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'deckard.svg',
    );
    panel.webview.html = getHelpHtml(panel.webview, this.extensionUri, this.manifest);
    this.panelDisposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (affectsPageChrome(event) && this.panel) {
          this.panel.webview.html = getHelpHtml(
            this.panel.webview,
            this.extensionUri,
            this.manifest,
          );
        }
      }),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
    ];
  }

  private disposePanelListeners(): void {
    this.panelDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }
}
