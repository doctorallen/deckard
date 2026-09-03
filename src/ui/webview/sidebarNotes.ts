import * as vscode from 'vscode';

import { PreferencesStore } from '../../core/storage/preferences';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { ParsedFile, SidebarMessage } from '../../core/types';
import {
  createSidebarSnapshot,
  createTagOverviewSidebarSnapshot,
  createTagOverviewSnapshot,
} from '../state/dashboardState';
import { openSourceAt } from '../commands/navigation';
import { getSidebarNotesHtml } from './sidebarNotesHtml';
import { parseSidebarMessage } from './messages';

/**
 * Provides active-note context or active-tag-overview context in the sidebar.
 *
 * It reparses the visible editor so unsaved changes are reflected immediately,
 * while the workspace index continues to supply related-note candidates.
 */
export class SidebarNotesView
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly tagOverview: ActiveTagOverview,
    private readonly onOpenTag: (tagKey: string) => void | Promise<void>,
    private readonly extensionVersion: string,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(tagOverview.onDidChange(() => this.refresh()));
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          event.document === vscode.window.activeTextEditor?.document &&
          isMarkdownDocument(event.document)
        ) {
          this.refresh();
        }
      }),
    );
  }

  /**
   * Binds a VS Code webview view and waits for indexed data before first render.
   */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewListeners();
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getSidebarNotesHtml(
      webviewView.webview,
      this.extensionVersion,
    );
    this.viewDisposables = [
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.disposeViewListeners();
      }),
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    ];
    void this.indexer.ready.then(() => this.refresh());
  }

  /**
   * Releases view listeners and shared subscriptions.
   */
  public dispose(): void {
    this.disposeViewListeners();
    this.view = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Removes listeners tied to the current view instance before replacement.
   */
  private disposeViewListeners(): void {
    this.viewDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  /**
   * Sends the current sidebar projection only when the view is attached.
   */
  private refresh(): void {
    if (!this.view) {
      return;
    }

    const snapshot = this.createSnapshot();
    void this.view.webview.postMessage({ type: 'state', data: snapshot });
  }

  /**
   * Gives an open tag overview priority over the active editor context.
   */
  private createSnapshot() {
    const index = this.indexer.getSnapshot();
    const activeTagKey = this.tagOverview.getActiveTagKey();
    if (activeTagKey) {
      const overview = createTagOverviewSnapshot(
        index,
        this.preferences.value,
        activeTagKey,
      );
      if (overview) {
        return createTagOverviewSidebarSnapshot(overview);
      }
    }

    const active = this.getActiveFile();
    return createSidebarSnapshot(index, active?.filePath, active?.file);
  }

  /**
   * Re-parses the active document so unsaved edits participate in tag matching.
   */
  private getActiveFile(): ActiveFile | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isMarkdownDocument(document)) {
      return undefined;
    }

    const filePath = this.indexer.getFilePath(document.uri);
    const previous = this.indexer.getSnapshot().files.get(filePath);
    return {
      filePath,
      file: this.indexer.parse(document.uri, document.getText(), previous),
    };
  }

  /**
   * Rejects malformed sidebar messages before invoking navigation or commands.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseSidebarMessage(value);
    if (!message) {
      return;
    }

    await this.handleValidMessage(message);
  }

  /**
   * Revalidates navigation targets against the current sidebar projection.
   */
  private async handleValidMessage(message: SidebarMessage): Promise<void> {
    const index = this.indexer.getSnapshot();
    if (message.type === 'openDashboard') {
      await vscode.commands.executeCommand('deckard.showDashboard');
      return;
    }
    if (message.type === 'createDailyNote') {
      await vscode.commands.executeCommand('deckard.createDailyNote');
      return;
    }
    if (message.type === 'openTag') {
      if (index.tags.has(message.tagKey)) {
        await this.onOpenTag(message.tagKey);
      }
      return;
    }

    const active = this.getActiveFile();
    const snapshot = this.createSnapshot();
    const note = snapshot.notes.find(
      (candidate) =>
        candidate.filePath === message.filePath &&
        candidate.sourceLine === message.line,
    );
    if (note) {
      await openSourceAt(note.filePath, note.sourceLine);
    }
  }
}

/**
 * Minimal contract needed to switch the sidebar between editor and overview.
 */
interface ActiveTagOverview {
  readonly onDidChange: vscode.Event<void>;
  getActiveTagKey(): string | undefined;
}

/**
 * Pairs the canonical path with content parsed using current editor text.
 */
interface ActiveFile {
  filePath: string;
  file: ParsedFile;
}

/**
 * Uses the URI extension so manual language-mode changes do not hide Markdown.
 */
function isMarkdownDocument(document: vscode.TextDocument): boolean {
  return isMarkdownFile(document.uri);
}
