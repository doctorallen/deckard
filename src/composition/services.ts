import { captureNextAction } from '../ui/commands/taskBoardActions';
import { readQueryContext } from '../ui/commands/queryContext';
import * as vscode from 'vscode';

import { DisplayService } from '../core/storage/preferencesDisplay';
import { FavoritesService } from '../core/storage/preferencesFavorites';
import { HomeWidgetsService } from '../core/storage/preferencesHomeWidgets';
import { PreferencesMaintenance } from '../core/storage/preferencesMaintenance';
import { PinsService } from '../core/storage/preferencesPins';
import { PreferencesRepository } from '../core/storage/preferencesRepository';
import { SavedSearchesService } from '../core/storage/preferencesSavedSearches';
import { TagRenames } from '../core/storage/preferencesTagRenames';
import { TaskLayoutService } from '../core/storage/preferencesTaskLayout';
import { UsageService } from '../core/storage/preferencesUsage';
import { SearchStore } from '../core/storage/searchStore';
import { reportError, setTimingLog } from '../shared/timing';
import { tidyAfterUpdate } from './tidyPreferences';
import { carryMovedSettingsOnce } from './movedSettings';
import { createWorkspaceIndex } from '../core/workspace/indexer';
import type { IndexRoles } from '../core/workspace/indexReader';
import { WorkspaceScanner } from '../core/workspace/scanner';
import { createVscodeEditApplier, createVscodeHistoryWriter } from '../platform/vscodeEditApplier';
import { createVscodeProgress } from '../platform/vscodeProgress';
import { createVscodeWorkspace } from '../platform/vscodeWorkspace';
import { createVscodeWorkspaceEvents } from '../platform/vscodeWorkspaceEvents';
import { VIEW_PRIORITY } from '../core/workspace/publishing';
import { captureToToday, createCaptureNotes } from '../ui/commands/capture';
import type { AddTaskContext } from '../ui/commands/addTask';
import { CaptureService } from '../services/captureService';
import { createHubNote } from '../ui/commands/hubNote';
import { createDailyNoteWithRollover, createRolloverService, VscodeRolloverService } from '../ui/commands/rollover';
import { createReviewService, ReviewWrites } from '../ui/commands/review';
import { TaskWrites } from '../ui/commands/taskActions';
import { MoveService } from '../services/moveService';
import { TaskService, TaskRankKeeper } from '../services/taskService';
import { resolveSourceUri } from '../ui/commands/navigation';
import { TaskEditorActions, TaskLineContext } from '../ui/commands/taskEditor';
import { TemplateService } from '../services/templateService';
import { ExportService } from '../services/exportService';
import { formatQueryBlock } from '../ui/state/queryBlockState';
import { ActiveNoteContext } from '../ui/commands/activeNoteContext';
import { TaskLineDecorations } from '../ui/providers/taskLineDecorations';
import { RepeatRuleHealth } from '../ui/providers/repeatRuleHealth';
import { WordCountStatusBar } from '../ui/views/wordCountStatusBar';
import { SectionFocus } from '../ui/commands/focusSection';
import { ExcludedFoldersContext } from '../ui/commands/excludeFolders';
import { createParkingService, ParkingCommands, ParkingContext } from '../ui/commands/parking';
import { moveTasks, MovePreferences, MoveToActions } from '../ui/commands/moveTo';
import { EntityHeadingSuggestions } from '../ui/providers/entitySuggestions';
import { LinkHealth } from '../ui/commands/linkHealth';
import { CalendarView } from '../ui/webview/calendar';
import { CalendarPanel } from '../ui/webview/calendarPage';
import { ActiveCalendar } from '../ui/webview/activeCalendar';
import { ActiveNotePage } from '../ui/webview/activeNotePage';
import { ActiveHome } from '../ui/webview/activeHome';
import { readManifestTools } from '../core/mcp/mcpProtocol';
import { DeckardMcpServer } from '../ui/commands/mcpServer';
import { ActivePinContext } from '../ui/commands/pinNote';
import { AgendaContextKeys } from '../ui/commands/agendaActions';
import { PinService } from '../services/pinService';
import { LinkMaintenance } from '../ui/commands/linkMaintenance';
import { readLinkStyle, vscodeLiveNotes } from '../ui/commands/linkMaintenancePorts';
import { LinkNoteService, LinkService } from '../services/linkService';
import { WikiLinkCompletionProvider } from '../ui/providers/linkSuggestions';
import { WorkspaceWriteHistory, WriteHandle } from '../ui/commands/workspaceWrites';
import { NoteVisits } from '../ui/commands/noteVisits';
import { TagWrites } from '../ui/commands/renameTag';
import { TagService } from '../services/tagService';
import { EditorTagDecorations } from '../ui/providers/tagDecorations';
import { TagCompletionProvider } from '../ui/providers/tagSuggestions';
import { TaskMetadataCompletionProvider } from '../ui/providers/taskMetadataSuggestions';
import { SlashMenuProvider } from '../ui/providers/slashMenu';
import { StatusSuggestionsProvider } from '../ui/providers/statusSuggestions';
import { EditorLenses } from '../ui/providers/editorLenses';
import { EditorReferences } from '../ui/providers/editorReferences';
import { AssistantTools } from '../ui/commands/assistantTools';
import { QuickFind } from '../ui/commands/quickFind';
import { DashboardPanel } from '../ui/webview/dashboard';
import { HelpPanel } from '../ui/webview/help';
import { NotesGraphPanel, readNotesGraphOptions } from '../ui/webview/notesGraph';
import { SidebarNotesView } from '../ui/webview/sidebarNotes';
import { RelatedNotesDebugPanel } from '../ui/webview/relatedNotesDebug';
import { StatsPanel } from '../ui/webview/stats';
import { TaskStatusesPanel } from '../ui/webview/taskStatuses';
import { NotePagePanel } from '../ui/webview/notePage';
import { TaskBoardPanel } from '../ui/webview/taskBoard';
import { ActiveSearch } from '../ui/webview/activeSearch';
import { SearchPanels } from '../ui/webview/searchPage';
import { setZenMode, startZenMode, toggleZenMode } from '../ui/webview/zenMode';
import { getSampleStorageUri, SAMPLE_FOLDER_NAMES, showSampleReadmeOnce } from '../ui/commands/sampleWorkspace';
import { LARGE_WORKSPACE_NOTES, summarizeFirstIndex } from '../ui/commands/firstIndex';
import { suggestEsperThemesOnce } from '../ui/commands/esperThemes';
import { initWriteTarget, isPausedHere, looksLikeCodeRepository, onDidChangePaused, readNotesFolder } from '../ui/commands/writeTarget';
import { ScopeStatusBar } from '../ui/views/scopeStatusBar';
import { countUnknownStatuses, noticeUnknownStatusesOnce } from '../ui/commands/otherCheckboxes';
import { offerStatusMigrationOnce } from '../ui/commands/statusMove';
import { openSettingAction, settingLabel } from '../ui/commands/notify';
import { PreferenceSnapshots } from '../core/storage/preferenceSnapshots';
import { OutlineTreeProvider } from '../ui/views/outlineTree';
import { publishViewChoices } from '../ui/commands/toggles/viewChoiceContext';
import { startPageWidth } from '../ui/commands/displaySettings';
import { QueryBlocks } from '../ui/preview/queryBlocks';
import { AgendaTreeProvider } from '../ui/views/agendaTree';
import { countDueTasks, TaskStatusBar } from '../ui/views/taskStatusBar';
import { AgendaGroup, createAgenda, selectAgendaTasks, selectOverdueTasks } from '../ui/state/agendaState';
import { isNamespaceName } from '../ui/state/tagGrouping';
import { resolveTaskMove } from '../ui/state/taskBoardState';
import { AgendaService } from '../services/agendaService';
import { WhatsNew } from '../ui/commands/whatsNew';
import { ThemePreview } from '../ui/webview/themePreview';
import { TryNextLedger } from '../ui/commands/tryNext';
import { DisposalOrder } from './disposalOrder';
import { findUnlinkedMentions } from '../domain/search/mentions';
import { evaluateSearchPage } from '../ui/state/searchPageState';
import { getCaptureInsertion } from '../domain/capture/captureLines';

