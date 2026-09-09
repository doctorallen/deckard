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
import { renameIndexedTag } from '../commands/renameTag';
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
  private readonly output = vscode.window.createOutputChannel('Deckard');
  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly tagOverview: ActiveTagOverview,
    private readonly onOpenTag: (
      tagKey: string,
      filterTagKey?: string,
    ) => void | Promise<void>,
    private readonly extensionVersion: string,
  ) {
    this.disposables.push(this.output);
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
        if (
          event.affectsConfiguration(
            'deckard.enableHeadingTagRelationships',
          )
        ) {
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
    this.log('Resolving Related Notes webview.');
    this.disposeViewListeners();
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.viewDisposables = [
      webviewView.onDidDispose(() => {
        this.log('Related Notes webview disposed.');
        this.view = undefined;
        this.disposeViewListeners();
      }),
      webviewView.onDidChangeVisibility(() => {
        this.log(
          `Related Notes visibility changed: ${webviewView.visible}.`,
        );
        if (webviewView.visible) {
          this.refresh();
        }
      }),
      webviewView.webview.onDidReceiveMessage((message) => {
        this.log(`Received Related Notes webview message: ${describeMessage(message)}.`);
        void this.handleMessage(message);
      }),
    ];
    this.renderHtml();
    this.refresh();
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
      this.log('Rendering Related Notes webview HTML.');
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
      this.log('Skipped Related Notes refresh because no webview is attached.');
      return;
    }

    const snapshot = this.createSnapshot();
    this.log(
      `Sending Related Notes state: ${snapshot.state}${snapshot.tagOverview ? ` (tag overview ${snapshot.tagOverview.key})` : snapshot.activeFileName ? ` (Markdown ${snapshot.activeFileName})` : ''}, ${snapshot.notes.length} note entries.`,
    );
    void this.view.webview
      .postMessage({ type: 'state', data: snapshot })
      .then(
        (delivered) =>
          this.log(
            `Related Notes state delivery ${delivered ? 'succeeded' : 'was skipped because the webview is not live'}.`,
          ),
        (error: unknown) =>
          this.log(
            `Related Notes state delivery failed: ${formatError(error)}.`,
          ),
      );
  }

  /**
   * Uses the tag-overview projection only while that panel is the active tab.
   */
  private createSnapshot() {
    const index = this.indexer.getSnapshot();
    const activeTagKey = this.tagOverview.getActiveTagKey();
    const activeTagFilterKey = this.tagOverview.getActiveTagFilterKey();
    if (activeTagKey && this.tagOverview.isActive()) {
      const overview = createTagOverviewSnapshot(
        index,
        this.preferences.value,
        activeTagKey,
        'active',
        this.getTagTitleDisplayMode(),
        this.areHeadingTagRelationshipsEnabled(),
        activeTagFilterKey,
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

  private areHeadingTagRelationshipsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('enableHeadingTagRelationships', true);
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
    if (message.type === 'ready') {
      this.log('Related Notes webview is ready; refreshing state.');
      this.refresh();
      return;
    }
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
        await this.onOpenTag(tagKey, message.filterTagKey);
      }
      return;
    }
    if (message.type === 'renameTag') {
      const replacement = await renameIndexedTag(
        this.indexer,
        message.tagKey,
      );
      if (replacement) {
        await this.onOpenTag(replacement.key);
      }
      return;
    }

    if (message.type !== 'openSource') {
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

  private log(message: string): void {
    this.output.appendLine(`[Related Notes] ${message}`);
  }
}

/**
 * Minimal contract needed to switch the sidebar between editor and overview.
 */
interface ActiveTagOverview {
  readonly onDidChange: vscode.Event<void>;
  getActiveTagKey(): string | undefined;
  getActiveTagFilterKey(): string | undefined;
  isActive(): boolean;
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

function describeMessage(message: unknown): string {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string'
  ) {
    return message.type;
  }
  return 'invalid payload';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
