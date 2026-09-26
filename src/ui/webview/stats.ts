import * as vscode from 'vscode';
import { onDidChangePageChrome } from './components';

import { PreferencesStore } from '../../core/storage/preferences';
import { measure } from '../../core/timing';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { openResultAt, resolveSourceUri } from '../commands/navigation';
import { createMissingNotes, reportCreatedNotes } from '../commands/linkHealth';
import { getExtractedNoteFileName } from '../../core/markdown/noteNames';
import { findMissingLinkTargets } from '../../core/workspace/backlinks';
import { createDeckardStatsSnapshot } from '../state/dashboardState';
import { parseStatsMessage } from './messages';
import { getStatsHtml } from './statsHtml';
import { followIndexing } from './indexingProgress';
import { onIndexUpdateInTurn, panelPriority } from '../../core/workspace/publishing';

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
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Stats', priority: () => panelPriority(this.panel) },
        () => this.refresh(),
      ),
    );
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      onDidChangePageChrome(() => {
        this.renderHtml();
        this.refresh();
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
      followIndexing(this.indexer, (message) => void panel.webview.postMessage(message)),
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

    if (message.type === 'createMissingNotes') {
      await this.createMissingNotes(message.names);
      return;
    }

    const section = [...index.sections.values()].find(
      (candidate) =>
        candidate.filePath === message.filePath &&
        candidate.startLine === message.line,
    );
    if (section) {
      await openResultAt(section.filePath, section.startLine, message);
      await this.preferences.recordSectionAccess(section.id);
      return;
    }
    // A note listed whole, such as one nothing links to, opens without
    // counting as a view of one of its entries.
    if (index.files.has(message.filePath)) {
      await openResultAt(message.filePath, message.line, message);
    }
  }

  /**
   * Makes the notes links name and no note carries. The names are read
   * again from the index as it is now, so only a name still missing and
   * able to be a file name is made; each goes in the notes folder of the
   * workspace folder its first link is in. Creating every one is confirmed
   * first.
   */
  private async createMissingNotes(requested: readonly string[]): Promise<void> {
    const wanted = new Set(requested.map((name) => name.toLocaleLowerCase()));
    const missing = findMissingLinkTargets(this.indexer.getSnapshot()).filter(
      (target) =>
        getExtractedNoteFileName(target.name) !== undefined &&
        (wanted.size === 0 || wanted.has(target.key)),
    );
    if (missing.length === 0) {
      return;
    }
    if (wanted.size === 0) {
      const create = 'Create';
      const choice = await vscode.window.showWarningMessage(
        `Create ${missing.length} ${missing.length === 1 ? 'note' : 'notes'} for links that open no note?`,
        {
          modal: true,
          detail: 'Each is an empty note named as the links write it, in the notes folder.',
        },
        create,
      );
      if (choice !== create) {
        return;
      }
    }
    const byFolder = new Map<string, { uri: vscode.Uri; names: string[] }>();
    for (const target of missing) {
      const uri = await resolveSourceUri(target.sourcePaths[0]);
      if (!uri) {
        continue;
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? '';
      const group = byFolder.get(folder) ?? { uri, names: [] };
      group.names.push(target.name);
      byFolder.set(folder, group);
    }
    if (byFolder.size === 0) {
      return;
    }
    let created = 0;
    for (const group of byFolder.values()) {
      created += await createMissingNotes(this.indexer, group.uri, group.names, { report: false });
    }
    reportCreatedNotes(created);
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
          this.indexer.getUnreadable(),
        ),
      ),
    });
  }
}