/** A first index this large is offered deckard.exclude, once. */
const EXCLUDE_HINT_SHOWN = 'deckard.excludeHintShown';

/**
 * The preference services, one per capability over one repository, and what
 * is kept beside them.
 */
export interface PreferenceParts {
  /** The one store every preference service writes through. */
  repository: PreferencesRepository;
  favorites: FavoritesService;
  usage: UsageService;
  taskLayout: TaskLayoutService;
  homeWidgets: HomeWidgetsService;
  pins: PinsService;
  savedSearches: SavedSearchesService;
  display: DisplayService;
  tagRenames: TagRenames;
  maintenance: PreferencesMaintenance;
  /** The copies Restore Preferences… offers. */
  snapshots: PreferenceSnapshots;
  /** What Move to… ranks destinations by and records a heading in. */
  move: MovePreferences;
}

/** What the commands that write to the notes write through. */
export interface Writes {
  tasks: TaskWrites;
  tags: TagWrites;
  parking: ParkingCommands;
  rollover: VscodeRolloverService;
  reviews: ReviewWrites;
  templates: TemplateService<vscode.Uri>;
  addTask: AddTaskContext;
}

/** The editor-area pages, each one host that opens, restores, and redraws its panel. */
export interface Pages {
  search: SearchPanels;
  dashboard: DashboardPanel;
  stats: StatsPanel;
  help: HelpPanel;
  notesGraph: NotesGraphPanel;
  relatedNotesDebug: RelatedNotesDebugPanel;
  calendar: CalendarPanel;
  taskBoard: TaskBoardPanel;
  notePage: NotePagePanel;
  taskStatuses: TaskStatusesPanel;
}

/**
 * Two functions that page modules export and commands call. A command may
 * not import a page host's module (the commands-not-to-webview rule), so the
 * composition root hands them over until Phase 6 gives them a home of their
 * own.
 */
export interface PageCommands {
  /** What Show Notes Graph keeps of the options it was run with. */
  readNotesGraphOptions: typeof readNotesGraphOptions;
  /** Goes to Zen, or back to the step the reader was on. */
  setZenMode: typeof setZenMode;
  /** Into Zen, or back out of it. */
  toggleZenMode: typeof toggleZenMode;
}

/** The sidebar views and the status bar that the commands reach. */
export interface Views {
  sidebarNotes: SidebarNotesView;
  calendar: CalendarView;
  outline: OutlineTreeProvider;
  agenda: AgendaTreeProvider;
  taskStatusBar: TaskStatusBar;
}

/**
 * Everything activation builds that a feature's commands, the startup steps,
 * or the extension's exports reach, built once by {@link createServices}.
 *
 * A feature takes what it needs from here rather than building its own, so
 * every command, view, and page shares one index, one preference store, and
 * one write history. What only lives to be disposed, such as a completion
 * provider or a context key, is not listed: `context.subscriptions` owns it.
 */
export interface Services {
  /** Deckard's log, which Show Log opens. */
  log: vscode.LogOutputChannel;
  whatsNew: WhatsNew;
  /** What Home's Try next has been told; a command that runs one retires it. */
  tryNext: TryNextLedger;
  /** Every write Deckard makes in this window, which Undo takes back. */
  history: WorkspaceWriteHistory;
  scanner: WorkspaceScanner<vscode.Uri>;
  indexer: IndexRoles<vscode.Uri>;
  preferences: PreferenceParts;
  writes: Writes;
  links: { service: LinkService<vscode.Uri>; notes: LinkNoteService<vscode.Uri> };
  /** The theme Choose Theme… shows on the open pages before one is kept. */
  themePreview: ThemePreview;
  pages: Pages;
  pageCommands: PageCommands;
  views: Views;
  /** The Tasks view's decisions. */
  agenda: AgendaService<AgendaGroup>;
  quickFind: QuickFind;
  mcpServer: DeckardMcpServer;
  /** What the Markdown preview draws ```deckard blocks with. */
  queryBlocks: QueryBlocks;
  sectionFocus: SectionFocus;
}

/** The index and what it reads and writes through. */
interface Core {
  history: WorkspaceWriteHistory;
  workspace: ReturnType<typeof createVscodeWorkspace>;
  scanner: WorkspaceScanner<vscode.Uri>;
  indexer: IndexRoles<vscode.Uri>;
}

/**
 * Builds every port implementation, store, service, index, provider, view,
 * page host, and status bar, in the order activation always built them, and
 * hands each disposable to `context.subscriptions` where activation always
 * did, before any command is registered.
 *
 * The order is VS Code's to see: which provider registers first, which
 * listener hears an index update first, and which context key is set first
 * all follow it, so a change here is a change in behavior. Only the command
 * registrations that used to sit between these steps are left out, to run
 * after this: within one synchronous activation, VS Code cannot tell when a
 * command was registered, and its registry is keyed by id.
 *
 * Nothing here starts work that reads the notes: {@link startServices} does,
 * once every feature has registered.
 */
