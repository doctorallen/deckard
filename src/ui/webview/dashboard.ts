import * as vscode from 'vscode';
import { ActiveHome, HomeSource, HomeWidgetChoice } from './activeHome';

import { listedParkedTags } from '../../core/workspace/parked';
import { setPinned } from '../commands/pinNote';
import { readWeekStart } from '../commands/datePrompt';
import { readQueryContext } from '../commands/queryContext';
import { TryNextSuggestion } from '../state/tryNext';
import { collectTryNextInput, runTryNext, suggestTryNext, TryNextLedger } from '../commands/tryNext';
import { WhatsNew } from '../commands/whatsNew';
import { onDidChangePageChrome } from './components';
import { setZenMode } from './zenMode';

import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import {
  isDefaultHomeLayout,
  PreferencesStore,
} from '../../core/storage/preferences';
import { measure } from '../../core/timing';
import {
  DashboardColumnCount,
  DashboardMessage,
  DashboardMode,
  DashboardSnapshot,
  PersistedPreferences,
  WorkspaceIndex,
} from '../../core/types';
import {
  createDashboardSnapshot,
  getSavedFilterQuery,
  mergeOrder,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { createDashboardWidgets } from '../state/dashboardWidgets';
import { TaskWrites, toggleTask } from '../commands/taskActions';
import { openResultAt, openSourceAt } from '../commands/navigation';
import { renameIndexedTag } from '../commands/renameTag';
import { parseDashboardMessage } from './messages';
import { getDashboardHtml } from './dashboardHtml';
import { followIndexing } from './indexingProgress';
import { onIndexUpdateInTurn, whenPublished } from '../../core/workspace/publishing';
import { panelPriority } from './panelPriority';

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
  /** Asks for a next action for a tag, and captures it to today's note. */
  addNextAction?(tagLabel: string): void | Promise<unknown>;
}

/** What Home is built from. */
export interface DashboardPanelOptions {
  indexer: WorkspaceIndexer;
  preferences: PreferencesStore;
  extensionUri: vscode.Uri;
  navigation: DashboardNavigation;
  /** Whether Home says Deckard was updated; absent, it never does. */
  whatsNew?: Pick<WhatsNew, 'pending' | 'clear' | 'onDidChange'>;
  /** What Try next has been told; absent, it suggests nothing. */
  tryNext?: Pick<TryNextLedger, 'retired' | 'snoozed' | 'retire' | 'snooze' | 'onDidChange'>;
  /** What checking a task off, or renaming a tag, writes through. */
  writes: TaskWrites;
}

/**
 * Owns the dashboard webview and translates validated UI messages into domain
 * actions while keeping filters local to the panel instance.
 */
export class DashboardPanel implements HomeSource, vscode.Disposable {
  /** Where Home says it is in front, so Related Notes can offer its widgets. */
  public activeHome?: ActiveHome;
  /** The widgets + Add widget offers, as the page last listed them. */
  private widgetChoices: HomeWidgetChoice[] = [];
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

  private readonly indexer: WorkspaceIndexer;
  private readonly preferences: PreferencesStore;
  private readonly extensionUri: vscode.Uri;
  private readonly navigation: DashboardNavigation;
  /** Whether Home says Deckard was updated; absent, it never does. */
  private readonly whatsNew: Pick<WhatsNew, 'pending' | 'clear' | 'onDidChange'> | undefined;
  /** What Try next has been told; absent, it suggests nothing. */
  private readonly tryNext: Pick<TryNextLedger, 'retired' | 'snoozed' | 'retire' | 'snooze' | 'onDidChange'> | undefined;
  /** What checking a task off, or renaming a tag, writes through. */
  private readonly writes: TaskWrites;

