import * as vscode from 'vscode';

import { parseQuery } from '../../core/query/queryParser';
import { PreferencesStore } from '../../core/storage/preferences';
import { measure } from '../../core/timing';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { openSourceAt } from '../commands/navigation';
import { toggleTask } from '../commands/taskActions';
import {
  moveTaskToColumn,
  readTaskBoardOptions,
  updateTaskBoardSetting,
} from '../commands/taskBoardActions';
import {
  mergeOrder,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { createTaskBoard } from '../state/taskBoardState';
import { parseTaskBoardMessage } from './messages';
import { getTaskBoardHtml } from './taskBoardHtml';

/**
 * Shows tasks as a Kanban board or as a list, narrowed by the search box
 * every search page shares, and turns a card moved between columns into an
 * edit to its task line.
 *
 * The page moves a dropped card at once; the host then writes the change,
 * and the reindex that follows sends the saved state back. A move that cannot
 * be written refreshes the board, which puts the card back.
 */
export class TaskBoardPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private query = '';
  /** A search typed that does not parse, shown with its error. */
  private invalidQuery: string | undefined;
  /** Whether the index changed while the panel was hidden. */
  private isStale = false;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly openTag: (tagKey: string) => Promise<void>,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          // The page reloads and asks for state again when it is ready.
          this.renderHtml();
        } else if (
          event.affectsConfiguration('deckard.board') ||
          event.affectsConfiguration('deckard.tasks') ||
          event.affectsConfiguration('deckard.tagTitleDisplayMode')
        ) {
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

  /**
   * Reopens a board VS Code kept across a reload, with its search.
   */
  public async restore(
    panel: vscode.WebviewPanel,
    state: unknown,
  ): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }
    if (typeof state === 'object' && state !== null) {
      const saved = state as { query?: unknown };
      if (typeof saved.query === 'string') {
        this.applyQuery(saved.query);
      }
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
      'deckard.taskBoard',
      'Deckard Task Board',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
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
      panel.webview.onDidReceiveMessage((message) =>
        this.handleMessage(message),
      ),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
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
      this.panel.webview.html = getTaskBoardHtml(this.panel.webview);
    }
  }

  private refresh(): void {
    if (!this.panel) {
      return;
    }
    // A hidden board keeps its cards and catches up when shown again.
    if (!this.panel.visible) {
      this.isStale = true;
      return;
    }
    this.isStale = false;
    const tagTitleDisplayMode = normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
    void this.panel.webview.postMessage({
      type: 'state',
      data: measure('Task board', () =>
        createTaskBoard(
          this.indexer.getSnapshot(),
          this.preferences.value,
          { query: this.query, invalidQuery: this.invalidQuery },
          readTaskBoardOptions(),
          tagTitleDisplayMode,
        ),
      ),
    });
  }

  /**
   * Applies a search, or keeps the previous one and shows the search that
   * does not parse with its error, as a tag overview does.
   */
  private applyQuery(text: string): boolean {
    const query = text.trim();
    this.invalidQuery = undefined;
    if (query && !parseQuery(query).node) {
      this.invalidQuery = query;
      return false;
    }
    this.query = query;
    return true;
  }

  /**
   * Checks a message against the current index before acting, since the page
   * may still show a task that has since changed.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseTaskBoardMessage(value);
    if (!message) {
      return;
    }
    const index = this.indexer.getSnapshot();

    switch (message.type) {
      case 'ready':
        this.refresh();
        return;
      case 'setBoardGroup':
        await this.preferences.setTaskBoardGroup(message.groupBy);
        return;
      case 'setTaskLayout':
        await this.preferences.setTaskBoardLayout(message.layout);
        return;
      case 'setTaskFilter':
        await this.preferences.setTaskBoardTaskFilter(message.filter);
        return;
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
      case 'setBoardQuery': {
        const applied = this.applyQuery(message.query);
        this.refresh();
        if (applied && this.query) {
          await this.preferences.recordRecentQuery(this.query);
        }
        return;
      }
      case 'setBoardStatuses':
        await updateTaskBoardSetting('statuses', [
          ...new Set(message.statuses.map((status) => status.toLowerCase())),
        ]);
        return;
      case 'setBoardStatusNamespace':
        await updateTaskBoardSetting(
          'statusNamespace',
          message.namespace.toLowerCase(),
        );
        return;
      case 'openSource': {
        const known = [...index.tasks.values()].some(
          (task) =>
            task.filePath === message.filePath &&
            task.lineNumber === message.line,
        );
        if (known) {
          await openSourceAt(message.filePath, message.line);
        }
        return;
      }
      case 'openTag':
        if (index.tags.has(message.tagKey)) {
          await this.openTag(message.tagKey);
        }
        return;
      case 'toggleTask': {
        const task = index.tasks.get(message.taskId);
        if (!task || !(await toggleTask(task, message.completed))) {
          this.refresh();
        }
        return;
      }
      case 'moveTask': {
        const task = index.tasks.get(message.taskId);
        if (!task || !(await moveTaskToColumn(task, message.column))) {
          this.refresh();
        }
        return;
      }
    }
  }
}
