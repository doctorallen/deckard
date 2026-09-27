import { captureNextAction } from './ui/commands/taskBoardActions';
import { setTaskPolicy } from './core/taskPolicy';
import { readWeekStart } from './ui/commands/datePrompt';
import { openDailyNoteForDate } from './ui/commands/dailyNoteForDate';
import * as vscode from 'vscode';

import { setQueryIdentity,
  setQueryWeekStart } from './core/query/queryEvaluator';
import { PreferencesStore } from './core/storage/preferences';
import { SearchStore } from './core/storage/searchStore';
import { setTimingLog } from './core/timing';
import { WorkspaceIndexer } from './core/workspace/indexer';
import { VIEW_PRIORITY } from './core/workspace/publishing';
import { capture, CaptureDrafts, captureToToday } from './ui/commands/capture';
import { createHubNote } from './ui/commands/hubNote';
import {
  createDailyNote,
  openAdjacentDailyNote,
} from './ui/commands/dailyNote';
import {
  createDailyNoteWithRollover,
  rollTasksForward,
} from './ui/commands/rollover';
import {
  openPeriodicNoteWithReview,
  writeReviewCommand,
} from './ui/commands/review';
import {
  openTask,
  quoteTaskTitle,
  setTaskRankKeeper,
} from './ui/commands/taskActions';
import {
  editTaskCommand,
  TaskEditorActions,
  TaskLineContext,
} from './ui/commands/taskEditor';
import { breakIntoStepsCommand } from './ui/commands/taskSteps';
import { newNoteFromTemplate } from './ui/commands/templates';
import { toggleTaskDoneCommand } from './ui/commands/toggleTaskDone';
import { ActiveNoteContext } from './ui/commands/activeNoteContext';
import { noteActionsCommand } from './ui/commands/noteActions';
import { TaskLineDecorations } from './ui/commands/taskLineDecorations';
import { RepeatRuleHealth } from './ui/commands/repeatRuleHealth';
import { WordCountStatusBar } from './ui/views/wordCountStatusBar';
import {
  focusSectionCommand,
  trackSectionFocus,
  unfoldAllSectionsCommand,
} from './ui/commands/focusSection';
import {
  excludeFolderCommand,
  ExcludedFoldersContext,
  includeFolderCommand,
} from './ui/commands/excludeFolders';
import {
  ParkingContext,
  parkFolders,
  parkNotes,
  parkTag,
  unparkFolders,
  unparkNotes,
  unparkTag,
} from './ui/commands/parking';
import { extractHeadingCommand } from './ui/commands/extractHeading';
import { moveTasks, moveToCommand, MoveToActions } from './ui/commands/moveTo';
import { EntityHeadingSuggestions } from './ui/commands/entitySuggestions';
import {
  CREATE_LINKED_NOTE_COMMAND,
  CREATE_MISSING_NOTES_COMMAND,
  createLinkedNote,
  createMissingNotes,
  LinkHealth,
} from './ui/commands/linkHealth';
import { CalendarView } from './ui/webview/calendar';
import { CalendarPanel } from './ui/webview/calendarPage';
import { readManifestTools } from './core/mcp/mcpProtocol';
import { DeckardMcpServer } from './ui/commands/mcpServer';
import { linkCurrentHeading } from './ui/commands/linkEntity';
import { ActivePinContext, setNotePinnedCommand } from './ui/commands/pinNote';
import {
  askForDueDate,
  dueDateFor,
  DueChoice,
  countLoad,
  RescheduleContext,
  rescheduleTasks,
  setTasksDue,
} from './ui/commands/agendaActions';
import { createPinForLine } from './ui/state/pinnedNotes';
import { pinKey } from './core/storage/preferences';
import {
  LinkMaintenance,
  renameHeadingCommand,
} from './ui/commands/linkMaintenance';
import { WikiLinkCompletionProvider } from './ui/commands/linkSuggestions';
import {
  undoLastWorkspaceWrite,
  workspaceWrites,
} from './ui/commands/workspaceWrites';
import { moveInlineTagsToFrontmatter } from './ui/commands/moveTagsToFrontmatter';
import { NoteVisits } from './ui/commands/noteVisits';
import { carrySectionIds } from './ui/state/frecency';
import { mergeIndexedTag, renameIndexedTag } from './ui/commands/renameTag';
import {
  EditorTagDecorations,
  isMarkdownDocument,
} from './ui/commands/tagDecorations';
import { TagCompletionProvider } from './ui/commands/tagSuggestions';
import { TaskMetadataCompletionProvider } from './ui/commands/taskMetadataSuggestions';
import { EditorLenses } from './ui/commands/editorLenses';
import {
  LINK_MENTIONS_COMMAND,
  linkMentions,
} from './ui/commands/unlinkedMentions';
import { EditorReferences } from './ui/commands/editorReferences';
import { AssistantTools } from './ui/commands/assistantTools';
import { QuickFind } from './ui/commands/quickFind';
import { DashboardPanel } from './ui/webview/dashboard';
import { HelpPanel } from './ui/webview/help';
import { NotesGraphPanel, readNotesGraphOptions } from './ui/webview/notesGraph';
import { SidebarNotesView } from './ui/webview/sidebarNotes';
import { RelatedNotesDebugPanel } from './ui/webview/relatedNotesDebug';
import { StatsPanel } from './ui/webview/stats';
import { TaskBoardPanel } from './ui/webview/taskBoard';
import { ActiveSearch } from './ui/webview/activeSearch';
import { SearchPanels } from './ui/webview/searchPage';
import { setZenMode, syncZenModeContext } from './ui/webview/zenMode';
import { tidyPreferences } from './ui/commands/tidyPreferences';
import { checkSetup } from './ui/commands/checkSetup';
import {
  createSampleWorkspace,
  getSampleStorageUri,
  SAMPLE_FOLDER_NAME,
  showSampleReadmeOnce,
} from './ui/commands/sampleWorkspace';
import { LARGE_WORKSPACE_NOTES, summarizeFirstIndex } from './ui/commands/firstIndex';
import { PreferenceSnapshots } from './core/storage/preferenceSnapshots';
import {
  exportPreferences,
  importPreferences,
  restorePreferences,
} from './ui/commands/preferenceBackups';
import {
  OutlineTreeProvider,
  pickOutlineTag,
  setOutlineFollowCursor,
  syncOutlineFollowCursorContext,
} from './ui/views/outlineTree';
import { OutlineNode } from './ui/state/outlineState';
import { QueryBlocks } from './ui/preview/queryBlocks';
import { listOverdueTasks, AgendaNode,
  AgendaTreeProvider,
  getAgendaQuery,
  pickAgendaGrouping,
} from './ui/views/agendaTree';
import { countDueTasks, TaskStatusBar } from './ui/views/taskStatusBar';
import { selectAgendaTasks } from './ui/state/agendaState';
import { insertQueryBlock } from './ui/commands/insertQueryBlock';
import { isWhatsNewShown, WhatsNew } from './ui/commands/whatsNew';
import { chooseTheme } from './ui/commands/chooseTheme';
import { TryNextLedger } from './ui/commands/tryNext';
import { openSettingAction, settingLabel } from './ui/commands/notify';
import { settingTarget, writeSetting } from './ui/commands/settings';

