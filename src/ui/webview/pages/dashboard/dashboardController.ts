import * as vscode from 'vscode';

import { openNoteAt } from '../../../commands/noteOpening';
import { PreferenceServices } from '../../../../core/storage/preferences';
import type { IndexControl, IndexReader, IndexScanStatus, IndexUpdates } from '../../../../core/workspace/indexReader';
import { listedParkedTags } from '../../../../domain/index/parked';
import { readAgendaQuery, readUpcomingDays } from '../../../../domain/tasks/agendaGroups';
import type { DashboardColumnCount, DashboardMode, PersistedPreferences } from '../../../../domain/model/preferences';
import type { WorkspaceIndex } from '../../../../domain/model';
import type { QueryContext } from '../../../../domain/query/queryContext';
import type { NavigationService } from '../../../../services/navigationService';
import type {
  DashboardHostToPage,
  DashboardPageState,
  DashboardPageToHost,
  DashboardSnapshot,
} from '../../../protocol/dashboard';
import { setPinned } from '../../../commands/pinNote';
import { readQueryContext } from '../../../commands/queryContext';
import type { TaskWrites } from '../../../commands/taskActions';
import { collectTryNextInput, runTryNext, suggestTryNext, TryNextLedger } from '../../../commands/tryNext';
import type { WhatsNew } from '../../../commands/whatsNew';
import { createDashboardSnapshot, getSavedFilterQuery, mergeOrder } from '../../../state/dashboardState';
import { createDashboardWidgets } from '../../../state/dashboardWidgets';
import type { TryNextSuggestion } from '../../../state/tryNext';
import type { ActiveHome, HomeSource, HomeWidgetChoice } from '../../activeHome';
import { getDashboardHtml } from '../../dashboardHtml';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import {
  chooseTheme,
  goToPage,
  listGoTo,
  openGoTo,
  openSource,
  openTag,
  parkTag,
  renameTag,
  displayCommand,
  setDisplay,
  setZenMode,
  toggleTask,
} from '../../host/sharedHandlers';
import type { PageChrome } from '../../components';
import { narrowDashboardMessage } from './messages';
import { normalizeTagTitleDisplayMode } from '../../../state/entryCards';
import { isDefaultHomeLayout } from '../../../../core/storage/preferencesSchema';
import { readDateFormats } from '../../../commands/datePrompt';

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

/**
 * The preference services Home reads and writes: the blob it draws, its
 * widgets and view state, favorites and their order, sort modes and
 * columns, saved and recent searches, pins, visits, and the keys a renamed
 * tag carries.
 */
export type DashboardPreferences = Pick<
  PreferenceServices,
  'reader' | 'favorites' | 'usage' | 'homeWidgets' | 'pins' | 'savedSearches' | 'display' | 'tagRenames'
>;

/** What Home reads and writes, where it sends the reader, and what stands for it in the sidebar. */
export interface DashboardControllerOptions {
  indexer: IndexReader & IndexScanStatus & IndexUpdates & IndexControl;
  preferences: DashboardPreferences;
  extensionUri: vscode.Uri;
  navigation: DashboardNavigation;
  /** Whether Home says Deckard was updated; absent, it never does. */
  whatsNew?: Pick<WhatsNew, 'pending' | 'clear' | 'onDidChange'>;
  /** What Try next has been told; absent, it suggests nothing. */
  tryNext?: Pick<TryNextLedger, 'retired' | 'snoozed' | 'retire' | 'snooze' | 'onDidChange'>;
  /** What checking a task off, or renaming a tag, writes through. */
  writes: TaskWrites;
  /** What a row's line or tag may open. */
  navigationService: NavigationService;
  /** What Related Notes is handed while Home is in front: the Dashboard's panel. */
  source: HomeSource;
}

/** Some of Home's handlers, by the types they answer. */
type Handlers<K extends keyof DashboardPageToHost> = Pick<MessageHandlers<DashboardPageToHost>, K>;

