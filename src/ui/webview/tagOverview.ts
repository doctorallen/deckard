import * as vscode from 'vscode';

import { formatEntityTitle } from '../../core/markdown/parser';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { PreferencesStore } from '../../core/storage/preferences';
import {
  TagOverviewMessage,
  TagTitleDisplayMode,
  TaskFilter,
} from '../../core/types';
import {
  createTagOverviewSnapshot,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { openSourceAt } from '../commands/navigation';
import { renameIndexedTag } from '../commands/renameTag';
import { toggleTask } from '../commands/taskActions';
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
  private activeFilterTagKey: string | undefined;

  public readonly onDidChange = this.changeEmitter.event;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.disposables.push(this.changeEmitter);
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.activeTagKey) {
          this.setActiveTagOverview(undefined, undefined);
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          this.panels.forEach((panel) => panel.renderHtml());
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
      }),
    );
  }

  /**
   * Returns the tag whose overview currently drives the sidebar.
   */
  public getActiveTagKey(): string | undefined {
    return this.activeTagKey;
  }

  /**
   * Returns the optional relationship filter for the active overview.
   */
  public getActiveTagFilterKey(): string | undefined {
    return this.activeFilterTagKey;
  }

  /**
   * Returns whether the selected editor tab is a Deckard Tag Overview.
   */
  public isActive(): boolean {
    const input =
      vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;
    return Boolean(
      this.activeTagKey && isDeckardTagOverviewInput(input),
    );
  }

  /**
   * Records access only for current tags, then reveals the shared panel instance.
   */
  public async show(
    tagKey: string,
    filterTagKey?: string,
  ): Promise<void> {
    await this.indexer.ready;
    const index = this.indexer.getSnapshot();
    const canonicalTagKey = resolveIndexedTagKey(index.tags, tagKey);
    if (!canonicalTagKey) {
      void vscode.window.showWarningMessage(
        `Deckard could not find the tag: ${tagKey}`,
      );
      return;
    }
    const resolvedFilterTagKey = filterTagKey
      ? resolveIndexedTagKey(index.tags, filterTagKey)
      : undefined;
    const effectiveFilterTagKey =
      resolvedFilterTagKey && resolvedFilterTagKey !== canonicalTagKey
        ? resolvedFilterTagKey
        : undefined;
    await this.preferences.recordTagAccess(canonicalTagKey);
    if (index.entities.has(canonicalTagKey)) {
      await this.preferences.recordEntityAccess(canonicalTagKey);
    }

    let panel = this.panels.get(canonicalTagKey);
    if (!panel) {
      panel = this.createPanel(canonicalTagKey);
    }
    panel.setFilterTagKey(effectiveFilterTagKey);
    panel.show();
    this.setActiveTagOverview(canonicalTagKey, effectiveFilterTagKey);
  }

  /**
   * Restores a serialized panel only when its tag still exists in the index.
   */
  public async restore(
    webviewPanel: vscode.WebviewPanel,
    state: unknown,
  ): Promise<void> {
    await this.indexer.ready;
    const index = this.indexer.getSnapshot();
    const serializedTagKey = getSerializedTagKey(state);
    const tagKey = serializedTagKey
      ? resolveIndexedTagKey(index.tags, serializedTagKey)
      : undefined;
    if (!tagKey) {
      webviewPanel.dispose();
      return;
    }
    const serializedFilterTagKey = getSerializedFilterTagKey(state);
    const filterTagKey = serializedFilterTagKey
      ? resolveIndexedTagKey(index.tags, serializedFilterTagKey)
      : undefined;

    const existingPanel = this.panels.get(tagKey);
    if (existingPanel) {
      webviewPanel.dispose();
      existingPanel.setFilterTagKey(
        filterTagKey && filterTagKey !== tagKey ? filterTagKey : undefined,
      );
      existingPanel.show();
      if (webviewPanel.active) {
        this.setActiveTagOverview(tagKey, existingPanel.getFilterTagKey());
      }
      return;
    }

    const panel = this.createPanel(tagKey);
    panel.setFilterTagKey(
      filterTagKey && filterTagKey !== tagKey ? filterTagKey : undefined,
    );
    panel.restore(webviewPanel);
    if (webviewPanel.active) {
      this.setActiveTagOverview(tagKey, panel.getFilterTagKey());
    }
  }

  /**
   * Releases the registry event source and every panel it owns.
   */
  public dispose(): void {
    this.setActiveTagOverview(undefined, undefined);
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
      (nextTagKey, filterTagKey) => this.show(nextTagKey, filterTagKey),
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
      this.setActiveTagOverview(undefined, undefined);
    }
  }

  /**
   * Keeps sidebar state aligned with which overview is visibly active.
   */
  private handlePanelActivity(tagKey: string, active: boolean): void {
    if (active) {
      this.setActiveTagOverview(
        tagKey,
        this.panels.get(tagKey)?.getFilterTagKey(),
      );
    } else if (this.activeTagKey === tagKey) {
      this.setActiveTagOverview(undefined, undefined);
    }
  }

  /**
   * Emits only meaningful active-overview transitions to avoid sidebar churn.
   */
  private setActiveTagOverview(
    tagKey: string | undefined,
    filterTagKey: string | undefined,
  ): void {
    if (
      this.activeTagKey === tagKey &&
      this.activeFilterTagKey === filterTagKey
    ) {
      return;
    }
    this.activeTagKey = tagKey;
    this.activeFilterTagKey = filterTagKey;
    this.changeEmitter.fire();
  }
}