let activeServices: ExtensionServices | undefined;

/**
 * What the extension exports. VS Code's Markdown preview calls
 * `extendMarkdownIt` to draw ```deckard query blocks.
 */
export interface DeckardExports {
  extendMarkdownIt: QueryBlocks['extendMarkdownIt'];
}

/**
 * Creates the extension's service graph and registers every VS Code entrypoint.
 *
 * Keeping services alive from one activation boundary lets panels, the sidebar,
 * decorations, and completion all observe the same index and preference store.
 */
/** A first index this large is offered deckard.exclude, once. */
const EXCLUDE_HINT_SHOWN = 'deckard.excludeHintShown';

export function activate(context: vscode.ExtensionContext): DeckardExports {
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
    isShown: isWhatsNewShown,
  });
  context.subscriptions.push(whatsNew);
  // What Home's Try next has been told, kept with the workspace. A
  // suggestion is retired for good once its command runs from anywhere.
  const tryNext = new TryNextLedger(context.workspaceState);
  context.subscriptions.push(tryNext);
  void whatsNew.onActivate();
  // A sample opened from Create a Sample Workspace shows its README once.
  void showSampleReadmeOnce(context);
  // One log for the whole extension. Its level, set from the Output panel,
  // decides how much of Deckard's timing it keeps.
  const log = vscode.window.createOutputChannel('Deckard', { log: true });
  setTimingLog(log);
  context.subscriptions.push(
    log,
    { dispose: () => setTimingLog(undefined) },
    vscode.commands.registerCommand('deckard.showLog', () => log.show()),
  );
  log.info(
    `Deckard ${String(context.extension.packageJSON.version)} activated.`,
  );
  // Who `is:mine` means. The evaluator is given it once rather than reading
  // settings from six call sites.
  const readIdentity = (): void => {
    setQueryIdentity(
      vscode.workspace.getConfiguration('deckard').get<string>('me', ''),
    );
  };
  readIdentity();
  // The day a search's this-week starts on, set the same way.
  setQueryWeekStart(readWeekStart());
  // When an overdue task needs a new date, and where a task's status is
  // written, for every view that lists tasks.
  const readTaskPolicy = (): void => {
    const configuration = vscode.workspace.getConfiguration('deckard');
    const days = configuration.get<number>('tasks.needsNewDateAfterDays', 30);
    const onHold = configuration.get<unknown>('tasks.onHoldStatuses', ['waiting', 'someday']);
    setTaskPolicy({
      needsNewDateAfterDays: Number.isFinite(days) ? Math.max(0, Math.round(days)) : 30,
      statusNamespace:
        configuration.get<string>('board.statusNamespace', 'status').trim() || 'status',
      onHoldStatuses: Array.isArray(onHold)
        ? onHold.filter((status): status is string => typeof status === 'string')
            .map((status) => status.trim().toLowerCase())
            .filter(Boolean)
        : ['waiting', 'someday'],
    });
  };
  readTaskPolicy();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('deckard.me')) {
        readIdentity();
      }
      if (event.affectsConfiguration('deckard.calendar.weekStart')) {
        setQueryWeekStart(readWeekStart());
      }
      if (
        event.affectsConfiguration('deckard.tasks') ||
        event.affectsConfiguration('deckard.board.statusNamespace')
      ) {
        readTaskPolicy();
      }
    }),
    { dispose: () => setTaskPolicy() },
    { dispose: () => setQueryIdentity(undefined) },
    { dispose: () => setQueryWeekStart(0) },
  );
  const indexer = new WorkspaceIndexer(
    undefined,
    new SearchStore(context.storageUri),
    {
      version: String(context.extension.packageJSON.version),
      // A developer's parser edits do not change the version, so only an
      // installed Deckard starts from the notes the cache kept.
      readCache: context.extensionMode === vscode.ExtensionMode.Production,
    },
  );
  // Favorites, pins and view counts name what is in a workspace, so they are
  // kept with it. A window with no folder open has no workspace to own them
  // and nothing to index, so it reads the machine-wide store alone.
  const preferences = new PreferencesStore(
    context.globalState,
    vscode.workspace.workspaceFolders?.length
      ? context.workspaceState
      : undefined,
  );
  void preferences.initialize();
  // A copy of what this workspace remembers, a moment after each change,
  // so one bad write is something a reader can take back.
  const snapshots = new PreferenceSnapshots(context.storageUri, preferences);
  context.subscriptions.push(snapshots);
  // A task's id comes from its own text, so an edit Deckard writes makes it a
  // new task to anything keyed by id. This keeps its place in a ranked list
  // across the edit, and across an Undo of it.
  setTaskRankKeeper((previousId, nextId) => {
    void preferences.replaceTaskInOrder(previousId, nextId);
  });
  context.subscriptions.push({ dispose: () => setTaskRankKeeper(undefined) });
  const activeSearch = new ActiveSearch();
  const searchPanels = new SearchPanels(
    indexer,
    preferences,
    context.extensionUri,
    activeSearch,
  );
  const tagDecorations = new EditorTagDecorations((uri) => indexer.isNotesFile(uri));
  // The hover on an entry offers to pin it, so it has to know which entries
  // are pinned; preferences answer, and a change redraws the hovers.
  const readPinned = (): void => {
    tagDecorations.setPinnedReader((filePath, line) => {
      const pin = createPinForLine(
        indexer.getSnapshot(),
        indexer.getFilePath(vscode.Uri.file(filePath)),
        line,
      );
      return pin !== undefined && preferences.isPinned(pinKey(pin));
    });
  };
  readPinned();
  context.subscriptions.push(preferences.onDidChange(() => readPinned()));
  const tagSuggestions = new TagCompletionProvider(indexer);
  const taskMetadataSuggestions = new TaskMetadataCompletionProvider(indexer);
  const taskEditorActions = new TaskEditorActions();
  const taskLineContext = new TaskLineContext();
  // A workspace's first index says what it read, once; a very large one is
  // worth one word about leaving folders out, said once, and only when
  // nothing is left out yet.
  void indexer.ready.then(async () => {
    const notes = indexer.getSnapshot().files.size;
    const exclude = vscode.workspace.getConfiguration('deckard').get<Record<string, unknown>>('exclude', {});
    const sample = vscode.Uri.joinPath(getSampleStorageUri(context.globalStorageUri), SAMPLE_FOLDER_NAME).toString();
    const summarized = await summarizeFirstIndex(
      context,
      indexer.getSnapshot(),
      {
        newToDeckard: newWorkspace,
        hasFolder: (vscode.workspace.workspaceFolders ?? []).length > 0,
        isSample: (vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.toString() === sample),
      },
      { excludeHintShownKey: EXCLUDE_HINT_SHOWN, excludeIsEmpty: Object.keys(exclude ?? {}).length === 0 },
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
  // The walkthrough checks its first steps off when there is a note, and a
  // tag, in the index, rather than when a button in it is pressed.
  const syncWalkthroughContext = (index: {
    files: Map<string, unknown>;
    tags: Map<string, unknown>;
    tasks: Map<string, unknown>;
  }): void => {
    void vscode.commands.executeCommand('setContext', 'deckard.hasNotes', index.files.size > 0);
    void vscode.commands.executeCommand('setContext', 'deckard.hasTags', index.tags.size > 0);
    void vscode.commands.executeCommand('setContext', 'deckard.hasTasks', index.tasks.size > 0);
  };
  context.subscriptions.push(indexer.onDidUpdate(syncWalkthroughContext));
  // The palette offers Pin or Unpin by what the cursor is in, and Undo Last
  // Change only while there is a change to take back.
  const activePinContext = new ActivePinContext(indexer, preferences);
  // The title bar offers Deckard's button on a note, and the arrows between
  // days on a daily note.
  context.subscriptions.push(
    new ActiveNoteContext(indexer),
    // A task's metadata steps back, and an overdue task says so on its line.
    new TaskLineDecorations((uri) => indexer.isNotesFile(uri)),
    // A repeat rule Deckard cannot read is marked before the task is done.
    new RepeatRuleHealth((uri) => indexer.isNotesFile(uri)),
    // The words in the note, or the selection, beside the task count.
    new WordCountStatusBar((uri) => indexer.isNotesFile(uri)),
  );
  void vscode.commands.executeCommand(
    'setContext',
    'deckard.canUndo',
    workspaceWrites.lastWrite !== undefined,
  );
  context.subscriptions.push(
    activePinContext,
    workspaceWrites.onDidChange((canUndo) =>
      vscode.commands.executeCommand('setContext', 'deckard.canUndo', canUndo),
    ),
  );
  const editorReferences = new EditorReferences(indexer);
  const editorLenses = new EditorLenses(indexer);
  const assistantTools = new AssistantTools(indexer);
  const mcpServer = new DeckardMcpServer(
    indexer,
    context.secrets,
    readManifestTools(
      context.extension.packageJSON.contributes?.languageModelTools,
    ),
    context.extension.packageJSON.version,
  );
  void mcpServer.restart();
  // Notes are offered in the order Find ranks them, opened ones first.
  const linkSuggestions = new WikiLinkCompletionProvider(indexer, preferences);
  const entitySuggestions = new EntityHeadingSuggestions((uri) =>
    indexer.isNotesFile(uri),
  );
  const linkHealth = new LinkHealth(indexer);
  const linkMaintenance = new LinkMaintenance(indexer);
  const calendar = new CalendarView(indexer);
  const calendarPage = new CalendarPanel(indexer, context.extensionUri);
  context.subscriptions.push(calendarPage);
  const taskBoard = new TaskBoardPanel(
    indexer,
    preferences,
    context.extensionUri,
    (tagKey) => searchPanels.show(tagKey),
    activeSearch,
  );
  const dashboard = new DashboardPanel(
    indexer,
    preferences,
    context.extensionUri,
    {
      openTag: (tagKey) => searchPanels.show(tagKey),
      openSearch: (query) => searchPanels.showQuery(query),
      openTaskBoard: (query) => taskBoard.show(query),
      openDailyNote: async () => {
        await createDailyNoteWithRollover(indexer);
      },
      quickAdd: (text) => captureToToday(text),
      createHubNote: async (tagKey) => {
        await createHubNote(indexer, tagKey);
      },
      addNextAction: (tagLabel) => captureNextAction(tagLabel),
    },
    whatsNew,
    tryNext,
  );
  const quickFind = new QuickFind(indexer, preferences, {
    openTag: (tagKey) => searchPanels.show(tagKey),
    openSavedFilter: (filterId) => dashboard.openSavedFilter(filterId),
    showSearch: (query) => searchPanels.showQuery(query),
    moveTask: (task) => moveTasks(indexer, preferences, [task]),
  });
  const sidebarNotes = new SidebarNotesView(
    indexer,
    preferences,
    activeSearch,
    (tagKey) => searchPanels.show(tagKey),
    context.extension.packageJSON.version,
  );
  const stats = new StatsPanel(
    indexer,
    preferences,
    context.extensionUri,
    async (tagKey) => {
      await searchPanels.show(tagKey);
    },
  );
  const help = new HelpPanel(
    context.extensionUri,
    context.extension.packageJSON.contributes,
    whatsNew,
  );
  const notesGraph = new NotesGraphPanel(
    indexer,
    context.extensionUri,
    async (graphContext, reveal) => {
      if (graphContext) {
        await sidebarNotes.showGraphConnections(graphContext, reveal);
      } else {
        sidebarNotes.clearGraphConnections();
      }
    },
  );
  const relatedNotesDebug = new RelatedNotesDebugPanel(
    sidebarNotes,
    context.extensionUri,
  );
  const outline = new OutlineTreeProvider(indexer);
  const queryBlocks = new QueryBlocks(indexer);
  const agenda = new AgendaTreeProvider(indexer, preferences);
  const taskStatusBar = new TaskStatusBar(indexer, context.globalState);
  // What was typed into Capture and not yet written, for this workspace.
  const captureDrafts = new CaptureDrafts(context.workspaceState);
  activeServices = {
    indexer,
    preferences,
    activeSearch,
    searchPanels,
    sidebarNotes,
    tagDecorations,
    tagSuggestions,
    linkSuggestions,
    entitySuggestions,
    dashboard,
    stats,
    help,
    notesGraph,
    relatedNotesDebug,
    outline,
    queryBlocks,
    agenda,
    taskStatusBar,
    taskMetadataSuggestions,
    taskEditorActions,
    taskLineContext,
    taskBoard,
    editorReferences,
    editorLenses,
    linkHealth,
    linkMaintenance,
    calendar,
    quickFind,
  };

  context.subscriptions.push(
    indexer,
    preferences,
    activeSearch,
    searchPanels,
    sidebarNotes,
    tagDecorations,
    tagSuggestions,
    linkSuggestions,
    entitySuggestions,
    dashboard,
    stats,
    help,
    notesGraph,
    relatedNotesDebug,
    outline,
    queryBlocks,
    agenda,
    taskStatusBar,
    taskMetadataSuggestions,
    taskEditorActions,
    taskLineContext,
    taskBoard,
    editorReferences,
    editorLenses,
    linkHealth,
    linkMaintenance,
    calendar,
    assistantTools,
    mcpServer,
    quickFind,
  );
  // A note that could not be read is missing from every search, which looks
  // like a bad search rather than a missing note. Say so, once per note, the
  // moment it happens - and no more than that, since an index updates on
  // every save.
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
            if (choice === 'Open Stats') {
              void vscode.commands.executeCommand('deckard.showStats');
            } else if (choice === 'Open Log') {
              void vscode.commands.executeCommand('deckard.showLog');
            }
          });
      }
      unreadableSeen = unreadable.length;
    }),
  );
  // A heading's id changes when a line above it does; its view count follows
  // it to the new id before anything is pruned.
  let previousIndex = indexer.getSnapshot();
  const tidy = (): void => {
    const index = indexer.getSnapshot();
    // The cache's notes at a warm start are not checked yet: a note gone
    // from them may only be unread, so nothing is pruned for it. The prune
    // after start runs once the check is done.
    if (indexer.isStale || index === previousIndex) {
      return;
    }
    {
      const moved = carrySectionIds(previousIndex, index);
      previousIndex = index;
      void (async () => {
        if (moved.size > 0) {
          await preferences.carrySectionAccess(moved);
        }
        await preferences.prune(
          index.tags.keys(),
          index.tasks.keys(),
          index.sections.keys(),
          index.entities.keys(),
          index.files.keys(),
        );
      })();
    }
  };
  context.subscriptions.push(
    indexer.onDidUpdateView(tidy, {
      name: 'tidy of derived counts',
      priority: () => VIEW_PRIORITY.housekeeping,
    }),
    new NoteVisits(indexer, preferences),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'deckard.relatedNotes',
      sidebarNotes,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider('deckard.calendar', calendar, {
      webviewOptions: { retainContextWhenHidden: true },
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
  // The Tasks view's own menus: a date by name or in plain words, on one
  // task, on the tasks selected, or on every task in a group.
  const dueFromView = (
    date: (subject: string) => Promise<string | undefined | null>,
  ) =>
    async (node?: AgendaNode, selected?: readonly AgendaNode[]) => {
      const tasks = agenda.tasksFor(node, selected);
      if (tasks.length === 0) {
        return;
      }
      const subject =
        tasks.length === 1 ? quoteTaskTitle(tasks[0]) : `${tasks.length} tasks`;
      const chosen = await date(subject);
      if (chosen !== null) {
        await setTasksDue(tasks, chosen, rescheduleContext());
      }
    };
  const named = (choice: DueChoice) => () => Promise.resolve(dueDateFor(choice));
  // How full a day is, of what the Tasks view lists, read beside the
  // reschedule choices and again after the write.
  const rescheduleContext = (): RescheduleContext => ({
    load: (date) =>
      countLoad(selectAgendaTasks(indexer.getSnapshot(), getAgendaQuery()).tasks, date),
    refresh: async () => {
      try {
        await indexer.refresh();
      } catch {
        // The watcher catches up; the load is read from what is there.
      }
    },
    todayCount: () =>
      countDueTasks(indexer.getSnapshot(), Date.now(), getAgendaQuery()).today,
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.agenda.dueToday', dueFromView(named('today'))),
    vscode.commands.registerCommand('deckard.agenda.dueTomorrow', dueFromView(named('tomorrow'))),
    vscode.commands.registerCommand('deckard.agenda.dueNextWeek', dueFromView(named('nextWeek'))),
    vscode.commands.registerCommand('deckard.agenda.dueOnDate', dueFromView(askForDueDate)),
    vscode.commands.registerCommand(
      'deckard.agenda.moveTo',
      async (node?: AgendaNode, selected?: readonly AgendaNode[]) => {
        const tasks = agenda.tasksFor(node, selected);
        if (tasks.length > 0) {
          await moveTasks(indexer, preferences, tasks);
        }
      },
    ),
    vscode.commands.registerCommand(
      'deckard.agenda.reschedule',
      async (node?: AgendaNode, selected?: readonly AgendaNode[]) => {
        const tasks = agenda.tasksFor(node, selected);
        if (tasks.length === 0) {
          return;
        }
        await rescheduleTasks(
          tasks.length === 1 ? quoteTaskTitle(tasks[0]) : `${tasks.length} tasks`,
          tasks,
          rescheduleContext(),
        );
      },
    ),
    vscode.commands.registerCommand('deckard.agenda.showMore', (groupId?: unknown) => {
      if (typeof groupId === 'string') {
        agenda.showMore(groupId);
      }
    }),
    vscode.commands.registerCommand('deckard.rescheduleOverdue', async () => {
      await indexer.ready;
      const overdue = listOverdueTasks(indexer.getSnapshot());
      if (overdue.length === 0) {
        void vscode.window.showInformationMessage('Nothing is overdue.');
        return;
      }
      await rescheduleTasks(
        overdue.length === 1 ? quoteTaskTitle(overdue[0]) : `${overdue.length} overdue tasks`,
        overdue,
        rescheduleContext(),
      );
    }),
    vscode.commands.registerCommand(
      'deckard.agenda.editTask',
      async (node?: AgendaNode) => {
        const [task] = agenda.tasksFor(node);
        if (task && (await openTask(task))) {
          await vscode.commands.executeCommand('deckard.editTask');
        }
      },
    ),
    vscode.commands.registerCommand(
      'deckard.agenda.breakIntoSteps',
      async (node?: AgendaNode) => {
        const [task] = agenda.tasksFor(node);
        if (task) {
          await breakIntoStepsCommand(indexer, task);
        }
      },
    ),
  );
  void syncOutlineFollowCursorContext();
  void syncZenModeContext();
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deckard.outline.revealSection',
      (node?: unknown) => {
        const outlineNode = asOutlineNode(node);
        return outlineNode ? outline.revealSection(outlineNode) : undefined;
      },
    ),
    vscode.commands.registerCommand(
      'deckard.outline.openTagOverview',
      async (node?: unknown) => {
        const tagKey = await pickOutlineTag(
          asOutlineNode(node),
          'Choose a tag from this heading',
        );
        if (tagKey) {
          await searchPanels.show(tagKey);
        }
      },
    ),
    vscode.commands.registerCommand(
      'deckard.outline.renameTag',
      async (node?: unknown) => {
        const tagKey = await pickOutlineTag(
          asOutlineNode(node),
          'Choose a tag to rename',
        );
        if (tagKey) {
          await renameIndexedTag(indexer, tagKey, preferences);
        }
      },
    ),
    vscode.commands.registerCommand('deckard.focusSection', async (node?: unknown) => {
      const outlineNode = asOutlineNode(node);
      if (outlineNode) {
        await outline.revealSection(outlineNode);
      }
      await focusSectionCommand(outlineNode?.line);
    }),
    vscode.commands.registerCommand('deckard.unfoldAllSections', () =>
      unfoldAllSectionsCommand(),
    ),
    trackSectionFocus(),
    vscode.commands.registerCommand('deckard.outline.filterByTag', async (node?: unknown) => {
      const outlineNode = asOutlineNode(node);
      if (outlineNode) {
        const key = await pickOutlineTag(outlineNode, 'Choose a tag to filter the Outline by');
        const tag = outlineNode.tags.find((candidate) => candidate.key === key);
        if (tag) {
          outline.setTagFilter(tag);
        }
        return;
      }
      const tags = outline.listTags();
      if (tags.length === 0) {
        void vscode.window.showInformationMessage('No heading in this note carries a tag to filter by.');
        return;
      }
      const chosen = await vscode.window.showQuickPick(
        tags.map((tag) => ({ label: tag.label, tag })),
        { placeHolder: 'Show only the headings that carry a tag' },
      );
      if (chosen) {
        outline.setTagFilter(chosen.tag);
      }
    }),
    vscode.commands.registerCommand('deckard.outline.clearTagFilter', () =>
      outline.setTagFilter(undefined),
    ),
    // The day panel is a setting, turned on and off from the Calendar's own
    // menu, and written where it is already set.
    vscode.commands.registerCommand('deckard.calendar.openDayPanel', () =>
      writeSetting('calendar.dayPanel', true, settingTarget('calendar.dayPanel')),
    ),
    vscode.commands.registerCommand('deckard.calendar.closeDayPanel', () =>
      writeSetting('calendar.dayPanel', false, settingTarget('calendar.dayPanel')),
    ),
    // Repeats the same way.
    vscode.commands.registerCommand('deckard.calendar.showRepeats', () =>
      writeSetting('calendar.showRepeats', true, settingTarget('calendar.showRepeats')),
    ),
    vscode.commands.registerCommand('deckard.calendar.hideRepeats', () =>
      writeSetting('calendar.showRepeats', false, settingTarget('calendar.showRepeats')),
    ),
    vscode.commands.registerCommand('deckard.agenda.setGrouping', () =>
      pickAgendaGrouping(indexer.getSnapshot()),
    ),
    // The board is the search editor: the view's search opens there to be
    // tried and changed, and its Tasks view button keeps it.
    vscode.commands.registerCommand('deckard.agenda.editQuery', () =>
      taskBoard.show(getAgendaQuery()),
    ),
    vscode.commands.registerCommand('deckard.clearAgendaQuery', async () => {
      if (await writeSetting('agenda.query', undefined, settingTarget('agenda.query'))) {
        void vscode.window.showInformationMessage('The Tasks view lists every open task again.');
      }
    }),
    vscode.commands.registerCommand('deckard.outline.enableFollowCursor', () =>
      setOutlineFollowCursor(true),
    ),
    vscode.commands.registerCommand('deckard.outline.disableFollowCursor', () =>
      setOutlineFollowCursor(false),
    ),
    vscode.commands.registerCommand('deckard.enableZenMode', () =>
      setZenMode(true),
    ),
    vscode.commands.registerCommand('deckard.disableZenMode', () =>
      setZenMode(false),
    ),
    vscode.commands.registerCommand('deckard.tidyPreferences', () =>
      tidyPreferences(indexer, preferences),
    ),
    vscode.commands.registerCommand('deckard.exportPreferences', () =>
      exportPreferences(preferences),
    ),
    vscode.commands.registerCommand('deckard.importPreferences', () =>
      importPreferences(preferences),
    ),
    vscode.commands.registerCommand('deckard.restorePreferences', () =>
      restorePreferences(preferences, snapshots),
    ),
    vscode.commands.registerCommand('deckard.checkSetup', () =>
      checkSetup(indexer),
    ),
    vscode.commands.registerCommand('deckard.createSampleWorkspace', () =>
      createSampleWorkspace(context),
    ),
  );
  context.subscriptions.push(
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
      deserializeWebviewPanel: (webviewPanel) => calendarPage.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.taskBoard', {
      deserializeWebviewPanel: (webviewPanel, state) =>
        taskBoard.restore(webviewPanel, state),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.tagOverview', {
      deserializeWebviewPanel: (webviewPanel, state) =>
        searchPanels.restore(webviewPanel, state),
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.showDashboard', () =>
      dashboard.show(),
    ),
    vscode.commands.registerCommand('deckard.showStats', () => stats.show()),
    // A page may open Help at the section about it, such as the calendar's.
    vscode.commands.registerCommand('deckard.showHelp', (anchor?: unknown) =>
      help.show(typeof anchor === 'string' && /^[\w-]+$/.test(anchor) ? anchor : undefined),
    ),
    vscode.commands.registerCommand('deckard.chooseTheme', () =>
      chooseTheme(context.extension.packageJSON.contributes),
    ),
    vscode.commands.registerCommand('deckard.openWalkthrough', () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${context.extension.id}#deckard.gettingStarted`,
        false,
      ),
    ),
    vscode.commands.registerCommand('deckard.openWhatsNew', async () => {
      await help.show('whats-new');
      await whatsNew.clear();
    }),
    vscode.commands.registerCommand('deckard.showNotesGraph', (options?: unknown) =>
      notesGraph.show(readNotesGraphOptions(options)),
    ),
    vscode.commands.registerCommand('deckard.showNotesGraphAroundNote', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !indexer.isNotesFile(uri)) {
        void vscode.window.showInformationMessage('Open a note to draw the graph around it.');
        return;
      }
      await notesGraph.showAround(indexer.getFilePath(uri));
    }),
    vscode.commands.registerCommand('deckard.noteActions', () =>
      noteActionsCommand({ index: indexer, preferences }),
    ),
    vscode.commands.registerCommand('deckard.showCalendar', () => calendarPage.show()),
    // From the sidebar, the page opens on the month and the day it shows.
    vscode.commands.registerCommand('deckard.calendar.openInEditor', () =>
      calendarPage.show(calendar.controller.month, calendar.controller.selectedDate),
    ),
    vscode.commands.registerCommand('deckard.showTaskBoard', async () => {
      await taskBoard.show();
      await tryNext.retire('taskBoard');
    }),
    vscode.commands.registerCommand(
      'deckard.activateNotesGraphNode',
      async (nodeId: unknown, open: unknown) => {
        if (typeof nodeId === 'string' && typeof open === 'boolean') {
          await notesGraph.activateNode(nodeId, open);
        }
      },
    ),
    vscode.commands.registerCommand(
      'deckard.highlightNotesGraphNode',
      (nodeId?: unknown) => {
        notesGraph.highlightNode(
          typeof nodeId === 'string' ? nodeId : undefined,
        );
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.reindexWorkspace', async () => {
      await indexer.ready;
      // Asked for by hand, every note is read and parsed again.
      await indexer.refresh({ reuse: 'none' });
      // Reindexing looked like it did nothing: a status-bar spinner, then
      // silence. Asked for by hand, it says what it found.
      const index = indexer.getSnapshot();
      const plural = (count: number, noun: string): string =>
        `${count} ${noun}${count === 1 ? '' : 's'}`;
      void vscode.window.showInformationMessage(
        `Deckard indexed ${plural(index.files.size, 'file')}: ${plural(
          index.sections.size,
          'note',
        )}, ${plural(index.tasks.size, 'task')}, and ${plural(
          index.tags.size,
          'tag',
        )}.`,
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.createDailyNote', () =>
      createDailyNoteWithRollover(indexer),
    ),
    vscode.commands.registerCommand('deckard.openDailyNoteForDate', () =>
      openDailyNoteForDate(indexer),
    ),
    vscode.commands.registerCommand('deckard.rollTasksForward', () =>
      rollTasksForward(indexer),
    ),
    vscode.commands.registerCommand('deckard.previousDailyNote', () =>
      openAdjacentDailyNote(indexer, 'previous'),
    ),
    vscode.commands.registerCommand('deckard.nextDailyNote', () =>
      openAdjacentDailyNote(indexer, 'next'),
    ),
    vscode.commands.registerCommand('deckard.openWeeklyNote', () =>
      openPeriodicNoteWithReview(indexer, preferences, 'week'),
    ),
    vscode.commands.registerCommand('deckard.openMonthlyNote', () =>
      openPeriodicNoteWithReview(indexer, preferences, 'month'),
    ),
    vscode.commands.registerCommand('deckard.writeReview', async () => {
      await writeReviewCommand(indexer, preferences);
      await tryNext.retire('weeklyReview');
    }),
    // One editor, two names: which one the palette offers is decided by
    // whether the cursor is on a task.
    vscode.commands.registerCommand('deckard.editTask', () =>
      editTaskCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.addTask', () =>
      editTaskCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.breakIntoSteps', () =>
      breakIntoStepsCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.toggleTaskDone', () =>
      toggleTaskDoneCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.capture', () =>
      capture(indexer, 'today', captureDrafts, preferences),
    ),
    // The hover on a tagged entry passes the line it was shown on, so it
    // pins that entry rather than wherever the cursor happens to be.
    vscode.commands.registerCommand(
      'deckard.pinNote',
      async (documentUri?: unknown, line?: unknown) => {
        const pinned = await setNotePinnedCommand(
          indexer,
          preferences,
          true,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        );
        if (pinned) {
          await tryNext.retire('pinNote');
        }
        return pinned;
      },
    ),
    vscode.commands.registerCommand(
      'deckard.unpinNote',
      (documentUri?: unknown, line?: unknown) =>
        setNotePinnedCommand(
          indexer,
          preferences,
          false,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        ),
    ),
    vscode.commands.registerCommand('deckard.captureUnderHeading', () =>
      capture(indexer, 'heading', captureDrafts, preferences),
    ),
    vscode.commands.registerCommand('deckard.newNoteFromTemplate', () =>
      newNoteFromTemplate(indexer),
    ),
    // The Explorer passes the folder that was right-clicked.
    vscode.commands.registerCommand('deckard.newNoteFromTemplateHere', (folder?: unknown) =>
      newNoteFromTemplate(indexer, folder instanceof vscode.Uri ? folder : undefined),
    ),
    vscode.commands.registerCommand('deckard.excludeFromIndex', (folder?: unknown) =>
      excludeFolderCommand(indexer, folder instanceof vscode.Uri ? folder : undefined),
    ),
    vscode.commands.registerCommand('deckard.includeInIndex', (folder?: unknown) =>
      includeFolderCommand(indexer, folder instanceof vscode.Uri ? folder : undefined),
    ),
    new ExcludedFoldersContext(),
    vscode.commands.registerCommand('deckard.parkNote', (uri?: unknown, uris?: unknown) =>
      parkNotes(indexer, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.unparkNote', (uri?: unknown, uris?: unknown) =>
      unparkNotes(indexer, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.parkFolder', (uri?: unknown, uris?: unknown) =>
      parkFolders(indexer, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.unparkFolder', (uri?: unknown, uris?: unknown) =>
      unparkFolders(indexer, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.parkTag', async (tag?: unknown) => {
      const outlineNode = asOutlineNode(tag);
      const key = outlineNode
        ? await pickOutlineTag(outlineNode, 'Choose a tag to park')
        : getCommandTagArgument(tag);
      if (outlineNode && !key) {
        return;
      }
      await parkTag(indexer, key);
    }),
    vscode.commands.registerCommand('deckard.unparkTag', async (tag?: unknown) => {
      const outlineNode = asOutlineNode(tag);
      const key = outlineNode
        ? await pickOutlineTag(outlineNode, 'Choose a tag to unpark')
        : getCommandTagArgument(tag);
      if (outlineNode && !key) {
        return;
      }
      await unparkTag(indexer, key);
    }),
    new ParkingContext(indexer),
    vscode.commands.registerCommand('deckard.copyMcpSetup', () =>
      mcpServer.copySetup(),
    ),
    vscode.commands.registerCommand('deckard.resetMcpToken', () =>
      mcpServer.resetTokenCommand(),
    ),
    vscode.commands.registerCommand(
      CREATE_LINKED_NOTE_COMMAND,
      (documentUri: unknown, name: unknown) =>
        typeof documentUri === 'string' && typeof name === 'string'
          ? createLinkedNote(indexer, vscode.Uri.parse(documentUri), name)
          : undefined,
    ),
    vscode.commands.registerCommand(
      CREATE_MISSING_NOTES_COMMAND,
      (documentUri: unknown, names: unknown) =>
        typeof documentUri === 'string' &&
        Array.isArray(names) &&
        names.every((name) => typeof name === 'string')
          ? createMissingNotes(indexer, vscode.Uri.parse(documentUri), names)
          : undefined,
    ),
    vscode.commands.registerCommand(
      LINK_MENTIONS_COMMAND,
      (documentUri: unknown) =>
        typeof documentUri === 'string'
          ? linkMentions(indexer, vscode.Uri.parse(documentUri))
          : undefined,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.extractHeading', () =>
      extractHeadingCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.moveTo', () =>
      moveToCommand(indexer, preferences),
    ),
    vscode.languages.registerCodeActionsProvider(
      { pattern: '**/*.md' },
      new MoveToActions(indexer),
      { providedCodeActionKinds: [vscode.CodeActionKind.RefactorMove] },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deckard.showTagOverview',
      (tagKey?: unknown) => showTagOverview(searchPanels, indexer, tagKey),
    ),
    vscode.commands.registerCommand('deckard.search', (query?: unknown) =>
      searchPanels.showQuery(getCommandTagArgument(query) ?? ''),
    ),
    vscode.commands.registerCommand('deckard.insertQueryBlock', () =>
      insertQueryBlock(preferences),
    ),
    vscode.commands.registerCommand(
      'deckard.searchWorkspace',
      (initialQuery?: unknown) =>
        quickFind.show(getCommandTagArgument(initialQuery)),
    ),
    vscode.commands.registerCommand('deckard.quickFind.complete', () =>
      quickFind.complete(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.openBeside', () =>
      quickFind.openBeside(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.insertLink', () =>
      quickFind.insertLinkFromActive(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.actions', () =>
      quickFind.showActions(),
    ),
    vscode.commands.registerCommand(
      'deckard.searchNotes',
      (requestedQuery?: unknown) =>
        showQuerySearch(searchPanels, indexer, requestedQuery),
    ),
    vscode.commands.registerCommand('deckard.linkCurrentHeading', () =>
      linkCurrentHeading(indexer),
    ),
    vscode.commands.registerCommand('deckard.moveTagsToFrontmatter', () =>
      moveInlineTagsToFrontmatter(),
    ),
    vscode.commands.registerCommand(
      'deckard.renameTag',
      (requestedTagKey?: unknown) =>
        renameIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
          preferences,
        ),
    ),
    vscode.commands.registerCommand('deckard.renameHeading', () =>
      renameHeadingCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.undoLastChange', () =>
      undoLastWorkspaceWrite(() => indexer.refresh()),
    ),
    vscode.commands.registerCommand(
      'deckard.mergeTag',
      (requestedTagKey?: unknown, requestedTargetKey?: unknown) =>
        mergeIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
          preferences,
          getCommandTagArgument(requestedTargetKey),
        ),
    ),
    vscode.commands.registerCommand(
        'deckard.showEntryRelatedNotes',
        async (documentUri?: unknown, sourceLine?: unknown) => {
          if (
            typeof documentUri !== 'string' ||
            typeof sourceLine !== 'number' ||
            !Number.isInteger(sourceLine) ||
            sourceLine < 1
          ) {
            return;
          }
          const uri = vscode.Uri.parse(documentUri);
          if (!isMarkdownDocument({ languageId: 'markdown', uri })) {
            return;
          }
          await sidebarNotes.showRelatedNotesForEntry(uri, sourceLine);
        },
    ),
    vscode.commands.registerCommand(
      'deckard.showEntryRelatedNotesDebug',
      async (documentUri?: unknown, sourceLine?: unknown) => {
        if (
          typeof documentUri !== 'string' ||
          typeof sourceLine !== 'number' ||
          !Number.isInteger(sourceLine) ||
          sourceLine < 1
        ) {
          return;
        }
        const uri = vscode.Uri.parse(documentUri);
        if (!isMarkdownDocument({ languageId: 'markdown', uri })) {
          return;
        }
        await relatedNotesDebug.show(uri, sourceLine);
      },
    ),
  );

  if (
    vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('dashboard.openOnStartup', false)
  ) {
    void dashboard.showOnStartup();
  }

  // The bar draws as soon as there is an index to count.
  taskStatusBar.refresh();

  void indexer.start().then(async () => {
    const index = indexer.getSnapshot();
    await preferences.prune(
      index.tags.keys(),
      index.tasks.keys(),
      index.sections.keys(),
      index.entities.keys(),
      index.files.keys(),
    );
  });

  return {
    extendMarkdownIt: (md) => queryBlocks.extendMarkdownIt(md),
  };
}

/**
 * Releases services explicitly so timers, watchers, panels, and event emitters
 * stop even when deactivation happens before the next workspace change.
 */
export function deactivate(): void {
  activeServices?.indexer.dispose();
  activeServices?.preferences.dispose();
  activeServices?.searchPanels.dispose();
  activeServices?.activeSearch.dispose();
  activeServices?.sidebarNotes.dispose();
  activeServices?.tagDecorations.dispose();
  activeServices?.tagSuggestions.dispose();
  activeServices?.linkSuggestions.dispose();
  activeServices?.entitySuggestions.dispose();
  activeServices?.dashboard.dispose();
  activeServices?.stats.dispose();
  activeServices?.help.dispose();
  activeServices?.relatedNotesDebug.dispose();
  activeServices?.outline.dispose();
  activeServices?.queryBlocks.dispose();
  activeServices?.agenda.dispose();
  activeServices?.taskStatusBar.dispose();
  activeServices?.taskMetadataSuggestions.dispose();
  activeServices?.taskEditorActions.dispose();
  activeServices?.taskLineContext.dispose();
  activeServices?.taskBoard.dispose();
  activeServices?.editorReferences.dispose();
  activeServices?.editorLenses.dispose();
  activeServices?.linkHealth.dispose();
  activeServices?.linkMaintenance.dispose();
  activeServices?.calendar.dispose();
  activeServices?.quickFind.dispose();
  activeServices = undefined;
}

/**
 * Names the long-lived services that share the extension lifecycle.
 */
interface ExtensionServices {
  indexer: WorkspaceIndexer;
  preferences: PreferencesStore;
  activeSearch: ActiveSearch;
  searchPanels: SearchPanels;
  sidebarNotes: SidebarNotesView;
  tagDecorations: EditorTagDecorations;
  tagSuggestions: TagCompletionProvider;
  linkSuggestions: WikiLinkCompletionProvider;
  entitySuggestions: EntityHeadingSuggestions;
  dashboard: DashboardPanel;
  stats: StatsPanel;
  help: HelpPanel;
  notesGraph: NotesGraphPanel;
  relatedNotesDebug: RelatedNotesDebugPanel;
  outline: OutlineTreeProvider;
  queryBlocks: QueryBlocks;
  agenda: AgendaTreeProvider;
  taskStatusBar: TaskStatusBar;
  taskMetadataSuggestions: TaskMetadataCompletionProvider;
  taskEditorActions: TaskEditorActions;
  taskLineContext: TaskLineContext;
  taskBoard: TaskBoardPanel;
  editorReferences: EditorReferences;
  editorLenses: EditorLenses;
  linkHealth: LinkHealth;
  linkMaintenance: LinkMaintenance;
  calendar: CalendarView;
  quickFind: QuickFind;
}

function getCommandTagArgument(value: unknown): string | undefined {
  const argument = Array.isArray(value) ? value[0] : value;
  return typeof argument === 'string' ? argument : undefined;
}

/**
 * Validates the tree argument because these commands are also reachable from
 * keybindings and other extensions, which can pass anything.
 */
function asOutlineNode(value: unknown): OutlineNode | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'line' in value &&
    'tags' in value
    ? (value as OutlineNode)
    : undefined;
}

/**
 * Opens a search page on a query.
 *
 * The command accepts a query argument so a link or another command can open a
 * saved search directly, and prompts for one otherwise.
 */
async function showQuerySearch(
  searchPanels: SearchPanels,
  indexer: WorkspaceIndexer,
  requestedQuery: unknown,
): Promise<void> {
  await indexer.ready;
  const query =
    getCommandTagArgument(requestedQuery) ??
    (await vscode.window.showInputBox({
      title: 'Search Deckard notes',
      prompt:
        'Write a query, such as (tag = #project/atlas AND tag = #urgent) OR text ~ "vendor"',
      placeHolder: 'tag = #project/atlas AND task = open',
    }));

  if (query?.trim()) {
    await searchPanels.showQuery(query);
  }
}

/**
 * Resolves a command argument or user choice only after the initial index exists.
 *
 * Serialized command URIs arrive as arrays, while the command palette supplies
 * no argument, so both paths converge on the same validated panel entrypoint.
 */
async function showTagOverview(
  searchPanels: SearchPanels,
  indexer: WorkspaceIndexer,
  requestedTag: unknown,
): Promise<void> {
  await indexer.ready;
  const tags = [...indexer.getSnapshot().tags.values()];
  const tagKey =
    getCommandTagArgument(requestedTag) ??
    (
      await vscode.window.showQuickPick(
        tags.map((tag) => ({
          label: tag.label,
          description: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
          key: tag.key,
        })),
        { placeHolder: 'Choose a tag to open its page' },
      )
    )?.key;

  if (tagKey) {
    await searchPanels.show(tagKey);
  }
}

