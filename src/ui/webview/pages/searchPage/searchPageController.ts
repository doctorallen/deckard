import * as vscode from 'vscode';

import type { PreferenceServices } from '../../../../core/storage/preferences';
import type { IndexControl, IndexReader, IndexScanStatus, IndexSearch, IndexUpdates } from '../../../../core/workspace/indexReader';
import { listedParkedTags } from '../../../../domain/index/parked';
import { resolveIndexedTagKey } from '../../../../domain/index/tagNavigation';
import { EntityNamespaceAliases, formatEntityTitle } from '../../../../domain/markdown/parser';
import type { Section, Task, WorkspaceIndex } from '../../../../domain/model';
import { formatQuery } from '../../../../domain/query/queryFormat';
import { parseWorkspaceQuery } from '../../../../domain/types/typeQueryFields';
import type { ExportService } from '../../../../services/exportService';
import type { NavigationService } from '../../../../services/navigationService';
import { measure } from '../../../../shared/timing';
import type { EditFieldsMessage } from '../../../protocol/fields';
import type { SearchPagePageToHost, SearchPageSnapshot, SearchPageState, SinceChipKind } from '../../../protocol/searchPage';
import type { DashboardTask, SearchRefineState } from '../../../protocol/shared';
import { editResults } from '../../../commands/bulkEditPrompts';
import { presentExport } from '../../../commands/exportResults';
import { copyFieldValue } from '../../../commands/typeNotes';
import { createHubNoteForTag, openEditFieldsForm, openTypeNoteForm } from '../../../commands/typeNoteForm';
import { renameTypeField, renameTypeOption } from '../../../commands/typeRenames';
import { getTypeIndex, type TypeRow } from '../../../../domain/types/typeIndex';
import { NoteOpening, openNoteAt } from '../../../commands/noteOpening';
import { setPinned } from '../../../commands/pinNote';
import { readEntityNamespaceAliases } from '../../../commands/parseSettings';
import { readQueryContext } from '../../../commands/queryContext';
import { openSettingAction } from '../../../commands/notify';
import { collectBetweenLines, formatBetweenAgenda } from '../../../state/betweenYou';
import { mergeIndexedTag } from '../../../commands/renameTag';
import { offerSavedSearchOnHome } from '../../../commands/savedSearchHome';
import type { TaskWrites } from '../../../commands/taskActions';
import { formatQueryBlock, queryBlockSortOf } from '../../../state/queryBlockState';
import { SearchHistory, SearchHistoryEntry } from '../../../state/searchHistory';
import type { ActiveSearch, SearchSource } from '../../activeSearch';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import {
  chooseTheme,
  goToPage,
  listGoTo,
  openGoTo,
  openHelp,
  openTag,
  parkTag,
  renameTag,
  setDisplay,
  setZenMode,
  toggleTask,
} from '../../host/sharedHandlers';
import { getSearchPageHtml } from '../../searchPageHtml';
import type { PageChrome } from '../../components';
import { narrowSearchPageMessage } from './messages';
import {
  captureTagPageState,
  createSearchPageSnapshot,
  evaluateSearchPage,
  resolveQueryTagIntersection,
  type SearchPageOptions,
} from '../../../state/searchPageState';
import { toTagVisit, VISIT_COUNTS_AFTER_MS } from '../../../state/sinceLastLooked';
import type { TagVisit, TagVisits } from '../../../../core/storage/tagVisits';
import { createQueryViewState } from '../../../state/querySuggestions';
import { findWikiLinkPlace, parseWikiTarget } from '../../../../domain/index/backlinks';
import { openResultAt } from '../../../commands/navigation';

/**
 * The preference services a search page reads and writes: the blob it
 * draws, visits, saved and recent searches, its display choices, pins, the
 * offer of a saved search on Home, and the keys a renamed tag carries.
 */
export type SearchPreferences = Pick<
  PreferenceServices,
  'reader' | 'usage' | 'savedSearches' | 'display' | 'pins' | 'homeWidgets' | 'tagRenames'
>;

/** The index a search page is drawn from, searches, and writes through. */
export type SearchIndexer = IndexReader<vscode.Uri> & IndexSearch & IndexScanStatus & IndexUpdates & IndexControl;

/** One search page's search, and what it reads, draws with, and tells. */
export interface SearchPageControllerOptions {
  /** The search the page opened with, which clearing its search goes back to. */
  originQuery: string;
  /** The search the page shows first. */
  queryText: string;
  indexer: SearchIndexer;
  preferences: SearchPreferences;
  activeSearch: ActiveSearch;
  /**
   * The page as the Related Notes sidebar knows it, which the page makes the
   * active search while it is in front.
   */
  source: SearchSource;
  /** What the page's checkboxes, tag renames and merges, and bulk edits write through. */
  writes: TaskWrites;
  /** What the page's Export plans its results with. */
  exports: ExportService;
  /** What a tag the page names may open. */
  navigation: NavigationService;
  /** Opens a tag's page. */
  openTag(tagKey: string): Promise<void>;
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri;
  /** Names the page's tab, before each snapshot is sent. */
  setTitle(title: string): void;
  /** Called when the reader closes the page. */
  onDidClose(): void;
  /**
   * The tags' last visits, which the page's Since you last looked band
   * reads, and which a visit to a tag's page is counted in. Without them
   * the page has no band and counts nothing.
   */
  visits?: Pick<TagVisits, 'get' | 'record'>;
  /** The time and the timer a visit is counted by: the real ones unless a test sets its own. */
  clock?: VisitClock;
}

