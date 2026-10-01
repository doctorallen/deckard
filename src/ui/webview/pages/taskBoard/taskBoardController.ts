import * as vscode from 'vscode';

import type { PreferenceServices } from '../../../../core/storage/preferences';
import type { IndexReader, IndexScanStatus, IndexUpdates } from '../../../../core/workspace/indexReader';
import { parseQuery } from '../../../../domain/query/queryParser';
import type { ExportService } from '../../../../services/exportService';
import type { NavigationService } from '../../../../services/navigationService';
import type { SearchRefineState } from '../../../protocol/shared';
import type {
  MoveRefusedMessage,
  MoveTaskMessage,
  TaskBoardPageToHost,
  TaskBoardSnapshot,
} from '../../../protocol/taskBoard';
import { askForDueDate, setTasksDue } from '../../../commands/agendaActions';
import { presentExport } from '../../../commands/exportResults';
import { moveTasks } from '../../../commands/moveTo';
import { readQueryContext } from '../../../commands/queryContext';
import { offerSavedSearchOnHome } from '../../../commands/savedSearchHome';
import { settingTarget, writeSetting } from '../../../commands/settings';
import { openTask, quoteTaskTitle, TaskWrites, toggleTask as writeTaskToggle } from '../../../commands/taskActions';
import {
  captureIntoColumn,
  moveTaskToColumn,
  readTaskBoardOptions,
  updateTaskBoardSetting,
} from '../../../commands/taskBoardActions';
import { breakIntoStepsCommand } from '../../../commands/taskSteps';
import { normalizeAgendaQuery } from '../../../state/agendaState';
import { mergeOrder, normalizeTagTitleDisplayMode } from '../../../state/dashboardState';
import { formatQueryBlock, QueryBlockWriteOptions } from '../../../state/queryBlockState';
import { createTaskBoard } from '../../../state/taskBoardState';
import type { ActiveSearch, SearchSource } from '../../activeSearch';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { chooseTheme, openHelp, openSource, openTag, ready, setZenMode } from '../../host/sharedHandlers';
import { getTaskBoardHtml } from '../../taskBoardHtml';
import type { DeckardTheme } from '../../themeNames';
import { narrowTaskBoardMessage } from './messages';

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

/** What the Task Board reads, writes through, and opens. */
export interface TaskBoardControllerOptions {
  indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  preferences: TaskBoardPreferences;
  openTag: (tagKey: string) => Promise<void>;
  activeSearch: ActiveSearch;
  /** What a card's checkbox, drop, date, move, or steps write through. */
  writes: TaskWrites;
  /** What the board's Export plans its tasks with. */
  exports: ExportService;
  /** What a card's line or tag may open. */
  navigation: NavigationService;
  /**
   * The board as the active search knows it: the panel whose Refine the
   * sidebar shows and whose search it runs.
   */
  source: SearchSource;
}

/** The board's handler map, by message type. */
type Handlers = MessageHandlers<TaskBoardPageToHost>;

/**
 * The Task Board: tasks as a Kanban board, a list, or a table, narrowed by
 * the search box every search page shares. A card moved between columns
 * becomes an edit to its task line.
 *
 * The page moves a dropped card at once; the host then writes the change,
 * and the reindex that follows sends the saved state back. A move that
 * cannot be written is refused, and the board redrawn, which puts the card
 * back. Each message is checked against the index as it is now, since the
 * page may still show a task that has since changed.
 */