  public constructor(options: DashboardPanelOptions) {
    this.indexer = options.indexer;
    this.preferences = options.preferences;
    this.extensionUri = options.extensionUri;
    this.navigation = options.navigation;
    this.whatsNew = options.whatsNew;
    this.tryNext = options.tryNext;
    this.writes = options.writes;
    const { indexer, preferences, whatsNew, tryNext } = options;
    const initialPreferences = preferences.value;
    this.dashboardTagColumns = initialPreferences.dashboardTagColumns;
    this.dashboardMode = initialPreferences.dashboardViewState.mode;
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Home', priority: () => panelPriority(this.panel) },
        () => this.refresh(),
      ),
    );
    if (whatsNew) {
      this.disposables.push(whatsNew.onDidChange(() => this.refresh()));
    }
    if (tryNext) {
      this.disposables.push(tryNext.onDidChange(() => this.refresh()));
    }
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
    // A visit is kept quietly; only Home's Recently opened shows it.
    this.disposables.push(
      preferences.onDidRecordVisit(() => {
        if (
          this.panel?.visible &&
          preferences.value.dashboardWidgets.some((widget) => widget.kind === 'recentNotes')
        ) {
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
      onDidChangePageChrome(() => {
        this.renderHtml();
        this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        const titleDisplayChanged = event.affectsConfiguration(
          'deckard.tagTitleDisplayMode',
        );
        if (
          titleDisplayChanged ||
          event.affectsConfiguration('deckard.agenda') ||
          event.affectsConfiguration('deckard.showWhatsNew')
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
    await whenPublished(this.indexer);
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
    await whenPublished(this.indexer);
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
    await whenPublished(this.indexer);
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
      followIndexing(this.indexer, (message) => void panel.webview.postMessage(message)),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.activeHome?.release(this);
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
        if (panel.active) {
          this.activeHome?.setActive(this);
        } else {
          this.activeHome?.release(this);
        }
      }),
    ];
    if (panel.active) {
      this.activeHome?.setActive(this);
    }
  }

  public getWidgetChoices(): HomeWidgetChoice[] {
    return this.widgetChoices;
  }

  /** Adds a widget from the sidebar: Home goes into customizing first. */
  public addWidget(value: string): void {
    void this.panel?.webview.postMessage({ type: 'addWidget', value });
  }

  /**
   * Puts back the widgets Home starts with, after a modal confirmation: it
   * discards an arrangement, which cannot be taken back.
   */
  public async resetWidgets(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      'Reset Home to its default widgets?',
      {
        modal: true,
        detail: 'The widgets you added, removed, moved, and resized are replaced by the ones Home starts with.',
      },
      'Reset Widgets',
    );
    if (choice === 'Reset Widgets') {
      await this.preferences.resetDashboardWidgets();
    }
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

  /** Try next's suggestion now, only while Home holds the widget. */
  private currentTryNext(
    index: WorkspaceIndex,
    preferences: PersistedPreferences,
  ): TryNextSuggestion | undefined {
    if (!this.tryNext || !preferences.dashboardWidgets.some((widget) => widget.kind === 'tryNext')) {
      return undefined;
    }
    return suggestTryNext(this.tryNext, index, preferences, readWeekStart(), Date.now());
  }

  /**
   * Acts on Try next's suggestion. The page names it by key; what runs is
   * worked out here from the suggestion the host would make now.
   */
  private async handleTryNext(
    type: 'runTryNext' | 'snoozeTryNext' | 'retireTryNext',
    key: string,
  ): Promise<void> {
    if (!this.tryNext) {
      return;
    }
    if (type === 'snoozeTryNext') {
      await this.tryNext.snooze(key);
      return;
    }
    if (type === 'retireTryNext') {
      await this.tryNext.retire(key);
      return;
    }
    const index = this.indexer.getSnapshot();
    const preferences = this.preferences.value;
    const suggestion = this.currentTryNext(index, preferences);
    if (!suggestion || suggestion.key !== key) {
      return;
    }
    await runTryNext(suggestion, collectTryNextInput(index, preferences, readWeekStart(), Date.now()), {
      run: (command, ...args) => vscode.commands.executeCommand(command, ...args),
      pin: async (filePath, line) => {
        const pinned = await setPinned(index, this.preferences, { filePath, line }, true);
        if (pinned) {
          await this.tryNext?.retire(suggestion.key);
        }
      },
    });
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
    // One moment and one reading of the settings for the whole page, so its
    // tiles and its widgets agree about what today is.
    const queryContext = readQueryContext();
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
        { agendaQuery: configuration.get<string>('agenda.query', ''), queryContext },
      ),
      homeArranged: !isDefaultHomeLayout(preferences.dashboardWidgets),
      ...(this.whatsNew?.pending() ? { whatsNew: this.whatsNew.pending() } : {}),
      // Switching tabs asks the host again, so only Home gets its widgets.
      ...(this.dashboardMode === 'home'
        ? {
            widgets: createDashboardWidgets(index, viewPreferences, {
              queryContext,
              upcomingDays: configuration.get<number>('agenda.upcomingDays', 7),
              agendaQuery: configuration.get<string>('agenda.query', ''),
              tagTitleDisplayMode,
              sourceNotePath: this.getSourceNotePath(),
              ...(this.currentTryNext(index, viewPreferences)
                ? { tryNext: this.currentTryNext(index, viewPreferences) }
                : {}),
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
    void this.panel.webview.postMessage({
      type: 'state',
      data: { ...data, parkedTags: listedParkedTags(this.indexer) },
    });
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
      case 'setZenMode':
        await setZenMode(message.enabled);
        return;
      case 'chooseTheme':
        await vscode.commands.executeCommand('deckard.chooseTheme');
        return;
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
          await openResultAt(message.filePath, message.line, message);
          if (section) {
            await this.preferences.recordSectionAccess(section.id);
          }
        }
        return;
      case 'toggleTask': {
        const task = index.tasks.get(message.taskId);
        if (task) {
          await toggleTask(this.writes, task, message.completed);
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
        const replacement = await renameIndexedTag(this.indexer, message.tagKey, {
          history: this.writes.history,
          preferences: this.preferences,
        });
        if (replacement) {
          await this.navigation.openTag(replacement.key);
        }
        return;
      }
      case 'parkTag':
      case 'unparkTag':
        await vscode.commands.executeCommand(`deckard.${message.type}`, message.tagKey);
        return;
      case 'openSavedFilter':
        await this.openSavedFilter(message.filterId);
        return;
      case 'addSavedSearchWidget':
        await this.preferences.addSavedSearchWidget(message.filterId);
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
        await this.resetWidgets();
        return;
      case 'widgetChoices':
        this.widgetChoices = message.choices;
        this.activeHome?.notifyChanged(this);
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
      case 'runTryNext':
      case 'snoozeTryNext':
      case 'retireTryNext':
        await this.handleTryNext(message.type, message.key);
        return;
      case 'openWhatsNew':
        await vscode.commands.executeCommand('deckard.openWhatsNew');
        return;
      case 'dismissWhatsNew':
        await this.whatsNew?.clear();
        return;
      case 'openView':
        await vscode.commands.executeCommand(
          {
            agenda: 'deckard.agenda.focus',
            stats: 'deckard.showStats',
            sampleWorkspace: 'deckard.createSampleWorkspace',
            checkSetup: 'deckard.checkSetup',
            walkthrough: 'deckard.openWalkthrough',
          }[message.view],
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
      case 'addNextAction': {
        const tag = index.tags.get(message.tagKey);
        if (tag) {
          await this.navigation.addNextAction?.(tag.label);
        }
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