export function createServices(context: vscode.ExtensionContext): Services {
  // The objects deactivate() once disposed by hand, in its order, before
  // anything else is disposed; see DisposalOrder for why the order is kept.
  const shutdown = new DisposalOrder();
  context.subscriptions.push(shutdown);
  const { newWorkspace, whatsNew, tryNext, log } = createLedgers(context);
  const core = createCore(context);
  const preferences = createPreferences(context, core);
  const writes = createWrites(core, preferences);
  const search = createSearch(context, core, preferences, writes);
  const editor = createEditorProviders(context, core, preferences);
  offerExcludeHint(context, core.indexer, newWorkspace);
  // Once per machine, and once per workspace, after the first index has had
  // its say; never in a test run, where a message arriving mid-test would
  // land in what a test records.
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    void core.indexer.ready
      .then(() => suggestEsperThemesOnce(context.globalState))
      .catch((error: unknown) => reportError('Could not suggest Esper Themes', error));
    void core.indexer.ready
      .then(() => noticeUnknownStatusesOnce(context.workspaceState, countUnknownStatuses(core.indexer.getSnapshot())))
      .catch((error: unknown) => reportError('Could not count the tasks whose status Deckard does not know', error));
    void core.indexer.ready
      .then(() => offerStatusMigrationOnce(context.workspaceState, core.indexer, { board: { reader: preferences.repository, taskLayout: preferences.taskLayout } }))
      .catch((error: unknown) => reportError('Could not offer to move status tags into checkboxes', error));
  }
  syncWalkthroughContext(context, core.indexer);
  createEditorContexts(context, core, preferences);
  const assistance = createLinksAndAssistance(context, core, preferences);
  const calendar = createCalendar(context, { core, preferences, writes, search });
  const home = createHome(context, {
    core,
    preferences,
    writes,
    search,
    pins: editor.pins,
    linkNotes: assistance.linkNotes,
    whatsNew,
    tryNext,
  });
  const sidebar = createSidebarAndPages(context, { core, preferences, search, calendar, dashboard: home.dashboard, whatsNew, writes });
  const trees = createTreesAndAddTask(context, core, preferences, writes);
  // With the note page in front, the Outline lists its note's headings.
  trees.outline.followNotePage(sidebar.activeNotePage);
  const built: Built = { core, preferences, writes, search, editor, assistance, calendar, home, sidebar, trees };
  holdUntilShutdown(context, shutdown, built);
  warnOfUnreadableNotes(context, core.indexer);
  tidyPreferencesOnUpdate(context, core.indexer, preferences);
  registerViews(context, { sidebarNotes: sidebar.sidebarNotes, calendar: calendar.calendar, outline: trees.outline, agenda: trees.agenda });
  const pages = listPages(built);
  const sectionFocus = createLateContexts(context, core, pages, preferences);
  return {
    log,
    whatsNew,
    tryNext,
    history: core.history,
    scanner: core.scanner,
    indexer: core.indexer,
    preferences,
    writes: { ...writes, addTask: trees.addTask },
    links: { service: assistance.links, notes: assistance.linkNotes },
    themePreview: search.themePreview,
    pages,
    pageCommands: { readNotesGraphOptions, setZenMode, toggleZenMode },
    views: {
      sidebarNotes: sidebar.sidebarNotes,
      calendar: calendar.calendar,
      outline: trees.outline,
      agenda: trees.agenda,
      taskStatusBar: trees.taskStatusBar,
    },
    agenda: trees.agendaService,
    quickFind: home.quickFind,
    mcpServer: assistance.mcpServer,
    queryBlocks: trees.queryBlocks,
    sectionFocus,
  };
}

/** What each step of {@link createServices} built, for the steps that list them. */
interface Built {
  core: Core;
  preferences: PreferenceParts;
  writes: Omit<Writes, 'addTask'>;
  search: ReturnType<typeof createSearch>;
  editor: ReturnType<typeof createEditorProviders>;
  assistance: ReturnType<typeof createLinksAndAssistance>;
  calendar: ReturnType<typeof createCalendar>;
  home: ReturnType<typeof createHome>;
  sidebar: ReturnType<typeof createSidebarAndPages>;
  trees: ReturnType<typeof createTreesAndAddTask>;
}

/**
 * Hands the long-lived services to the subscriptions at the point
 * activation always pushed them. The 27 that deactivate() disposed by hand go
 * to `shutdown`, in deactivate()'s order; the three it never listed are
 * pushed, in the order they were pushed among the rest.
 */
function holdUntilShutdown(context: vscode.ExtensionContext, shutdown: DisposalOrder, built: Built): void {
  const { core, preferences, search, editor, assistance, calendar, home, sidebar, trees } = built;
  shutdown.add(
    core.indexer,
    preferences.repository,
    search.searchPanels,
    search.activeSearch,
    sidebar.sidebarNotes,
    editor.tagDecorations,
    editor.tagSuggestions,
    assistance.linkSuggestions,
    assistance.entitySuggestions,
    home.dashboard,
    sidebar.stats,
    sidebar.taskStatuses,
    sidebar.help,
    sidebar.relatedNotesDebug,
    sidebar.notePage,
    trees.outline,
    trees.queryBlocks,
    trees.agenda,
    trees.taskStatusBar,
    editor.taskMetadataSuggestions,
    editor.taskEditorActions,
    editor.taskLineContext,
    home.taskBoard,
    assistance.editorReferences,
    assistance.editorLenses,
    assistance.linkHealth,
    assistance.linkMaintenance,
    calendar.calendar,
    home.quickFind,
  );
  context.subscriptions.push(sidebar.notesGraph, assistance.assistantTools, assistance.mcpServer);
}

/** The page hosts, by page. */
function listPages({ search, home, sidebar, calendar }: Built): Pages {
  return {
    search: search.searchPanels,
    dashboard: home.dashboard,
    stats: sidebar.stats,
    help: sidebar.help,
    notesGraph: sidebar.notesGraph,
    relatedNotesDebug: sidebar.relatedNotesDebug,
    calendar: calendar.calendarPage,
    taskBoard: home.taskBoard,
    notePage: sidebar.notePage,
    taskStatuses: sidebar.taskStatuses,
  };
}

/**
 * Starts what reads the notes, once every command is registered: Home on
 * startup when the setting asks, the status bar's first draw, and the first
 * index, which prunes the preferences once it is read.
 */
