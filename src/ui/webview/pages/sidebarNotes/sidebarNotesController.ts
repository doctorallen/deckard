import * as vscode from 'vscode';

import type { PreferenceServices } from '../../../../core/storage/preferences';
import type { IndexControl, IndexReader, IndexScanStatus, IndexUpdates } from '../../../../core/workspace/indexReader';
import { whenPublished } from '../../../../core/workspace/publishing';
import { isMarkdownFile } from '../../../../core/workspace/scanner';
import { listedParkedTags } from '../../../../domain/index/parked';
import { getEntityNamespaceAliases, getPersonMarker } from '../../../../domain/markdown/parser';
import { findTagTarget } from '../../../../domain/markdown/tagTarget';
import type { ParsedFile, Section, TagTitleDisplayMode, WorkspaceIndex } from '../../../../domain/model';
import { refineQueryText } from '../../../../domain/query/queryEdit';
import type { NavigationService } from '../../../../services/navigationService';
import { logTrace, measure } from '../../../../shared/timing';
import type { SidebarGraphContext } from '../../../protocol/notesGraph';
import type {
  LinkMentionMessage,
  RefineActiveSearchMessage,
  SidebarNotesPageState,
  SidebarNotesPageToHost,
  SidebarNotesSnapshot,
} from '../../../protocol/sidebarNotes';
import { appendTagToLine } from '../../../commands/bulkEdit';
import { createWikiLink, insertWikiLink } from '../../../commands/insertLink';
import { openSourceAt, resolveSourceUri } from '../../../commands/navigation';
import { describeRejectedEdit, noteName, reportFailure, reportStale } from '../../../commands/notify';
import { linkMentions } from '../../../commands/unlinkedMentions';
import type { WorkspaceWriteHistory } from '../../../commands/workspaceWrites';
import { createEntryScope, findTaggedEntry } from '../../../state/entryScope';
import { collectNoteLinks, createLinksSearchQuery } from '../../../state/noteLinks';
import { createSidebarSnapshot, EntryRelatedNotesDiagnostic } from '../../../state/relatedNotesRanking';
import type { ActiveCalendar } from '../../activeCalendar';
import type { ActiveHome } from '../../activeHome';
import type { ActiveSearch } from '../../activeSearch';
import { onDidChangePageChrome } from '../../host/pageChrome';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { openHelp, openTag, parkTag, renameTag } from '../../host/sharedHandlers';
import { ViewSurface, WebviewSurface } from '../../host/surface';
import { getSidebarNotesHtml } from '../../sidebarNotesHtml';
import type { PageChrome } from '../../components';
import type { ThemePreview } from '../../themePreview';
import { narrowSidebarNotesMessage } from './messages';
import { RelatedNotesRankingOptions } from '../../../../domain/ranking/relatedNotesContext';
import { readStatusNamespace } from '../../../../domain/tasks/taskPolicy';
import { normalizeTagTitleDisplayMode } from '../../../state/entryCards';

/** How long cursor moves must pause before the sidebar ranks a new entry. */
const selectionRefreshDelayMs = 120;

/**
 * The preference services Related Notes reads and writes: the blob it
 * ranks by, its display choices, visits, and the keys a renamed tag carries.
 */
export type SidebarNotesPreferences = Pick<PreferenceServices, 'reader' | 'display' | 'usage' | 'tagRenames'>;

/** What Related Notes is built from, and what a click may name. */
export interface SidebarNotesControllerOptions {
  indexer: IndexReader & IndexScanStatus & IndexUpdates & IndexControl;
  preferences: SidebarNotesPreferences;
  activeSearch: ActiveSearch;
  onOpenTag: (tagKey: string) => void | Promise<void>;
  extensionVersion: string;
  /** The calendar page, whose chosen day this shows while it is in front. */
  activeCalendar?: ActiveCalendar;
  /** Home, whose widgets this offers to add while it is in front. */
  activeHome?: ActiveHome;
  /** The history its links, tags, and renames are written to. */
  history: WorkspaceWriteHistory;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /** What a row a click names may open, write to, or link. */
  navigation: NavigationService;
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri;
}

/** Writes a line to the log at Trace, under Related Notes' name. */
export function logRelatedNotes(message: string): void {
  logTrace(() => `[Related Notes] ${message}`);
}

/**
 * Shows the notes related to the Markdown note being edited, or, while a
 * search page is the active editor, that search's Refine options, so the page
 * keeps its height for its results.
 *
 * It presents saved-note relationships from the workspace index so sidebar
 * context matches the persistent local search data.
 *
 * Unlike a page drawn from the index alone, it refreshes itself: when shown,
 * after each change it follows, and once a burst of cursor moves ends. So
 * it sends its own state, with the log lines it has always written, and
 * checks every row a click names against the rows it would list now.
 */