/**
 * Home and the Tags tab: translates validated page messages into domain
 * actions, keeping the tab shown and the tag columns local to the page.
 * Each handler checks what a message names against the index as it is now,
 * since the page may hold a snapshot from before a note changed, so old ids
 * and paths cannot change unrelated state.
 */
export class DashboardController implements PageController<DashboardPageState, DashboardPageToHost> {
  public readonly name = 'Home';
  /**
   * Home's turn after an index update is "Home", and its snapshot has
   * always been timed as "Dashboard", from building it to posting it.
   */
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: true,
    measure: { name: 'Dashboard', includesPost: true },
  };
  public readonly narrow = narrowDashboardMessage;
  public readonly handlers: MessageHandlers<DashboardPageToHost>;
  /** Where Home says it is in front, so Related Notes can offer its widgets. */
  public activeHome?: ActiveHome;
  /** The widgets + Add widget offers, as the page last listed them. */
  private widgetChoices: HomeWidgetChoice[] = [];
  private dashboardMode: DashboardMode;
  private dashboardTagColumns: DashboardColumnCount;
  /** The note last open in an editor, which Home's widgets can follow. */
  private sourceNotePath: string | undefined;
  /** The day the widgets were built for: Today goes stale when it turns. */
  private publishedOn = startOfToday();
  /**
   * How many saves of the tab, and of the tag columns, are still being
   * written. A save's change event carries what was stored then, which an
   * earlier save can make older than the reader's last choice.
   */
  private readonly pendingWrites = { mode: 0, columns: 0 };

  /** Reads Home's tab and columns as they were saved; nothing is drawn until the host asks. */
  public constructor(private readonly home: DashboardControllerOptions) {
    const initialPreferences = home.preferences.reader.value;
    this.dashboardTagColumns = initialPreferences.dashboardTagColumns;
    this.dashboardMode = initialPreferences.dashboardViewState.mode;
    this.handlers = {
      ...this.sharedHandlers(),
      ...this.tagsTabHandlers(),
      ...this.searchHandlers(),
      ...this.widgetHandlers(),
      ...this.tryNextHandlers(),
    };
  }

  /** The widgets + Add widget offers, as the page last listed them. */
  public getWidgetChoices(): HomeWidgetChoice[] {
    return this.widgetChoices;
  }

  /** The page's template, in the reader's theme, with the heart icons it loads from the extension. */
  public html(webview: vscode.Webview, chrome: PageChrome): string {
    return getDashboardHtml(webview, this.home.extensionUri, chrome);
  }

  /**
   * Everything Home draws, as of now: the tags and entities, the saved
   * searches, Home's widgets while Home is the tab shown, and the parked
   * tags. Building it marks today as the day the widgets were built for.
   */
  public buildSnapshot(): DashboardPageState {
    this.publishedOn = startOfToday();
    const { preferences, indexer } = this.home;
    const blob = preferences.reader.value;
    const configuration = vscode.workspace.getConfiguration('deckard');
    const tagTitleDisplayMode = normalizeTagTitleDisplayMode(configuration.get<unknown>('tagTitleDisplayMode', 'inline'));
    const index = indexer.getSnapshot();
    // One moment and one reading of the settings for the whole page, so its
    // tiles and its widgets agree about what today is.
    const queryContext = readQueryContext();
    const viewPreferences = {
      ...blob,
      dashboardTagColumns: this.dashboardTagColumns,
      dashboardViewState: { ...blob.dashboardViewState, mode: this.dashboardMode },
    };
    // Home alone shows Try next, so only Home asks for its suggestion.
    const tryNext = this.dashboardMode === 'home' ? this.currentTryNext(index, viewPreferences, queryContext) : undefined;
    const data: DashboardSnapshot = {
      ...createDashboardSnapshot({
        index,
        preferences: viewPreferences,
        tagTitleDisplayMode,
        agendaQuery: readAgendaQuery(configuration),
        queryContext,
      }),
      homeArranged: !isDefaultHomeLayout(blob.dashboardWidgets),
      ...(this.home.whatsNew?.pending() ? { whatsNew: this.home.whatsNew.pending() } : {}),
      // Switching tabs asks the host again, so only Home gets its widgets.
      ...(this.dashboardMode === 'home'
        ? { widgets: this.buildWidgets(index, viewPreferences, configuration, { queryContext, tagTitleDisplayMode, tryNext }) }
        : {}),
    };
    return { ...data, parkedTags: listedParkedTags(indexer) };
  }

  /**
   * What else redraws Home besides the index and its theme: What's new and
   * Try next changing, the note in the editor changing while a widget
   * follows it, a visit while Recently opened is shown, the preferences,
   * and the settings it draws from: how tag titles show, the agenda, and
   * whether What's new is said. The host listens to the theme and zen
   * first, so an edit that changes the theme and the agenda at once resets
   * the page's HTML before either sends it a snapshot, as it always did.
   */
  public subscribe(page: PageContext): vscode.Disposable[] {
    const { whatsNew, tryNext, preferences } = this.home;
    const disposables: vscode.Disposable[] = [];
    if (whatsNew) {
      disposables.push(whatsNew.onDidChange(() => page.refresh()));
    }
    if (tryNext) {
      disposables.push(tryNext.onDidChange(() => page.refresh()));
    }
    this.followEditor(vscode.window.activeTextEditor);
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const previous = this.sourceNotePath;
        this.followEditor(editor);
        if (this.sourceNotePath !== previous && this.followsSourceNote()) {
          page.refresh();
        }
      }),
      // A visit is kept quietly; only Home's Recently opened shows it.
      preferences.reader.onDidRecordVisit(() => {
        if (
          page.surface?.visible &&
          preferences.reader.value.dashboardWidgets.some((widget) => widget.kind === 'recentNotes')
        ) {
          page.refresh();
        }
      }),
      // A tab or column choice still being saved is the newest the page
      // knows; the stored one can be the choice before it, and taking it
      // would flip Home back for a moment.
      preferences.reader.onDidChange((nextPreferences) => {
        if (this.pendingWrites.columns === 0) {
          this.dashboardTagColumns = nextPreferences.dashboardTagColumns;
        }
        if (this.pendingWrites.mode === 0) {
          this.dashboardMode = nextPreferences.dashboardViewState.mode;
        }
        page.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        const titleDisplayChanged = event.affectsConfiguration('deckard.tagTitleDisplayMode');
        if (
          titleDisplayChanged ||
          event.affectsConfiguration('deckard.agenda') ||
          event.affectsConfiguration('deckard.showWhatsNew')
        ) {
          page.refresh();
        }
      }),
    );
    return disposables;
  }

  /**
   * Before the first scan, or a warm start's cached notes, the index is
   * empty, and Home drawn from it would say the workspace has no notes and
   * offer a sample workspace. A preference saved meanwhile would redraw it,
   * so until then nothing is sent and the page stays on its loading line,
   * which says how far the scan has got.
   */
  public isReady(): boolean {
    return this.home.indexer.hasIndexed !== false;
  }

  /**
   * Coming back to a page left open is also how a new day arrives, so it
   * refreshes when the day has turned even if nothing was indexed.
   */
  public isOutOfDate(): boolean {
    return this.publishedOn !== startOfToday();
  }

  /** A panel that opens in front makes Home the active source. */
  public onDidAttach(page: PageContext): void {
    if (page.surface?.active) {
      this.activeHome?.setActive(this.home.source);
    }
  }

  /** Home is the active source while its panel is in front, and only then. */
  public onDidChangeViewState(page: PageContext): void {
    if (page.surface?.active) {
      this.activeHome?.setActive(this.home.source);
    } else {
      this.activeHome?.release(this.home.source);
    }
  }

  /** A closed panel is no longer in front. */
  public onDidDetach(): void {
    this.activeHome?.release(this.home.source);
  }

  /**
   * Home disposed of is no longer in front. The host drops the panel's
   * listeners before it closes the panel, so onDidDetach never hears that
   * close, and Home used to stay the active source, with Related Notes
   * offering widgets for a page that was gone.
   */
  public dispose(): void {
    this.activeHome?.release(this.home.source);
  }

  /**
   * Opens a saved view where it was saved: on the Task Board, or on a search
   * page with its query, or its tags that still exist joined by AND.
   */
  public async openSavedFilter(filterId: string): Promise<void> {
    const savedFilter = this.home.preferences.reader.value.savedFilters.find((filter) => filter.id === filterId);
    if (!savedFilter) {
      return;
    }
    if (savedFilter.query && savedFilter.page === 'taskBoard') {
      await this.home.navigation.openTaskBoard(savedFilter.query);
      return;
    }
    if (savedFilter.query) {
      await this.home.navigation.openSearch(savedFilter.query);
      return;
    }
    const index = this.home.indexer.getSnapshot();
    const tagKeys = savedFilter.tagKeys.filter((tagKey) => index.tags.has(tagKey));
    if (tagKeys.length >= 2) {
      await this.home.navigation.openSearch(getSavedFilterQuery({ tagKeys }));
    }
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
      await this.home.preferences.homeWidgets.resetDashboardWidgets();
    }
  }

  /** The gear, a row's line, a task's box, and a tag's menu, as other pages answer them. */
  private sharedHandlers(): Handlers<
    'setZenMode' | 'setDisplay' | 'displayCommand' | 'chooseTheme' | 'openGoTo' | 'listGoTo' | 'goToPage' | 'openSource' | 'toggleTask' | 'openTag' | 'renameTag' | 'parkTag' | 'unparkTag'
  > {
    const { indexer, navigationService, preferences, navigation, writes } = this.home;
    return {
      setZenMode: setZenMode(),
      setDisplay: setDisplay(),
      displayCommand: displayCommand(),
      chooseTheme: chooseTheme(),
      openGoTo: openGoTo(),
      listGoTo: listGoTo({ indexer, current: 'home' }),
      goToPage: goToPage(),
      // Only open a line that still identifies an indexed note or task.
      openSource: openSource({ indexer, navigation: navigationService, policy: 'entries', usage: preferences.usage }),
      toggleTask: toggleTask({ writes, findTask: (taskId) => indexer.getSnapshot().tasks.get(taskId) }),
      openTag: openTag({
        indexer,
        navigation: navigationService,
        policy: 'lenient',
        openTag: (tagKey) => navigation.openTag(tagKey),
      }),
      renameTag: renameTag({
        indexer,
        writes: { history: writes.history, preferences },
        openTag: (tagKey) => navigation.openTag(tagKey),
      }),
      parkTag: parkTag(),
      unparkTag: parkTag(),
    };
  }

  /** The Tags tab: hearts, sorting, dragging, its search box and columns, and a tag's hub. */
  private tagsTabHandlers(): Handlers<
    | 'toggleFavorite'
    | 'toggleFavoriteEntity'
    | 'setTagSort'
    | 'setEntitySort'
    | 'setDashboardMode'
    | 'setDashboardSearch'
    | 'setDashboardColumns'
    | 'reorderTags'
    | 'reorderEntities'
    | 'createTagHub'
    | 'addNextAction'
  > {
    const { indexer, preferences, navigation } = this.home;
    return {
      toggleFavorite: async (message) => {
        if (indexer.getSnapshot().tags.has(message.tagKey)) {
          await preferences.favorites.toggleFavorite(message.tagKey);
        }
      },
      toggleFavoriteEntity: async (message) => {
        if (indexer.getSnapshot().entities.has(message.entityKey)) {
          await preferences.favorites.toggleFavoriteEntity(message.entityKey);
        }
      },
      setTagSort: (message) => preferences.display.setTagSortMode(message.mode),
      setEntitySort: (message) => preferences.display.setEntitySortMode(message.mode),
      setDashboardMode: async (message, page) => {
        this.dashboardMode = message.mode;
        page.refresh();
        await this.whileWriting('mode', () => preferences.homeWidgets.setDashboardMode(message.mode));
      },
      setDashboardSearch: (message) => preferences.homeWidgets.setDashboardSearch(message.field, message.query),
      setDashboardColumns: async (message, page) => {
        this.dashboardTagColumns = message.columns;
        page.refresh();
        await this.whileWriting('columns', () => preferences.display.setDashboardColumns(message.section, message.columns));
      },
      reorderTags: (message) => this.reorderTags(message.tagKeys, message.tagKey, message.isFavorite),
      reorderEntities: async (message) => {
        if (preferences.reader.value.entitySortMode === 'custom') {
          await preferences.favorites.setEntityAccessOrder(
            mergeOrder(message.entityKeys, indexer.getSnapshot().entities.keys()),
          );
        }
      },
      // A tag that has a hub already opens it instead.
      createTagHub: async (message) => {
        const index = indexer.getSnapshot();
        if (index.tags.get(message.tagKey)?.hubFilePaths?.length) {
          await navigation.openTag(message.tagKey);
        } else if (index.tags.has(message.tagKey)) {
          await navigation.createHubNote(message.tagKey);
        }
      },
      addNextAction: async (message) => {
        const tag = indexer.getSnapshot().tags.get(message.tagKey);
        if (tag) {
          await navigation.addNextAction?.(tag.label);
        }
      },
    };
  }

  /** Saved searches, recent searches, and the searches and board Home opens. */
  private searchHandlers(): Handlers<
    | 'openSavedFilter'
    | 'addSavedSearchWidget'
    | 'removeSavedFilter'
    | 'recordRecentQuery'
    | 'openSearch'
    | 'openTaskBoard'
  > {
    const { preferences, navigation } = this.home;
    return {
      openSavedFilter: (message) => this.openSavedFilter(message.filterId),
      addSavedSearchWidget: (message) => preferences.homeWidgets.addSavedSearchWidget(message.filterId),
      removeSavedFilter: (message) => this.removeSavedFilter(message.filterId),
      recordRecentQuery: (message) => preferences.savedSearches.recordRecentQuery(message.query),
      openSearch: async (message) => {
        const query = message.query.trim();
        await navigation.openSearch(query);
        if (query) {
          await preferences.savedSearches.recordRecentQuery(query);
        }
      },
      openTaskBoard: (message) => navigation.openTaskBoard(message.query),
    };
  }

  /** Home's widgets: arranging them, and what each one's buttons and rows open. */
  private widgetHandlers(): Handlers<
    | 'setDashboardWidgets'
    | 'resetDashboardWidgets'
    | 'widgetChoices'
    | 'openWhatsNew'
    | 'dismissWhatsNew'
    | 'openView'
    | 'openDailyNote'
    | 'quickAdd'
    | 'openNote'
    | 'pinNote'
    | 'unpinNote'
  > {
    const { indexer, preferences, navigation } = this.home;
    return {
      // A saved-search widget needs its saved search to still exist.
      setDashboardWidgets: (message) =>
        preferences.homeWidgets.setDashboardWidgets(
          message.widgets.filter(
            (widget) =>
              widget.kind !== 'savedQuery' ||
              preferences.reader.value.savedFilters.some((filter) => filter.id === widget.filterId),
          ),
        ),
      resetDashboardWidgets: () => this.resetWidgets(),
      widgetChoices: (message) => {
        this.widgetChoices = message.choices;
        this.activeHome?.notifyChanged(this.home.source);
      },
      openWhatsNew: () => vscode.commands.executeCommand('deckard.openWhatsNew'),
      dismissWhatsNew: () => this.home.whatsNew?.clear(),
      openView: (message) =>
        vscode.commands.executeCommand(
          {
            agenda: 'deckard.agenda.focus',
            stats: 'deckard.showStats',
            sampleWorkspace: 'deckard.createWorkSample',
            checkSetup: 'deckard.checkSetup',
            walkthrough: 'deckard.openWalkthrough',
          }[message.view],
        ),
      openDailyNote: () => navigation.openDailyNote(),
      // The page holds the task as "Adding…" until it is answered, so a
      // capture that fails, such as on a read-only disk, still answers, and
      // the page gives the text back.
      quickAdd: async (message, page) => {
        let added = false;
        try {
          added = await navigation.quickAdd(message.text.trim());
        } finally {
          const result: DashboardHostToPage['quickAddResult'] = { type: 'quickAddResult', text: message.text, added };
          page.post(result);
        }
      },
      openNote: async (message) => {
        if (indexer.getSnapshot().files.has(message.filePath)) {
          await openNoteAt(message.filePath, 1, { pin: true, opposite: message.opposite === true });
        }
      },
      // Home lists pins; it does not make them, since the note being
      // pinned is the one place Home cannot show you.
      pinNote: () => undefined,
      unpinNote: async (message) => {
        if (message.pinKey) {
          await preferences.pins.unpinNote(message.pinKey);
        }
      },
    };
  }

  /** Try next's button, Not now, and Don't suggest. */
  private tryNextHandlers(): Handlers<'runTryNext' | 'snoozeTryNext' | 'retireTryNext'> {
    return {
      runTryNext: (message) => this.handleTryNext(message.type, message.key),
      snoozeTryNext: (message) => this.handleTryNext(message.type, message.key),
      retireTryNext: (message) => this.handleTryNext(message.type, message.key),
    };
  }

  /** Runs a save of the tab or the tag columns, counted as pending until it settles. */
  private async whileWriting(field: 'mode' | 'columns', write: () => Promise<void>): Promise<void> {
    this.pendingWrites[field] += 1;
    try {
      await write();
    } finally {
      this.pendingWrites[field] -= 1;
    }
  }

  /**
   * Keeps the order tags were dragged into, while tags are sorted by hand
   * and the dragged tag is still indexed, with its heart as the page says.
   */
  private async reorderTags(tagKeys: string[], tagKey: string, isFavorite: boolean): Promise<void> {
    const { indexer, preferences } = this.home;
    const index = indexer.getSnapshot();
    if (preferences.reader.value.tagSortMode !== 'custom' || !index.tags.has(tagKey)) {
      return;
    }
    const favoriteTags = new Set(preferences.reader.value.favoriteTags);
    if (isFavorite) {
      favoriteTags.add(tagKey);
    } else {
      favoriteTags.delete(tagKey);
    }
    await preferences.favorites.setTagAccessOrderAndFavorites(mergeOrder(tagKeys, index.tags.keys()), [...favoriteTags]);
  }

  /**
   * Removing a saved search also removes any Home widget bound to it, and
   * nothing could bring either back, so it asks first.
   */
  private async removeSavedFilter(filterId: string): Promise<void> {
    const { preferences } = this.home;
    const saved = preferences.reader.value.savedFilters.find((filter) => filter.id === filterId);
    const widgets = preferences.reader.value.dashboardWidgets.filter((widget) => widget.filterId === filterId).length;
    const confirm = await vscode.window.showWarningMessage(
      `Remove the saved search "${saved?.name ?? 'this search'}"?${widgets ? ' Its widget leaves Home with it.' : ''}`,
      { modal: true },
      'Remove',
    );
    if (confirm === 'Remove') {
      await preferences.savedSearches.removeSavedFilter(filterId);
    }
  }

  /** Home's widgets, each with what it shows, read in one moment with one reading of the settings. */
  private buildWidgets(
    index: WorkspaceIndex,
    viewPreferences: PersistedPreferences,
    configuration: vscode.WorkspaceConfiguration,
    reading: {
      queryContext: QueryContext;
      tagTitleDisplayMode: ReturnType<typeof normalizeTagTitleDisplayMode>;
      tryNext: TryNextSuggestion | undefined;
    },
  ): DashboardSnapshot['widgets'] {
    const { queryContext, tagTitleDisplayMode, tryNext } = reading;
    // The agenda's settings are read as the Tasks view reads them, so its
    // widget lists what the view does, however they were written.
    return createDashboardWidgets(index, viewPreferences, {
      queryContext,
      upcomingDays: readUpcomingDays(configuration),
      agendaQuery: readAgendaQuery(configuration),
      tagTitleDisplayMode,
      sourceNotePath: this.getSourceNotePath(),
      ...(tryNext ? { tryNext } : {}),
      relatedNotes: {
        enableKeywordLinks: configuration.get<boolean>('enableKeywordLinks', true),
        ranking: {
          associationMinimumSupport: configuration.get<number>('relatedNotesAssociationMinimumSupport', 1),
          recencyHalfLifeDays: configuration.get<number>('relatedNotesRecencyHalfLifeDays', 0),
          dateFormats: readDateFormats(),
        },
      },
    });
  }

  /** Remembers a note's editor; other editors, and none, leave it as it was. */
  private followEditor(editor: vscode.TextEditor | undefined): void {
    const uri = editor?.document.uri;
    // A test's indexer may not tell notes apart; then no editor is followed.
    if (uri && this.home.indexer.isNotesFile?.(uri)) {
      this.sourceNotePath = this.home.indexer.getFilePath(uri);
    }
  }

  /** Whether a widget on Home shows something about the last note. */
  private followsSourceNote(): boolean {
    return this.home.preferences.reader.value.dashboardWidgets.some(
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
    const index = this.home.indexer.getSnapshot();
    const [latest] = Object.entries(this.home.preferences.reader.value.sectionAccessTimes ?? {})
      .filter(([sectionId]) => index.sections.has(sectionId))
      .sort((left, right) => right[1] - left[1]);
    return latest ? index.sections.get(latest[0])?.filePath : undefined;
  }

  /**
   * Try next's suggestion in `queryContext`, its week start and its moment,
   * only while Home holds the widget.
   */
  private currentTryNext(
    index: WorkspaceIndex,
    preferences: PersistedPreferences,
    queryContext: QueryContext,
  ): TryNextSuggestion | undefined {
    const ledger = this.home.tryNext;
    if (!ledger || !preferences.dashboardWidgets.some((widget) => widget.kind === 'tryNext')) {
      return undefined;
    }
    return suggestTryNext({ ledger, index, preferences, weekStart: queryContext.weekStart, now: queryContext.now });
  }

  /**
   * Acts on Try next's suggestion. The page names it by key; what runs is
   * worked out here from the suggestion the host would make now.
   */
  private async handleTryNext(type: 'runTryNext' | 'snoozeTryNext' | 'retireTryNext', key: string): Promise<void> {
    const ledger = this.home.tryNext;
    if (!ledger) {
      return;
    }
    if (type === 'snoozeTryNext') {
      await ledger.snooze(key);
      return;
    }
    if (type === 'retireTryNext') {
      await ledger.retire(key);
      return;
    }
    const index = this.home.indexer.getSnapshot();
    const preferences = this.home.preferences.reader.value;
    // One week start and one moment for the suggestion and what it runs on.
    const queryContext = readQueryContext();
    const suggestion = this.currentTryNext(index, preferences, queryContext);
    if (!suggestion || suggestion.key !== key) {
      return;
    }
    await runTryNext(suggestion, collectTryNextInput(index, preferences, queryContext.weekStart, queryContext.now), {
      run: (command, ...args) => vscode.commands.executeCommand(command, ...args),
      pin: async (filePath, line) => {
        const pinned = await setPinned(index, this.home.preferences.pins, { filePath, line }, true);
        if (pinned) {
          await this.home.tryNext?.retire(suggestion.key);
        }
      },
    });
  }
}
