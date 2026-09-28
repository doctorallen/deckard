import * as vscode from 'vscode';

import { listedParkedTags } from '../../core/workspace/parked';
import { onDidChangePageChrome } from './components';

import { PreferencesStore } from '../../core/storage/preferences';
import { logTrace, measure } from '../../core/timing';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { refineQueryText } from '../../core/query/queryEdit';
import {
  LinkMentionMessage,
  ParsedFile,
  RefineActiveSearchMessage,
  Section,
  SidebarGraphContext,
  SidebarNotesSnapshot,
  SidebarMessage,
  TagReference,
  TagTitleDisplayMode,
} from '../../core/types';
import { normalizeTagTitleDisplayMode } from '../state/dashboardState';
import {
  createSidebarSnapshot,
  RelatedNotesRankingOptions,
} from '../state/relatedNotesRanking';
import { createWikiLink, insertWikiLink } from '../commands/insertLink';
import { openSourceAt, resolveSourceUri } from '../commands/navigation';
import { describeRejectedEdit, noteName, reportFailure, reportStale } from '../commands/notify';
import { appendTagToLine } from '../commands/bulkEdit';
import { findTagTarget } from '../../core/markdown/tagTarget';
import { getEntityNamespaceAliases, getPersonMarker } from '../../core/markdown/parser';
import { renameIndexedTag } from '../commands/renameTag';
import { ActiveCalendar } from './activeCalendar';
import { ActiveHome } from './activeHome';
import { ActiveSearch } from './activeSearch';
import { getSidebarNotesHtml } from './sidebarNotesHtml';
import { parseCalendarMessage, parseSidebarMessage } from './messages';
import { collectNoteLinks, createLinksSearchQuery } from '../state/noteLinks';
import { linkMentions } from '../commands/unlinkedMentions';
import { applyWorkspaceWrite } from '../commands/workspaceWrites';
import { onIndexUpdateInTurn, viewPriority, whenPublished } from '../../core/workspace/publishing';

/** How long cursor moves must pause before the sidebar ranks a new entry. */
const selectionRefreshDelayMs = 120;

/**
 * Shows the notes related to the Markdown note being edited, or, while a
 * search page is the active editor, that search's Refine options, so the page
 * keeps its height for its results.
 *
 * It presents saved-note relationships from the workspace index so sidebar
 * context matches the persistent local search data.
 */