export function startServices(services: Services): void {
  if (
    vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('dashboard.openOnStartup', false)
  ) {
    void services.pages.dashboard.showOnStartup();
  }

  // The bar's constructor only listens, so its first draw is here, before
  // the index starts; each index update redraws it after that.
  services.views.taskStatusBar.refresh();

  // Nothing awaits this, so a failure is logged here rather than lost.
  void services.indexer
    .start()
    .then(async () => {
      await services.preferences.maintenance.prune(services.indexer.getSnapshot());
    })
    .catch((error: unknown) => reportError('Could not finish the first index', error));
}

/**
 * What's new, Try next, and the log: the first things activation makes, since
 * whether Deckard has run here before is read before anything stores a value.
 */
function createLedgers(context: vscode.ExtensionContext) {
  // Read before anything below stores a value: whether Deckard has run here
  // before, which tells an update from a new install, and whether it has run
  // in this workspace, which decides the first index's summary.
  const newWorkspace = context.workspaceState.keys().length === 0;
  const ranBefore =
    context.globalState.keys().length > 0 || context.workspaceState.keys().length > 0;
  const whatsNew = new WhatsNew({
    globalState: context.globalState,
    version: String(context.extension.packageJSON.version),
    existingUser: ranBefore,
    readChangelog: async () =>
      Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md')),
      ).toString('utf8'),
  });
  context.subscriptions.push(whatsNew);
  // What Home's Try next has been told, kept with the workspace. A
  // suggestion is retired for good once its command runs from anywhere.
  const tryNext = new TryNextLedger(context.workspaceState);
  context.subscriptions.push(tryNext);
  void whatsNew.onActivate();
  // A sample opened from Create a Work Sample or the Story Tour shows its README once.
  void showSampleReadmeOnce(context);
  // One log for the whole extension. Its level, set from the Output panel,
  // decides how much of Deckard's timing it keeps.
  const log = vscode.window.createOutputChannel('Deckard', { log: true });
  context.subscriptions.push(
    log,
    // Measurements go to this log until the extension deactivates.
    setTimingLog(log),
  );
  log.info(
    `Deckard ${String(context.extension.packageJSON.version)} activated.`,
  );
  return { newWorkspace, whatsNew, tryNext, log };
}

/** The write history, the ports the index reads through, and the index. */
function createCore(context: vscode.ExtensionContext): Core {
  // What Deckard has written to the notes in this window: the write Undo
  // takes back, and the notes it has just saved, which the index reads back
  // at once. Every command that writes is handed this one.
  const history = new WorkspaceWriteHistory();
  // Whether Deckard is paused in this workspace, and where it may write,
  // kept in VS Code's storage for the workspace; read before the scanner is.
  initWriteTarget(context.workspaceState);
  // The index reads the workspace through ports; this is VS Code's.
  const workspace = createVscodeWorkspace({ isPaused: isPausedHere });
  const scanner = new WorkspaceScanner(workspace);
  const indexer = createWorkspaceIndex({
    scanner,
    searchStore: new SearchStore(context.storageUri?.fsPath),
    version: String(context.extension.packageJSON.version),
    // A developer's parser edits do not change the version, so only an
    // installed Deckard starts from the notes the cache kept.
    readCache: context.extensionMode === vscode.ExtensionMode.Production,
    events: createVscodeWorkspaceEvents(),
    progress: createVscodeProgress(),
    ownWrites: history.ownWrites,
  });
  // Pausing or resuming reads the workspace again: nothing, or the notes.
  context.subscriptions.push(
    onDidChangePaused(() => {
      void indexer.refresh().catch((error: unknown) => reportError('Could not read the workspace again', error));
    }),
  );
  const scope = new ScopeStatusBar(context.workspaceState);
  context.subscriptions.push(scope);
  void scope.refresh();
  return { history, workspace, scanner, indexer };
}

/** The preference repository, a service per capability over it, and its snapshots. */
function createPreferences(context: vscode.ExtensionContext, core: Core): PreferenceParts {
  // Favorites, pins and view counts name what is in a workspace, so they are
  // kept with it. A window with no folder open has no workspace to own them
  // and nothing to index, so it reads the machine-wide store alone.
  const repository = new PreferencesRepository(
    context.globalState,
    vscode.workspace.workspaceFolders?.length
      ? context.workspaceState
      : undefined,
  );
  // One service per capability, each writing through the one repository;
  // every caller is handed the ones it uses.
  const favorites = new FavoritesService(repository);
  const usage = new UsageService(repository);
  const taskLayout = new TaskLayoutService(repository);
  const homeWidgets = new HomeWidgetsService(repository);
  const pins = new PinsService(repository);
  const savedSearches = new SavedSearchesService(repository);
  const display = new DisplayService(repository);
  const tagRenames = new TagRenames(repository);
  const maintenance = new PreferencesMaintenance(repository);
  void repository.initialize();
  // The settings that moved into the views' preferences, carried once,
  // before any view is built from them.
  void carryMovedSettingsOnce(repository, { global: context.globalState, workspace: context.workspaceState }).catch(
    (error: unknown) => reportError('Could not carry the moved settings into the preferences', error),
  );
  // What Move to… ranks destinations by and records a heading in, wherever
  // it is run from.
  const move = { reader: repository, usage };
  // A copy of what this workspace remembers, a moment after each change,
  // so one bad write is something a reader can take back.
  const snapshots = new PreferenceSnapshots(context.storageUri, repository, core.workspace);
  context.subscriptions.push(snapshots);
  return {
    repository,
    favorites,
    usage,
    taskLayout,
    homeWidgets,
    pins,
    savedSearches,
    display,
    tagRenames,
    maintenance,
    snapshots,
    move,
  };
}

/**
 * What tasks, tags, parking, rollover, reviews, and templates write through.
 * Add Task's is made later, with the Tasks view, and filled in by createServices.
 */