/**
 * Owns the webview mechanics for one canonical tag overview.
 */
class TagOverviewPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private taskFilter: TaskFilter = 'active';
  private filterTagKey: string | undefined;

  public constructor(
    private readonly tagKey: string,
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly onDispose: () => void,
    private readonly onOpenTag: (
      tagKey: string,
      filterTagKey?: string,
    ) => Promise<void>,
    private readonly onViewStateChange: (active: boolean) => void,
  ) {}

  public setFilterTagKey(filterTagKey: string | undefined): void {
    this.filterTagKey = filterTagKey;
  }

  public getFilterTagKey(): string | undefined {
    return this.filterTagKey;
  }

  /**
   * Creates or reveals the panel, then projects the latest overview state.
   */
  public show(): void {
    if (!this.panel) {
      const tagLabel = getOverviewTitle(
        this.indexer.getSnapshot(),
        this.tagKey,
      );
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

    function getOverviewTitle(
      index: ReturnType<WorkspaceIndexer['getSnapshot']>,
      tagKey: string,
    ): string {
      const entity = index.entities.get(tagKey);
      if (entity) {
        return formatEntityTitle(entity.kind, entity.name);
      }
      return `${index.tags.get(tagKey)?.label ?? tagKey} Overview`;
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
      this.taskFilter,
      this.getTagTitleDisplayMode(),
      this.areHeadingTagRelationshipsEnabled(),
      this.filterTagKey,
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
    this.renderHtml();
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

  public renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getTagOverviewHtml(this.panel.webview);
    }
  }

  private getTagTitleDisplayMode(): TagTitleDisplayMode {
    return normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
  }

  private areHeadingTagRelationshipsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('enableHeadingTagRelationships', true);
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

    if (message.type === 'openTag') {
      const tagKey = resolveIndexedTagKey(
        this.indexer.getSnapshot().tags,
        message.tagKey,
      );
      if (tagKey) {
        const filterTagKey = message.filterTagKey
          ? resolveIndexedTagKey(
              this.indexer.getSnapshot().tags,
              message.filterTagKey,
            )
          : undefined;
        await this.onOpenTag(
          tagKey,
          filterTagKey && filterTagKey !== tagKey ? filterTagKey : undefined,
        );
      }
      return;
    }

    if (message.type === 'setRenderMode') {
      await this.preferences.setRenderMode(message.mode);
      return;
    }
    if (message.type === 'setTaskFilter') {
      this.taskFilter = message.filter;
      this.refresh();
      return;
    }
    if (message.type === 'setTagOverviewSort') {
      await this.preferences.setTagOverviewSortMode(message.mode);
      return;
    }
    if (message.type === 'setTagOverviewLayout') {
      await this.preferences.setTagOverviewLayout(message.layout);
      return;
    }
    if (message.type === 'toggleTask') {
      const task = createTagOverviewSnapshot(
        this.indexer.getSnapshot(),
        this.preferences.value,
        this.tagKey,
        this.taskFilter,
        this.getTagTitleDisplayMode(),
        this.areHeadingTagRelationshipsEnabled(),
        this.filterTagKey,
      )?.tasks.find((candidate) => candidate.task.id === message.taskId)?.task;
      if (task) {
        await toggleTask(task, message.completed);
      }
      return;
    }
    if (message.type !== 'openSource') {
      return;
    }

    const snapshot = createTagOverviewSnapshot(
      this.indexer.getSnapshot(),
      this.preferences.value,
      this.tagKey,
      this.taskFilter,
      this.getTagTitleDisplayMode(),
      this.areHeadingTagRelationshipsEnabled(),
      this.filterTagKey,
    );
    const card = snapshot?.sections.find(
      (section) =>
        section.filePath === message.filePath &&
        section.startLine === message.line,
    );
    if (card) {
      await this.preferences.recordSectionAccess(card.id);
      await openSourceAt(card.filePath, card.startLine);
      return;
    }
    const task = snapshot?.tasks.find(
      (candidate) =>
        candidate.task.filePath === message.filePath &&
        candidate.task.lineNumber === message.line,
    );
    if (task) {
      await openSourceAt(task.task.filePath, task.task.lineNumber);
    }
  }
}

/**
 * Identifies the active tab shape without depending on a runtime VS Code class.
 */
function isDeckardTagOverviewInput(
  input: vscode.Tab['input'] | undefined,
): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    'viewType' in input &&
    input.viewType === 'deckard.tagOverview'
  );
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

function getSerializedFilterTagKey(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined;
  }

  const filterTagKey = (state as { filterTagKey?: unknown }).filterTagKey;
  return typeof filterTagKey === 'string' && filterTagKey.length > 0
    ? filterTagKey
    : undefined;
}
