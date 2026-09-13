import * as vscode from 'vscode';

import { NotesGraphMessage, SourceLocation } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { openSourceAt } from '../commands/navigation';
import { createNotesGraphSnapshot } from '../state/notesGraphState';
import { parseNotesGraphMessage } from './messages';
import { getNotesGraphHtml } from './notesGraphHtml';

/**
 * Owns the workspace-wide Notes Graph panel and validates navigation requests
 * against the current index before opening editors or tag overviews.
 */
export class NotesGraphPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly extensionUri: vscode.Uri,
    private readonly onShowConnections: (
      filePath: string,
      line: number,
    ) => readonly SourceLocation[] | Promise<readonly SourceLocation[]>,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          this.renderHtml();
          this.refresh();
        }
      }),
    );
  }

  public async show(): Promise<void> {
    if (!this.panel) {
      this.createPanel();
    }

    this.panel?.reveal(vscode.ViewColumn.Active);
    await this.indexer.ready;
    this.refresh();
  }

  public async restore(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }

    this.attachPanel(panel);
    await this.indexer.ready;
    this.refresh();
  }

  public dispose(): void {
    this.disposePanelListeners();
    this.panel?.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  public highlightSource(filePath?: string, line?: number): void {
    if (
      filePath &&
      line !== undefined &&
      this.isKnownSourceLocation(filePath, line)
    ) {
      void this.panel?.webview.postMessage({
        type: 'highlightSource',
        filePath,
        line,
      });
      return;
    }
    void this.panel?.webview.postMessage({ type: 'highlightSource' });
  }

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      'deckard.notesGraph',
      'Deckard Notes Graph',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
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
      'notes-graph.svg',
    );
    panel.webview.options = { enableScripts: true };
    this.renderHtml();
    this.panelDisposables = [
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    ];
  }

  private disposePanelListeners(): void {
    this.panelDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getNotesGraphHtml(this.panel.webview);
    }
  }

  private refresh(): void {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage({
      type: 'state',
      data: createNotesGraphSnapshot(this.indexer.getSnapshot()),
    });
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseNotesGraphMessage(value);
    if (message) {
      await this.handleValidMessage(message);
    }
  }

  private async handleValidMessage(message: NotesGraphMessage): Promise<void> {
    const index = this.indexer.getSnapshot();

    if (message.type === 'openTag') {
      if (index.tags.has(message.tagKey)) {
        await vscode.commands.executeCommand(
          'deckard.showTagOverview',
          message.tagKey,
        );
      }
      return;
    }

    if (message.type === 'showConnections') {
      if (this.isKnownSourceLocation(message.filePath, message.line)) {
        const sources = await this.onShowConnections(
          message.filePath,
          message.line,
        );
        void this.panel?.webview.postMessage({
          type: 'relatedSources',
          source: { filePath: message.filePath, line: message.line },
          sources: sources.slice(0, 100),
        });
      }
      return;
    }

    if (this.isKnownSourceLocation(message.filePath, message.line)) {
      await openSourceAt(message.filePath, message.line);
    }
  }

  private isKnownSourceLocation(filePath: string, line: number): boolean {
    const index = this.indexer.getSnapshot();
    for (const task of index.tasks.values()) {
      if (task.filePath === filePath && task.lineNumber === line) {
        return true;
      }
    }
    for (const section of index.sections.values()) {
      if (section.filePath === filePath && section.startLine === line) {
        return true;
      }
    }
    const file = index.files.get(filePath);
    return Boolean(
      file &&
        file.sections.length === 0 &&
        (file.frontmatterTags.length > 0 || file.links.length > 0) &&
        line === 1,
    );
  }
}
