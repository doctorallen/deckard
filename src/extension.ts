import * as vscode from 'vscode';

import { setQueryIdentity } from './core/query/queryEvaluator';
import { PreferencesStore } from './core/storage/preferences';
import { SearchStore } from './core/storage/searchStore';
import { setTimingLog } from './core/timing';
import { WorkspaceIndexer } from './core/workspace/indexer';
import { capture, captureToToday } from './ui/commands/capture';
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
import { setTaskRankKeeper } from './ui/commands/taskActions';
import {
  editTaskCommand,
  TaskEditorActions,
  TaskLineContext,
} from './ui/commands/taskEditor';
import { newNoteFromTemplate } from './ui/commands/templates';
import { extractHeadingCommand } from './ui/commands/extractHeading';
import { EntityHeadingSuggestions } from './ui/commands/entitySuggestions';
import {
  CREATE_LINKED_NOTE_COMMAND,
  createLinkedNote,
  LinkHealth,
} from './ui/commands/linkHealth';
import { CalendarView } from './ui/webview/calendar';
import { readManifestTools } from './core/mcp/mcpProtocol';
import { DeckardMcpServer } from './ui/commands/mcpServer';
import { linkCurrentHeading } from './ui/commands/linkEntity';
import { setNotePinnedCommand } from './ui/commands/pinNote';
import { createPinForLine } from './ui/state/pinnedNotes';
import { pinKey } from './core/storage/preferences';
import {
  LinkMaintenance,
  renameHeadingCommand,
} from './ui/commands/linkMaintenance';
import { WikiLinkCompletionProvider } from './ui/commands/linkSuggestions';
import { undoLastWorkspaceWrite } from './ui/commands/workspaceWrites';
import { moveInlineTagsToFrontmatter } from './ui/commands/moveTagsToFrontmatter';
import { mergeIndexedTag, renameIndexedTag } from './ui/commands/renameTag';
import {
  EditorTagDecorations,
  isMarkdownDocument,
} from './ui/commands/tagDecorations';
import { TagCompletionProvider } from './ui/commands/tagSuggestions';
import { TaskMetadataCompletionProvider } from './ui/commands/taskMetadataSuggestions';
import { EditorReferences } from './ui/commands/editorReferences';
import { AssistantTools } from './ui/commands/assistantTools';
import { QuickFind } from './ui/commands/quickFind';
import { DashboardPanel } from './ui/webview/dashboard';
import { HelpPanel } from './ui/webview/help';
import { NotesGraphPanel } from './ui/webview/notesGraph';
import { SidebarNotesView } from './ui/webview/sidebarNotes';
import { RelatedNotesDebugPanel } from './ui/webview/relatedNotesDebug';
import { StatsPanel } from './ui/webview/stats';
import { TaskBoardPanel } from './ui/webview/taskBoard';
import { ActiveSearch } from './ui/webview/activeSearch';
import { SearchPanels } from './ui/webview/searchPage';
import { setZenMode, syncZenModeContext } from './ui/webview/zenMode';
import { tidyPreferences } from './ui/commands/tidyPreferences';
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
import {
  AgendaTreeProvider,
  getAgendaQuery,
  pickAgendaGrouping,
} from './ui/views/agendaTree';
import { TaskStatusBar } from './ui/views/taskStatusBar';

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
export function activate(context: vscode.ExtensionContext): DeckardExports {
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
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('deckard.me')) {
        readIdentity();
      }
    }),
    { dispose: () => setQueryIdentity(undefined) },
  );
  const indexer = new WorkspaceIndexer(
    undefined,
    new SearchStore(context.storageUri),
  );
  // Favourites, pins and view counts name what is in a workspace, so they are
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
  const tagDecorations = new EditorTagDecorations();
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
  const editorReferences = new EditorReferences(indexer);
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
  const linkSuggestions = new WikiLinkCompletionProvider(indexer);
  const entitySuggestions = new EntityHeadingSuggestions();
  const linkHealth = new LinkHealth(indexer);
  const linkMaintenance = new LinkMaintenance(indexer);
  const calendar = new CalendarView(indexer);
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
    },
  );
  const quickFind = new QuickFind(indexer, preferences, {
    openTag: (tagKey) => searchPanels.show(tagKey),
    openSavedFilter: (filterId) => dashboard.openSavedFilter(filterId),
    showSearch: (query) => searchPanels.showQuery(query),
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
  const taskStatusBar = new TaskStatusBar(indexer);
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
            count === 1
              ? `Deckard could not read ${unreadable[0].filePath}, so it is not indexed: ${unreadable[0].reason}`
              : `Deckard could not read ${count} notes, so they are not indexed.`,
            'Show Stats',
            'Show Log',
          )
          .then((choice) => {
            if (choice === 'Show Stats') {
              void vscode.commands.executeCommand('deckard.showStats');
            } else if (choice === 'Show Log') {
              void vscode.commands.executeCommand('deckard.showLog');
            }
          });
      }
      unreadableSeen = unreadable.length;
    }),
  );
  context.subscriptions.push(
    indexer.onDidUpdate(() => {
      const index = indexer.getSnapshot();
      void preferences.prune(
        index.tags.keys(),
        index.tasks.keys(),
        index.sections.keys(),
        index.entities.keys(),
        index.files.keys(),
      );
    }),
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
    // Dragging a task onto another ranks it there; onto a group, it joins
    // that group through the same checked edit the board writes.
    dragAndDropController: agenda,
  });
  agenda.attach(agendaView);
  context.subscriptions.push(agendaView);
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
    vscode.commands.registerCommand('deckard.agenda.setGrouping', () =>
      pickAgendaGrouping(),
    ),
    // The board is the search editor: the view's search opens there to be
    // tried and changed, and its Tasks view button keeps it.
    vscode.commands.registerCommand('deckard.agenda.editQuery', () =>
      taskBoard.show(getAgendaQuery()),
    ),
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
    vscode.commands.registerCommand('deckard.showHelp', () => help.show()),
    vscode.commands.registerCommand('deckard.showNotesGraph', () =>
      notesGraph.show(),
    ),
    vscode.commands.registerCommand('deckard.showTaskBoard', () =>
      taskBoard.show(),
    ),
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
      await indexer.refresh();
      // Reindexing looked like it did nothing: a status-bar spinner, then
      // silence. Asked for by hand, it says what it found.
      const index = indexer.getSnapshot();
      void vscode.window.showInformationMessage(
        `Deckard indexed ${index.files.size} ${
          index.files.size === 1 ? 'note' : 'notes'
        }, ${index.tasks.size} ${
          index.tasks.size === 1 ? 'task' : 'tasks'
        }, and ${index.tags.size} ${index.tags.size === 1 ? 'tag' : 'tags'}.`,
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.createDailyNote', () =>
      createDailyNoteWithRollover(indexer),
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
    vscode.commands.registerCommand('deckard.writeReview', () =>
      writeReviewCommand(indexer, preferences),
    ),
    // One editor, two names: which one the palette offers is decided by
    // whether the cursor is on a task.
    vscode.commands.registerCommand('deckard.editTask', () =>
      editTaskCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.addTask', () =>
      editTaskCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.capture', () => capture(indexer)),
    // The hover on a tagged entry passes the line it was shown on, so it
    // pins that entry rather than wherever the cursor happens to be.
    vscode.commands.registerCommand(
      'deckard.pinNote',
      (documentUri?: unknown, line?: unknown) =>
        setNotePinnedCommand(
          indexer,
          preferences,
          true,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        ),
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
      capture(indexer, 'heading'),
    ),
    vscode.commands.registerCommand('deckard.newNoteFromTemplate', () =>
      newNoteFromTemplate(indexer),
    ),
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
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.extractHeading', () =>
      extractHeadingCommand(indexer),
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
    vscode.commands.registerCommand(
      'deckard.searchWorkspace',
      (initialQuery?: unknown) =>
        quickFind.show(getCommandTagArgument(initialQuery) ?? ''),
    ),
    vscode.commands.registerCommand('deckard.quickFind.complete', () =>
      quickFind.complete(),
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
          description: `${tag.count} items`,
          key: tag.key,
        })),
        { placeHolder: 'Choose a tag to inspect' },
      )
    )?.key;

  if (tagKey) {
    await searchPanels.show(tagKey);
  }
}

