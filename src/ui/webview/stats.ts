import * as vscode from 'vscode';

import { PreferencesStore } from '../../core/storage/preferences';
import { measure } from '../../core/timing';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { openSourceAt } from '../commands/navigation';
import { createDeckardStatsSnapshot } from '../state/dashboardState';
import { parseStatsMessage } from './messages';
import { getStatsHtml } from './statsHtml';

/**
 * Provides an overview of indexed content and recorded local views. Each
 * most-viewed row opens the tag overview or note entry it counts.
 */
export class StatsPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  /** Whether the index changed while the panel was hidden. */
  private isStale = false;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly onOpenTag: (tagKey: string) => void | Promise<void>,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
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

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      'deckard.stats',
      'Deckard Stats',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
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
    panel.webview.options = { enableScripts: true };
    this.renderHtml();
    this.panelDisposables = [
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
      panel.webview.onDidReceiveMessage((message: unknown) =>
        this.handleMessage(message),
      ),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
      }),
    ];
  }

  /**
   * Opens what a row names, if the index still has it: the page may hold a
   * snapshot from before a tag was renamed or a note was edited.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseStatsMessage(value);
    if (!message) {
      return;
    }

    const index = this.indexer.getSnapshot();
    if (message.type === 'openTag') {
      const tagKey = resolveIndexedTagKey(index.tags, message.tagKey);
      if (tagKey) {
        await this.onOpenTag(tagKey);
      }
      return;
    }

    // A total opens the notes and tasks it counted, so the page is a way in
    // rather than a list of numbers.
    if (message.type === 'openSearch') {
      await vscode.commands.executeCommand('deckard.search', message.query);
      return;
    }

    // A pair that looks alike is merged by the same command the tag list
    // uses, so the merge is confirmed, previewed, and undoable as usual.
    if (message.type === 'mergeTags') {
      const sourceKey = resolveIndexedTagKey(index.tags, message.sourceKey);
      const targetKey = resolveIndexedTagKey(index.tags, message.targetKey);
      if (sourceKey && targetKey && sourceKey !== targetKey) {
        await vscode.commands.executeCommand(
          'deckard.mergeTag',
          sourceKey,
          targetKey,
        );
      }
      return;
    }

    // The page is where staleness shows, so it is also where it is fixed.
    if (message.type === 'reindexWorkspace') {
      await vscode.commands.executeCommand('deckard.reindexWorkspace');
      return;
    }

    const section = [...index.sections.values()].find(
      (candidate) =>
        candidate.filePath === message.filePath &&
        candidate.startLine === message.line,
    );
    if (section) {
      await openSourceAt(section.filePath, section.startLine);
      await this.preferences.recordSectionAccess(section.id);
      return;
    }
    // A note listed whole, such as one nothing links to, opens without
    // counting as a view of one of its entries.
    if (index.files.has(message.filePath)) {
      await openSourceAt(message.filePath, message.line);
    }
  }

  private disposePanelListeners(): void {
    this.panelDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getStatsHtml(this.panel.webview);
    }
  }

  private refresh(): void {
    if (!this.panel) {
      return;
    }
    // A hidden page keeps what it shows and catches up when shown again.
    if (!this.panel.visible) {
      this.isStale = true;
      return;
    }

    this.isStale = false;
    void this.panel.webview.postMessage({
      type: 'state',
      data: measure('Stats', () =>
        createDeckardStatsSnapshot(
          this.indexer.getSnapshot(),
          this.preferences.value,
        ),
      ),
    });
  }
}