/** The time, and a timer, as a visit is counted by them. */
export interface VisitClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The real time and timers. */
const REAL_CLOCK: VisitClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * One search page: its search, the search it opened with, the pages of
 * results the reader is on, and what each message the page sends does.
 *
 * Each message is checked against the page's current results before it is
 * acted on, since the page may still show an entry that has since changed.
 */
export class SearchPageController implements PageController<SearchPageState, SearchPagePageToHost> {
  /** A page's turn after an index update, as the log has always named it. */
  public readonly name = 'search page';
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: true,
    // SearchPanels redraws every page's HTML, and then refreshes each page
    // or closes it when its tag has gone.
    onChromeChange: 'none',
    // The page times its search alone, as "Search page", in buildSnapshot.
    measure: false,
  };
  public readonly narrow = narrowSearchPageMessage;
  public readonly handlers: MessageHandlers<SearchPagePageToHost>;

  private readonly originQuery: string;
  private queryText: string;
  /**
   * Which page of notes and of tasks the page is showing. A workspace-wide
   * search used to send, and draw, every one of them on every save: several
   * megabytes through the webview channel, and thousands of cards rebuilt,
   * for the screenful anyone reads.
   *
   * Both are kept as the reader left them, and clamped by the snapshot when
   * the results move under them, so they are read back from it rather than
   * trusted.
   */
  private notePage = 1;
  private taskPage = 1;
  /**
   * The page size those numbers count in. The size is one preference for
   * every search page, so another page may change it under this one.
   */
  private pagedAt: number | undefined;
  /**
   * The words the reader is typing but has not committed. They narrow the
   * whole search rather than the page of it on screen, so what the box
   * promises while it is typed in is what Enter delivers.
   */
  private previewWords: string[] = [];
  /**
   * Search text that does not parse. The box shows it, with its error, while
   * the page keeps the results of the last search that did.
   */
  private invalidQueryText: string | undefined;
  /** The searches the page showed before this one, and after it. */
  private readonly history = new SearchHistory();
  /** Whether the last state sent put Refine in the sidebar. */
  private refineWasInSidebar = false;
  private lastSnapshot: SearchPageSnapshot | undefined;
  /**
   * The visit the band compares the tag's page with: the last one before
   * the page was put in front, read again once the reader leaves the page
   * and comes back, so a visit counted meanwhile clears the band on the
   * next draw, and not under the reader's eyes.
   */
  private sinceBaseline: { tagKey: string; visit: TagVisit | undefined } | undefined;
  /** The band's chip filtering the page, until it is chosen again or the search changes. */
  private sinceFilter: SinceChipKind | undefined;
  /** Whether the page is in front, where a visit to it counts. */
  private inFront = false;
  /** The visit waiting out its five seconds in front, and the tag it is to. */
  private visitTimer: { tagKey: string; handle: unknown } | undefined;
  /** The tag whose visit counted while the page has been in front, which counts no more until it is left. */
  private countedVisit: string | undefined;

  /** The time and the timer a visit to the page is counted by. */
  private readonly clock: VisitClock;

  /** Starts on `search.queryText`, opened with `search.originQuery`. */
  public constructor(private readonly search: SearchPageControllerOptions) {
    this.clock = search.clock ?? REAL_CLOCK;
    this.originQuery = search.originQuery;
    this.queryText = search.queryText;
    const { indexer, navigation, preferences } = search;
    this.handlers = {
      setZenMode: setZenMode(),
      setDisplay: setDisplay(),
      chooseTheme: chooseTheme(),
      setOverviewQuery: (message, page) => this.applyQuery(page, message.query, message.remember !== false),
      clearOverviewQuery: (_message, page) => this.applyQuery(page, this.originQuery, false),
      navigateSearchHistory: (message, page) => this.navigateHistory(page, message.direction),
      setResultPage: (message, page) => {
        if (message.kind === 'notes') {
          this.notePage = message.page;
        } else {
          this.taskPage = message.page;
        }
        page.refresh();
      },
      previewSearch: (message, page) => this.previewSearch(page, message.words),
      // Every open search page starts its lists again at the new size,
      // when it next draws.
      setResultsPerPage: (message) => preferences.display.setSearchPageSize(message.size),
      setRenderMode: (message) => preferences.display.setRenderMode(message.mode),
      setTagOverviewSort: (message) => preferences.display.setTagOverviewSortMode(message.mode),
      setTagOverviewLayout: (message) => preferences.display.setTagOverviewLayout(message.layout),
      setSearchPreview: (message) => preferences.display.setSearchPreview(message.preview),
      setSearchHierarchy: (message) => preferences.display.setSearchHierarchy(message.hierarchy),
      setSearchColumns: (message) => preferences.display.setDashboardColumns(message.section, message.columns),
      // A type's rows open Help at the guide's page on types; any other search at Search.
      openHelp: (message, page) => openHelp(this.currentSnapshot().typeRows ? 'databases' : 'search')(message, page),
      openGoTo: openGoTo(),
      listGoTo: listGoTo({ indexer }),
      goToPage: goToPage(),
      saveTagOverviewFilter: (message, page) => this.saveSearch(page, message.query),
      mergeTags: (message) => this.mergeTags(message.sourceKey, message.targetKey),
      setHubOpen: (message) => preferences.display.setHubNoteCollapsed(!message.open),
      editFields: (message) => this.editFields(message),
      // Create hub note, or Add fields… on a typed row's Fields card: the form for its note.
      createHubNote: async () => {
        const tagKey = this.currentSnapshot().tag?.key;
        if (tagKey) {
          await createHubNoteForTag({ indexer, history: search.writes.history }, tagKey);
        }
      },
      openTag: openTag({ indexer, navigation, policy: 'lenient', openTag: (tagKey) => search.openTag(tagKey) }),
      parkTag: parkTag(),
      unparkTag: parkTag(),
      parkNote: (message) => this.parkNote(message.type, message.filePath),
      unparkNote: (message) => this.parkNote(message.type, message.filePath),
      renameTag: renameTag({
        indexer,
        writes: { history: search.writes.history, preferences },
        openTag: (tagKey) => search.openTag(tagKey),
      }),
      toggleTask: toggleTask({
        writes: search.writes,
        findTask: (taskId) => this.drawnTasks().find((candidate) => candidate.task.id === taskId)?.task,
      }),
      // A result is an entry, so pinning one pins that entry rather than
      // the file it is written in.
      pinNote: (message) => this.setPinned(message.filePath, message.line, true),
      unpinNote: (message) => this.setPinned(message.filePath, message.line, false),
      editResults: (message) => editResults(search.writes.history, message.kind, this.currentResults()),
      exportResults: (message) => this.exportResults(message.kind),
      openSource: (message) => this.openSource(message.filePath, message.line, message),
      openWikiLink: (message) => this.openWikiLink(message.target, message.from, message),
      ...this.betweenHandlers(),
      ...this.sinceHandlers(),
      ...this.typeHandlers(),
    };
  }

  /** The page as its template draws it, in a theme. */
  public html(webview: vscode.Webview, chrome: PageChrome): string {
    return getSearchPageHtml(webview, this.search.extensionUri, chrome);
  }

  /** What names the page's search, so the same search reached two ways finds this page. */
  public key(): string {
    return getSearchKey(this.search.indexer.getSnapshot(), this.queryText, readEntityNamespaceAliases());
  }

  /** The search the page shows, as typed. */
  public searchText(): string {
    return this.queryText;
  }

  /** Whether the page is about one tag the index no longer has. */
  public isForMissingTag(index: WorkspaceIndex): boolean {
    const parsed = parseWorkspaceQuery(index, this.queryText);
    const node = parsed.node;
    return (
      node?.type === 'condition' &&
      node.field === 'tag' &&
      node.operator === 'eq' &&
      this.queryText === this.originQuery &&
      resolveIndexedTagKey(index.tags, node.value, readEntityNamespaceAliases()) === undefined
    );
  }

  /**
   * Before the first scan there is nothing to show but how far it has got,
   * so a refresh sends nothing and a hidden page is not marked stale.
   */
  public isReady(): boolean {
    return this.search.indexer.hasIndexed !== false;
  }

  /** Sends the state again when the sidebar took or gave back Refine. */
  public refreshIfRefineMoved(page: PageContext): void {
    if (this.search.activeSearch.isRefineInSidebar(this.search.source) !== this.refineWasInSidebar) {
      page.refresh();
    }
  }

  /**
   * The page's results, which also names its tab and fixes the pages of
   * results it is on. What is sent differs from what is kept: it carries
   * the parked tags, and the Markdown view's cards carry no rendered HTML.
   */
  public buildSnapshot(): SearchPageState {
    const snapshot = measure('Search page', () => this.createSnapshot());
    // The snapshot clamps a page number to the pages the search has, and a
    // search shortens under an open page whenever a note is saved. Reading
    // the clamped numbers back keeps the page the reader is on and the page
    // the host asks for from drifting apart.
    this.notePage = snapshot.notePaging.page;
    this.taskPage = snapshot.taskPaging.page;
    this.lastSnapshot = snapshot;
    this.refineWasInSidebar = snapshot.refineInSidebar === true;
    this.search.setTitle(getPageTitle(snapshot));
    // The search may have moved to another tag, or off one.
    this.syncVisitTimer();
    return {
      ...snapshot,
      parkedTags: listedParkedTags(this.search.indexer),
      // The Markdown view shows each note's source, which the page's
      // search also reads, so only the HTML view is sent each note's tokens.
      sections:
        snapshot.renderMode === 'html'
          ? snapshot.sections
          : snapshot.sections.map((card) => ({
              ...card,
              bodyTokens: [],
              ...(card.snippet ? { snippet: { ...card.snippet, bodyTokens: [] } } : {}),
            })),
    };
  }

  /**
   * A hidden page keeps what it shows and catches up when shown again; the
   * sidebar reads the page's results afresh meanwhile.
   */
  public onDidMarkStale(): void {
    this.lastSnapshot = undefined;
    this.search.activeSearch.notifyChanged(this.search.source);
  }

  /** Tells the sidebar the page's results changed. */
  public onDidSendSnapshot(): void {
    this.search.activeSearch.notifyChanged(this.search.source);
  }

  /** The page is the active search while its panel is in front. */
  public onDidAttach(page: PageContext): void {
    this.updateActivity(page.surface?.active === true);
  }

  /** The page is the active search while its panel is in front. */
  public onDidChangeViewState(page: PageContext): void {
    this.updateActivity(page.surface?.active === true);
  }

  /** A page the reader closed is gone, and its search with it. */
  public onDidDetach(): void {
    this.search.onDidClose();
  }

  /** A page that is gone is no longer the active search, and counts no visit. */
  public dispose(): void {
    this.stopVisitTimer();
    this.search.activeSearch.release(this.search.source);
  }

  /** The page's search as the sidebar's Refine view needs it. */
  public getRefineState(): SearchRefineState | undefined {
    const snapshot = this.lastSnapshot ?? this.createSnapshot();
    return {
      page: 'search',
      title: getPageTitle(snapshot),
      query: snapshot.query,
      resultKinds: ['notes', 'tasks'],
    };
  }

  /** Runs a search refined in the sidebar, as the page's own box would. */
  public async applySearch(page: PageContext, queryText: string): Promise<void> {
    await this.applyQuery(page, queryText);
  }

  /**
   * While the page is in front it is the active search, and a visit to its
   * tag counts after five seconds. Left, a visit no longer counts, and the
   * next time it is put in front the band reads the tag's last visit again.
   */
  private updateActivity(active: boolean): void {
    if (active) {
      this.search.activeSearch.setActive(this.search.source);
    } else {
      this.search.activeSearch.release(this.search.source);
    }
    if (!active && this.inFront) {
      this.countedVisit = undefined;
      this.sinceBaseline = undefined;
    }
    this.inFront = active;
    this.syncVisitTimer();
  }

  private createSnapshot(): SearchPageSnapshot {
    const index = this.search.indexer.getSnapshot();
    const preferences = this.search.preferences.reader.value;
    // A different page size is a different set of pages, and the number
    // the reader was on means nothing in it, so both lists start again,
    // whichever page changed the size.
    if (this.pagedAt !== undefined && this.pagedAt !== preferences.searchPageSize) {
      this.notePage = 1;
      this.taskPage = 1;
    }
    this.pagedAt = preferences.searchPageSize;
    const queryContext = readQueryContext(this.clock.now());
    const since = this.readSinceBaseline();
    const snapshot = createSearchPageSnapshot(
      index,
      preferences,
      this.queryText,
      {
        queryContext,
        ...(since ? { since } : {}),
        originQuery: this.originQuery,
        notePage: this.notePage,
        taskPage: this.taskPage,
        previewWords: this.previewWords,
        // Correcting a spelling needs the full-text cache. An indexer
        // without one answers no search page any the worse for it, so the
        // page asks only when there is something to ask.
        ...(this.search.indexer.suggestWords
          ? { suggestWords: (words: readonly string[]) => this.search.indexer.suggestWords(words) }
          : {}),
      },
    );
    return {
      ...snapshot,
      history: {
        back: this.history.canGoBack,
        forward: this.history.canGoForward,
      },
      ...(snapshot.hub
        ? { hub: { ...snapshot.hub, expanded: preferences.hubNoteCollapsed !== true } }
        : {}),
      // The results come from the last search that parsed; only the box
      // shows the text that did not.
      ...(this.invalidQueryText === undefined
        ? {}
        : {
            query: createQueryViewState({
              index,
              parsed: parseWorkspaceQuery(index, this.queryText),
              matchCounts: snapshot.query.matchCounts,
              isAdvanced: true,
              recentQueries: preferences.recentQueries ?? [],
              facets: snapshot.query.facets,
              pending: this.invalidQueryText,
              queryContext,
            }),
          }),
      refineInSidebar: this.search.activeSearch.isRefineInSidebar(this.search.source),
    };
  }

  /**
   * Runs a search typed, built, or refined on the page. A search that does
   * not parse is shown with its error, and the results stay as they were.
   */
  private async applyQuery(page: PageContext, queryText: string, remember = true): Promise<void> {
    const text = queryText.trim();
    if (text && parseWorkspaceQuery(this.search.indexer.getSnapshot(), text).node === undefined) {
      this.invalidQueryText = text;
      page.refresh();
      return;
    }
    if (text !== this.queryText) {
      this.history.leave(this.historyEntry());
    }
    // A different search is a different list, read from its first page.
    this.showSearch(page, { query: text, notePage: 1, taskPage: 1 });
    if (remember && text) {
      await this.search.preferences.savedSearches.recordRecentQuery(text);
    }
  }

  /**
   * Returns to the search before this one, or the one after it, at the
   * pages of results the reader left it on. With nowhere to go, the page
   * stays as it is.
   */
  private navigateHistory(page: PageContext, direction: 'back' | 'forward'): void {
    const current = this.historyEntry();
    const entry =
      direction === 'back'
        ? this.history.back(current)
        : this.history.forward(current);
    if (entry) {
      this.showSearch(page, entry);
    }
  }

  private historyEntry(): SearchHistoryEntry {
    return {
      query: this.queryText,
      notePage: this.notePage,
      taskPage: this.taskPage,
    };
  }

  private showSearch(page: PageContext, entry: SearchHistoryEntry): void {
    this.invalidQueryText = undefined;
    this.sinceFilter = undefined;
    this.queryText = entry.query;
    // The draft has become the search, or been replaced by another, so it is
    // no longer narrowing anything on its own.
    this.previewWords = [];
    this.notePage = entry.notePage;
    this.taskPage = entry.taskPage;
    page.refresh();
  }

  /** Narrows the results by the words being typed, unless they are the same words. */
  private previewSearch(page: PageContext, sent: readonly string[]): void {
    const words = sent
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
    if (
      words.length === this.previewWords.length &&
      words.every((word, index) => word === this.previewWords[index])
    ) {
      return;
    }
    this.previewWords = words;
    // Narrowing is a different list, read from its first page.
    this.notePage = 1;
    this.taskPage = 1;
    page.refresh();
  }

  /**
   * The merge the tag list and Stats run: confirmed, previewed, and
   * undoable. A page whose tag was merged away follows the one kept.
   */
  private async mergeTags(sourceKey: string, targetKey: string): Promise<void> {
    const pageTag = this.currentSnapshot().tag?.key;
    const kept = await mergeIndexedTag(
      this.search.indexer,
      sourceKey,
      { history: this.search.writes.history, preferences: this.search.preferences },
      targetKey,
    );
    if (kept && pageTag && pageTag !== kept.key) {
      await this.search.openTag(kept.key);
    }
  }

  /** Park Note or Unpark Note, by the command of that name, for a note the index has. */
  private async parkNote(type: 'parkNote' | 'unparkNote', filePath: string): Promise<void> {
    const uri = this.search.indexer.getUri?.(filePath);
    if (uri) {
      await vscode.commands.executeCommand(`deckard.${type}`, uri);
    }
  }

  /** Pins or unpins the entry at a line, or the note's first. */
  private async setPinned(filePath: string, line: number | undefined, pinned: boolean): Promise<void> {
    await setPinned(
      this.search.indexer.getSnapshot(),
      this.search.preferences.pins,
      { filePath, line: line ?? 1 },
      pinned,
    );
  }

  /** Export, of everything the search found. */
  private async exportResults(kind: 'notes' | 'tasks'): Promise<void> {
    const plan = this.search.exports.fromResults(kind, this.currentResults());
    // A page with a search can hand it on as a live query block, in the
    // page's own sort; a page of every note has none to hand on.
    const search = this.queryText.trim();
    const sort = this.search.preferences.reader.value.tagOverviewSortMode;
    const liveBlock = search
      ? () => formatQueryBlock(search, queryBlockSortOf(sort, 'notes'))
      : undefined;
    await presentExport(plan, liveBlock);
  }

  /**
   * Everything the page's search found, rather than the page of it on
   * screen: an edit made to results means all of them.
   *
   * A page with no search of its own shows every note, which is not a set
   * anyone means to edit at once, so there the results are the ones drawn.
   */
  private currentResults(): {
    tasks: readonly Task[];
    sections: readonly Section[];
  } {
    const index = this.search.indexer.getSnapshot();
    const snapshot = this.currentSnapshot();
    const node = this.queryText.trim()
      ? parseWorkspaceQuery(index, this.queryText).node
      : undefined;
    if (!node) {
      return {
        tasks: snapshot.tasks.map((item) => item.task),
        sections: snapshot.sections.flatMap((card) => {
          const section = index.sections.get(card.id);
          return section ? [section] : [];
        }),
      };
    }
    // The same list the page shows: on a tag's page, what links its hub too.
    const { results } = evaluateSearchPage(index, this.queryText, {
      queryContext: readQueryContext(),
    });
    return {
      // The search is the filter: is:open, is:done, and the rest say which
      // tasks, so the pane shows every task the search found.
      tasks: results.tasks,
      sections: results.sections,
    };
  }

  private currentSnapshot(): SearchPageSnapshot {
    return this.lastSnapshot ?? this.createSnapshot();
  }

  /** Every task the page draws: the results, and a person's Between you card. */
  private drawnTasks(): DashboardTask[] {
    const snapshot = this.currentSnapshot();
    return [...snapshot.tasks, ...(snapshot.between?.groups ?? []).flatMap((group) => group.tasks)];
  }

  /**
   * What a person's Between you card asks of its host: a group's search on
   * a page of its own, the card copied as an agenda, and the setting that
   * says who the reader is.
   */
  private betweenHandlers(): Pick<MessageHandlers<SearchPagePageToHost>, 'openSearch' | 'copyBetweenAgenda' | 'openIdentitySetting'> {
    return {
      // Only a search the card drew: a group's label.
      openSearch: async (message) => {
        if ((this.currentSnapshot().between?.groups ?? []).some((group) => group.query === message.query)) {
          await vscode.commands.executeCommand('deckard.searchNotes', message.query);
        }
      },
      copyBetweenAgenda: () => this.copyBetweenAgenda(),
      openIdentitySetting: async () => {
        await openSettingAction('me').run();
      },
    };
  }

  /**
   * Since you last looked: Mark seen counts the visit now and clears the
   * band; a chip narrows the page to what it counts, or, chosen again,
   * lets it go.
   */
  private sinceHandlers(): Pick<MessageHandlers<SearchPagePageToHost>, 'markSeen' | 'setSinceFilter'> {
    return {
      markSeen: async (_message, page) => {
        const tagKey = this.visitTagKey();
        const visit = tagKey ? await this.countVisit(tagKey) : undefined;
        if (!tagKey || !visit) {
          return;
        }
        this.sinceBaseline = { tagKey, visit };
        this.sinceFilter = undefined;
        page.refresh();
      },
      setSinceFilter: (message, page) => {
        this.sinceFilter = message.kind;
        // A narrower list, read from its first page.
        this.notePage = 1;
        this.taskPage = 1;
        page.refresh();
      },
    };
  }

  /** The tag whose own page this is, when the search is that one tag alone; a visit counts only to it. */
  private visitTagKey(): string | undefined {
    if (!this.search.visits) {
      return undefined;
    }
    const index = this.search.indexer.getSnapshot();
    const tagKeys = resolveQueryTagIntersection(index, parseWorkspaceQuery(index, this.queryText), readEntityNamespaceAliases());
    return tagKeys?.length === 1 ? tagKeys[0] : undefined;
  }

  /**
   * What the band compares the page with: the tag's last visit, read when
   * the page first draws the tag, and again after the page is left and
   * put in front again. A different tag lets the chip go.
   */
  private readSinceBaseline(): SearchPageOptions['since'] {
    const tagKey = this.visitTagKey();
    if (this.sinceBaseline?.tagKey !== tagKey) {
      this.sinceBaseline = tagKey ? { tagKey, visit: this.search.visits?.get(tagKey) } : undefined;
      this.sinceFilter = undefined;
    }
    return this.sinceBaseline ? { visit: this.sinceBaseline.visit, filter: this.sinceFilter } : undefined;
  }

  /**
   * Starts the five seconds a visit to the tag's page waits in front (D7),
   * or stops them when the page is left or shows something else. A visit
   * counted while the page has been in front counts again only after it
   * is left.
   */
  private syncVisitTimer(): void {
    const tagKey = this.inFront ? this.visitTagKey() : undefined;
    if (this.visitTimer && this.visitTimer.tagKey === tagKey) {
      return;
    }
    this.stopVisitTimer();
    if (!tagKey || this.countedVisit === tagKey) {
      return;
    }
    const handle = this.clock.setTimeout(() => {
      this.visitTimer = undefined;
      if (this.inFront && this.visitTagKey() === tagKey) {
        void this.countVisit(tagKey);
      }
    }, VISIT_COUNTS_AFTER_MS);
    this.visitTimer = { tagKey, handle };
  }

  /** Stops the five seconds a visit was waiting out, when one was. */
  private stopVisitTimer(): void {
    if (!this.visitTimer) {
      return;
    }
    this.clock.clearTimeout(this.visitTimer.handle);
    this.visitTimer = undefined;
  }

  /** Counts a visit to a tag's page: what it holds now replaces its last visit. */
  private async countVisit(tagKey: string): Promise<TagVisit | undefined> {
    const visits = this.search.visits;
    if (!visits) {
      return undefined;
    }
    this.stopVisitTimer();
    this.countedVisit = tagKey;
    const index = this.search.indexer.getSnapshot();
    const now = this.clock.now();
    const visit = toTagVisit(captureTagPageState(index, tagKey, readQueryContext(now)), now);
    await visits.record(tagKey, visit, (key) => index.tags.has(key));
    return visit;
  }

  /**
   * Copy as agenda: every line of the card, not only those drawn, worked
   * out afresh from the index, as Markdown on the clipboard.
   */
  private async copyBetweenAgenda(): Promise<void> {
    const tagKey = this.currentSnapshot().tag?.key;
    const groups = tagKey ? collectBetweenLines(this.search.indexer.getSnapshot(), tagKey, readQueryContext()) : undefined;
    const agenda = groups ? formatBetweenAgenda(groups) : '';
    if (!agenda || !groups) {
      return;
    }
    await vscode.env.clipboard.writeText(`${agenda}\n`);
    const lines = groups.reduce((count, group) => count + group.tasks.length, 0);
    vscode.window.setStatusBarMessage(`Copied ${lines} ${lines === 1 ? 'line' : 'lines'} as an agenda`, 3000);
  }

  /**
   * What a type's page asks of its host: its rows tab's sort, columns, and
   * grouping; Add <type>…, its note, and Create type; the renames a
   * column's menu offers; and a row's hub note and Copy.
   */
  private typeHandlers(): Pick<
    MessageHandlers<SearchPagePageToHost>,
    | 'setTypeSort'
    | 'setTypeColumns'
    | 'setTypeGroup'
    | 'addTypeRow'
    | 'openTypeNote'
    | 'createTypeFromTag'
    | 'renameTypeField'
    | 'editTypeField'
    | 'renameTypeOption'
    | 'createRowHub'
    | 'copyRowValue'
  > {
    const { indexer, preferences, writes } = this.search;
    return {
      setTypeSort: (message) =>
        preferences.display.setTypeTable(message.typeKey, {
          sort: message.column ? { column: message.column, direction: message.direction ?? 'asc' } : undefined,
        }),
      setTypeColumns: (message) => preferences.display.setTypeTable(message.typeKey, { columns: message.columns }),
      setTypeGroup: (message) => preferences.display.setTypeTable(message.typeKey, { groupBy: message.field }),
      addTypeRow: (message) => this.addTypeRow(message.typeKey),
      openTypeNote: (message) => this.openTypeNote(message.typeKey),
      createTypeFromTag: async (message) => {
        await vscode.commands.executeCommand('deckard.createTypeFromTags', message.namespace);
      },
      renameTypeField: async (message) => {
        await renameTypeField({ indexer, history: writes.history }, message.typeKey, message.field);
      },
      editTypeField: (message) => this.openTypeNote(message.typeKey, message.field),
      renameTypeOption: async (message) => {
        await renameTypeOption({ indexer, history: writes.history }, message.typeKey, message.field, message.option);
      },
      createRowHub: async (message) => {
        const row = this.findTypeRow(message.typeKey, message.rowId);
        if (row && !row.filePath && row.tagKeys.length) {
          await createHubNoteForTag({ indexer, history: writes.history }, row.tagKeys.includes(row.id) ? row.id : row.tagKeys[0]);
        }
      },
      copyRowValue: async (message) => {
        // What the row's ⋯ offered to copy, as the page drew it.
        const table = this.currentSnapshot().typeRows;
        const rows = [...(table?.rows ?? []), ...(table?.groups ?? []).flatMap((group) => group.rows)];
        const copy = rows.find((row) => row.id === message.rowId)?.copy;
        if (copy) {
          await copyFieldValue(copy.value);
        }
      },
    };
  }

  /**
   * Edit fields… or a field's name on the hub card, or a row's Edit
   * fields… on a type's rows: the form on that note, at the field asked.
   * Only a note the page drew with fields is opened: the hub note of a
   * typed row, or a row of the type's table.
   */
  private async editFields(message: EditFieldsMessage): Promise<void> {
    const snapshot = this.currentSnapshot();
    const table = snapshot.typeRows;
    const rows = [...(table?.rows ?? []), ...(table?.groups ?? []).flatMap((group) => group.rows)];
    const drawn = (snapshot.hub?.fields !== undefined && snapshot.hub.filePath === message.filePath) || rows.some((row) => row.filePath === message.filePath);
    if (drawn) {
      await openEditFieldsForm({ indexer: this.search.indexer, history: this.search.writes.history }, message);
    }
  }

  /** A row of the page's type, by id, as the index has it now; undefined for one it no longer has. */
  private findTypeRow(typeKey: string, rowId: string): TypeRow | undefined {
    const row = getTypeIndex(this.search.indexer.getSnapshot()).row(rowId);
    return row?.typeKey === typeKey ? row : undefined;
  }

  /**
   * Add <type>…: the new note's form, its folder, title, tag, and fields,
   * written into the type's folder when Create the note is chosen.
   */
  private async addTypeRow(typeKey: string): Promise<void> {
    if (!getTypeIndex(this.search.indexer.getSnapshot()).registry.get(typeKey)) {
      return;
    }
    await openTypeNoteForm({ indexer: this.search.indexer, history: this.search.writes.history }, { typeKey });
  }

  /** Opens a type's note, at a field's row of its table when one is named, else at the top. */
  private async openTypeNote(typeKey: string, fieldKey?: string): Promise<void> {
    const type = getTypeIndex(this.search.indexer.getSnapshot()).registry.get(typeKey);
    if (!type) {
      return;
    }
    const field = fieldKey ? type.fields.find((candidate) => candidate.key === fieldKey.toLowerCase()) : undefined;
    await openResultAt(type.filePath, field?.line ?? type.table?.startLine ?? 1, { pin: true });
  }

  /**
   * Opens a line the page shows: its hub, a card, or a task. A card's visit
   * is counted, unless it is a note's front matter.
   */
  /**
   * Follows a `[[link]]` in the hub note to the note it names, read from the
   * note it is written in, as the note page follows one.
   */
  private async openWikiLink(target: string, from: string | undefined, how: NoteOpening): Promise<void> {
    const writtenIn = from ?? this.currentSnapshot().hub?.filePath;
    const place = findWikiLinkPlace(this.search.indexer.getSnapshot(), target, writtenIn);
    if (!place) {
      void vscode.window.showInformationMessage(`No note is named "${parseWikiTarget(target).note}" yet, or more than one is.`);
      return;
    }
    await this.openSource(place.filePath, place.line ?? 1, how);
  }

  private async openSource(
    filePath: string,
    line: number,
    how: NoteOpening = {},
  ): Promise<void> {
    const snapshot = this.currentSnapshot();
    const hub = snapshot.hub;
    if (
      hub &&
      (filePath === hub.filePath || hub.otherFilePaths.includes(filePath))
    ) {
      // A hub note's page is this tag's page, which is open already: the
      // hub always opens in the editor, whatever deckard.openNotesIn says.
      await openResultAt(filePath, line, { ...(how.beside ? { beside: true } : {}), ...(how.pin ? { pin: true } : {}) });
      return;
    }
    const card = snapshot.sections.find(
      (section) => section.filePath === filePath && section.startLine === line,
    );
    if (card) {
      if (!card.id.startsWith('frontmatter:')) {
        await this.search.preferences.usage.recordSectionAccess(card.id);
      }
      await openNoteAt(card.filePath, card.startLine, how);
      return;
    }
    const task = this.drawnTasks().find(
      (candidate) =>
        candidate.task.filePath === filePath &&
        candidate.task.lineNumber === line,
    );
    if (task) {
      await openNoteAt(task.task.filePath, task.task.lineNumber, how);
      return;
    }
    // A note a type's row, or one of its values, names: a row's note or hub, or a Note field's.
    if (snapshot.typeRows && this.search.indexer.getSnapshot().files.has(filePath)) {
      await openNoteAt(filePath, line, how);
    }
  }

  /**
   * Names the search the page's box holds and keeps it as a saved view: a
   * search of two or more tags as that set of tags, and any other as its
   * text. The box may hold words typed and not yet run, so the search is
   * the page's to say rather than the one last run. One that does not
   * parse is run instead, so the box shows why it cannot be kept.
   */
  private async saveSearch(page: PageContext, query: string): Promise<void> {
    const index = this.search.indexer.getSnapshot();
    const text = query.trim();
    if (!text) {
      return;
    }
    if (parseWorkspaceQuery(index, text).node === undefined) {
      await this.applyQuery(page, text);
      return;
    }
    const tagKeys = resolveQueryTagIntersection(index, parseWorkspaceQuery(index, text), readEntityNamespaceAliases());
    const isTagSet = tagKeys !== undefined && tagKeys.length >= 2;
    const name = await vscode.window.showInputBox({
      title: 'Save search',
      prompt: 'Name this search',
      value: isTagSet
        ? tagKeys.map((tagKey) => index.tags.get(tagKey)?.label ?? tagKey).join(' + ')
        : text,
      validateInput: (value) =>
        value.trim() ? undefined : 'A saved search needs a name.',
    });
    if (name === undefined) {
      return;
    }
    const saved = isTagSet
      ? await this.search.preferences.savedSearches.saveSavedFilter(name, tagKeys)
      : await this.search.preferences.savedSearches.saveSavedQueryFilter(name, text);
    if (saved) {
      void offerSavedSearchOnHome(this.search.preferences, saved);
    }
  }
}

