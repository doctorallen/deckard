import * as vscode from 'vscode';

import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { PreferencesStore } from '../../core/storage/preferences';
import { DashboardMessage, DashboardSnapshot } from '../../core/types';
import { createDashboardSnapshot } from '../state/dashboardState';
import { toggleTask } from '../commands/taskActions';
import { openSourceAt } from '../commands/navigation';
import { parseDashboardMessage } from './messages';
import { getDashboardHtml } from './dashboardHtml';

/**
 * Owns the dashboard webview and translates validated UI messages into domain
 * actions while keeping filters local to the panel instance.
 */
export class DashboardPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private taskFilter: DashboardSnapshot['taskFilter'] = 'active';
  private selectedTaskTags: string[] = [];

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly onOpenTag: (tagKey: string) => void,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
  }

  /**
   * Reveals or creates the dashboard, waiting for the initial index first.
   */
  public async show(): Promise<void> {
    if (!this.panel) {
      this.createPanel();
    }

    this.panel?.reveal(vscode.ViewColumn.Active);
    await this.indexer.ready;
    this.refresh();
  }

  /**
   * Reattaches a serialized panel without creating a duplicate dashboard.
   */
  public async restore(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }

    this.attachPanel(panel);
    await this.indexer.ready;
    this.refresh();
  }

  /**
   * Releases panel listeners and shared subscriptions owned by the dashboard.
   */
  public dispose(): void {
    this.disposePanelListeners();
    this.panel?.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Creates the dashboard with retained state and the VS Code find widget.
   */
  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      'deckard.dashboard',
      'Deckard Dashboard',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
      },
    );
    this.attachPanel(panel);
  }

  /**
   * Attaches the common webview HTML and listeners to new or restored panels.
   */
  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'deckard.svg',
    );
    panel.webview.options = { enableScripts: true };
    panel.webview.html = getDashboardHtml(panel.webview);
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

  /**
   * Removes only listeners tied to the current panel instance.
   */
  private disposePanelListeners(): void {
    this.panelDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  /**
   * Sends a fresh projection whenever index or persisted preferences change.
   */
  private refresh(): void {
    if (!this.panel) {
      return;
    }

    const snapshot = createDashboardSnapshot(
      this.indexer.getSnapshot(),
      this.preferences.value,
      this.taskFilter,
      this.selectedTaskTags,
    );
    void this.panel.webview.postMessage({ type: 'state', data: snapshot });
  }

  /**
   * Rejects malformed webview payloads before invoking the action dispatcher.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseDashboardMessage(value);
    if (!message) {
      return;
    }

    await this.handleValidMessage(message);
  }

  /**
   * Revalidates current index membership before navigation or persistence.
   *
   * A webview may hold a stale snapshot after a note changes, so validation here
   * prevents old IDs and paths from mutating unrelated current state.
   */
  private async handleValidMessage(message: DashboardMessage): Promise<void> {
    const index = this.indexer.getSnapshot();

    switch (message.type) {
      case 'openSource':
        // Only open a line that still identifies an indexed task.
        if (
          [...index.tasks.values()].some(
            (task) =>
              task.filePath === message.filePath &&
              task.lineNumber === message.line,
          )
        ) {
          await openSourceAt(message.filePath, message.line);
        }
        return;
      case 'toggleTask': {
        const task = index.tasks.get(message.taskId);
        if (task) {
          await toggleTask(task, message.completed);
        }
        return;
      }
      case 'toggleFavorite':
        if (index.tags.has(message.tagKey)) {
          await this.preferences.toggleFavorite(message.tagKey);
        }
        return;
      case 'setTagSort':
        await this.preferences.setTagSortMode(message.mode);
        return;
      case 'setTaskFilter':
        this.taskFilter = message.filter;
        this.refresh();
        return;
      case 'setTaskTags': {
        const availableTags = new Set(
          [...index.tags.values()]
            .filter((tag) => tag.taskIds.length > 0)
            .map((tag) => tag.key),
        );
        this.selectedTaskTags = [
          ...new Set(
            message.tagKeys.filter((tagKey) => availableTags.has(tagKey)),
          ),
        ];
        this.refresh();
        return;
      }
      case 'setTaskSort':
        await this.preferences.setTaskSortMode(message.mode);
        return;
      case 'reorderTasks':
        if (this.preferences.value.taskSortMode === 'rank') {
          await this.preferences.setTaskOrder(
            mergeOrder(message.taskIds, index.tasks.keys()),
          );
        }
        return;
      case 'reorderTags':
        if (
          this.preferences.value.tagSortMode === 'custom' &&
          index.tags.has(message.tagKey)
        ) {
          const favoriteTags = new Set(this.preferences.value.favoriteTags);
          if (message.isFavorite) {
            favoriteTags.add(message.tagKey);
          } else {
            favoriteTags.delete(message.tagKey);
          }
          await this.preferences.setTagAccessOrderAndFavorites(
            mergeOrder(message.tagKeys, index.tags.keys()),
            [...favoriteTags],
          );
        }
        return;
      case 'openTag':
        if (index.tags.has(message.tagKey)) {
          this.onOpenTag(message.tagKey);
        }
        return;
    }
  }
}

/**
 * Merges a requested order with current IDs so a stale drag result cannot lose
 * entries created or removed since the webview rendered its list.
 */
function mergeOrder(
  requested: string[],
  available: Iterable<string>,
): string[] {
  const availableIds = [...available];
  const availableSet = new Set(availableIds);
  const requestedIds = requested.filter((id) => availableSet.has(id));
  const requestedSet = new Set(requestedIds);
  return [
    ...requestedIds,
    ...availableIds.filter((id) => !requestedSet.has(id)),
  ];
}
