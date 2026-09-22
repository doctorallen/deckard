import * as vscode from 'vscode';

import { parseQuery } from '../../core/query/queryParser';
import { PreferencesStore } from '../../core/storage/preferences';
import { measure } from '../../core/timing';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { SearchRefineState, TaskBoardSnapshot } from '../../core/types';
import { openSourceAt } from '../commands/navigation';
import { toggleTask } from '../commands/taskActions';
import {
  moveTaskToColumn,
  readTaskBoardOptions,
  updateTaskBoardSetting,
} from '../commands/taskBoardActions';
import { writeSetting } from '../commands/settings';
import {
  mergeOrder,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { normalizeAgendaQuery } from '../state/agendaState';
import { createTaskBoard } from '../state/taskBoardState';
import { ActiveSearch, SearchSource } from './activeSearch';
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
/** What the Task Board searches for until it is told otherwise. */
export const DEFAULT_TASK_BOARD_QUERY = 'is:open';

export class TaskBoardPanel implements SearchSource, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  /**
   * The search the board opens on. A board is for what is still to do, so
   * it starts there and says so in its box, where it can be cleared or
   * changed like any other search.
   */
  private query = DEFAULT_TASK_BOARD_QUERY;
  /** A search typed that does not parse, shown with its error. */
  private invalidQuery: string | undefined;
  /** Whether the index changed while the panel was hidden. */
  private isStale = false;
  /** Whether the last state sent put Refine in the sidebar. */
  private refineWasInSidebar = false;
  private lastSnapshot: TaskBoardSnapshot | undefined;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly openTag: (tagKey: string) => Promise<void>,
    private readonly activeSearch: ActiveSearch,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      activeSearch.onDidChangeRefineVisibility(() => {
        if (activeSearch.isRefineInSidebar(this) !== this.refineWasInSidebar) {
          this.refresh();
        }
      }),
    );
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

  /**
   * Opens the board, on a search when one is given, such as the one a Home
   * widget lists.
   */
  public async show(query?: string): Promise<void> {
    if (query !== undefined) {
      this.applyQuery(query);
    }
    if (!this.panel) {
      this.createPanel();
    }
    this.panel?.reveal(vscode.ViewColumn.Active);
    await this.indexer.ready;
    this.refresh();
  }

  public getRefineState(): SearchRefineState | undefined {
    const snapshot = this.lastSnapshot ?? this.createSnapshot();
    return {
      page: 'taskBoard',
      title: 'Task Board',
      query: snapshot.query,
      resultKinds: ['tasks'],
    };
  }

  public async applySearch(queryText: string): Promise<void> {
    const applied = this.applyQuery(queryText);
    this.refresh();
    if (applied && this.query) {
      await this.preferences.recordRecentQuery(this.query);
    }
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
    this.activeSearch.release(this);
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
        this.lastSnapshot = undefined;
        this.activeSearch.release(this);
        this.disposePanelListeners();
      }),
      panel.webview.onDidReceiveMessage((message) =>
        this.handleMessage(message),
      ),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
        this.updateActivity(panel.active);
      }),
    ];
    this.updateActivity(panel.active);
  }

  private updateActivity(active: boolean): void {
    if (active) {
      this.activeSearch.setActive(this);
    } else {
      this.activeSearch.release(this);
    }
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
    const snapshot = measure('Task board', () => this.createSnapshot());
    this.lastSnapshot = snapshot;
    this.refineWasInSidebar = snapshot.refineInSidebar === true;
    void this.panel.webview.postMessage({ type: 'state', data: snapshot });
    this.activeSearch.notifyChanged(this);
  }

  /**
   * Whether the Done column is showing every completed task. It holds the
   * most recent handful otherwise, and the column says how many are left.
   */
  private showEveryDoneTask = false;

  private createSnapshot(): TaskBoardSnapshot {
    const tagTitleDisplayMode = normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
    return {
      ...createTaskBoard(
        this.indexer.getSnapshot(),
        this.preferences.value,
        { query: this.query, invalidQuery: this.invalidQuery },
        {
          ...readTaskBoardOptions(),
          ...(this.showEveryDoneTask
            ? { doneLimit: Number.MAX_SAFE_INTEGER }
            : {}),
        },
        tagTitleDisplayMode,
      ),
      refineInSidebar: this.activeSearch.isRefineInSidebar(this),
      agendaListsThisSearch:
        normalizeAgendaQuery(
          vscode.workspace
            .getConfiguration('deckard')
            .get<string>('agenda.query', ''),
        ) === normalizeAgendaQuery(this.query),
    };
  }

  /**
   * Makes the Tasks view list this search. The board is where a search is
   * tried with its results in view, so this is how the view's search is
   * edited: open it here, change it, keep it.
   */
  private async useSearchForAgenda(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('deckard');
    const query = normalizeAgendaQuery(this.query);
    if (normalizeAgendaQuery(configuration.get<string>('agenda.query', '')) === query) {
      void vscode.window.showInformationMessage(
        'The Tasks view lists this search already.',
      );
      return;
    }
    // The value goes where it is already set, as the board's own settings do.
    const target =
      configuration.inspect('agenda.query')?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    if (await writeSetting('agenda.query', query, target, configuration)) {
      void vscode.window.showInformationMessage(
        query
          ? `The Tasks view lists "${query}" now.`
          : 'The Tasks view lists every open task now.',
      );
      this.refresh();
    }
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
   * Names the board's search and keeps it as a saved view that reopens here.
   */
  private async saveSearch(): Promise<void> {
    const query = this.query.trim();
    if (!query) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: 'Save this search',
      prompt: 'Name this Task Board search',
      value: query,
      validateInput: (value) =>
        value.trim() ? undefined : 'A saved filter needs a name.',
    });
    if (name === undefined) {
      return;
    }
    const saved = await this.preferences.saveSavedQueryFilter(
      name,
      query,
      'taskBoard',
    );
    if (saved) {
      void vscode.window.showInformationMessage(
        `Saved the search "${saved.name}".`,
      );
    }
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
      case 'openHelp':
        await vscode.commands.executeCommand('deckard.showHelp');
        return;
      case 'setBoardGroup':
        // A different grouping is a different board, so the Done column goes
        // back to its short form.
        this.showEveryDoneTask = false;
        await this.preferences.setTaskBoardGroup(message.groupBy);
        return;
      case 'showColumnRest':
        this.showEveryDoneTask = true;
        this.refresh();
        return;
      case 'setTaskLayout':
        await this.preferences.setTaskBoardLayout(message.layout);
        return;

      case 'setTaskSort':
        await this.preferences.setTaskSortMode(message.mode);
        return;
      case 'setTableSort': {
        // The same column again turns the sort round; none is the rank order.
        const current = this.preferences.value.taskTableSort;
        await this.preferences.setTaskTableSort(
          message.column === undefined
            ? undefined
            : {
                column: message.column,
                direction:
                  current?.column === message.column && current.direction === 'asc'
                    ? 'desc'
                    : 'asc',
              },
        );
        return;
      }
      case 'setTableColumns':
        await this.preferences.setTaskTableColumns(message.columns);
        return;
      case 'reorderTasks':
        if (this.preferences.value.taskSortMode === 'rank') {
          await this.preferences.setTaskOrder(
            mergeOrder(message.taskIds, index.tasks.keys()),
          );
        }
        return;
      case 'setBoardQuery':
        await this.applySearch(message.query);
        return;
      case 'saveBoardSearch':
        await this.saveSearch();
        return;
      case 'useSearchForAgenda':
        await this.useSearchForAgenda();
        return;
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