/**
 * What names a search, so the same search reached two ways finds one page:
 * a search of only tags is its set of tags, each read through
 * `entityNamespaceAliases` as the index read the notes, and any other search
 * is its canonical text.
 */
export function getSearchKey(
  index: WorkspaceIndex,
  queryText: string,
  entityNamespaceAliases?: EntityNamespaceAliases,
): string {
  const parsed = parseWorkspaceQuery(index, queryText.trim());
  if (!parsed.node) {
    return '';
  }
  const tagKeys = resolveQueryTagIntersection(index, parsed, entityNamespaceAliases);
  return tagKeys
    ? `tags:${[...tagKeys].sort().join('\u0000')}`
    : `query:${formatQuery(parsed.node)}`;
}

/**
 * A page's tab title: its entity or tag, or its search.
 */
function getPageTitle(snapshot: SearchPageSnapshot): string {
  if (snapshot.typeRows) {
    return snapshot.typeRows.plural;
  }
  if (snapshot.entity) {
    return formatEntityTitle(snapshot.entity.kind, snapshot.entity.name);
  }
  if (snapshot.tag) {
    return snapshot.tag.label;
  }
  const text = snapshot.query.text.trim();
  if (!text) {
    return 'Deckard Search';
  }
  return `Search: ${text.length > 40 ? `${text.slice(0, 39)}…` : text}`;
}