export class SidebarNotesController implements PageController<SidebarNotesPageState, SidebarNotesPageToHost> {
  public readonly name = 'Related Notes';
  /**
   * The view is not kept running while hidden (Q1 of
   * docs/implementation/20-webviews.md): hidden, its HTML is set again with
   * the last state it posted, which it draws when shown, and what the reader
   * chose in it comes back from its own setState. Its HTML carries no state
   * built when it is set: ranking for a note takes 1,924 ms median on the
   * 5,000-note bench (185 ms on 1,000), far over Q3's 50 ms, so it opens on
   * its loading line and is posted its state, as before.
   */
  public readonly options: PageOptions = {
    retainContextWhenHidden: false,
    enableFindWidget: false,
    followIndexing: false,
    refreshWhenShown: 'never',
    onChromeChange: 'none',
    readsInertState: true,
  };
  public readonly handlers: MessageHandlers<SidebarNotesPageToHost>;
  /** The host the sidebar is run by, from when it subscribes. */
  private page: PageContext<SidebarNotesPageState> | undefined;
  private entryContext: EntryContext | undefined;
  private graphContext: SidebarGraphContext | undefined;
  private suppressAutomaticEntrySelection = false;
  private refreshHandle: ReturnType<typeof setTimeout> | undefined;
  /** Whether the first scan has finished, which tells indexing from missing. */
  private indexed = false;
  /**
   * The state last posted, and the day it was ranked on, while nothing it
   * was ranked from has changed since: the index, the editor and its entry,
   * the pages in front, the preferences, and the settings. Undefined once
   * anything has, or while nothing has been posted.
   */
  private current: { state: SidebarNotesPageState; day: string } | undefined;

  /** Reads from `sidebar.indexer` and `sidebar.preferences`, and checks clicks through `sidebar.navigation`. */
  public constructor(private readonly sidebar: SidebarNotesControllerOptions) {
    this.handlers = { ...this.createNavigationHandlers(), ...this.createWriteHandlers(), ...this.createSettingHandlers() };
  }

  /** The sidebar's HTML, carrying `state` when the host hands it one, which is logged each time it is set. */
  public html(webview: vscode.Webview, chrome: PageChrome, state?: SidebarNotesPageState): string {
    logRelatedNotes('Rendering Related Notes webview HTML.');
    return getSidebarNotesHtml(webview, this.sidebar.extensionUri, this.sidebar.extensionVersion, { chrome, snapshot: state });
  }

  /** Narrows a message the page sent, after logging that it came. */
  public narrow(value: unknown): ReturnType<typeof narrowSidebarNotesMessage> {
    logRelatedNotes(`Received Related Notes webview message: ${describeMessage(value)}.`);
    return narrowSidebarNotesMessage(value);
  }

  /**
   * What the sidebar is sent as its state. The sidebar sends it itself, in
   * `refresh`, which also logs; this is the same state, without the log.
   */
  public buildSnapshot(): SidebarNotesPageState {
    return { ...this.createSnapshot(), parkedTags: listedParkedTags(this.sidebar.indexer) };
  }

  /** An index update redraws the sidebar as every other change does. */
  public onIndexUpdate(): void {
    this.refresh();
  }

  /**
   * Everything else the sidebar follows, in the order it has always
   * listened: Home and the calendar page in front, the first scan's
   * progress, the active search, the editor and its cursor, the theme and
   * zen, and the settings ranking reads.
   */
  public subscribe(page: PageContext<SidebarNotesPageState>): vscode.Disposable[] {
    this.page = page;
    const { indexer, activeSearch, activeCalendar, activeHome } = this.sidebar;
    const disposables: vscode.Disposable[] = [];
    if (activeHome) {
      disposables.push(activeHome.onDidChange(() => this.refresh()));
    }
    if (activeCalendar) {
      disposables.push(activeCalendar.onDidChange(() => this.refresh()));
    }
    // While the first scan runs, the waiting line says how far it has got.
    if (indexer.onDidProgress) {
      disposables.push(
        indexer.onDidProgress(() => {
          if (!this.indexed) {
            this.scheduleRefresh();
          }
        }),
      );
    }
    disposables.push(activeSearch.onDidChange(() => this.refresh()), ...this.followEditor());
    // The ranking reads the preferences, and not every write to them redraws
    // the sidebar, so any write means the state last posted may be out of date.
    const { reader } = this.sidebar.preferences;
    disposables.push(reader.onDidChange(() => this.forgetCurrent()), reader.onDidRecordVisit(() => this.forgetCurrent()));
    disposables.push(
      // The theme or zen changing reloads the page, and the state is sent
      // again at once rather than when the page asks.
      onDidChangePageChrome(() => {
        page.renderHtml();
        this.refresh();
      }, this.sidebar.themePreview),
      vscode.workspace.onDidChangeConfiguration((event) => this.onDidChangeConfiguration(event)),
    );
    return disposables;
  }

  /**
   * The view is attached: the sidebar says whether it is open, and is sent
   * its state at once and again once the index has notes to show.
   */
  public onDidAttach(page: PageContext): void {
    const visible = page.surface?.visible === true;
    this.sidebar.activeSearch.setSidebarVisible(visible);
    this.sidebar.activeCalendar?.setSidebarVisible(visible);
    this.refresh();
    void whenPublished(this.sidebar.indexer).then(() => {
      this.indexed = true;
      this.refresh();
    });
  }

  /**
   * Shown or hidden: the search and calendar pages are told, so they give
   * the sidebar their part or take it back, and a shown sidebar is sent
   * its state, since a hidden one is sent nothing.
   */
  public onDidChangeViewState(page: PageContext): void {
    const visible = page.surface?.visible === true;
    logRelatedNotes(`Related Notes visibility changed: ${visible}.`);
    this.sidebar.activeSearch.setSidebarVisible(visible);
    this.sidebar.activeCalendar?.setSidebarVisible(visible);
    if (!visible) {
      return;
    }
    // A view shown with nothing changed since its last state draws that
    // state from its HTML (Q2), and is sent it again when it says ready;
    // ranking again would find the same.
    if (this.currentState()) {
      logRelatedNotes('Related Notes state is unchanged since it was hidden; not ranking again.');
      return;
    }
    this.refresh();
  }

