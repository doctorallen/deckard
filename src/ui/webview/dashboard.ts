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
  getSavedFilterQuery,
  mergeOrder,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { createDashboardWidgets } from '../state/dashboardWidgets';
import { toggleTask } from '../commands/taskActions';
import { openSourceAt } from '../commands/navigation';
import { renameIndexedTag } from '../commands/renameTag';
import { parseDashboardMessage } from './messages';
import { getDashboardHtml } from './dashboardHtml';

/** Where the Dashboard sends a reader who leaves it. */
export interface DashboardNavigation {
  openTag(tagKey: string): void | Promise<void>;
  openSearch(query: string): void | Promise<void>;
  openTaskBoard(query?: string): void | Promise<void>;
}

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
  private dashboardMode: DashboardMode = 'home';
  private dashboardTagColumns: DashboardColumnCount;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly navigation: DashboardNavigation,
  ) {
    const initialPreferences = preferences.value;
    this.dashboardTagColumns = initialPreferences.dashboardTagColumns;
    this.dashboardMode = initialPreferences.dashboardViewState.mode;
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(
      preferences.onDidChange((nextPreferences) => {
        this.dashboardTagColumns = nextPreferences.dashboardTagColumns;
        this.dashboardMode = nextPreferences.dashboardViewState.mode;
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
          event.affectsConfiguration('deckard.agenda')
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
   * Opens a saved view where it was saved: on the Task Board, or on a search
   * page with its query, or its tags that still exist joined by AND.
   */
  public async openSavedFilter(filterId: string): Promise<void> {
    const savedFilter = this.preferences.value.savedFilters.find(
      (filter) => filter.id === filterId,
    );
    if (!savedFilter) {
      return;
    }
    if (savedFilter.query && savedFilter.page === 'taskBoard') {
      await this.navigation.openTaskBoard(savedFilter.query);
      return;
    }
    if (savedFilter.query) {
      await this.navigation.openSearch(savedFilter.query);
      return;
    }
    const index = this.indexer.getSnapshot();
    const tagKeys = savedFilter.tagKeys.filter((tagKey) =>
      index.tags.has(tagKey),
    );
    if (tagKeys.length >= 2) {
      await this.navigation.openSearch(getSavedFilterQuery({ tagKeys }));
    }
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
    const configuration = vscode.workspace.getConfiguration('deckard');
    const tagTitleDisplayMode = normalizeTagTitleDisplayMode(
      configuration.get<unknown>('tagTitleDisplayMode', 'inline'),
    );
    const index = this.indexer.getSnapshot();
    const viewPreferences = {
      ...preferences,
      dashboardTagColumns: this.dashboardTagColumns,
      dashboardViewState: {
        ...preferences.dashboardViewState,
        mode: this.dashboardMode,
      },
    };
    const data: DashboardSnapshot = {
      ...createDashboardSnapshot(
        index,
        viewPreferences,
        undefined,
        tagTitleDisplayMode,
      ),
      // Switching tabs asks the host again, so only Home gets its widgets.
      ...(this.dashboardMode === 'home'
        ? {
            widgets: createDashboardWidgets(index, viewPreferences, {
              now: Date.now(),
              upcomingDays: configuration.get<number>('agenda.upcomingDays', 7),
              tagTitleDisplayMode,
            }),
          }
        : {}),
    };
    void this.panel.webview.postMessage({ type: 'state', data });
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
        this.dashboardTagColumns = message.columns;
        this.refresh();
        await this.preferences.setDashboardColumns(
          message.section,
          message.columns,
        );
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
            await this.navigation.openTag(tagKey);
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
          await this.navigation.openTag(replacement.key);
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
      case 'setDashboardWidgets':
        // A saved-search widget needs its saved search to still exist.
        await this.preferences.setDashboardWidgets(
          message.widgets.filter(
            (widget) =>
              widget.kind !== 'savedQuery' ||
              this.preferences.value.savedFilters.some(
                (filter) => filter.id === widget.filterId,
              ),
          ),
        );
        return;
      case 'resetDashboardWidgets':
        await this.preferences.resetDashboardWidgets();
        return;
      case 'openSearch': {
        const query = message.query.trim();
        await this.navigation.openSearch(query);
        if (query) {
          await this.preferences.recordRecentQuery(query);
        }
        return;
      }
      case 'openTaskBoard':
        await this.navigation.openTaskBoard(message.query);
        return;
      case 'openView':
        await vscode.commands.executeCommand(
          message.view === 'agenda' ? 'deckard.agenda.focus' : 'deckard.showStats',
        );
        return;
    }
  }
}
