import * as vscode from 'vscode';

import { PreferencesStore } from '../../core/storage/preferences';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { isMarkdownFile } from '../../core/workspace/scanner';
import {
  ParsedFile,
  SidebarMessage,
  TagTitleDisplayMode,
} from '../../core/types';
import {
  createSidebarSnapshot,
  createTagOverviewSidebarSnapshot,
  createTagOverviewSnapshot,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { openSourceAt } from '../commands/navigation';
import { getSidebarNotesHtml } from './sidebarNotesHtml';
import { parseSidebarMessage } from './messages';

/**
 * Provides active-note context or active-tag-overview context in the sidebar.
 *
 * It presents saved-note relationships from the workspace index so sidebar
 * context matches the persistent local search data.
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
    private readonly onReveal: () => void | Promise<void>,
    private readonly extensionVersion: string,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(tagOverview.onDidChange(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.enableKeywordLinks')) {
          this.refresh();
        }
        if (event.affectsConfiguration('deckard.tagTitleDisplayMode')) {
          this.refresh();
        }
        if (event.affectsConfiguration('deckard.theme')) {
          this.renderHtml();
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
    this.renderHtml();
    let wasVisible = false;
    const handleVisibilityChange = (): void => {
      if (
        webviewView.visible &&
        !wasVisible &&
        shouldOpenDashboardForSidebarReveal(
          vscode.window.activeTextEditor?.document,
        )
      ) {
        void this.onReveal();
      }
      wasVisible = webviewView.visible;
    };
    this.viewDisposables = [
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.disposeViewListeners();
      }),
      webviewView.onDidChangeVisibility(handleVisibilityChange),
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    ];
    handleVisibilityChange();
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

  private renderHtml(): void {
    if (this.view) {
      this.view.webview.html = getSidebarNotesHtml(
        this.view.webview,
        this.extensionVersion,
      );
    }
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
        'active',
        this.getTagTitleDisplayMode(),
      );
      if (overview) {
        return createTagOverviewSidebarSnapshot(overview);
      }
    }

    const active = this.getActiveFile();
    return createSidebarSnapshot(
      index,
      active?.filePath,
      active?.file,
      this.areKeywordLinksEnabled(),
      this.preferences.value.relatedNotesSortMode,
      this.preferences.value.sectionAccessCounts,
      this.getTagTitleDisplayMode(),
    );
  }

  private getTagTitleDisplayMode(): TagTitleDisplayMode {
    return normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
  }

  /**
   * Reads the active note from the saved workspace index.
   */
  private getActiveFile(): ActiveFile | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isMarkdownDocument(document)) {
      return undefined;
    }

    const filePath = this.indexer.getFilePath(document.uri);
    const file = this.indexer.getSnapshot().files.get(filePath);
    if (!file) {
      return undefined;
    }
    return {
      filePath,
      file,
    };
  }

  /**
   * Reads the active note's workspace setting for related-note ranking.
   */
  private areKeywordLinksEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard', vscode.window.activeTextEditor?.document.uri)
      .get<boolean>('enableKeywordLinks', true);
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
    if (message.type === 'openHelp') {
      await vscode.commands.executeCommand('deckard.showHelp');
      return;
    }
    if (message.type === 'setRelatedNotesSort') {
      await this.preferences.setRelatedNotesSortMode(message.mode);
      return;
    }
    if (message.type === 'openTag') {
      const tagKey = resolveIndexedTagKey(index.tags, message.tagKey);
      if (tagKey) {
        await this.onOpenTag(tagKey);
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
      if (note.sectionId) {
        await this.preferences.recordSectionAccess(note.sectionId);
      }
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

/**
 * Avoids taking focus from a Markdown note when Related Notes is opened.
 */
export function shouldOpenDashboardForSidebarReveal(
  document: Pick<vscode.TextDocument, 'uri'> | undefined,
): boolean {
  return !document || !isMarkdownFile(document.uri);
}