  /** VS Code let the view go, so the sidebar is no longer open. */
  public onDidDetach(): void {
    logRelatedNotes('Related Notes webview disposed.');
    this.forgetCurrent();
    this.sidebar.activeSearch.setSidebarVisible(false);
    this.sidebar.activeCalendar?.setSidebarVisible(false);
  }

  /**
   * Stops a waiting refresh, and tells the pages the sidebar is gone. The
   * host has let go of the view by then, so a refresh that telling them
   * asks for finds no view, as it always has.
   */
  public onDidDispose(): void {
    clearTimeout(this.refreshHandle);
    this.sidebar.activeSearch.setSidebarVisible(false);
    this.sidebar.activeCalendar?.setSidebarVisible(false);
  }

  /**
   * Narrows the sidebar to one tagged entry selected from a Markdown hover.
   */
  public async showRelatedNotesForEntry(documentUri: vscode.Uri, sourceLine: number): Promise<void> {
    const { indexer } = this.sidebar;
    await whenPublished(indexer);
    const index = indexer.getSnapshot();
    const filePath = indexer.getFilePath(documentUri);
    const file = index.files.get(filePath);
    const savedLine = file && this.resolveSavedEntryLine(documentUri, sourceLine, file);
    const entry = file && savedLine !== undefined ? findTaggedEntry(file, savedLine) : undefined;
    if (!file || savedLine === undefined || !entry) {
      void reportFailure({
        outcome: 'Deckard could not find that entry in the note as it is now.',
        fix: 'Save the note so Deckard reads it again, then try again.',
      });
      return;
    }

    this.graphContext = undefined;
    this.entryContext = { filePath, sourceLine: savedLine, source: 'manual' };
    this.suppressAutomaticEntrySelection = false;
    await vscode.commands.executeCommand('workbench.view.extension.deckard');
    this.reveal();
    this.refresh();
  }

  /**
   * Shows what a node chosen on the notes graph connects to, revealing the
   * sidebar first when asked.
   */
  public async showGraphConnections(context: SidebarGraphContext, reveal = false): Promise<void> {
    this.graphContext = context;
    if (reveal) {
      await vscode.commands.executeCommand('workbench.view.extension.deckard');
      this.reveal();
    }
    this.refresh();
  }

  /** Goes back from a graph node's connections to the notes, if it shows them. */
  public clearGraphConnections(): void {
    if (!this.graphContext) {
      return;
    }
    this.graphContext = undefined;
    this.refresh();
  }

  /**
   * How Related Notes ranks for one entry, for the debug page: the entry's
   * tags with their weights and where each came from, and the ranking with
   * its evidence. Undefined when the saved note has no such tagged entry.
   */
  public async getEntryDiagnostic(
    documentUri: vscode.Uri,
    sourceLine: number,
  ): Promise<EntryRelatedNotesDiagnostic | undefined> {
    const { indexer } = this.sidebar;
    await whenPublished(indexer);
    const index = indexer.getSnapshot();
    const filePath = indexer.getFilePath(documentUri);
    const file = index.files.get(filePath);
    const savedLine = file && this.resolveSavedEntryLine(documentUri, sourceLine, file);
    const entryScope = file && savedLine !== undefined ? createEntryScope(file, savedLine) : undefined;
    if (!file || savedLine === undefined || !entryScope) {
      return undefined;
    }

    return {
      filePath,
      sourceLine: savedLine,
      title: getEntryTitle(entryScope.file) ?? 'Selected note',
      tags: [...entryScope.tagWeights.entries()].map(([key, weight]) => ({
        key,
        weight,
        context: entryScope.tagSources.get(key)?.context ?? 'selected',
        source: entryScope.tagSources.get(key)?.source ?? 'selected entry',
      })),
      snapshot: createSidebarSnapshot(index, filePath, entryScope.file, {
        now: Date.now(),
        enableKeywordLinks: this.areKeywordLinksEnabled(),
        relatedNotesSortMode: 'tags',
        sectionAccessCounts: this.sidebar.preferences.reader.value.sectionAccessCounts,
        tagTitleDisplayMode: this.getTagTitleDisplayMode(),
        activeEntryTitle: getEntryTitle(entryScope.file),
        activeTagWeights: entryScope.tagWeights,
        rankingOptions: this.getRelatedNotesRankingOptions(),
      }),
    };
  }

  /**
   * Sends the current sidebar projection only when the view is attached and
   * shown; a hidden sidebar is refreshed when it is shown again. Each call
   * ends a refresh waiting on the cursor. A refresh that cannot send means
   * something changed that the view has not been sent.
   *
   * With `reuse`, the state last posted is sent again, not ranked again,
   * while nothing it was ranked from has changed: for a view VS Code loaded
   * again, which says ready and has been sent, or has in its HTML, that
   * state already.
   */
  private refresh(reuse = false): void {
    clearTimeout(this.refreshHandle);
    this.refreshHandle = undefined;
    const page = this.page;
    const surface = page?.surface;
    if (!page || !surface) {
      this.forgetCurrent();
      logRelatedNotes('Skipped Related Notes refresh because no webview is attached.');
      return;
    }
    if (!surface.visible) {
      this.forgetCurrent();
      logRelatedNotes('Skipped Related Notes refresh because the view is hidden.');
      return;
    }
    const kept = reuse ? this.currentState() : undefined;
    if (kept) {
      logRelatedNotes('Related Notes state is unchanged since it was ranked; sending it again.');
      this.post(page, kept);
      return;
    }

    const snapshot = measure(
      'Related Notes',
      () => this.createSnapshot(),
      (result) => `${result.notes.length} results`,
    );
    logRelatedNotes(
      `Sending Related Notes state: ${snapshot.state}${describeSource(snapshot)}, ${snapshot.notes.length} note entries.`,
    );
    const state: SidebarNotesPageState = { ...snapshot, parkedTags: listedParkedTags(this.sidebar.indexer) };
    this.current = { state, day: today() };
    this.post(page, state);
  }

