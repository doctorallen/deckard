import * as vscode from 'vscode';

import { parseQuery } from '../../core/query/queryParser';
import { TaskBoardGroupBy } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { openSourceAt } from '../commands/navigation';
import { toggleTask } from '../commands/taskActions';
import {
  moveTaskToColumn,
  readTaskBoardOptions,
} from '../commands/taskBoardActions';
import { createTaskBoard } from '../state/taskBoardState';
import { isTaskBoardGroupBy, parseTaskBoardMessage } from './messages';
import { getTaskBoardHtml } from './taskBoardHtml';

/**
 * Shows tasks as a Kanban board, and turns a card moved between columns into
 * an edit to its task line.
 *
 * The page moves a dropped card at once; the host then writes the change,
 * and the reindex that follows sends the saved state back. A move that cannot
 * be written refreshes the board, which puts the card back.
 */
export class TaskBoardPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private groupBy: TaskBoardGroupBy = 'status';
  private query = '';
  private queryError: string | undefined;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly extensionUri: vscode.Uri,
    private readonly openTag: (tagKey: string) => Promise<void>,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          // The page reloads and asks for state again when it is ready.
          this.renderHtml();
        } else if (
          event.affectsConfiguration('deckard.board') ||
          event.affectsConfiguration('deckard.tasks')
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
   * Reopens a board VS Code kept across a reload, with its grouping and query.
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
      const saved = state as { groupBy?: unknown; query?: unknown };
      if (isTaskBoardGroupBy(saved.groupBy)) {
        this.groupBy = saved.groupBy;
      }
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
    void this.panel.webview.postMessage({
      type: 'state',
      data: createTaskBoard(
        this.indexer.getSnapshot(),
        this.groupBy,
        this.query,
        readTaskBoardOptions(),
        this.queryError,
      ),
    });
  }

  /**
   * Applies a query, or keeps the previous one and reports why a query that
   * does not parse could not be used.
   */
  private applyQuery(text: string): void {
    const query = text.trim();
    if (!query) {
      this.query = '';
      this.queryError = undefined;
      return;
    }
    const parsed = parseQuery(query);
    if (parsed.node) {
      this.query = query;
      this.queryError = undefined;
      return;
    }
    this.queryError =
      parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
        ?.message ?? 'Deckard could not read this query.';
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
        this.groupBy = message.groupBy;
        this.refresh();
        return;
      case 'setBoardQuery':
        this.applyQuery(message.query);
        this.refresh();
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
