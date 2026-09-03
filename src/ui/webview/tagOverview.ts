import * as vscode from 'vscode';

import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { PreferencesStore } from '../../core/storage/preferences';
import { TagOverviewMessage } from '../../core/types';
import { createTagOverviewSnapshot } from '../state/dashboardState';
import { openSourceAt } from '../commands/navigation';
import { parseTagOverviewMessage } from './messages';
import { getTagOverviewHtml } from './tagOverviewHtml';

/**
 * Manages one reusable panel per tag and exposes the active tag to the sidebar.
 *
 * Panel identity is keyed by canonical tag key so links can switch context
 * without opening duplicate overview tabs.
 */
export class TagOverviewPanels implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panels = new Map<string, TagOverviewPanel>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private activeTagKey: string | undefined;

  public readonly onDidChange = this.changeEmitter.event;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.disposables.push(this.changeEmitter);
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
  }

  /**
   * Returns the tag whose overview currently drives the sidebar.
   */
  public getActiveTagKey(): string | undefined {
    return this.activeTagKey;
  }

  /**
   * Records access only for current tags, then reveals the shared panel instance.
   */
  public async show(tagKey: string): Promise<void> {
    await this.indexer.ready;
    if (!this.indexer.getSnapshot().tags.has(tagKey)) {
      void vscode.window.showWarningMessage(
        `Deckard could not find the tag: ${tagKey}`,
      );
      return;
    }
    await this.preferences.recordTagAccess(tagKey);

    let panel = this.panels.get(tagKey);
    if (!panel) {
      panel = this.createPanel(tagKey);
    }
    panel.show();
    this.setActiveTagKey(tagKey);
  }

  /**
   * Restores a serialized panel only when its tag still exists in the index.
   */
  public async restore(
    webviewPanel: vscode.WebviewPanel,
    state: unknown,
  ): Promise<void> {
    await this.indexer.ready;
    const tagKey = getSerializedTagKey(state);
    if (!tagKey || !this.indexer.getSnapshot().tags.has(tagKey)) {
      webviewPanel.dispose();
      return;
    }

    const existingPanel = this.panels.get(tagKey);
    if (existingPanel) {
      webviewPanel.dispose();
      existingPanel.show();
      return;
    }

    const panel = this.createPanel(tagKey);
    panel.restore(webviewPanel);
    if (webviewPanel.active) {
      this.setActiveTagKey(tagKey);
    }
  }

  /**
   * Releases the registry event source and every panel it owns.
   */
  public dispose(): void {
    this.setActiveTagKey(undefined);
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    this.panels.forEach((panel) => panel.dispose());
    this.panels.clear();
  }

  /**
   * Refreshes surviving panels and removes overviews for deleted tags.
   */
  private refresh(): void {
    const index = this.indexer.getSnapshot();
    this.panels.forEach((panel, tagKey) => {
      if (index.tags.has(tagKey)) {
        panel.refresh();
      } else {
        panel.dispose();
        this.removePanel(tagKey);
      }
    });
    this.changeEmitter.fire();
  }

  /**
   * Creates the private panel with callbacks back into the panel registry.
   */
  private createPanel(tagKey: string): TagOverviewPanel {
    const panel = new TagOverviewPanel(
      tagKey,
      this.indexer,
      this.preferences,
      this.extensionUri,
      () => this.removePanel(tagKey),
      (nextTagKey) => this.show(nextTagKey),
      (active) => this.handlePanelActivity(tagKey, active),
    );
    this.panels.set(tagKey, panel);
    return panel;
  }

  /**
   * Removes registry state when a panel closes or its tag disappears.
   */
  private removePanel(tagKey: string): void {
    this.panels.delete(tagKey);
    if (this.activeTagKey === tagKey) {
      this.setActiveTagKey(undefined);
    }
  }

  /**
   * Keeps sidebar state aligned with which overview is visibly active.
   */
  private handlePanelActivity(tagKey: string, active: boolean): void {
    if (active) {
      this.setActiveTagKey(tagKey);
    } else if (this.activeTagKey === tagKey) {
      this.setActiveTagKey(undefined);
    }
  }

  /**
   * Emits only meaningful active-tag transitions to avoid sidebar churn.
   */
  private setActiveTagKey(tagKey: string | undefined): void {
    if (this.activeTagKey === tagKey) {
      return;
    }
    this.activeTagKey = tagKey;
    this.changeEmitter.fire();
  }
}