  /**
   * The state last posted, while nothing it was ranked from has changed
   * since and the day has not turned, which moves how recent each note is.
   */
  private currentState(): SidebarNotesPageState | undefined {
    return this.current && this.current.day === today() ? this.current.state : undefined;
  }

  /** Something the ranking reads has changed, so the state last posted may be out of date. */
  private forgetCurrent(): void {
    this.current = undefined;
  }

  /**
   * Posts a state through the host, which keeps it to draw a hidden view
   * again from, and logs whether it was delivered.
   */
  private post(page: PageContext<SidebarNotesPageState>, state: SidebarNotesPageState): void {
    void page.postState(state)?.then(
      (delivered) =>
        logRelatedNotes(
          `Related Notes state delivery ${delivered ? 'succeeded' : 'was skipped because the webview is not live'}.`,
        ),
      (error: unknown) => logRelatedNotes(`Related Notes state delivery failed: ${formatError(error)}.`),
    );
  }

  /** The handlers that open something: a page, a tag, a graph node, or a line. */
  private createNavigationHandlers() {
    const { indexer, navigation } = this.sidebar;
    const openTagPage = (tagKey: string) => this.sidebar.onOpenTag(tagKey);
    return {
      // A view VS Code loaded again, when it was shown or its theme changed,
      // is sent the state it was last sent unless something has changed.
      ready: () => {
        logRelatedNotes('Related Notes webview is ready; refreshing state.');
        this.refresh(true);
      },
      openDashboard: () => vscode.commands.executeCommand('deckard.showDashboard'),
      openNotesGraph: () => vscode.commands.executeCommand('deckard.showNotesGraph'),
      openTaskBoard: () => vscode.commands.executeCommand('deckard.showTaskBoard'),
      createDailyNote: () => vscode.commands.executeCommand('deckard.createDailyNote'),
      openHelp: openHelp(),
      activateNotesGraphNode: (message: SidebarNotesPageToHost['activateNotesGraphNode']) =>
        vscode.commands.executeCommand('deckard.activateNotesGraphNode', message.nodeId, message.open),
      hoverNotesGraphNode: (message: SidebarNotesPageToHost['hoverNotesGraphNode']) =>
        vscode.commands.executeCommand('deckard.highlightNotesGraphNode', message.nodeId),
      openTag: openTag({ indexer, navigation, policy: 'lenient', openTag: openTagPage }),
      openSource: (message: SidebarNotesPageToHost['openSource']) => this.openSource(message),
      openLinksSearch: () => this.openLinksSearch(),
      refineActiveSearch: (message: RefineActiveSearchMessage) => this.refineActiveSearch(message),
      // What is done in the calendar's day is the calendar's to do.
      calendarDay: async (message: SidebarNotesPageToHost['calendarDay']) => {
        const source = this.sidebar.activeCalendar?.active;
        if (source) {
          await source.handleDayMessage(message.message);
        }
      },
    };
  }

  /** The handlers that write to notes: links, tags, and renames. */
  private createWriteHandlers() {
    const { indexer, history, preferences } = this.sidebar;
    return {
      renameTag: renameTag({ indexer, writes: { history, preferences }, openTag: (tagKey) => this.sidebar.onOpenTag(tagKey) }),
      parkTag: parkTag(),
      unparkTag: parkTag(),
      insertLink: (message: SidebarNotesPageToHost['insertLink']) => this.insertLink(message),
      linkMention: (message: LinkMentionMessage) => this.linkMention(message),
      linkAllMentions: () => this.linkAllMentions(),
      addSuggestedTag: (message: SidebarNotesPageToHost['addSuggestedTag']) => this.addSuggestedTag(message.tagKey),
    };
  }

  /** The handlers that change what the sidebar, or Home, shows. */
  private createSettingHandlers() {
    const { display } = this.sidebar.preferences;
    return {
      clearEntryRelatedNotes: () => {
        this.entryContext = undefined;
        this.suppressAutomaticEntrySelection = true;
        this.refresh();
      },
      // The view does not follow every preference write, so it redraws here:
      // the list in its new order, and the select saying so.
      setRelatedNotesSort: async (message: SidebarNotesPageToHost['setRelatedNotesSort']) => {
        await display.setRelatedNotesSortMode(message.mode);
        this.refresh();
      },
      setHideDailyNotes: async (message: SidebarNotesPageToHost['setHideDailyNotes']) => {
        await display.setHideDailyNotes(message.hide);
        this.refresh();
      },
      setRelatedNotesPreviewLines: async (message: SidebarNotesPageToHost['setRelatedNotesPreviewLines']) => {
        await display.setRelatedNotesPreviewLines(message.lines);
        this.refresh();
      },
      // Home's widgets are Home's to add, and to reset.
      homeAddWidget: (message: SidebarNotesPageToHost['homeAddWidget']) => {
        this.sidebar.activeHome?.active?.addWidget(message.value);
      },
      homeResetWidgets: async () => {
        await this.sidebar.activeHome?.active?.resetWidgets();
      },
    };
  }

