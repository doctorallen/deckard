import * as vscode from 'vscode';
import { moveTasks } from '../commands/moveTo';
import { breakIntoStepsCommand } from '../commands/taskSteps';
import { onDidChangePageChrome } from './components';
import { getDeckardTheme } from './themes';
import { ThemePreview } from './themePreview';
import { setZenMode } from './zenMode';

import { parseQuery } from '../../domain/query/queryParser';
import { PreferenceServices } from '../../core/storage/preferences';
import { measure } from '../../shared/timing';
import type { IndexReader, IndexScanStatus, IndexUpdates } from '../../core/workspace/indexReader';
import { SearchRefineState, TaskBoardSnapshot } from '../../core/types';
import { openResultAt } from '../commands/navigation';
import { presentExport } from '../commands/exportResults';
import type { ExportService } from '../../services/exportService';
import { formatQueryBlock, QueryBlockWriteOptions } from '../state/queryBlockState';
import {
  captureIntoColumn,
  moveTaskToColumn,
  readTaskBoardOptions,
  updateTaskBoardSetting,
} from '../commands/taskBoardActions';
import { askForDueDate, setTasksDue } from '../commands/agendaActions';
import { readQueryContext } from '../commands/queryContext';
import { openTask, quoteTaskTitle, TaskWrites, toggleTask } from '../commands/taskActions';
import { settingTarget, writeSetting } from '../commands/settings';
import {
  mergeOrder,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { normalizeAgendaQuery } from '../state/agendaState';
import { createTaskBoard } from '../state/taskBoardState';
import { ActiveSearch, SearchSource } from './activeSearch';
import { parseTaskBoardMessage } from './messages';
import { getTaskBoardHtml } from './taskBoardHtml';
import { offerSavedSearchOnHome } from '../commands/savedSearchHome';
import { followIndexing } from './indexingProgress';
import { onIndexUpdateInTurn, whenPublished } from '../../core/workspace/publishing';
import { panelPriority } from './panelPriority';

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

/**
 * The preference services the Task Board reads and writes: the blob it
 * draws, its layout and the rank order, saved and recent searches, the
 * offer of a saved search on Home, and the heading Move to… records.
 */
export type TaskBoardPreferences = Pick<
  PreferenceServices,
  'reader' | 'taskLayout' | 'savedSearches' | 'homeWidgets' | 'usage'
>;

/** What the Task board is built from. */
export interface TaskBoardPanelOptions {
  indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  preferences: TaskBoardPreferences;
  extensionUri: vscode.Uri;
  openTag: (tagKey: string) => Promise<void>;
  activeSearch: ActiveSearch;
  /** What a card's checkbox, drop, date, move, or steps write through. */
  writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /** What the board's Export plans its tasks with. */
  exports: ExportService;
}

/**
 * Whether a redraw would show the index a write started from: the write has
 * not come back through the index yet, so what it shows is what the reader
 * just changed away from.
 */
export function isAwaitingIndex(
  writeIndexAt: number | undefined,
  index: { updatedAt: number },
): boolean {
  return writeIndexAt !== undefined && index.updatedAt === writeIndexAt;
}

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

  private readonly indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  private readonly preferences: TaskBoardPreferences;
  private readonly extensionUri: vscode.Uri;
  private readonly openTag: (tagKey: string) => Promise<void>;
  private readonly activeSearch: ActiveSearch;
  /** What a card's checkbox, drop, date, move, or steps write through. */
  private readonly writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  private readonly themePreview: ThemePreview;
  /** What the board's Export plans its tasks with. */
  private readonly exports: ExportService;

  public constructor(options: TaskBoardPanelOptions) {
    this.indexer = options.indexer;
    this.preferences = options.preferences;
    this.extensionUri = options.extensionUri;
    this.openTag = options.openTag;
    this.activeSearch = options.activeSearch;
    this.writes = options.writes;
    this.themePreview = options.themePreview;
    this.exports = options.exports;
    const { indexer, preferences, activeSearch } = options;
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Task board', priority: () => panelPriority(this.panel) },
        () => {
          this.writeIndexAt = undefined;
          this.refresh();
        },
      ),
    );
    // A task write carries the task's rank into the preferences before the
    // index has read the note back, and a redraw from that index put a
    // dropped card back in its old column for a moment, then forward again.
    // The preferences change waits for the index the write is about to bring.
    this.disposables.push(
      preferences.reader.onDidChange(() => {
        if (isAwaitingIndex(this.writeIndexAt, this.indexer.getSnapshot())) {
          return;
        }
        this.refresh();
      }),
    );
    this.disposables.push(
      activeSearch.onDidChangeRefineVisibility(() => {
        if (activeSearch.isRefineInSidebar(this) !== this.refineWasInSidebar) {
          this.refresh();
        }
      }),
    );
    this.disposables.push(
      // The page reloads and asks for state again when it is ready.
      onDidChangePageChrome(() => this.renderHtml(), this.themePreview),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
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
    await whenPublished(this.indexer);
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
      await this.preferences.savedSearches.recordRecentQuery(this.query);
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
    await whenPublished(this.indexer);
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
      followIndexing(this.indexer, (message) => void panel.webview.postMessage(message)),
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
      this.panel.webview.html = getTaskBoardHtml(this.panel.webview, getDeckardTheme(this.themePreview));
    }
  }

  /** The index a task write started from, until the index has moved on. */
  private writeIndexAt: number | undefined;

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
   * The columns showing every card after "Show N more". An open column
   * draws its first hundred otherwise, and Done its most recent handful,
   * and each says how many are left.
   */
  private shownColumns = new Set<string>();

  private createSnapshot(): TaskBoardSnapshot {
    const tagTitleDisplayMode = normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
    return {
      ...createTaskBoard(
        this.indexer.getSnapshot(),
        this.preferences.reader.value,
        { query: this.query, invalidQuery: this.invalidQuery },
        {
          ...readTaskBoardOptions(readQueryContext()),
          shownColumns: this.shownColumns,
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
      agendaQueryIsDefault:
        normalizeAgendaQuery(
          vscode.workspace
            .getConfiguration('deckard')
            .get<string>('agenda.query', ''),
        ) === '',
    };
  }

  /**
   * Makes the Tasks view list this search. The board is where a search is
   * tried with its results in view, so this is how the view's search is
   * edited: open it here, change it, keep it.
   */
  private async useSearchForAgenda(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('deckard');
    const listed = normalizeAgendaQuery(configuration.get<string>('agenda.query', ''));
    // Pressed a second time, the switch gives the Tasks view back its own
    // list of every open task; when that is what it lists, it does nothing.
    const again = listed === normalizeAgendaQuery(this.query);
    if (again && !listed) {
      return;
    }
    const query = again ? '' : normalizeAgendaQuery(this.query);
    // The value goes where it is already set, as the board's own settings do.
    const target = settingTarget('agenda.query', configuration);
    if (again) {
      if (await writeSetting('agenda.query', '', target, configuration)) {
        void vscode.window.showInformationMessage('The Tasks view lists every open task again.');
        this.refresh();
      }
      return;
    }
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
    if (query !== this.query) {
      // A new search is a new board; its columns start short again.
      this.shownColumns = new Set();
    }
    this.query = query;
    return true;
  }

  /**
   * Names the board's search and keeps it as a saved view that reopens here.
   */
  /**
   * How the board is laid out, as a query block's options: a list sorted by
   * date keeps that sort, a table its columns and sorted column, and the
   * board's columns have no block of their own.
   */
  private queryBlockOptions(): QueryBlockWriteOptions {
    const preferences = this.preferences.reader.value;
    if (preferences.taskBoardLayout === 'table') {
      const sort = preferences.taskTableSort;
      return {
        view: 'table',
        ...(preferences.taskTableColumns?.length ? { columns: preferences.taskTableColumns } : {}),
        ...(sort ? { sort: sort.column, direction: sort.direction } : {}),
      };
    }
    if (preferences.taskBoardLayout === 'list' && preferences.taskSortMode !== 'rank') {
      return { sort: preferences.taskSortMode };
    }
    return {};
  }

  private async saveSearch(): Promise<void> {
    const query = this.query.trim();
    if (!query) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: 'Save search',
      prompt: 'Name this search. It opens on the Task Board.',
      value: query,
      validateInput: (value) =>
        value.trim() ? undefined : 'A saved search needs a name.',
    });
    if (name === undefined) {
      return;
    }
    const saved = await this.preferences.savedSearches.saveSavedQueryFilter(
      name,
      query,
      'taskBoard',
    );
    if (saved) {
      void offerSavedSearchOnHome(this.preferences, saved);
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
      case 'setZenMode':
        await setZenMode(message.enabled);
        return;
      case 'chooseTheme':
        await vscode.commands.executeCommand('deckard.chooseTheme');
        return;
      case 'ready':
        this.refresh();
        return;
      case 'openHelp':
        await vscode.commands.executeCommand('deckard.showHelp');
        return;
      case 'exportResults': {
        // Every task the search found, whatever the layout shows: the list
        // layout with no Done limit is the board as a plain list.
        const index = this.indexer.getSnapshot();
        const board = createTaskBoard(
          index,
          { ...this.preferences.reader.value, taskBoardLayout: 'list' },
          { query: this.query, invalidQuery: this.invalidQuery },
          { ...readTaskBoardOptions(readQueryContext()), doneLimit: Number.MAX_SAFE_INTEGER },
          'inline',
        );
        const plan = this.exports.fromResults('tasks', {
          tasks: (board.tasks ?? []).map((item) => item.task),
          sections: [],
        });
        // The live block keeps the board's layout, sort, and columns.
        const search = this.query.trim();
        await presentExport(
          plan,
          search ? () => formatQueryBlock(search, this.queryBlockOptions()) : undefined,
        );
        return;
      }
      case 'setBoardGroup':
        // A different grouping is a different board, so every column goes
        // back to its short form.
        this.shownColumns = new Set();
        await this.preferences.taskLayout.setTaskBoardGroup(message.groupBy, message.namespace);
        return;
      case 'showColumnRest':
        this.shownColumns.add(message.columnId);
        this.refresh();
        return;
      case 'setTaskLayout':
        await this.preferences.taskLayout.setTaskBoardLayout(message.layout);
        return;

      case 'setTaskSort':
        await this.preferences.taskLayout.setTaskSortMode(message.mode);
        return;
      case 'setTableSort': {
        // The same column again turns the sort round; none is the rank order.
        const current = this.preferences.reader.value.taskTableSort;
        await this.preferences.taskLayout.setTaskTableSort(
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
        await this.preferences.taskLayout.setTaskTableColumns(message.columns);
        return;
      case 'reorderTasks':
        if (this.preferences.reader.value.taskSortMode === 'rank') {
          await this.preferences.taskLayout.setTaskOrder(
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
          await openResultAt(message.filePath, message.line, message);
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
        this.writeIndexAt = index.updatedAt;
        if (!task || !(await toggleTask(this.writes, task, message.completed))) {
          this.writeIndexAt = undefined;
          this.refresh();
        }
        return;
      }
      case 'moveTask': {
        const task = index.tasks.get(message.taskId);
        this.writeIndexAt = index.updatedAt;
        if (
          !task ||
          !(await moveTaskToColumn(this.writes, task, message.column, { index, from: message.from }))
        ) {
          this.writeIndexAt = undefined;
          // The card moved at once on the page; say it did not, then put it back.
          void this.panel?.webview.postMessage({ type: 'moveRefused', taskId: message.taskId });
          this.refresh();
        }
        return;
      }
      case 'pickTaskDate': {
        const task = index.tasks.get(message.taskId);
        if (!task) {
          return;
        }
        const date = await askForDueDate(quoteTaskTitle(task));
        if (date !== null) {
          await setTasksDue(this.writes, [task], date);
        }
        return;
      }
      case 'moveTaskTo': {
        const task = index.tasks.get(message.taskId);
        if (task) {
          await moveTasks(this.indexer, this.preferences, this.writes, [task]);
        }
        return;
      }
      case 'editTask': {
        const task = index.tasks.get(message.taskId);
        if (task && (await openTask(task))) {
          await vscode.commands.executeCommand('deckard.editTask');
        }
        return;
      }
      case 'breakIntoSteps': {
        const task = index.tasks.get(message.taskId);
        if (task) {
          await breakIntoStepsCommand(this.indexer, this.writes, task);
        }
        return;
      }
      case 'addTaskToColumn':
        await captureIntoColumn(message.column);
        return;
    }
  }
}
