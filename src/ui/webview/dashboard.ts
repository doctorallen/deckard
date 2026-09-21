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

/** Today, as a day number, so a rollover is one comparison. */
function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Where the Dashboard sends a reader who leaves it, and what it asks for. */
export interface DashboardNavigation {
  openTag(tagKey: string): void | Promise<void>;
  openSearch(query: string): void | Promise<void>;
  openTaskBoard(query?: string): void | Promise<void>;
  /** Opens today's daily note, creating it first when needed. */
  openDailyNote(): void | Promise<void>;
  /** Adds a task to today's daily note; true when it was added. */
  quickAdd(text: string): boolean | Promise<boolean>;
  createHubNote(tagKey: string): void | Promise<void>;
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
  /** The note last open in an editor, which Home's widgets can follow. */
  private sourceNotePath: string | undefined;
  /** The day the widgets were built for: Today goes stale when it turns. */
  private publishedOn = startOfToday();

  /** Whether a new day has started since the widgets were last built. */
  private dayHasTurned(): boolean {
    return this.publishedOn !== startOfToday();
  }

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
    this.followEditor(vscode.window.activeTextEditor);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const previous = this.sourceNotePath;
        this.followEditor(editor);
        if (this.sourceNotePath !== previous && this.followsSourceNote()) {
          this.refresh();
        }
      }),
    );
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

  /** Remembers a note's editor; other editors, and none, leave it as it was. */
  private followEditor(editor: vscode.TextEditor | undefined): void {
    const uri = editor?.document.uri;
    // A test's indexer may not tell notes apart; then no editor is followed.
    if (uri && this.indexer.isNotesFile?.(uri)) {
      this.sourceNotePath = this.indexer.getFilePath(uri);
    }
  }

  /** Whether a widget on Home shows something about the last note. */
  private followsSourceNote(): boolean {
    return this.preferences.value.dashboardWidgets.some(
      (widget) => widget.kind === 'relatedNotes' || widget.kind === 'pinnedNotes',
    );
  }

  /**
   * The note last open in an editor, or else the note last opened from
   * Deckard.
   */
  private getSourceNotePath(): string | undefined {
    if (this.sourceNotePath) {
      return this.sourceNotePath;
    }
    const index = this.indexer.getSnapshot();
    const [latest] = Object.entries(
      this.preferences.value.sectionAccessTimes ?? {},
    )
      .filter(([sectionId]) => index.sections.has(sectionId))
      .sort((left, right) => right[1] - left[1]);
    return latest ? index.sections.get(latest[0])?.filePath : undefined;
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
        // Coming back to a page left open is also how a new day arrives, so
        // it refreshes when the day has turned even if nothing was indexed.
        if (panel.visible && (this.isStale || this.dayHasTurned())) {
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
    this.publishedOn = startOfToday();
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
              sourceNotePath: this.getSourceNotePath(),
              relatedNotes: {
                enableKeywordLinks: configuration.get<boolean>(
                  'enableKeywordLinks',
                  true,
                ),
                ranking: {
                  associationMinimumSupport: configuration.get<number>(
                    'relatedNotesAssociationMinimumSupport',
                    1,
                  ),
                  recencyHalfLifeDays: configuration.get<number>(
                    'relatedNotesRecencyHalfLifeDays',
                    0,
                  ),
                },
              },
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
      case 'removeSavedFilter': {
        // Removing a saved search also removes any Home widget bound to it,
        // and nothing could bring either back, so it asks first.
        const saved = this.preferences.value.savedFilters.find(
          (filter) => filter.id === message.filterId,
        );
        const widgets = this.preferences.value.dashboardWidgets.filter(
          (widget) => widget.filterId === message.filterId,
        ).length;
        const confirm = await vscode.window.showWarningMessage(
          `Remove the saved search "${saved?.name ?? 'this search'}"?${
            widgets ? ' Its widget leaves Home with it.' : ''
          }`,
          { modal: true },
          'Remove',
        );
        if (confirm === 'Remove') {
          await this.preferences.removeSavedFilter(message.filterId);
        }
        return;
      }
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
      case 'openDailyNote':
        await this.navigation.openDailyNote();
        return;
      case 'quickAdd': {
        const added = await this.navigation.quickAdd(message.text.trim());
        void this.panel?.webview.postMessage({
          type: 'quickAddResult',
          text: message.text,
          added,
        });
        return;
      }
      case 'createTagHub':
        // A tag that has a hub already opens it instead.
        if (index.tags.get(message.tagKey)?.hubFilePaths?.length) {
          await this.navigation.openTag(message.tagKey);
        } else if (index.tags.has(message.tagKey)) {
          await this.navigation.createHubNote(message.tagKey);
        }
        return;
      case 'openNote':
        if (index.files.has(message.filePath)) {
          await openSourceAt(message.filePath, 1);
        }
        return;
      case 'pinNote':
        // Home lists pins; it does not make them, since the note being
        // pinned is the one place Home cannot show you.
        return;
      case 'unpinNote':
        if (message.pinKey) {
          await this.preferences.unpinNote(message.pinKey);
        }
        return;
    }
  }
}