export class SidebarNotesView
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private entryContext: EntryContext | undefined;
  private graphContext: SidebarGraphContext | undefined;
  private suppressAutomaticEntrySelection = false;
  private refreshHandle: ReturnType<typeof setTimeout> | undefined;
  /** Whether the first scan has finished, which tells indexing from missing. */
  private indexed = false;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly activeSearch: ActiveSearch,
    private readonly onOpenTag: (tagKey: string) => void | Promise<void>,
    private readonly extensionVersion: string,
    /** The calendar page, whose chosen day this shows while it is in front. */
    private readonly activeCalendar?: ActiveCalendar,
    /** Home, whose widgets this offers to add while it is in front. */
    private readonly activeHome?: ActiveHome,
  ) {
    if (activeHome) {
      this.disposables.push(activeHome.onDidChange(() => this.refresh()));
    }
    if (activeCalendar) {
      this.disposables.push(activeCalendar.onDidChange(() => this.refresh()));
    }
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Related Notes', priority: () => viewPriority(this.view) },
        () => this.refresh(),
      ),
    );
    // While the first scan runs, the waiting line says how far it has got.
    if (indexer.onDidProgress) {
      this.disposables.push(
        indexer.onDidProgress(() => {
          if (!this.indexed) {
            this.scheduleRefresh();
          }
        }),
      );
    }
    this.disposables.push(activeSearch.onDidChange(() => this.refresh()));
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.suppressAutomaticEntrySelection = false;
        this.updateEntryContextFromActiveEditor(true);
        this.refresh();
      }),
    );
    this.disposables.push(
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
    );
    this.disposables.push(
      onDidChangePageChrome(() => {
        this.renderHtml();
        this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
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
        if (
          event.affectsConfiguration(
            'deckard.enableHeadingTagRelationships',
          )
        ) {
          this.refresh();
        }
        if (event.affectsConfiguration('deckard.autoSelectNoteSections')) {
          this.updateEntryContextFromActiveEditor();
          this.refresh();
        }
      }),
    );
  }

  /**
   * Binds a VS Code webview view and waits for indexed data before first render.
   */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.log('Resolving Related Notes webview.');
    this.disposeViewListeners();
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.viewDisposables = [
      webviewView.onDidDispose(() => {
        this.log('Related Notes webview disposed.');
        this.view = undefined;
        this.activeSearch.setSidebarVisible(false);
        this.activeCalendar?.setSidebarVisible(false);
        this.disposeViewListeners();
      }),
      webviewView.onDidChangeVisibility(() => {
        this.log(
          `Related Notes visibility changed: ${webviewView.visible}.`,
        );
        this.activeSearch.setSidebarVisible(webviewView.visible);
        this.activeCalendar?.setSidebarVisible(webviewView.visible);
        if (webviewView.visible) {
          this.refresh();
        }
      }),
      webviewView.webview.onDidReceiveMessage((message) => {
        this.log(`Received Related Notes webview message: ${describeMessage(message)}.`);
        void this.handleMessage(message);
      }),
    ];
    this.renderHtml();
    this.activeSearch.setSidebarVisible(webviewView.visible);
    this.activeCalendar?.setSidebarVisible(webviewView.visible);
    this.refresh();
    void whenPublished(this.indexer).then(() => {
      this.indexed = true;
      this.refresh();
    });
  }

  /**
   * Releases view listeners and shared subscriptions.
   */
  public dispose(): void {
    clearTimeout(this.refreshHandle);
    this.disposeViewListeners();
    this.view = undefined;
    this.activeSearch.setSidebarVisible(false);
    this.activeCalendar?.setSidebarVisible(false);
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Narrows the sidebar to one tagged entry selected from a Markdown hover.
   */
  public async showRelatedNotesForEntry(
    documentUri: vscode.Uri,
    sourceLine: number,
  ): Promise<void> {
    await whenPublished(this.indexer);
    const index = this.indexer.getSnapshot();
    const filePath = this.indexer.getFilePath(documentUri);
    const file = index.files.get(filePath);
    const savedLine =
      file && this.resolveSavedEntryLine(documentUri, sourceLine, file);
    const entry =
      file && savedLine !== undefined
        ? findTaggedEntry(file, savedLine)
        : undefined;
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
    this.view?.show(true);
    this.refresh();
  }

  public async showGraphConnections(
    context: SidebarGraphContext,
    reveal = false,
  ): Promise<void> {
    this.graphContext = context;
    if (reveal) {
      await vscode.commands.executeCommand('workbench.view.extension.deckard');
      this.view?.show(true);
    }
    this.refresh();
  }

  public clearGraphConnections(): void {
    if (!this.graphContext) {
      return;
    }
    this.graphContext = undefined;
    this.refresh();
  }

  /**
   * Where an entry the editor names sits in the saved note. Related Notes
   * ranks saved notes, but a count or hover in an unsaved note names a line
   * in the text as it is now, where lines may have moved since the save.
   */
  private resolveSavedEntryLine(
    documentUri: vscode.Uri,
    sourceLine: number,
    savedFile: ParsedFile,
  ): number | undefined {
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === documentUri.toString(),
    );
    if (!document?.isDirty) {
      return sourceLine;
    }
    return findMatchingEntryLine(
      this.indexer.parse(documentUri, document.getText()),
      sourceLine,
      savedFile,
    );
  }

  public async getEntryDiagnostic(
    documentUri: vscode.Uri,
    sourceLine: number,
  ): Promise<EntryRelatedNotesDiagnostic | undefined> {
    await whenPublished(this.indexer);
    const index = this.indexer.getSnapshot();
    const filePath = this.indexer.getFilePath(documentUri);
    const file = index.files.get(filePath);
    const savedLine =
      file && this.resolveSavedEntryLine(documentUri, sourceLine, file);
    const entryScope =
      file && savedLine !== undefined
        ? createEntryScope(file, savedLine)
        : undefined;
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
      snapshot: createSidebarSnapshot(
        index,
        filePath,
        entryScope.file,
        this.areKeywordLinksEnabled(),
        'tags',
        this.preferences.value.sectionAccessCounts,
        this.getTagTitleDisplayMode(),
        getEntryTitle(entryScope.file),
        entryScope.tagWeights,
        this.getRelatedNotesRankingOptions(),
      ),
    };
  }

  /**
   * Removes listeners tied to the current view instance before replacement.
   */
  private disposeViewListeners(): void {
    this.viewDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.view) {
      this.log('Rendering Related Notes webview HTML.');
      this.view.webview.html = getSidebarNotesHtml(
        this.view.webview,
        this.extensionVersion,
      );
    }
  }

  /**
   * Sends the current sidebar projection only when the view is attached.
   */
  private refresh(snapshot?: SidebarNotesSnapshot): void {
    clearTimeout(this.refreshHandle);
    this.refreshHandle = undefined;
    if (!this.view) {
      this.log('Skipped Related Notes refresh because no webview is attached.');
      return;
    }
    // A hidden sidebar is refreshed when it is shown again.
    if (!this.view.visible) {
      this.log('Skipped Related Notes refresh because the view is hidden.');
      return;
    }

    const currentSnapshot =
      snapshot ??
      measure(
        'Related Notes',
        () => this.createSnapshot(),
        (result) => `${result.notes.length} results`,
      );
    this.log(
      `Sending Related Notes state: ${currentSnapshot.state}${currentSnapshot.refine ? ` (search ${currentSnapshot.refine.title})` : currentSnapshot.activeFileName ? ` (Markdown ${currentSnapshot.activeFileName})` : ''}, ${currentSnapshot.notes.length} note entries.`,
    );
    void this.view.webview
      .postMessage({
        type: 'state',
        data: { ...currentSnapshot, parkedTags: listedParkedTags(this.indexer) },
      })
      .then(
        (delivered) =>
          this.log(
            `Related Notes state delivery ${delivered ? 'succeeded' : 'was skipped because the webview is not live'}.`,
          ),
        (error: unknown) =>
          this.log(
            `Related Notes state delivery failed: ${formatError(error)}.`,
          ),
      );
  }

  /** Refreshes once a burst of cursor moves, such as a held arrow key, ends. */
  private scheduleRefresh(): void {
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
    const index = this.indexer.getSnapshot();
    if (this.graphContext) {
      return {
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: this.getTagTitleDisplayMode(),
        graph: this.graphContext,
        state: 'graph',
      };
    }
    // The calendar page in front: its chosen day, which the page leaves
    // to this pane while it is open.
    const day = this.activeCalendar?.active?.getDay();
    if (day) {
      return {
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: this.getTagTitleDisplayMode(),
        calendarDay: day,
        state: 'calendarDay',
      };
    }
    // Home in front: the widgets it can add, and Reset.
    const home = this.activeHome?.active;
    if (home) {
      return {
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: this.getTagTitleDisplayMode(),
        homeWidgets: home.getWidgetChoices(),
        state: 'customizeHome',
      };
    }
    const refine = this.activeSearch.active?.getRefineState();
    if (refine) {
      return {
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: this.getTagTitleDisplayMode(),
        refine,
        state: 'refine',
      };
    }

    // A Markdown note that is open but absent from the index is either one
    // Deckard has not read yet, or one outside the notes folder. Both used to
    // read as "open a Markdown note", contradicting the editor.
    const openDocument = vscode.window.activeTextEditor?.document;
    if (
      openDocument &&
      isMarkdownDocument(openDocument) &&
      !this.getActiveFile() &&
      // A entry chosen by hand keeps the pane on that entry, whatever the
      // editor is showing.
      this.entryContext?.source !== 'manual'
    ) {
      return {
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: this.getTagTitleDisplayMode(),
        state: this.indexed ? 'notIndexed' : 'loading',
        ...(!this.indexed && this.indexer.scanProgress
          ? { progress: this.indexer.scanProgress }
          : {}),
      };
    }

    this.updateEntryContextFromActiveEditor();
    const active = this.getActiveFile();
    const selectedFile =
      this.entryContext?.source === 'manual'
        ? index.files.get(this.entryContext.filePath)
        : active?.file;
    const selectedFilePath =
      this.entryContext?.source === 'manual'
        ? this.entryContext.filePath
        : active?.filePath;
    const activeEntry =
      selectedFile &&
      selectedFilePath &&
      this.entryContext?.filePath === selectedFilePath
        ? createEntryScope(selectedFile, this.entryContext.sourceLine)
        : undefined;
    const snapshot = createSidebarSnapshot(
      index,
      selectedFilePath,
      activeEntry?.file ?? selectedFile,
      this.areKeywordLinksEnabled(),
      this.preferences.value.relatedNotesSortMode,
      this.preferences.value.sectionAccessCounts,
      this.getTagTitleDisplayMode(),
      activeEntry ? getEntryTitle(activeEntry.file) : undefined,
      activeEntry?.tagWeights,
      this.getRelatedNotesRankingOptions(),
    );
    // What links here is about the whole note, whichever entry is selected.
    const indexedFile = selectedFilePath ? index.files.get(selectedFilePath) : undefined;
    const hideDailyNotes = this.preferences.value.hideDailyNotes === true;
    const previewLines = this.preferences.value.relatedNotesPreviewLines ?? 1;
    return indexedFile
      ? {
          ...snapshot,
          hideDailyNotes,
          previewLines,
          links: collectNoteLinks(index, indexedFile, { hideDailyNotes }),
        }
      : { ...snapshot, hideDailyNotes, previewLines };
  }

  private getTagTitleDisplayMode(): TagTitleDisplayMode {
    return normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
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

    const filePath = this.indexer.getFilePath(document.uri);
    const file = this.indexer.getSnapshot().files.get(filePath);
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
    if (!this.shouldAutoSelectNoteSections(editor.document)) {
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

  private shouldAutoSelectNoteSections(document: vscode.TextDocument): boolean {
    return vscode.workspace
      .getConfiguration('deckard', document.uri)
      .get<boolean>('autoSelectNoteSections', true);
  }

  /**
   * Reads the active note's workspace setting for related-note ranking.
   */
  private areKeywordLinksEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard', vscode.window.activeTextEditor?.document.uri)
      .get<boolean>('enableKeywordLinks', true);
  }

  private getRelatedNotesRankingOptions(): RelatedNotesRankingOptions {
    const configuration = vscode.workspace.getConfiguration(
      'deckard',
      vscode.window.activeTextEditor?.document.uri,
    );
    return {
      associationMinimumSupport: configuration.get<number>(
        'relatedNotesAssociationMinimumSupport',
        1,
      ),
      recencyHalfLifeDays: configuration.get<number>(
        'relatedNotesRecencyHalfLifeDays',
        0,
      ),
      hidePeriodicNotes: this.preferences.value.hideDailyNotes === true,
      // The board's status is how a task moves, not what a note is about.
      excludedTagNamespaces: [
        vscode.workspace.getConfiguration('deckard').get<string>('board.statusNamespace', 'status').trim() || 'status',
      ],
    };
  }

  /**
   * Rejects malformed sidebar messages before invoking navigation or commands.
   */
  private async handleMessage(value: unknown): Promise<void> {
    // Home's widgets are Home's to add, and to reset.
    const request = typeof value === 'object' && value !== null ? (value as { type?: unknown; value?: unknown }) : undefined;
    if (request?.type === 'homeAddWidget' && typeof request.value === 'string') {
      this.activeHome?.active?.addWidget(request.value);
      return;
    }
    if (request?.type === 'homeResetWidgets') {
      await this.activeHome?.active?.resetWidgets();
      return;
    }
    // What is done in the calendar's day is the calendar's to do.
    if (typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'calendarDay') {
      const dayMessage = parseCalendarMessage((value as { message?: unknown }).message);
      const source = this.activeCalendar?.active;
      if (dayMessage && source) {
        await source.handleDayMessage(dayMessage);
      }
      return;
    }
    const message = parseSidebarMessage(value);
    if (!message) {
      return;
    }

    await this.handleValidMessage(message);
  }

  /**
   * Revalidates navigation targets against the current sidebar projection.
   */
  private async handleValidMessage(message: SidebarMessage): Promise<void> {
    const index = this.indexer.getSnapshot();
    if (message.type === 'ready') {
      this.log('Related Notes webview is ready; refreshing state.');
      this.refresh();
      return;
    }
    if (message.type === 'clearEntryRelatedNotes') {
      this.entryContext = undefined;
      this.suppressAutomaticEntrySelection = true;
      this.refresh();
      return;
    }
    if (message.type === 'openDashboard') {
      await vscode.commands.executeCommand('deckard.showDashboard');
      return;
    }
    if (message.type === 'openNotesGraph') {
      await vscode.commands.executeCommand('deckard.showNotesGraph');
      return;
    }
    if (message.type === 'openTaskBoard') {
      await vscode.commands.executeCommand('deckard.showTaskBoard');
      return;
    }
    if (message.type === 'refineActiveSearch') {
      await this.refineActiveSearch(message);
      return;
    }
    if (message.type === 'activateNotesGraphNode') {
      await vscode.commands.executeCommand(
        'deckard.activateNotesGraphNode',
        message.nodeId,
        message.open,
      );
      return;
    }
    if (message.type === 'hoverNotesGraphNode') {
      await vscode.commands.executeCommand(
        'deckard.highlightNotesGraphNode',
        message.nodeId,
      );
      return;
    }
    if (message.type === 'createDailyNote') {
      await vscode.commands.executeCommand('deckard.createDailyNote');
      return;
    }
    if (message.type === 'openHelp') {
      await vscode.commands.executeCommand('deckard.showHelp');
      return;
    }
    if (message.type === 'setRelatedNotesSort') {
      await this.preferences.setRelatedNotesSortMode(message.mode);
      // The view does not follow every preference write, so it redraws here:
      // the list in its new order, and the select saying so.
      this.refresh();
      return;
    }
    if (message.type === 'openTag') {
      const tagKey = resolveIndexedTagKey(index.tags, message.tagKey);
      if (tagKey) {
        await this.onOpenTag(tagKey);
      }
      return;
    }
    if (message.type === 'parkTag' || message.type === 'unparkTag') {
      await vscode.commands.executeCommand(`deckard.${message.type}`, message.tagKey);
      return;
    }
    if (message.type === 'renameTag') {
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

    if (message.type === 'insertLink') {
      const note = this.createSnapshot().notes.find(
        (candidate) =>
          candidate.filePath === message.filePath &&
          candidate.sourceLine === message.line,
      );
      if (note) {
        await insertWikiLink(
          createWikiLink(index, note.filePath, note.sectionId),
        );
      }
      return;
    }

    if (message.type === 'linkMention') {
      await this.linkMention(message);
      return;
    }

    if (message.type === 'setHideDailyNotes') {
      await this.preferences.setHideDailyNotes(message.hide);
      this.refresh();
      return;
    }

    if (message.type === 'addSuggestedTag') {
      await this.addSuggestedTag(message.tagKey);
      return;
    }

    if (message.type === 'setRelatedNotesPreviewLines') {
      await this.preferences.setRelatedNotesPreviewLines(message.lines);
      this.refresh();
      return;
    }

    if (message.type === 'openLinksSearch') {
      // Built here from the note itself, never from text the page sent.
      const filePath = this.getSelectedFilePath();
      const file = filePath ? index.files.get(filePath) : undefined;
      if (file) {
        await vscode.commands.executeCommand(
          'deckard.search',
          createLinksSearchQuery(file, this.preferences.value.hideDailyNotes === true),
        );
      }
      return;
    }

    if (message.type === 'linkAllMentions') {
      const filePath = this.createSnapshot().links ? this.getSelectedFilePath() : undefined;
      const uri = filePath ? await resolveSourceUri(filePath) : undefined;
      if (uri) {
        await linkMentions(this.indexer, uri);
      }
      return;
    }

    if (message.type !== 'openSource') {
      return;
    }
    const active = this.getActiveFile();
    const snapshot = this.createSnapshot();
    // A line that links here, or names this note, opens where it is.
    const link = [
      ...(snapshot.links?.linkedFromNotes.flatMap((group) => group.entries) ?? []),
      ...(snapshot.links?.mentions ?? []),
    ].find(
      (candidate) =>
        candidate.filePath === message.filePath && candidate.line === message.line,
    );
    if (link) {
      await openSourceAt(link.filePath, link.line, undefined, message.beside === true);
      return;
    }
    const note = snapshot.notes.find(
      (candidate) =>
        candidate.filePath === message.filePath &&
        candidate.sourceLine === message.line,
    );
    if (note) {
      if (note.sectionId) {
        await this.preferences.recordSectionAccess(note.sectionId);
      }
      // A result used to replace the note it was ranked from, with no way
      // back but Ctrl+Tab. Cmd/Ctrl-click opens it alongside instead.
      await openSourceAt(
        note.filePath,
        note.sourceLine,
        undefined,
        message.beside === true,
      );
    }
  }

  /** The note Related Notes is about: the one chosen by hand, or the active one. */
  private getSelectedFilePath(): string | undefined {
    return this.entryContext?.source === 'manual'
      ? this.entryContext.filePath
      : this.getActiveFile()?.filePath;
  }

  /**
   * Makes one mention a link, as written: `atlas` becomes `[[atlas]]`. The
   * mention is found again in the snapshot and in its note as it is now, so
   * a line edited since is left alone. It is one write, taken back by Undo
   * Last Change.
   */
  private async linkMention(message: LinkMentionMessage): Promise<void> {
    const mention = this.createSnapshot().links?.mentions.find(
      (candidate) =>
        candidate.filePath === message.filePath &&
        candidate.line === message.line &&
        candidate.startColumn === message.startColumn,
    );
    const uri = mention ? await resolveSourceUri(mention.filePath) : undefined;
    if (!mention || !uri) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const range = new vscode.Range(
      mention.line - 1,
      mention.startColumn,
      mention.line - 1,
      mention.endColumn,
    );
    if (mention.line > document.lineCount || document.getText(range) !== mention.name) {
      void reportStale([uri]);
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, `[[${mention.name}]]`);
    await applyWorkspaceWrite(edit, {
      label: `a link to ${mention.name} in ${mention.title}`,
    });
    await this.indexer.refresh();
  }

  /**
   * Writes a tag the similar notes use onto the untagged note, on the
   * heading or line where the cursor is, found from the note as it is now.
   * The tag must still be one the sidebar offers. One write, which the
   * message's Undo and Undo Last Change both take back.
   */
  private async addSuggestedTag(tagKey: string): Promise<void> {
    const snapshot = this.createSnapshot();
    const tag = snapshot.similar?.tags.find((candidate) => candidate.key === tagKey);
    const filePath = this.getSelectedFilePath();
    if (!tag || !filePath) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      !isMarkdownDocument(editor.document) ||
      this.indexer.getFilePath(editor.document.uri) !== filePath
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
    const written = await applyWorkspaceWrite(edit, {
      label: `${tag.label} on ${where}`,
      preview: 'never',
    });
    if (!written.applied) {
      void reportFailure(describeRejectedEdit(noteName(document.uri)));
      return;
    }
    await this.indexer.refresh();
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
        await applyWorkspaceWrite(undo, { label: `taking ${tag.label} off ${where}`, preview: 'never' });
        await this.indexer.refresh();
      });
  }

  /**
   * Narrows the active search by a value its Refine view lists, as the
   * page's own Refine would.
   */
  private async refineActiveSearch(
    message: RefineActiveSearchMessage,
  ): Promise<void> {
    const source = this.activeSearch.active;
    const state = source?.getRefineState();
    const facet = state?.query.facets.find(
      (candidate) => candidate.id === message.facetId,
    );
    if (
      !source ||
      !state ||
      !facet?.values.some((value) => value.clause === message.clause)
    ) {
      return;
    }
    await source.applySearch(
      refineQueryText(
        state.query.text,
        message.clause,
        message.mode,
        facet.applied[0],
      ),
    );
  }

  private log(message: string): void {
    logTrace(() => `[Related Notes] ${message}`);
  }
}