function createWrites(core: Core, preferences: PreferenceParts): Omit<Writes, 'addTask'> {
  const { history, workspace, indexer } = core;
  // What an edit to a task writes through, for every view that edits one.
  // A task's id comes from its own text, so an edit Deckard writes makes it
  // a new task to anything keyed by id. This keeps its place in a ranked
  // list across the edit, and across an Undo of it.
  const keepRank: TaskRankKeeper = (previousId, nextId) => {
    void preferences.taskLayout.replaceTaskInOrder(previousId, nextId);
  };
  const tasks: TaskWrites = {
    history,
    keepRank,
    tasks: new TaskService<vscode.Uri, WriteHandle>({
      notes: createVscodeEditApplier(),
      history: createVscodeHistoryWriter(history),
      ownWrites: history.ownWrites,
      keepRank,
      resolveUri: (filePath) => resolveSourceUri(filePath),
      configuration: workspace,
      clock: { now: () => Date.now() },
    }),
    moves: new MoveService<vscode.Uri, WriteHandle>({
      notes: createVscodeEditApplier(),
      history: createVscodeHistoryWriter(history),
      files: workspace,
      configuration: workspace,
      getFilePath: (uri) => indexer.getFilePath(uri),
      keepRank,
      resolveUri: (filePath) => resolveSourceUri(filePath),
      placeInsertion: getCaptureInsertion,
    }),
  };
  // What renaming or merging a tag writes through, for the commands that
  // rename one; the service decides what a rename does.
  const tags: TagWrites = {
    history,
    preferences: { tagRenames: preferences.tagRenames },
    tags: new TagService({ index: indexer, preferences: preferences.tagRenames }),
  };
  // What the parking commands read, and the service that decides what they
  // may park and writes it.
  const parking: ParkingCommands = {
    indexer,
    parking: createParkingService(indexer, history),
  };
  // What carries unfinished tasks into today's note, for every command
  // and page that opens today's note or rolls tasks forward.
  const rollover = createRolloverService(history, indexer);
  // What writes a week's or a month's review into its note.
  const reviews: ReviewWrites = {
    reviews: createReviewService(history, indexer),
    preferences: preferences.repository,
  };
  // What makes a note from a template, never over one already there.
  const templates = new TemplateService<vscode.Uri>({
    files: workspace,
    index: indexer,
    clock: { now: () => Date.now() },
  });
  return { tasks, tags, parking, rollover, reviews, templates };
}

/** The theme preview, the active search, exports, and the search pages. */
function createSearch(
  context: vscode.ExtensionContext,
  core: Core,
  preferences: PreferenceParts,
  writes: Omit<Writes, 'addTask'>,
) {
  const { indexer } = core;
  // The theme Choose Theme… shows on the open pages before one is kept.
  // Every page draws with it, and redraws when it changes.
  const themePreview = new ThemePreview();
  const activeSearch = new ActiveSearch();
  // What a search page's and the Task Board's Export plan with. A page
  // exports the results it found, and writes the live block itself, with
  // its own sort and layout; a search is run as a search page runs one.
  const exportService = new ExportService({
    index: indexer,
    search: (query) =>
      evaluateSearchPage(indexer.getSnapshot(), query, { queryContext: readQueryContext() }).results,
    queryBlock: (query) => formatQueryBlock(query),
  });
  const { repository, usage, savedSearches, display, pins, homeWidgets, tagRenames } = preferences;
  const searchPanels = new SearchPanels({
    indexer,
    preferences: { reader: repository, usage, savedSearches, display, pins, homeWidgets, tagRenames },
    extensionUri: context.extensionUri,
    activeSearch,
    writes: writes.tasks,
    themePreview,
    exports: exportService,
  });
  return { themePreview, activeSearch, exportService, searchPanels };
}

/** The tag decorations and hover, the completions, and the task editor's actions. */
function createEditorProviders(context: vscode.ExtensionContext, core: Core, preferences: PreferenceParts) {
  const { indexer } = core;
  const tagDecorations = new EditorTagDecorations((uri) => indexer.isNotesFile(uri)).register();
  // Which entry a line of a note pins, and whether it is pinned, for the
  // hover and Find's rows alike.
  const pins = new PinService({ index: indexer, store: preferences.pins });
  /**
   * Hands the hover a fresh way to ask whether a line is pinned. The hover
   * on an entry offers to pin it, so it has to know which entries are
   * pinned; PinService answers, and a change redraws the hovers.
   */
  const readPinned = (): void => {
    tagDecorations.setPinnedReader((filePath, line) =>
      pins.isLinePinned(indexer.getFilePath(vscode.Uri.file(filePath)), line),
    );
  };
  readPinned();
  context.subscriptions.push(preferences.repository.onDidChange(() => readPinned()));
  const tagSuggestions = new TagCompletionProvider(indexer).register();
  const taskMetadataSuggestions = new TaskMetadataCompletionProvider(indexer).register();
  context.subscriptions.push(new SlashMenuProvider(indexer).register());
  context.subscriptions.push(new StatusSuggestionsProvider((uri) => indexer.isNotesFile(uri)).register());
  const taskEditorActions = new TaskEditorActions();
  const taskLineContext = new TaskLineContext();
  return { tagDecorations, pins, tagSuggestions, taskMetadataSuggestions, taskEditorActions, taskLineContext };
}

/** Whether a workspace folder with no notes folder set looks like a code repository. */
async function readsWholeRepository(): Promise<boolean> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (!readNotesFolder(folder) && (await looksLikeCodeRepository(folder))) {
      return true;
    }
  }
  return false;
}

/**
 * A workspace's first index says what it read, once; a very large one is
 * worth one word about leaving folders out, said once, and only when nothing
 * is left out yet.
 */
function offerExcludeHint(
  context: vscode.ExtensionContext,
  indexer: IndexRoles<vscode.Uri>,
  newWorkspace: boolean,
): void {
  void indexer.ready.then(async () => {
    const notes = indexer.getSnapshot().files.size;
    const exclude = vscode.workspace.getConfiguration('deckard').get<Record<string, unknown>>('exclude', {});
    const storage = getSampleStorageUri(context.globalStorageUri);
    const samples = SAMPLE_FOLDER_NAMES.map((name) => vscode.Uri.joinPath(storage, name).toString());
    const summarized = await summarizeFirstIndex(
      context,
      indexer.getSnapshot(),
      {
        newToDeckard: newWorkspace,
        hasFolder: (vscode.workspace.workspaceFolders ?? []).length > 0,
        isSample: (vscode.workspace.workspaceFolders ?? []).some((folder) => samples.includes(folder.uri.toString())),
      },
      {
        excludeHintShownKey: EXCLUDE_HINT_SHOWN,
        excludeIsEmpty: Object.keys(exclude ?? {}).length === 0,
        wholeRepository: await readsWholeRepository(),
      },
    );
    if (
      summarized ||
      notes < LARGE_WORKSPACE_NOTES ||
      Object.keys(exclude ?? {}).length > 0 ||
      context.workspaceState.get<boolean>(EXCLUDE_HINT_SHOWN)
    ) {
      return;
    }
    await context.workspaceState.update(EXCLUDE_HINT_SHOWN, true);
    const open = openSettingAction('exclude');
    const choice = await vscode.window.showInformationMessage(
      `Deckard read ${notes.toLocaleString('en-US')} files. If some folders hold Markdown you do not want in the index, such as exported docs or dependencies, the "${settingLabel('exclude')}" setting leaves them out and makes every scan faster.`,
      open.title,
    );
    if (choice === open.title) {
      await open.run();
    }
  });
}