  /**
   * The active editor, and where its cursor is, choose the entry ranked
   * for; a cursor move within one entry ranks nothing again.
   */
  private followEditor(): vscode.Disposable[] {
    return [
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.suppressAutomaticEntrySelection = false;
        this.updateEntryContextFromActiveEditor(true);
        this.refresh();
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor !== vscode.window.activeTextEditor) {
          return;
        }
        // Typing moves the cursor on every keystroke, and ranking reads the
        // whole workspace, so the sidebar only refreshes when the cursor
        // reaches a different tagged entry.
        const previous = this.entryContext;
        this.suppressAutomaticEntrySelection = false;
        this.updateEntryContextFromActiveEditor(true);
        if (!isSameEntryContext(previous, this.entryContext)) {
          this.scheduleRefresh();
        }
      }),
    ];
  }

  /** Redraws for a setting the ranking or its titles read. */
  private onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent): void {
    // The ranking reads settings it does not redraw for, such as the board's
    // status namespace, so any of Deckard's means the state may be out of date.
    if (event.affectsConfiguration('deckard')) {
      this.forgetCurrent();
    }
    if (
      event.affectsConfiguration('deckard.enableKeywordLinks') ||
      event.affectsConfiguration('deckard.relatedNotesAssociationMinimumSupport') ||
      event.affectsConfiguration('deckard.relatedNotesRecencyHalfLifeDays')
    ) {
      this.refresh();
    }
    if (event.affectsConfiguration('deckard.tagTitleDisplayMode')) {
      this.refresh();
    }
    if (event.affectsConfiguration('deckard.enableHeadingTagRelationships')) {
      this.refresh();
    }
    if (!event.affectsConfiguration('deckard.autoSelectNoteSections')) {
      return;
    }
    this.updateEntryContextFromActiveEditor();
    this.refresh();
  }

  /** The view the sidebar is shown in, while its host has one. */
  private get surface(): WebviewSurface | undefined {
    return this.page?.surface;
  }

  /** Brings the view to the front of its side bar, keeping the focus where it is. */
  private reveal(): void {
    if (this.surface instanceof ViewSurface) {
      this.surface.view.show(true);
    }
  }

  /**
   * Where an entry the editor names sits in the saved note. Related Notes
   * ranks saved notes, but a count or hover in an unsaved note names a line
   * in the text as it is now, where lines may have moved since the save.
   */
  private resolveSavedEntryLine(documentUri: vscode.Uri, sourceLine: number, savedFile: ParsedFile): number | undefined {
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === documentUri.toString(),
    );
    if (!document?.isDirty) {
      return sourceLine;
    }
    return findMatchingEntryLine(this.sidebar.indexer.parse(documentUri, document.getText()), sourceLine, savedFile);
  }

  /** Refreshes once a burst of cursor moves, such as a held arrow key, ends. */
  private scheduleRefresh(): void {
    this.forgetCurrent();
    clearTimeout(this.refreshHandle);
    this.refreshHandle = setTimeout(() => {
      this.refreshHandle = undefined;
      this.refresh();
    }, selectionRefreshDelayMs);
  }

  /**
   * Shows the active search page's Refine options while one is the active
   * editor, and otherwise the notes related to the Markdown note.
   */
  private createSnapshot(): SidebarNotesSnapshot {
    const index = this.sidebar.indexer.getSnapshot();
    return this.createPageSnapshot() ?? this.createUnreadNoteSnapshot() ?? this.createNoteSnapshot(index);
  }

  /**
   * What a page in front has the sidebar show in its place: a graph node's
   * connections, the calendar page's chosen day, Home's widgets, or a
   * search's Refine options. Undefined when none does.
   */
  private createPageSnapshot(): SidebarNotesSnapshot | undefined {
    if (this.graphContext) {
      return this.createEmptySnapshot({ graph: this.graphContext, state: 'graph' });
    }
    // The calendar page in front: its chosen day, which the page leaves
    // to this pane while it is open.
    const day = this.sidebar.activeCalendar?.active?.getDay();
    if (day) {
      return this.createEmptySnapshot({ calendarDay: day, state: 'calendarDay' });
    }
    // Home in front: the widgets it can add, and Reset.
    const home = this.sidebar.activeHome?.active;
    if (home) {
      return this.createEmptySnapshot({ homeWidgets: home.getWidgetChoices(), state: 'customizeHome' });
    }
    const refine = this.sidebar.activeSearch.active?.getRefineState();
    return refine ? this.createEmptySnapshot({ refine, state: 'refine' }) : undefined;
  }

  /**
   * A Markdown note that is open but absent from the index is either one
   * Deckard has not read yet, or one outside the notes folder. Both used to
   * read as "open a Markdown note", contradicting the editor. Undefined for
   * any other editor.
   */
  private createUnreadNoteSnapshot(): SidebarNotesSnapshot | undefined {
    const openDocument = vscode.window.activeTextEditor?.document;
    if (
      !openDocument ||
      !isMarkdownDocument(openDocument) ||
      this.getActiveFile() ||
      // A entry chosen by hand keeps the pane on that entry, whatever the
      // editor is showing.
      this.entryContext?.source === 'manual'
    ) {
      return undefined;
    }
    return this.createEmptySnapshot({
      state: this.indexed ? 'notIndexed' : 'loading',
      ...(!this.indexed && this.sidebar.indexer.scanProgress ? { progress: this.sidebar.indexer.scanProgress } : {}),
    });
  }

  /**
   * The notes related to the note in the editor, or to the entry chosen by
   * hand, with what links to the note when the index has it.
   */
  private createNoteSnapshot(index: WorkspaceIndex): SidebarNotesSnapshot {
    const { filePath, file, entry } = this.selectEntry(index);
    // The moment this snapshot is built at, for the ranking's recency and
    // for how lately each linking note changed.
    const now = Date.now();
    const reader = this.sidebar.preferences.reader.value;
    const snapshot = createSidebarSnapshot(index, filePath, entry?.file ?? file, {
      now,
      enableKeywordLinks: this.areKeywordLinksEnabled(),
      relatedNotesSortMode: reader.relatedNotesSortMode,
      sectionAccessCounts: reader.sectionAccessCounts,
      tagTitleDisplayMode: this.getTagTitleDisplayMode(),
      activeEntryTitle: entry ? getEntryTitle(entry.file) : undefined,
      activeTagWeights: entry?.tagWeights,
      rankingOptions: this.getRelatedNotesRankingOptions(),
    });
    // What links here is about the whole note, whichever entry is selected.
    const indexedFile = filePath ? index.files.get(filePath) : undefined;
    const hideDailyNotes = this.sidebar.preferences.reader.value.hideDailyNotes === true;
    const previewLines = this.sidebar.preferences.reader.value.relatedNotesPreviewLines ?? 1;
    return indexedFile
      ? {
          ...snapshot,
          hideDailyNotes,
          previewLines,
          links: collectNoteLinks(index, indexedFile, { now, hideDailyNotes }),
        }
      : { ...snapshot, hideDailyNotes, previewLines };
  }

  /**
   * The note ranked for, and the entry in it when one is chosen: the entry
   * chosen by hand, or the note in the editor and the entry its cursor is
   * in, followed first.
   */
  private selectEntry(index: WorkspaceIndex) {
    this.updateEntryContextFromActiveEditor();
    const active = this.getActiveFile();
    const manual = this.entryContext?.source === 'manual' ? this.entryContext : undefined;
    const file = manual ? index.files.get(manual.filePath) : active?.file;
    const filePath = manual ? manual.filePath : active?.filePath;
    const entry =
      file && filePath && this.entryContext?.filePath === filePath
        ? createEntryScope(file, this.entryContext.sourceLine)
        : undefined;
    return { filePath, file, entry };
  }

  /** A state with no notes and no tags, and the fields it is drawn from. */
  private createEmptySnapshot(
    fields: Partial<SidebarNotesSnapshot> & Pick<SidebarNotesSnapshot, 'state'>,
  ): SidebarNotesSnapshot {
    return {
      activeTags: [],
      notes: [],
      tagTitleDisplayMode: this.getTagTitleDisplayMode(),
      ...fields,
    };
  }

  /** How tag titles are drawn, as the setting says. */
  private getTagTitleDisplayMode(): TagTitleDisplayMode {
    return normalizeTagTitleDisplayMode(
      vscode.workspace.getConfiguration('deckard').get<unknown>('tagTitleDisplayMode', 'inline'),
    );
  }

  /**
   * Reads the active note from the saved workspace index.
   */
  private getActiveFile(): ActiveFile | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isMarkdownDocument(document)) {
      return undefined;
    }

    const filePath = this.sidebar.indexer.getFilePath(document.uri);
    const file = this.sidebar.indexer.getSnapshot().files.get(filePath);
    if (!file) {
      return undefined;
    }
    return {
      filePath,
      file,
    };
  }

  /**
   * Keeps the sidebar focused on the smallest tagged entry containing the cursor.
   */
  private updateEntryContextFromActiveEditor(fromSelection = false): void {
    if (!fromSelection && this.entryContext?.source === 'manual') {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const active = this.getActiveFile();
    if (!editor || !active) {
      this.entryContext = undefined;
      return;
    }
    if (!fromSelection && this.suppressAutomaticEntrySelection) {
      return;
    }
    if (!shouldAutoSelectNoteSections(editor.document)) {
      if (this.entryContext?.source === 'cursor') {
        this.entryContext = undefined;
      }
      return;
    }
    const entry = findTaggedEntry(active.file, editor.selection.active.line + 1);
    this.entryContext = entry
      ? {
          filePath: active.filePath,
          sourceLine: getEntryStartLine(entry),
          source: 'cursor',
        }
      : undefined;
  }

  /**
   * Reads the active note's workspace setting for related-note ranking.
   */
  private areKeywordLinksEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard', vscode.window.activeTextEditor?.document.uri)
      .get<boolean>('enableKeywordLinks', true);
  }

  /** The ranking's settings, for the active note's folder, and what it leaves out. */
  private getRelatedNotesRankingOptions(): RelatedNotesRankingOptions {
    const configuration = vscode.workspace.getConfiguration('deckard', vscode.window.activeTextEditor?.document.uri);
    return {
      associationMinimumSupport: configuration.get<number>('relatedNotesAssociationMinimumSupport', 1),
      recencyHalfLifeDays: configuration.get<number>('relatedNotesRecencyHalfLifeDays', 0),
      hidePeriodicNotes: this.sidebar.preferences.reader.value.hideDailyNotes === true,
      // The board's status is how a task moves, not what a note is about.
      excludedTagNamespaces: [
        readStatusNamespace(vscode.workspace.getConfiguration('deckard')),
      ],
    };
  }

  /** The note Related Notes is about: the one chosen by hand, or the active one. */
  private getSelectedFilePath(): string | undefined {
    return this.entryContext?.source === 'manual' ? this.entryContext.filePath : this.getActiveFile()?.filePath;
  }

  /**
   * Opens a row's line: one that links here, or names this note, opens
   * where it is, and a related note opens at its first line, counting its
   * entry's visit first. The row is checked against what the sidebar
   * would list now, ranked again for the click.
   */
  private async openSource(message: SidebarNotesPageToHost['openSource']): Promise<void> {
    const location = this.sidebar.navigation.resolveRelatedSource(this.createSnapshot(), message.filePath, message.line);
    if (location.kind === 'unknown') {
      return;
    }
    if (location.visit) {
      await this.sidebar.preferences.usage.recordSectionAccess(location.visit);
    }
    // A result used to replace the note it was ranked from, with no way
    // back but Ctrl+Tab. Cmd/Ctrl-click opens it alongside instead.
    await openSourceAt({ filePath: location.filePath, line: location.line, beside: message.beside === true });
  }

  /**
   * Writes a link to a related note at the cursor, for a note the sidebar
   * would list now.
   */
  private async insertLink(message: SidebarNotesPageToHost['insertLink']): Promise<void> {
    const index = this.sidebar.indexer.getSnapshot();
    const note = this.sidebar.navigation.findRelatedNote(this.createSnapshot(), message.filePath, message.line);
    if (note) {
      await insertWikiLink(createWikiLink(index, note.filePath, note.sectionId));
    }
  }

  /** Open as search: every entry that links to the note. */
  private async openLinksSearch(): Promise<void> {
    const index = this.sidebar.indexer.getSnapshot();
    // Built here from the note itself, never from text the page sent.
    const filePath = this.getSelectedFilePath();
    const file = filePath ? index.files.get(filePath) : undefined;
    if (file) {
      await vscode.commands.executeCommand(
        'deckard.search',
        createLinksSearchQuery(file, this.sidebar.preferences.reader.value.hideDailyNotes === true),
      );
    }
  }

  /** Link all: every mention of the note, while the sidebar lists its links. */
  private async linkAllMentions(): Promise<void> {
    const filePath = this.sidebar.navigation.listsNoteLinks(this.createSnapshot()) ? this.getSelectedFilePath() : undefined;
    const uri = filePath ? await resolveSourceUri(filePath) : undefined;
    if (uri) {
      await linkMentions(this.sidebar.indexer, this.sidebar.history, uri);
    }
  }

  /**
   * Makes one mention a link, as written: `atlas` becomes `[[atlas]]`. The
   * mention is found again in the snapshot and in its note as it is now, so
   * a line edited since is left alone. It is one write, taken back by Undo
   * Last Change.
   */
  private async linkMention(message: LinkMentionMessage): Promise<void> {
    const mention = this.sidebar.navigation.findNoteMention(
      this.createSnapshot(),
      message.filePath,
      message.line,
      message.startColumn,
    );
    const uri = mention ? await resolveSourceUri(mention.filePath) : undefined;
    if (!mention || !uri) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const range = new vscode.Range(mention.line - 1, mention.startColumn, mention.line - 1, mention.endColumn);
    if (mention.line > document.lineCount || document.getText(range) !== mention.name) {
      void reportStale([uri]);
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, `[[${mention.name}]]`);
    await this.sidebar.history.write(edit, {
      label: `a link to ${mention.name} in ${mention.title}`,
    });
    await this.sidebar.indexer.refresh();
  }

  /**
   * Writes a tag the similar notes use onto the untagged note, on the
   * heading or line where the cursor is, found from the note as it is now.
   * The tag must still be one the sidebar offers. One write, which the
   * message's Undo and Undo Last Change both take back.
   */
  private async addSuggestedTag(tagKey: string): Promise<void> {
    const snapshot = this.createSnapshot();
    const tag = this.sidebar.navigation.findSuggestedTag(snapshot, tagKey);
    const filePath = this.getSelectedFilePath();
    if (!tag || !filePath) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      !isMarkdownDocument(editor.document) ||
      this.sidebar.indexer.getFilePath(editor.document.uri) !== filePath
    ) {
      void vscode.window.showInformationMessage(
        'Open the note in an editor, and put the cursor where the tag should go.',
      );
      return;
    }
    const document = editor.document;
    const lines = document.getText().split(/\r?\n/);
    const target = findTagTarget(lines, editor.selection.active.line + 1);
    if (!target) {
      void vscode.window.showInformationMessage('Write a heading or a line first, then add the tag to it.');
      return;
    }
    const configuration = vscode.workspace.getConfiguration('deckard', document.uri);
    const before = lines[target.line - 1];
    const after = appendTagToLine(before, tag.label, {
      entityNamespaceAliases: getEntityNamespaceAliases(configuration.get<unknown>('entityNamespaceAliases', {})),
      personMarker: getPersonMarker(configuration.get<unknown>('personMarker', '@')),
    });
    if (after === before) {
      void vscode.window.showInformationMessage(`This line already has ${tag.label}.`);
      return;
    }
    const where = target.kind === 'heading' ? `"${target.label}"` : target.label;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, document.lineAt(target.line - 1).range, after);
    const written = await this.sidebar.history.write(edit, {
      label: `${tag.label} on ${where}`,
      preview: 'never',
    });
    if (!written.applied) {
      void reportFailure(describeRejectedEdit(noteName(document.uri)));
      return;
    }
    await this.sidebar.indexer.refresh();
    const uri = document.uri;
    void vscode.window
      .showInformationMessage(`Added ${tag.label} to ${where}.`, 'Undo')
      .then(async (choice) => {
        if (choice !== 'Undo') {
          return;
        }
        const now = await vscode.workspace.openTextDocument(uri);
        if (target.line > now.lineCount || now.lineAt(target.line - 1).text !== after) {
          void vscode.window.showWarningMessage(
            `Line ${target.line} changed after the tag was added, so Deckard left it as it is.`,
          );
          return;
        }
        const undo = new vscode.WorkspaceEdit();
        undo.replace(uri, now.lineAt(target.line - 1).range, before);
        await this.sidebar.history.write(undo, { label: `taking ${tag.label} off ${where}`, preview: 'never' });
        await this.sidebar.indexer.refresh();
      });
  }

  /**
   * Narrows the active search by a value its Refine view lists, as the
   * page's own Refine would.
   */
  private async refineActiveSearch(message: RefineActiveSearchMessage): Promise<void> {
    const source = this.sidebar.activeSearch.active;
    const state = source?.getRefineState();
    const facet = state?.query.facets.find((candidate) => candidate.id === message.facetId);
    if (!source || !state || !facet?.values.some((value) => value.clause === message.clause)) {
      return;
    }
    await source.applySearch(refineQueryText(state.query.text, message.clause, message.mode, facet.applied[0]));
  }
}