/** Whether two cursor or manual contexts name the same entry. */
function isSameEntryContext(
  left: EntryContext | undefined,
  right: EntryContext | undefined,
): boolean {
  return (
    left?.filePath === right?.filePath &&
    left?.sourceLine === right?.sourceLine &&
    left?.source === right?.source
  );
}

/**
 * Pairs the canonical path with content parsed using current editor text.
 */
interface ActiveFile {
  filePath: string;
  file: ParsedFile;
}

interface EntryContext {
  filePath: string;
  sourceLine: number;
  source: 'cursor' | 'manual';
}

export function findTaggedEntry(file: ParsedFile, sourceLine: number) {
  const task = file.tasks.find(
    (candidate) =>
      candidate.lineNumber === sourceLine &&
      (candidate.associationTagGroups?.length ?? 0) > 0,
  );
  if (task) {
    return task;
  }
  return file.sections
    .filter(
      (section) =>
        section.startLine <= sourceLine &&
        section.endLine >= sourceLine &&
        ((section.headingTags?.length ?? 0) > 0 ||
          (section.isInline &&
            (section.associationTagGroups?.length ?? 0) > 0)),
    )
    .sort(
      (left, right) =>
        left.endLine - left.startLine - (right.endLine - right.startLine) ||
        right.startLine - left.startLine,
    )[0];
}