export class TaskBoardController implements PageController<TaskBoardSnapshot, TaskBoardPageToHost> {
  public readonly name = 'Task board';
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: false,
    // The page reloads and asks for state again when it is ready.
    onChromeChange: 'reload',
    restore: (state) => this.restoreSearch(state),
  };
  public readonly narrow = narrowTaskBoardMessage;
  public readonly handlers: Handlers;

  /**
   * The search the board opens on. A board is for what is still to do, so
   * it starts there and says so in its box, where it can be cleared or
   * changed like any other search.
   */
  private query = DEFAULT_TASK_BOARD_QUERY;
  /** A search typed that does not parse, shown with its error. */
  private invalidQuery: string | undefined;
  /** Whether the last state sent put Refine in the sidebar. */
  private refineWasInSidebar = false;
  private lastSnapshot: TaskBoardSnapshot | undefined;
  /** The index a task write started from, until the index has moved on. */
  private writeIndexAt: number | undefined;
  /**
   * The columns showing every card after "Show N more". An open column
   * draws its first hundred otherwise, and Done its most recent handful,
   * and each says how many are left.
   */
  private shownColumns = new Set<string>();

  /** Reads and writes through `board`, and is the active search as `board.source`. */
  public constructor(private readonly board: TaskBoardControllerOptions) {
    this.handlers = { ...this.pageHandlers(), ...this.viewHandlers(), ...this.taskHandlers() };
  }

  /** The board's template page, in a theme; it asks for its state when it loads. */
  public html(webview: vscode.Webview, theme: DeckardTheme): string {
    return getTaskBoardHtml(webview, theme);
  }

  /**
   * The board for the search as it stands, kept for the sidebar's Refine,
   * with whether it put Refine in the sidebar.
   */
  public buildSnapshot(): TaskBoardSnapshot {
    const snapshot = this.createSnapshot();
    this.lastSnapshot = snapshot;
    this.refineWasInSidebar = snapshot.refineInSidebar === true;
    return snapshot;
  }

  /**
   * What else redraws the board: the preferences it draws, and the sidebar
   * opening or closing, which moves Refine. Its settings are listened to
   * apart, by `subscribeToSettings`.
   */
  public subscribe(page: PageContext): vscode.Disposable[] {
    const { preferences, activeSearch, source } = this.board;
    return [
      // A task write carries the task's rank into the preferences before the
      // index has read the note back, and a redraw from that index put a
      // dropped card back in its old column for a moment, then forward again.
      // The preferences change waits for the index the write is about to bring.
      preferences.reader.onDidChange(() => {
        if (isAwaitingIndex(this.writeIndexAt, this.board.indexer.getSnapshot())) {
          return;
        }
        page.refresh();
      }),
      activeSearch.onDidChangeRefineVisibility(() => {
        if (activeSearch.isRefineInSidebar(source) !== this.refineWasInSidebar) {
          page.refresh();
        }
      }),
    ];
  }

  /**
   * Redraws the board when one of its settings changes. It is listened to
   * after the page's theme and zen, as it always was, so a change to both
   * reloads the page before the board is sent, rather than after; the host
   * subscribes `subscribe`'s listeners before those, so this is apart.
   */
  public subscribeToSettings(page: PageContext): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('deckard.board') ||
        event.affectsConfiguration('deckard.tasks') ||
        event.affectsConfiguration('deckard.tagTitleDisplayMode')
      ) {
        page.refresh();
      }
    });
  }

  /** An index update brings any write back, so a preferences change redraws again. */
  public onIndexUpdate(page: PageContext): void {
    this.writeIndexAt = undefined;
    page.refresh();
  }

  /** Tells the sidebar the board's search or tasks changed. */
  public onDidSendSnapshot(): void {
    this.board.activeSearch.notifyChanged(this.board.source);
  }

  /** The board is the active search while its panel is in front. */
  public onDidAttach(page: PageContext): void {
    this.updateActivity(page.surface?.active === true);
  }

  /** The board is the active search while its panel is in front. */
  public onDidChangeViewState(page: PageContext): void {
    this.updateActivity(page.surface?.active === true);
  }

  /** A closed board forgets what it last drew and stops being the active search. */
  public onDidDetach(): void {
    this.lastSnapshot = undefined;
    this.board.activeSearch.release(this.board.source);
  }

  /** The board stops being the active search. */
  public dispose(): void {
    this.board.activeSearch.release(this.board.source);
  }

  /**
   * The search the sidebar's Refine shows: the one last drawn, or the
   * board's search drawn now when it has not been.
   */
  public getRefineState(): SearchRefineState | undefined {
    const snapshot = this.lastSnapshot ?? this.createSnapshot();
    return {
      page: 'taskBoard',
      title: 'Task Board',
      query: snapshot.query,
      resultKinds: ['tasks'],
    };
  }

  /**
   * Runs a search on the board, as its own box does, and keeps it among the
   * recent searches when it parses.
   */
  public async applySearch(queryText: string, page: PageContext): Promise<void> {
    const applied = this.applyQuery(queryText);
    page.refresh();
    if (applied && this.query) {
      await this.board.preferences.savedSearches.recordRecentQuery(this.query);
    }
  }

  /**
   * Applies a search, or keeps the previous one and shows the search that
   * does not parse with its error, as a tag overview does. Returns whether
   * it parsed.
   */
  public applyQuery(text: string): boolean {
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

  /** Reopens a board VS Code kept across a reload on the search it was saved with. */
  private restoreSearch(state: unknown): void {
    if (typeof state !== 'object' || state === null) {
      return;
    }
    const saved = state as { query?: unknown };
    if (typeof saved.query === 'string') {
      this.applyQuery(saved.query);
    }
  }

  /** Makes the board the active search, or stops it being one. */
  private updateActivity(active: boolean): void {
    if (active) {
      this.board.activeSearch.setActive(this.board.source);
    } else {
      this.board.activeSearch.release(this.board.source);
    }
  }

  /** The board for the search as it stands, with what the sidebar and the Tasks view say of it. */
  private createSnapshot(): TaskBoardSnapshot {
    const configuration = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('deckard');
    const tagTitleDisplayMode = normalizeTagTitleDisplayMode(
      configuration().get<unknown>('tagTitleDisplayMode', 'inline'),
    );
    return {
      ...createTaskBoard({
        index: this.board.indexer.getSnapshot(),
        preferences: this.board.preferences.reader.value,
        search: { query: this.query, invalidQuery: this.invalidQuery },
        options: {
          ...readTaskBoardOptions(readQueryContext()),
          shownColumns: this.shownColumns,
        },
        tagTitleDisplayMode,
      }),
      refineInSidebar: this.board.activeSearch.isRefineInSidebar(this.board.source),
      agendaListsThisSearch:
        normalizeAgendaQuery(configuration().get<string>('agenda.query', '')) === normalizeAgendaQuery(this.query),
      agendaQueryIsDefault: normalizeAgendaQuery(configuration().get<string>('agenda.query', '')) === '',
    };
  }

  /** The gear's theme, zen, and help, the page asking for its state, and a card's line and tags. */
  private pageHandlers(): Pick<Handlers, 'setZenMode' | 'chooseTheme' | 'ready' | 'openHelp' | 'openSource' | 'openTag'> {
    const { indexer, navigation } = this.board;
    return {
      setZenMode: setZenMode(),
      chooseTheme: chooseTheme(),
      ready: ready(),
      openHelp: openHelp(),
      // Only a task's own line opens: the board lists nothing else.
      openSource: openSource({ indexer, navigation, policy: 'tasks' }),
      openTag: openTag({ indexer, navigation, policy: 'exact', openTag: (tagKey) => this.board.openTag(tagKey) }),
    };
  }

  /** The search box, the gear's view options and settings, and Export. */
  private viewHandlers(): Pick<
    Handlers,
    | 'exportResults'
    | 'setBoardGroup'
    | 'showColumnRest'
    | 'setTaskLayout'
    | 'setTaskSort'
    | 'setTableSort'
    | 'setTableColumns'
    | 'reorderTasks'
    | 'setBoardQuery'
    | 'saveBoardSearch'
    | 'useSearchForAgenda'
    | 'setBoardStatuses'
    | 'setBoardStatusNamespace'
  > {
    const { taskLayout, reader } = this.board.preferences;
    return {
      exportResults: () => this.exportTasks(),
      setBoardGroup: (message) => {
        // A different grouping is a different board, so every column goes
        // back to its short form.
        this.shownColumns = new Set();
        return taskLayout.setTaskBoardGroup(message.groupBy, message.namespace);
      },
      showColumnRest: (message, page) => {
        this.shownColumns.add(message.columnId);
        page.refresh();
      },
      setTaskLayout: (message) => taskLayout.setTaskBoardLayout(message.layout),
      setTaskSort: (message) => taskLayout.setTaskSortMode(message.mode),
      setTableSort: (message) => {
        // The same column again turns the sort round; none is the rank order.
        const current = reader.value.taskTableSort;
        return taskLayout.setTaskTableSort(
          message.column === undefined
            ? undefined
            : {
                column: message.column,
                direction: current?.column === message.column && current.direction === 'asc' ? 'desc' : 'asc',
              },
        );
      },
      setTableColumns: (message) => taskLayout.setTaskTableColumns(message.columns),
      reorderTasks: async (message) => {
        const index = this.board.indexer.getSnapshot();
        if (reader.value.taskSortMode === 'rank') {
          await taskLayout.setTaskOrder(mergeOrder(message.taskIds, index.tasks.keys()));
        }
      },
      setBoardQuery: (message, page) => this.applySearch(message.query, page),
      saveBoardSearch: () => this.saveSearch(),
      useSearchForAgenda: (_message, page) => this.useSearchForAgenda(page),
      setBoardStatuses: (message) =>
        updateTaskBoardSetting('statuses', [...new Set(message.statuses.map((status) => status.toLowerCase()))]),
      setBoardStatusNamespace: (message) => updateTaskBoardSetting('statusNamespace', message.namespace.toLowerCase()),
    };
  }

  /** What a card or row does to its task, and a column's + Add task. */
  private taskHandlers(): Pick<
    Handlers,
    'toggleTask' | 'moveTask' | 'pickTaskDate' | 'moveTaskTo' | 'editTask' | 'breakIntoSteps' | 'addTaskToColumn'
  > {
    const { indexer, preferences, writes } = this.board;
    return {
      toggleTask: async (message, page) => {
        const index = indexer.getSnapshot();
        const task = index.tasks.get(message.taskId);
        this.writeIndexAt = index.updatedAt;
        if (task && (await writeTaskToggle(writes, task, message.completed))) {
          return;
        }
        this.writeIndexAt = undefined;
        page.refresh();
      },
      moveTask: (message, page) => this.moveTask(message, page),
      pickTaskDate: async (message) => {
        const task = indexer.getSnapshot().tasks.get(message.taskId);
        if (!task) {
          return;
        }
        const date = await askForDueDate(quoteTaskTitle(task));
        if (date !== null) {
          await setTasksDue(writes, [task], date);
        }
      },
      moveTaskTo: async (message) => {
        const task = indexer.getSnapshot().tasks.get(message.taskId);
        if (task) {
          await moveTasks(indexer, preferences, writes, [task]);
        }
      },
      editTask: async (message) => {
        const task = indexer.getSnapshot().tasks.get(message.taskId);
        if (task && (await openTask(task))) {
          await vscode.commands.executeCommand('deckard.editTask');
        }
      },
      breakIntoSteps: async (message) => {
        const task = indexer.getSnapshot().tasks.get(message.taskId);
        if (task) {
          await breakIntoStepsCommand(indexer, writes, task);
        }
      },
      addTaskToColumn: (message) => captureIntoColumn(message.column),
    };
  }

  /**
   * Writes a card's move. A move that cannot be written, or of a task that
   * has gone, is refused under the move's number, and the board redrawn.
   */
  private async moveTask(message: MoveTaskMessage, page: PageContext): Promise<void> {
    const index = this.board.indexer.getSnapshot();
    const task = index.tasks.get(message.taskId);
    this.writeIndexAt = index.updatedAt;
    if (task && (await moveTaskToColumn(this.board.writes, task, message.column, { index, from: message.from }))) {
      return;
    }
    this.writeIndexAt = undefined;
    // The card moved at once on the page; say it did not, then put it back.
    const refused: MoveRefusedMessage = {
      type: 'moveRefused',
      taskId: message.taskId,
      ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
    };
    page.post(refused);
    page.refresh();
  }

  /**
   * Exports every task the search found, whatever the layout shows: the
   * list layout with no Done limit is the board as a plain list.
   */
  private async exportTasks(): Promise<void> {
    const index = this.board.indexer.getSnapshot();
    const board = createTaskBoard({
      index,
      preferences: { ...this.board.preferences.reader.value, taskBoardLayout: 'list' },
      search: { query: this.query, invalidQuery: this.invalidQuery },
      options: { ...readTaskBoardOptions(readQueryContext()), doneLimit: Number.MAX_SAFE_INTEGER },
      tagTitleDisplayMode: 'inline',
    });
    const plan = this.board.exports.fromResults('tasks', {
      tasks: (board.tasks ?? []).map((item) => item.task),
      sections: [],
    });
    // The live block keeps the board's layout, sort, and columns.
    const search = this.query.trim();
    await presentExport(
      plan,
      search ? () => formatQueryBlock(search, this.queryBlockOptions()) : undefined,
    );
  }

  /**
   * Makes the Tasks view list this search. The board is where a search is
   * tried with its results in view, so this is how the view's search is
   * edited: open it here, change it, keep it.
   */
  private async useSearchForAgenda(page: PageContext): Promise<void> {
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
        page.refresh();
      }
      return;
    }
    if (!(await writeSetting('agenda.query', query, target, configuration))) {
      return;
    }
    void vscode.window.showInformationMessage(
      query
        ? `The Tasks view lists "${query}" now.`
        : 'The Tasks view lists every open task now.',
    );
    page.refresh();
  }

  /**
   * How the board is laid out, as a query block's options: a list sorted by
   * date keeps that sort, a table its columns and sorted column, and the
   * board's columns have no block of their own.
   */
  private queryBlockOptions(): QueryBlockWriteOptions {
    const preferences = this.board.preferences.reader.value;
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

  /** Names the board's search and keeps it as a saved view that reopens here. */
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
    const saved = await this.board.preferences.savedSearches.saveSavedQueryFilter(
      name,
      query,
      'taskBoard',
    );
    if (saved) {
      void offerSavedSearchOnHome(this.board.preferences, saved);
    }
  }
}