/** Today, as the state last posted remembers the day it was ranked on. */
function today(): string {
  return new Date().toDateString();
}

/** Whether two cursor or manual contexts name the same entry. */
function isSameEntryContext(left: EntryContext | undefined, right: EntryContext | undefined): boolean {
  return left?.filePath === right?.filePath && left?.sourceLine === right?.sourceLine && left?.source === right?.source;
}

/**
 * Pairs the canonical path with content parsed using current editor text.
 */
interface ActiveFile {
  filePath: string;
  file: ParsedFile;
}

/** The entry Related Notes ranks for: chosen by the cursor, or by hand from a hover. */
interface EntryContext {
  filePath: string;
  sourceLine: number;
  source: 'cursor' | 'manual';
}

/** Where a tagged entry starts: its heading, or its task's line. */
function getEntryStartLine(entry: NonNullable<ReturnType<typeof findTaggedEntry>>): number {
  return 'heading' in entry ? entry.startLine : entry.lineNumber;
}

/**
 * The saved line of the tagged entry at `liveLine` in a note's unsaved text,
 * or undefined when the saved note has no such entry, as when its title was
 * changed and not yet saved.
 *
 * The entry is found again by its title, and among entries sharing a title by
 * its position, so the second "## Next" in the editor is the second one saved
 * even when lines above both have moved.
 */