/**
 * The walkthrough checks its first steps off when there is a note, and a
 * tag, in the index, rather than when a button in it is pressed.
 */
function syncWalkthroughContext(context: vscode.ExtensionContext, indexer: IndexRoles<vscode.Uri>): void {
  const sync = (index: {
    files: Map<string, { links: readonly string[] }>;
    tags: Map<string, unknown>;
    tasks: Map<string, unknown>;
  }): void => {
    void vscode.commands.executeCommand('setContext', 'deckard.hasNotes', index.files.size > 0);
    void vscode.commands.executeCommand('setContext', 'deckard.hasTags', index.tags.size > 0);
    void vscode.commands.executeCommand('setContext', 'deckard.hasTasks', index.tasks.size > 0);
    void vscode.commands.executeCommand('setContext', 'deckard.hasLinks', [...index.files.values()].some((file) => file.links.length > 0));
  };
  context.subscriptions.push(indexer.onDidUpdate(sync));
}

/** The context keys and editor marks that follow the active note and Undo. */
function createEditorContexts(context: vscode.ExtensionContext, core: Core, preferences: PreferenceParts): void {
  const { indexer, history } = core;
  // The palette offers Pin or Unpin by what the cursor is in, and Undo Last
  // Change only while there is a change to take back.
  const activePinContext = new ActivePinContext(indexer, { reader: preferences.repository, pins: preferences.pins });
  // The title bar offers Deckard's button on a note, and the arrows between
  // days on a daily note.
  context.subscriptions.push(
    new ActiveNoteContext(indexer),
    // A task's metadata steps back, and an overdue task says so on its line.
    new TaskLineDecorations((uri) => indexer.isNotesFile(uri)).register(),
    // A repeat rule Deckard cannot read is marked before the task is done.
    new RepeatRuleHealth((uri) => indexer.isNotesFile(uri)).register(),
    // The words in the note, or the selection, beside the task count.
    new WordCountStatusBar((uri) => indexer.isNotesFile(uri)),
  );
  void vscode.commands.executeCommand(
    'setContext',
    'deckard.canUndo',
    history.lastWrite !== undefined,
  );
  context.subscriptions.push(
    activePinContext,
    history.onDidChange((canUndo) =>
      vscode.commands.executeCommand('setContext', 'deckard.canUndo', canUndo),
    ),
  );
}

/** The lenses, the assistant's tools and MCP server, and the link services. */
function createLinksAndAssistance(context: vscode.ExtensionContext, core: Core, preferences: PreferenceParts) {
  const { indexer, history, workspace } = core;
  const editorReferences = new EditorReferences(indexer).register();
  const editorLenses = new EditorLenses(indexer).register();
  const assistantTools = new AssistantTools(indexer, history);
  const mcpServer = new DeckardMcpServer({
    indexer,
    history,
    secrets: context.secrets,
    tools: readManifestTools(
      context.extension.packageJSON.contributes?.languageModelTools,
    ),
    version: context.extension.packageJSON.version,
  });
  void mcpServer.restart();
  // Notes are offered in the order Find ranks them, opened ones first.
  const linkSuggestions = new WikiLinkCompletionProvider(indexer, preferences.repository).register();
  const entitySuggestions = new EntityHeadingSuggestions((uri) =>
    indexer.isNotesFile(uri),
  ).register();
  const linkHealth = new LinkHealth(indexer);
  // Which links a rename carries and which mentions become links, and the
  // notes links name, each decided once for every command that asks.
  const links = new LinkService({ index: indexer, notes: vscodeLiveNotes, findUnlinkedMentions, linkStyle: readLinkStyle });
  const linkNotes = new LinkNoteService(workspace);
  const linkMaintenance = new LinkMaintenance(indexer, links);
  return {
    editorReferences,
    editorLenses,
    assistantTools,
    mcpServer,
    linkSuggestions,
    entitySuggestions,
    linkHealth,
    links,
    linkNotes,
    linkMaintenance,
  };
}

/**
 * The sidebar calendar, the calendar page, and the active day and Home they
 * share. A tag in a day's task opens on a search page, as from Related Notes.
 */
function createCalendar(
  context: vscode.ExtensionContext,
  { core, preferences, writes, search }: {
    core: Core;
    preferences: PreferenceParts;
    writes: Omit<Writes, 'addTask'>;
    search: ReturnType<typeof createSearch>;
  },
) {
  const { indexer } = core;
  const { themePreview, searchPanels } = search;
  const openTag = (tagKey: string) => searchPanels.show(tagKey);
  // Whether the day panel shows and weekends are drawn, which the
  // Calendar's menu and the page's gear keep.
  const calendarPreferences = { reader: preferences.repository, display: preferences.display };
  const calendar = new CalendarView({
    indexer,
    writes: writes.tasks,
    themePreview,
    extensionUri: context.extensionUri,
    openTag,
    preferences: calendarPreferences,
  });
  const activeCalendar = new ActiveCalendar();
  const activeHome = new ActiveHome();
  context.subscriptions.push(activeCalendar, activeHome);
  const calendarPage = new CalendarPanel({
    indexer,
    extensionUri: context.extensionUri,
    writes: writes.tasks,
    themePreview,
    activeCalendar,
    openTag,
    preferences: calendarPreferences,
  });
  context.subscriptions.push(calendarPage);
  return { calendar, activeCalendar, activeHome, calendarPage };
}

/** What {@link createHome} builds the Task Board, Home, and Find from. */
interface HomeParts {
  core: Core;
  preferences: PreferenceParts;
  writes: Omit<Writes, 'addTask'>;
  search: ReturnType<typeof createSearch>;
  /** Which entry a line pins, for Find's rows. */
  pins: PinService;
  linkNotes: LinkNoteService<vscode.Uri>;
  whatsNew: WhatsNew;
  tryNext: TryNextLedger;
}