/**
 * Owns the webview mechanics for one canonical tag overview.
 */
class TagOverviewPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;

  public constructor(
    private readonly tagKey: string,
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly onDispose: () => void,
    private readonly onOpenTag: (tagKey: string) => Promise<void>,
    private readonly onViewStateChange: (active: boolean) => void,
  ) {}

  /**
   * Creates or reveals the panel, then projects the latest overview state.
   */
  public show(): void {
    if (!this.panel) {
      const tagLabel =
        this.indexer.getSnapshot().tags.get(this.tagKey)?.label ?? this.tagKey;
      const panel = vscode.window.createWebviewPanel(
        'deckard.tagOverview',
        `${tagLabel} Overview`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          enableFindWidget: true,
        },
      );
      this.attachPanel(panel);
    }

    this.panel?.reveal(vscode.ViewColumn.Active);
    this.refresh();
  }

  /**
   * Reuses a serialized panel after the registry has validated its tag key.
   */
  public restore(panel: vscode.WebviewPanel): void {
    if (this.panel) {
      panel.dispose();
      return;
    }

    this.attachPanel(panel);
    this.refresh();
  }

  /**
   * Sends the current tag snapshot without retaining mutable UI state locally.
   */
  public refresh(): void {
    if (!this.panel) {
      return;
    }

    const snapshot = createTagOverviewSnapshot(
      this.indexer.getSnapshot(),
      this.preferences.value,
      this.tagKey,
    );
    if (snapshot) {
      void this.panel.webview.postMessage({ type: 'state', data: snapshot });
    }
  }

  /**
   * Releases webview listeners and the panel itself.
   */
  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    this.panel?.dispose();
    this.panel = undefined;
  }

  /**
   * Installs HTML, lifecycle listeners, and the message boundary for the panel.
   */
  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'deckard.svg',
    );
    panel.webview.options = { enableScripts: true };
    panel.webview.html = getTagOverviewHtml(panel.webview);
    this.disposables.push(
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.onDispose();
        this.dispose();
      }),
    );
    this.disposables.push(
      panel.onDidChangeViewState(() => this.onViewStateChange(panel.active)),
    );
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    );
    this.onViewStateChange(panel.active);
  }

  /**
   * Validates raw webview input before dispatching any overview action.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseTagOverviewMessage(value);
    if (!message) {
      return;
    }

    await this.handleValidMessage(message);
  }

  /**
   * Rechecks tag/card membership against the current index before navigation.
   */
  private async handleValidMessage(message: TagOverviewMessage): Promise<void> {
    if (message.type === 'openTag') {
      if (this.indexer.getSnapshot().tags.has(message.tagKey)) {
        await this.onOpenTag(message.tagKey);
      }
      return;
    }

    if (message.type === 'setRenderMode') {
      await this.preferences.setRenderMode(message.mode);
      return;
    }
    if (message.type === 'setTagOverviewSort') {
      await this.preferences.setTagOverviewSortMode(message.mode);
      return;
    }
    if (message.type !== 'openSource') {
      return;
    }

    const snapshot = createTagOverviewSnapshot(
      this.indexer.getSnapshot(),
      this.preferences.value,
      this.tagKey,
    );
    const card = snapshot?.sections.find(
      (section) =>
        section.filePath === message.filePath &&
        section.startLine === message.line,
    );
    if (card) {
      await this.preferences.recordSectionAccess(card.id);
      await openSourceAt(card.filePath, card.startLine);
    }
  }
}

/**
 * Extracts the serialized tag key while rejecting malformed serializer state.
 */
function getSerializedTagKey(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined;
  }

  const tagKey = (state as { tagKey?: unknown }).tagKey;
  return typeof tagKey === 'string' && tagKey.length > 0 ? tagKey : undefined;
}