export function findMatchingEntryLine(liveFile: ParsedFile, liveLine: number, savedFile: ParsedFile): number | undefined {
  const liveEntry = findTaggedEntry(liveFile, liveLine);
  if (!liveEntry) {
    return undefined;
  }
  const liveStart = getEntryStartLine(liveEntry);
  const pick = (liveLines: number[], savedLines: number[]) => {
    const tagged = savedLines.filter((line) => findTaggedEntry(savedFile, line) !== undefined);
    const occurrence = liveLines.filter((line) => line < liveStart).length;
    return tagged[Math.min(occurrence, tagged.length - 1)];
  };
  if ('heading' in liveEntry) {
    const sameTitle = (sections: Section[]) =>
      sections
        .filter(
          (section) =>
            section.heading === liveEntry.heading && Boolean(section.isInline) === Boolean(liveEntry.isInline),
        )
        .map((section) => section.startLine)
        .sort((left, right) => left - right);
    return pick(sameTitle(liveFile.sections), sameTitle(savedFile.sections));
  }
  const sameTitle = (file: ParsedFile) =>
    file.tasks
      .filter((task) => task.title === liveEntry.title)
      .map((task) => task.lineNumber)
      .sort((left, right) => left - right);
  return pick(sameTitle(liveFile), sameTitle(savedFile));
}