/** The Task Board, Home, and Find, which open each other and the search pages. */
function createHome(context: vscode.ExtensionContext, parts: HomeParts) {
  const { core, preferences, writes, search, whatsNew, tryNext } = parts;
  const { indexer, history } = core;
  const { searchPanels, activeSearch, themePreview, exportService } = search;
  const { repository, favorites, usage, homeWidgets, pins, savedSearches, display, tagRenames, taskLayout } = preferences;
  const taskBoard = new TaskBoardPanel({
    indexer,
    preferences: { reader: repository, taskLayout, savedSearches, homeWidgets, usage },
    extensionUri: context.extensionUri,
    openTag: (tagKey) => searchPanels.show(tagKey),
    activeSearch,
    writes: writes.tasks,
    themePreview,
    exports: exportService,
  });
  const dashboard = new DashboardPanel({
    indexer,
    preferences: { reader: repository, favorites, usage, homeWidgets, pins, savedSearches, display, tagRenames },
    extensionUri: context.extensionUri,
    navigation: {
      openTag: (tagKey) => searchPanels.show(tagKey),
      openSearch: (query) => searchPanels.showQuery(query),
      openTaskBoard: (query) => taskBoard.show(query),
      openDailyNote: async () => {
        await createDailyNoteWithRollover(indexer, history, undefined, writes.rollover);
      },
      quickAdd: (text) => captureToToday(text),
      createHubNote: async (tagKey) => {
        await createHubNote(indexer, tagKey);
      },
      addNextAction: (tagLabel) => captureNextAction(tagLabel),
    },
    whatsNew,
    tryNext,
    writes: writes.tasks,
    themePreview,
  });
  const quickFind = new QuickFind({
    indexer,
    preferences: { reader: repository, favorites, usage, savedSearches, pins },
    actions: {
      openTag: (tagKey) => searchPanels.show(tagKey),
      openSavedFilter: (filterId) => dashboard.openSavedFilter(filterId),
      showSearch: (query) => searchPanels.showQuery(query),
      moveTask: (task) => moveTasks(indexer, preferences.move, writes.tasks, [task]),
    },
    writes: writes.tasks,
    pins: parts.pins,
    linkNotes: parts.linkNotes,
  });
  return { taskBoard, dashboard, quickFind };
}

/** What {@link createSidebarAndPages} builds the sidebar and the other pages from. */
interface SidebarParts {
  core: Core;
  preferences: PreferenceParts;
  search: ReturnType<typeof createSearch>;
  calendar: ReturnType<typeof createCalendar>;
  dashboard: DashboardPanel;
  whatsNew: WhatsNew;
  writes: Omit<Writes, 'addTask'>;
}

/** Related Notes in the sidebar, and Stats, Help, the Notes Graph, the note page, and the debug page. */
function createSidebarAndPages(context: vscode.ExtensionContext, parts: SidebarParts) {
  const { indexer, history } = parts.core;
  const { repository, display, usage, tagRenames } = parts.preferences;
  const { searchPanels, activeSearch, themePreview } = parts.search;
  const { activeCalendar, activeHome } = parts.calendar;
  // The note page in front, whose note Related Notes follows.
  const activeNotePage = new ActiveNotePage();
  context.subscriptions.push(activeNotePage);
  const sidebarNotes = new SidebarNotesView({
    indexer,
    preferences: { reader: repository, display, usage, tagRenames },
    activeSearch,
    onOpenTag: (tagKey) => searchPanels.show(tagKey),
    extensionVersion: context.extension.packageJSON.version,
    extensionUri: context.extensionUri,
    activeCalendar,
    activeHome,
    activeNotePage,
    history,
    themePreview,
  });
  parts.dashboard.activeHome = activeHome;
  const stats = new StatsPanel({
    indexer,
    preferences: { reader: repository, usage },
    extensionUri: context.extensionUri,
    onOpenTag: async (tagKey) => {
      await searchPanels.show(tagKey);
    },
    themePreview,
  });
  const help = new HelpPanel({
    extensionUri: context.extensionUri,
    themePreview,
    manifest: context.extension.packageJSON.contributes,
    whatsNew: parts.whatsNew,
    indexer,
  });
  const notesGraph = new NotesGraphPanel({
    indexer,
    extensionUri: context.extensionUri,
    onGraphContext: async (graphContext, reveal) => {
      if (graphContext) {
        await sidebarNotes.showGraphConnections(graphContext, reveal);
      } else {
        sidebarNotes.clearGraphConnections();
      }
    },
    themePreview,
  });
  const relatedNotesDebug = new RelatedNotesDebugPanel({
    sidebarNotes,
    extensionUri: context.extensionUri,
    themePreview,
  });
  const notePage = new NotePagePanel({
    indexer,
    writes: parts.writes.tasks,
    extensionUri: context.extensionUri,
    onOpenTag: async (tagKey) => {
      await searchPanels.show(tagKey);
    },
    themePreview,
    activeNotePage,
    onOpenSearch: (query) => searchPanels.showQuery(query),
  });
  const taskStatuses = new TaskStatusesPanel({ indexer, preferences: repository, history, extensionUri: context.extensionUri, themePreview });
  return { sidebarNotes, stats, help, notesGraph, relatedNotesDebug, notePage, activeNotePage, taskStatuses };
}

/** The Outline, the query blocks, the Tasks view and its service, the status bar, and Add Task. */
function createTreesAndAddTask(context: vscode.ExtensionContext, core: Core, preferences: PreferenceParts, writes: Omit<Writes, 'addTask'>) {
  const { indexer } = core;
  const outline = new OutlineTreeProvider(indexer, preferences.repository);
  // A query block's checkboxes link to Deckard's URI handler, which ticks them.
  const queryBlocks = new QueryBlocks(indexer, {
    base: `${vscode.env.uriScheme}://${context.extension.id}`,
    writes: writes.tasks,
  });
  // What the Tasks view lists, and what dropping or checking a task in it
  // writes, over the index and the settings.
  const agendaService = new AgendaService<AgendaGroup>({
    configuration: core.workspace,
    index: indexer,
    readQueryContext: () => readQueryContext(),
    model: {
      select: selectAgendaTasks,
      build: createAgenda,
      countDue: countDueTasks,
      listOverdue: selectOverdueTasks,
      resolveMove: resolveTaskMove,
      isNamespaceName,
    },
    // How the view is grouped and sorted, which its Group and Sort buttons keep.
    preferences: {
      get value() {
        return preferences.repository.current;
      },
      setAgendaGrouping: (groupBy, namespace) => preferences.taskLayout.setAgendaGrouping(groupBy, namespace),
      setAgendaSort: (sort) => preferences.taskLayout.setAgendaSort(sort),
    },
  });
  const agenda = new AgendaTreeProvider(
    indexer,
    { agenda: agendaService, writes: writes.tasks, contextKeys: new AgendaContextKeys() },
    { reader: preferences.repository, taskLayout: preferences.taskLayout },
  );
  const taskStatusBar = new TaskStatusBar(indexer, context.globalState);
  // Where Add Task writes outside the note being edited, and the headings
  // it remembers.
  const addTask: AddTaskContext = {
    indexer,
    preferences: preferences.repository,
    captures: new CaptureService({
      index: indexer,
      notes: createCaptureNotes(indexer),
      recentHeadings: preferences.usage,
    }),
  };
  return { outline, queryBlocks, agendaService, agenda, taskStatusBar, addTask };
}

