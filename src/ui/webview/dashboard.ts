import * as vscode from 'vscode';

import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { PreferencesStore } from '../../core/storage/preferences';
import { measure } from '../../core/timing';
import {
  DashboardMode,
  DashboardColumnCount,
  DashboardMessage,
  DashboardSnapshot,
} from '../../core/types';
import {
  createDashboardSnapshot,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { toggleTask } from '../commands/taskActions';
import {
  moveTaskToColumn,
  readTaskBoardOptions,
} from '../commands/taskBoardActions';
import { layoutTaskBoard } from '../state/taskBoardState';
import { openSourceAt } from '../commands/navigation';
import { renameIndexedTag } from '../commands/renameTag';
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
  /** Whether something changed while the panel was hidden. */
  private isStale = false;
  private taskFilter: DashboardSnapshot['taskFilter'] = 'active';
  private selectedTaskTags: string[] = [];
  private selectedNoteTags: string[] = [];
  private dashboardMode: DashboardMode = 'tasks';
  private dashboardTaskColumns: DashboardColumnCount;
  private dashboardNoteColumns: DashboardColumnCount;
  private dashboardTagColumns: DashboardColumnCount;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly onOpenTag: (
      tagKey: string,
      filterTagKeys?: readonly string[],
    ) => void | Promise<void>,
  ) {
    const initialPreferences = preferences.value;
    this.dashboardTaskColumns = initialPreferences.dashboardTaskColumns;
    this.dashboardNoteColumns = initialPreferences.dashboardNoteColumns;
    this.dashboardTagColumns = initialPreferences.dashboardTagColumns;
    this.dashboardMode = initialPreferences.dashboardViewState.mode;
    this.taskFilter = initialPreferences.dashboardViewState.taskFilter;
    this.selectedTaskTags = [
      ...initialPreferences.dashboardViewState.selectedTaskTags,
    ];
    this.selectedNoteTags = [
      ...initialPreferences.dashboardViewState.selectedNoteTags,
    ];
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(
      preferences.onDidChange((nextPreferences) => {
        this.dashboardTaskColumns = nextPreferences.dashboardTaskColumns;
        this.dashboardNoteColumns = nextPreferences.dashboardNoteColumns;
        this.dashboardTagColumns = nextPreferences.dashboardTagColumns;
        this.dashboardMode = nextPreferences.dashboardViewState.mode;
        this.taskFilter = nextPreferences.dashboardViewState.taskFilter;
        this.selectedTaskTags = [
          ...nextPreferences.dashboardViewState.selectedTaskTags,
        ];
        this.selectedNoteTags = [
          ...nextPreferences.dashboardViewState.selectedNoteTags,
        ];
        this.refresh();
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        const themeChanged = event.affectsConfiguration('deckard.theme');
        const titleDisplayChanged = event.affectsConfiguration(
          'deckard.tagTitleDisplayMode',
        );
        if (themeChanged) {
          this.renderHtml();
        }
        if (
          themeChanged ||
          titleDisplayChanged ||
          event.affectsConfiguration('deckard.board') ||
          event.affectsConfiguration('deckard.tasks')
        ) {
          this.refresh();
        }
      }),
    );
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
   * Opens a saved view: a saved search on the Notes tab, or a saved tag set
   * as that tag intersection.
   */
  public async openSavedFilter(filterId: string): Promise<void> {
    const savedFilter = this.preferences.value.savedFilters.find(
      (filter) => filter.id === filterId,
    );
    if (!savedFilter) {
      return;
    }
    if (savedFilter.query) {
      await this.showSearch(savedFilter.query);
      return;
    }
    const index = this.indexer.getSnapshot();
    const tagKeys = savedFilter.tagKeys.filter((tagKey) =>
      index.tags.has(tagKey),
    );
    if (tagKeys.length >= 2) {
      await this.onOpenTag(tagKeys[0], tagKeys.slice(1));
    }
  }

  /**
   * Opens the Notes tab on a search, which is where every search can be
   * seen in full and refined.
   */
  public async showSearch(query: string): Promise<void> {
    this.dashboardMode = 'notes';
    await this.preferences.setDashboardSearch('notes', query.trim());
    await this.preferences.setDashboardMode('notes');
    await this.show();
  }

  /**
   * Opens the dashboard for `deckard.dashboard.openOnStartup`.
   *
   * Waiting for the first index gives VS Code time to restore a dashboard from
   * the last session, which is left as it is rather than opened twice, and
   * shows whether the workspace has any notes worth opening it for.
   */
  public async showOnStartup(): Promise<void> {
    await this.indexer.ready;
    if (!this.panel && this.indexer.getSnapshot().files.size > 0) {
      await this.show();
    }
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
    this.renderHtml();
    this.panelDisposables = [
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
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

  private renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getDashboardHtml(
        this.panel.webview,
        this.extensionUri,
      );
    }
  }

  /**
   * Sends a fresh projection whenever index or persisted preferences change.
   */
  private refresh(): void {
    if (!this.panel) {
      return;
    }
    // A hidden page keeps what it shows and catches up when shown again, so
    // saving a note while the Dashboard is in the background costs nothing.
    if (!this.panel.visible) {
      this.isStale = true;
      return;
    }

    this.isStale = false;
    measure('Dashboard', () => this.publish());
  }

  private publish(): void {
    if (!this.panel) {
      return;
    }
    const preferences = this.preferences.value;
    const tagTitleDisplayMode = normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
    const index = this.indexer.getSnapshot();
    const snapshot = createDashboardSnapshot(
      index,
      {
        ...preferences,
        dashboardTaskColumns: this.dashboardTaskColumns,
        dashboardNoteColumns: this.dashboardNoteColumns,
        dashboardTagColumns: this.dashboardTagColumns,
        dashboardViewState: {
          ...preferences.dashboardViewState,
          mode: this.dashboardMode,
          taskFilter: this.taskFilter,
          selectedTaskTags: [...this.selectedTaskTags],
          selectedNoteTags: [...this.selectedNoteTags],
        },
      },
      this.taskFilter,
      this.selectedTaskTags,
      undefined,
      this.selectedNoteTags,
      tagTitleDisplayMode,
      // Switching tabs asks the host again, so only the Notes tab gets notes.
      this.dashboardMode === 'notes',
    );
    // The board lays out the same filtered tasks the list would show.
    const taskLayout = preferences.dashboardTaskLayout ?? 'list';
    const data: DashboardSnapshot = {
      ...snapshot,
      // The Markdown view shows each note's source, which its search also
      // reads, so only the HTML view is sent each note rendered.
      notes:
        snapshot.renderMode === 'html'
          ? snapshot.notes
          : snapshot.notes.map((note) => ({ ...note, renderedHtml: '' })),
      taskLayout,
      taskBoard:
        taskLayout === 'board'
          ? layoutTaskBoard(
              index,
              snapshot.tasks.map((item) => item.task),
              preferences.dashboardBoardGroup ?? 'status',
              readTaskBoardOptions(),
            )
          : undefined,
    };
    void this.panel.webview.postMessage({ type: 'state', data });
  }

  /**
   * Names the Notes tab's search and keeps it as a saved view.
   */
  private async saveSearch(): Promise<void> {
    const query = this.preferences.value.dashboardViewState.noteSearchQuery.trim();
    if (!query) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: 'Save Deckard filter',
      prompt: 'Name this search',
      value: query,
      validateInput: (value) =>
        value.trim() ? undefined : 'A saved filter needs a name.',
    });
    if (name === undefined) {
      return;
    }
    const saved = await this.preferences.saveSavedQueryFilter(name, query);
    if (saved) {
      void vscode.window.showInformationMessage(
        `Saved Deckard filter: ${saved.name}`,
      );
    }
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
        // Only open a line that still identifies an indexed note or task.
        const task = [...index.tasks.values()].find(
          (candidate) =>
            candidate.filePath === message.filePath &&
            candidate.lineNumber === message.line,
        );
        const section = [...index.sections.values()].find(
          (candidate) =>
            candidate.filePath === message.filePath &&
            candidate.startLine === message.line,
        );
        const metadataOnlyFile = [...index.files.values()].find(
          (file) =>
            file.filePath === message.filePath &&
            file.sections.length === 0 &&
            file.frontmatterTags.length > 0 &&
            message.line === 1,
        );
        if (task || section || metadataOnlyFile) {
          await openSourceAt(message.filePath, message.line);
          if (section) {
            await this.preferences.recordSectionAccess(section.id);
          }
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
      case 'toggleFavoriteEntity':
        if (index.entities.has(message.entityKey)) {
          await this.preferences.toggleFavoriteEntity(message.entityKey);
        }
        return;
      case 'setTagSort':
        await this.preferences.setTagSortMode(message.mode);
        return;
      case 'setEntitySort':
        await this.preferences.setEntitySortMode(message.mode);
        return;
      case 'setTaskFilter':
        this.taskFilter = message.filter;
        this.refresh();
        await this.preferences.setDashboardTaskFilter(message.filter);
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
        await this.preferences.setDashboardTaskTags(this.selectedTaskTags);
        return;
      }
      case 'setNoteTags': {
        const availableTags = new Set(
          [...index.tags.values()]
            .filter(
              (tag) => tag.sectionIds.length > 0 || tag.filePaths.length > 0,
            )
            .map((tag) => tag.key),
        );
        this.selectedNoteTags = [
          ...new Set(
            message.tagKeys.filter((tagKey) => availableTags.has(tagKey)),
          ),
        ];
        this.refresh();
        await this.preferences.setDashboardNoteTags(this.selectedNoteTags);
        return;
      }
      case 'setTaskSort':
        await this.preferences.setTaskSortMode(message.mode);
        return;
      case 'setRenderMode':
        await this.preferences.setRenderMode(message.mode);
        return;
      case 'setNoteSort':
        await this.preferences.setDashboardNoteSortMode(message.mode);
        return;
      case 'setDashboardMode':
        this.dashboardMode = message.mode;
        this.refresh();
        await this.preferences.setDashboardMode(message.mode);
        return;
      case 'setDashboardSearch':
        await this.preferences.setDashboardSearch(
          message.field,
          message.query,
        );
        return;
      case 'setDashboardColumns':
        if (message.section === 'tasks') {
          this.dashboardTaskColumns = message.columns;
        } else if (message.section === 'notes') {
          this.dashboardNoteColumns = message.columns;
        } else {
          this.dashboardTagColumns = message.columns;
        }
        this.refresh();
        await this.preferences.setDashboardColumns(
          message.section,
          message.columns,
        );
        return;
      case 'setDashboardTaskLayout':
        await this.preferences.setDashboardTaskLayout(message.layout);
        return;
      case 'setBoardGroup':
        await this.preferences.setDashboardBoardGroup(message.groupBy);
        return;
      case 'moveTask': {
        const task = index.tasks.get(message.taskId);
        if (!task || !(await moveTaskToColumn(task, message.column))) {
          this.refresh();
        }
        return;
      }
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
      case 'reorderEntities':
        if (this.preferences.value.entitySortMode === 'custom') {
          await this.preferences.setEntityAccessOrder(
            mergeOrder(message.entityKeys, index.entities.keys()),
          );
        }
        return;
      case 'openTag':
        {
          const tagKey = resolveIndexedTagKey(index.tags, message.tagKey);
          if (tagKey) {
            await this.onOpenTag(tagKey);
          }
        }
        return;
      case 'renameTag': {
        const replacement = await renameIndexedTag(
          this.indexer,
          message.tagKey,
          this.preferences,
        );
        if (replacement) {
          await this.onOpenTag(replacement.key);
        }
        return;
      }
      case 'openSavedFilter':
        await this.openSavedFilter(message.filterId);
        return;
      case 'removeSavedFilter':
        await this.preferences.removeSavedFilter(message.filterId);
        return;
      case 'recordRecentQuery':
        await this.preferences.recordRecentQuery(message.query);
        return;
      case 'saveDashboardSearch':
        await this.saveSearch();
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