function getEntryStartLine(
  entry: NonNullable<ReturnType<typeof findTaggedEntry>>,
): number {
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
export function findMatchingEntryLine(
  liveFile: ParsedFile,
  liveLine: number,
  savedFile: ParsedFile,
): number | undefined {
  const liveEntry = findTaggedEntry(liveFile, liveLine);
  if (!liveEntry) {
    return undefined;
  }
  const liveStart = getEntryStartLine(liveEntry);
  const pick = (liveLines: number[], savedLines: number[]) => {
    const tagged = savedLines.filter(
      (line) => findTaggedEntry(savedFile, line) !== undefined,
    );
    const occurrence = liveLines.filter((line) => line < liveStart).length;
    return tagged[Math.min(occurrence, tagged.length - 1)];
  };
  if ('heading' in liveEntry) {
    const sameTitle = (sections: Section[]) =>
      sections
        .filter(
          (section) =>
            section.heading === liveEntry.heading &&
            Boolean(section.isInline) === Boolean(liveEntry.isInline),
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

export function createEntryScope(
  file: ParsedFile,
  sourceLine: number,
): EntryScope | undefined {
  const entry = findTaggedEntry(file, sourceLine);
  if (!entry) {
    return undefined;
  }

  const tagLabels = new Map<string, string>();
  const tagWeights = new Map<string, number>();
  const tagSources = new Map<string, EntryTagSource>();
  const addTag = (
    key: string,
    label: string,
    weight: number,
    source: string,
    context: EntryTagContext,
  ): void => {
    const currentWeight = tagWeights.get(key);
    if (currentWeight === undefined || weight > currentWeight) {
      tagLabels.set(key, label);
      tagWeights.set(key, weight);
      tagSources.set(key, { context, source });
    }
  };
  const explicitEntryTags =
    entry.associationTagGroups?.flat() ??
    ('headingTags' in entry ? (entry.headingTags ?? []) : []);
  explicitEntryTags.forEach((tag) =>
    addTag(
      tag.key,
      tag.label,
      1,
      'Written on the selected entry',
      'selected',
    ),
  );

  const sections = new Map(file.sections.map((section) => [section.id, section]));
  let parentSectionId =
    'heading' in entry ? entry.parentSectionId : entry.sectionId;
  let depth = 1;
  while (parentSectionId) {
    const parent = sections.get(parentSectionId);
    if (!parent) {
      break;
    }
    parent.headingTags?.forEach((tag) =>
      addTag(
        tag.key,
        tag.label,
        0.5 / depth,
        `Parent ancestry: ${depth === 1 ? 'one level up' : `${depth} levels up`} (0.5 / ${depth})`,
        'parent',
      ),
    );
    parentSectionId = parent.parentSectionId;
    depth += 1;
  }

  if ('heading' in entry) {
    const childrenByParent = new Map<string, Section[]>();
    const childItemsByParent = new Map<string, Section[]>();
    file.sections.forEach((section) => {
      if (!section.parentSectionId) {
        return;
      }
      if (section.isInline) {
        const childItems = childItemsByParent.get(section.parentSectionId) ?? [];
        childItems.push(section);
        childItemsByParent.set(section.parentSectionId, childItems);
        return;
      }
      const children = childrenByParent.get(section.parentSectionId) ?? [];
      children.push(section);
      childrenByParent.set(section.parentSectionId, children);
    });
    const childTasksByParent = new Map<string, typeof file.tasks>();
    file.tasks.forEach((task) => {
      if (!task.sectionId) {
        return;
      }
      const childTasks = childTasksByParent.get(task.sectionId) ?? [];
      childTasks.push(task);
      childTasksByParent.set(task.sectionId, childTasks);
    });
    const visitedChildren = new Set<string>();
    const visitedChildItems = new Set<string>();
    const addChildItemTags = (
      tags: TagReference[],
      itemDepth: number,
    ): void => {
      const distance =
        itemDepth === 1
          ? 'one level down'
          : `${itemDepth} levels down`;
      tags.forEach((tag) =>
        addTag(
          tag.key,
          tag.label,
          0.5 / itemDepth,
          `Child item: ${distance} (0.5 / ${itemDepth})`,
          'childItem',
        ),
      );
    };
    const addChildItemContext = (
      parentId: string,
      itemDepth: number,
    ): void => {
      (childItemsByParent.get(parentId) ?? []).forEach((child) => {
        if (visitedChildItems.has(child.id)) {
          return;
        }
        visitedChildItems.add(child.id);
        addChildItemTags((child.associationTagGroups ?? []).flat(), itemDepth);
      });
      (childTasksByParent.get(parentId) ?? []).forEach((child) => {
        if (visitedChildItems.has(child.id)) {
          return;
        }
        visitedChildItems.add(child.id);
        addChildItemTags((child.associationTagGroups ?? []).flat(), itemDepth);
      });
    };
    const addChildContext = (parentId: string, childDepth: number): void => {
      addChildItemContext(parentId, childDepth + 1);
      (childrenByParent.get(parentId) ?? []).forEach((child) => {
        if (visitedChildren.has(child.id)) {
          return;
        }
        visitedChildren.add(child.id);
        (child.headingTags ?? []).forEach((tag) =>
          addTag(
            tag.key,
            tag.label,
            0.5 / childDepth,
            `Child heading: ${childDepth === 1 ? 'one level down' : `${childDepth} levels down`} (0.5 / ${childDepth})`,
            'child',
          ),
        );
        addChildContext(child.id, childDepth + 1);
      });
    };
    addChildContext(entry.id, 1);

    const section = {
      ...entry,
      tags: [...tagLabels.keys()],
      tagLabels: Object.fromEntries(tagLabels),
    };
    return {
      file: {
        ...file,
        content: entry.rawContent,
        sections: [section],
        tasks: file.tasks.filter((task) => task.sectionId === entry.id),
        frontmatterTags: [],
        links: entry.links,
      },
      tagWeights,
      tagSources,
    };
  }
  const task = {
    ...entry,
    tags: [...tagLabels.keys()],
    tagLabels: Object.fromEntries(tagLabels),
  };
  return {
    file: {
      ...file,
      content: entry.sourceLineText,
      sections: [],
      tasks: [task],
      frontmatterTags: [],
      links: [],
    },
    tagWeights,
    tagSources,
  };
}

function getEntryTitle(file: ParsedFile): string | undefined {
  return file.sections[0]?.heading ?? file.tasks[0]?.title;
}

export interface EntryScope {
  file: ParsedFile;
  tagWeights: ReadonlyMap<string, number>;
  tagSources: ReadonlyMap<string, EntryTagSource>;
}

export type EntryTagContext =
  | 'selected'
  | 'parent'
  | 'child'
  | 'childItem';

export interface EntryTagSource {
  context: EntryTagContext;
  source: string;
}

export interface EntryRelatedNotesDiagnostic {
  filePath: string;
  sourceLine: number;
  title: string;
  tags: Array<{
    key: string;
    weight: number;
    context: EntryTagContext;
    source: string;
  }>;
  snapshot: SidebarNotesSnapshot;
}

/**
 * Uses the URI extension so manual language-mode changes do not hide Markdown.
 */
function isMarkdownDocument(document: vscode.TextDocument): boolean {
  return isMarkdownFile(document.uri);
}

function describeMessage(message: unknown): string {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string'
  ) {
    return message.type;
  }
  return 'invalid payload';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