/** The command each button on the unreadable-notes warning runs. */
const UNREADABLE_NOTE_ACTIONS: Readonly<Record<string, string>> = {
  'Open Stats': 'deckard.showStats',
  'Open Log': 'deckard.showLog',
};

/**
 * A note that could not be read is missing from every search, which looks
 * like a bad search rather than a missing note. Say so, once per note, the
 * moment it happens - and no more than that, since an index updates on
 * every save.
 */
function warnOfUnreadableNotes(context: vscode.ExtensionContext, indexer: IndexRoles<vscode.Uri>): void {
  let unreadableSeen = 0;
  context.subscriptions.push(
    indexer.onDidUpdate(() => {
      const unreadable = indexer.getUnreadable();
      if (unreadable.length > unreadableSeen) {
        const count = unreadable.length;
        void vscode.window
          .showWarningMessage(
            // The reason is in the log already, where the scanner wrote it.
            count === 1
              ? `Deckard could not read ${unreadable[0].filePath}, so it is missing from search and Home.`
              : `Deckard could not read ${count} files, so they are missing from search and Home.`,
            'Open Stats',
            'Open Log',
          )
          .then((choice) => {
            const command = choice && UNREADABLE_NOTE_ACTIONS[choice];
            if (command) {
              void vscode.commands.executeCommand(command);
            }
          });
      }
      unreadableSeen = unreadable.length;
    }),
  );
}

/**
 * Keeps the derived counts in step with the index, as `tidyAfterUpdate`
 * does after each update. Also starts counting visits to notes.
 */
function tidyPreferencesOnUpdate(
  context: vscode.ExtensionContext,
  indexer: IndexRoles<vscode.Uri>,
  preferences: PreferenceParts,
): void {
  // A heading's id changes when a line above it does, and every id in a
  // note changes when its path does; what names them follows them to the
  // new ids before anything is pruned.
  let previousIndex = indexer.getSnapshot();
  /**
   * Carries what names a moved heading or note to its new id, then prunes
   * what names a note gone from the index; nothing is done while the index
   * is stale or unchanged.
   */
  const tidy = (): void => {
    const index = indexer.getSnapshot();
    // The cache's notes at a warm start are not checked yet: a note gone
    // from them may only be unread, so nothing is pruned for it. The prune
    // after start runs once the check is done.
    if (indexer.isStale || index === previousIndex) {
      return;
    }
    const previous = previousIndex;
    previousIndex = index;
    void tidyAfterUpdate(previous, index, preferences).catch((error: unknown) =>
      reportError('Could not tidy the preferences after an index update', error),
    );
  };
  context.subscriptions.push(
    indexer.onDidUpdateView(tidy, {
      name: 'tidy of derived counts',
      priority: () => VIEW_PRIORITY.housekeeping,
    }),
    new NoteVisits(indexer, { reader: preferences.repository, usage: preferences.usage }),
  );
}

/** Registers the two sidebar webviews and creates the Outline and Tasks trees. */
function registerViews(context: vscode.ExtensionContext, views: Omit<Views, 'taskStatusBar'>): void {
  const { sidebarNotes, calendar, outline, agenda } = views;
  context.subscriptions.push(
    // Neither Related Notes nor the Calendar is kept running while hidden
    // (Q1 of docs/implementation/20-webviews.md); their controllers say so too.
    vscode.window.registerWebviewViewProvider('deckard.relatedNotes', sidebarNotes, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.window.registerWebviewViewProvider('deckard.calendar', calendar, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );
  const outlineView = vscode.window.createTreeView('deckard.outline', {
    treeDataProvider: outline,
    showCollapseAll: true,
  });
  outline.attach(outlineView);
  context.subscriptions.push(outlineView);
  const agendaView = vscode.window.createTreeView('deckard.agenda', {
    treeDataProvider: agenda,
    manageCheckboxStateManually: true,
    // Several tasks can be chosen and dated at once from the item menu.
    canSelectMany: true,
    // Dragging a task onto another ranks it there; onto a group, it joins
    // that group through the same checked edit the board writes.
    dragAndDropController: agenda,
  });
  agenda.attach(agendaView);
  context.subscriptions.push(agendaView);
}

/**
 * What activation always made after the views and between its command
 * registrations, in that order: two context keys, section focus, the page
 * serializers, the excluded and parked folders' context keys, and Move to…'s
 * code action. Each was made where it was registered; only the commands
 * around them moved out, to the features.
 */
function createLateContexts(context: vscode.ExtensionContext, core: Core, pages: Pages, preferences: PreferenceParts): SectionFocus {
  // The Calendar's day panel and weekends, and the Outline following the
  // cursor, as context keys their menus and titles read.
  context.subscriptions.push(publishViewChoices(preferences.repository));
  // Every page's width, which its gear keeps in the preferences.
  context.subscriptions.push(startPageWidth({ reader: preferences.repository, display: preferences.display }));
  context.subscriptions.push(startZenMode(context.globalState));
  // Which note a section is focused in, which leaving it clears.
  const sectionFocus = new SectionFocus();
  context.subscriptions.push(sectionFocus);
  registerSerializers(context, pages);
  context.subscriptions.push(new ExcludedFoldersContext(), new ParkingContext(core.indexer));
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { pattern: '**/*.md' },
      new MoveToActions(core.indexer),
      { providedCodeActionKinds: [vscode.CodeActionKind.RefactorMove] },
    ),
  );
  return sectionFocus;
}

/** Lets VS Code restore each page left open when the window closed. */
function registerSerializers(context: vscode.ExtensionContext, pages: Pages): void {
  const { dashboard, stats, help, notesGraph, calendar, taskBoard, search, notePage } = pages;
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('deckard.notePage', {
      deserializeWebviewPanel: (webviewPanel, state) => notePage.restore(webviewPanel, state),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.dashboard', {
      deserializeWebviewPanel: (webviewPanel) =>
        dashboard.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.stats', {
      deserializeWebviewPanel: (webviewPanel) => stats.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.help', {
      deserializeWebviewPanel: (webviewPanel) => help.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.notesGraph', {
      deserializeWebviewPanel: (webviewPanel) =>
        notesGraph.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.calendarPage', {
      deserializeWebviewPanel: (webviewPanel) => calendar.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.taskBoard', {
      deserializeWebviewPanel: (webviewPanel, state) =>
        taskBoard.restore(webviewPanel, state),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.tagOverview', {
      deserializeWebviewPanel: (webviewPanel, state) =>
        search.restore(webviewPanel, state),
    }),
  );
}