/** An entry's title: its first heading, or its first task's. */
function getEntryTitle(file: ParsedFile): string | undefined {
  return file.sections[0]?.heading ?? file.tasks[0]?.title;
}

/**
 * Uses the URI extension so manual language-mode changes do not hide Markdown.
 */
function isMarkdownDocument(document: vscode.TextDocument): boolean {
  return isMarkdownFile(document.uri);
}

/** Whether the cursor chooses the entry ranked for, as the note's folder sets it. */
function shouldAutoSelectNoteSections(document: vscode.TextDocument): boolean {
  return vscode.workspace.getConfiguration('deckard', document.uri).get<boolean>('autoSelectNoteSections', true);
}

/** A message's type, for the log, or `invalid payload`. */
function describeMessage(message: unknown): string {
  if (typeof message === 'object' && message !== null && 'type' in message && typeof message.type === 'string') {
    return message.type;
  }
  return 'invalid payload';
}

/** What a state is about, for the log: the search, the Markdown note, or neither. */
function describeSource(snapshot: SidebarNotesSnapshot): string {
  if (snapshot.refine) {
    return ` (search ${snapshot.refine.title})`;
  }
  return snapshot.activeFileName ? ` (Markdown ${snapshot.activeFileName})` : '';
}

/** An error, as the log says it. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
