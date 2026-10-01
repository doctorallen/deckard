import * as vscode from 'vscode';

import type { PreferenceServices } from '../../../../core/storage/preferences';
import type { IndexControl, IndexReader, IndexScanStatus, IndexSearch, IndexUpdates } from '../../../../core/workspace/indexReader';
import { listedParkedTags } from '../../../../domain/index/parked';
import { resolveIndexedTagKey } from '../../../../domain/index/tagNavigation';
import { formatEntityTitle } from '../../../../domain/markdown/parser';
import type { Section, Task, WorkspaceIndex } from '../../../../domain/model';
import type { TagTitleDisplayMode } from '../../../../domain/model/tags';
import { formatQuery } from '../../../../domain/query/queryFormat';
import { parseQuery } from '../../../../domain/query/queryParser';
import type { ExportService } from '../../../../services/exportService';
import type { NavigationService } from '../../../../services/navigationService';
import { measure } from '../../../../shared/timing';
import type { SearchPagePageToHost, SearchPageSnapshot, SearchPageState } from '../../../protocol/searchPage';
import type { SearchRefineState } from '../../../protocol/shared';
import { editResults } from '../../../commands/bulkEditPrompts';
import { presentExport } from '../../../commands/exportResults';
import { createHubNote } from '../../../commands/hubNote';
import { openResultAt, ResultOpening } from '../../../commands/navigation';
import { setPinned } from '../../../commands/pinNote';
import { readQueryContext } from '../../../commands/queryContext';
import { mergeIndexedTag } from '../../../commands/renameTag';
import { offerSavedSearchOnHome } from '../../../commands/savedSearchHome';
import type { TaskWrites } from '../../../commands/taskActions';
import {
  createQueryViewState,
  createSearchPageSnapshot,
  evaluateSearchPage,
  normalizeTagTitleDisplayMode,
  resolveQueryTagIntersection,
} from '../../../state/dashboardState';
import { formatQueryBlock } from '../../../state/queryBlockState';
import { SearchHistory, SearchHistoryEntry } from '../../../state/searchHistory';
import type { ActiveSearch, SearchSource } from '../../activeSearch';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { chooseTheme, openHelp, openTag, parkTag, renameTag, setZenMode, toggleTask } from '../../host/sharedHandlers';
import { getSearchPageHtml } from '../../searchPageHtml';
import type { DeckardTheme } from '../../themeNames';
import { narrowSearchPageMessage } from './messages';

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
  /** Names the page's tab, before each snapshot is sent. */
  setTitle(title: string): void;
  /** Called when the reader closes the page. */
  onDidClose(): void;
}

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

  /** Starts on `search.queryText`, opened with `search.originQuery`. */
  public constructor(private readonly search: SearchPageControllerOptions) {
    this.originQuery = search.originQuery;
    this.queryText = search.queryText;
    const { indexer, navigation, preferences } = search;
    this.handlers = {
      setZenMode: setZenMode(),
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
        this.refresh(page);
      },
      previewSearch: (message, page) => this.previewSearch(page, message.words),
      setResultsPerPage: async (message) => {
        // A different page size is a different set of pages, and the number
        // the reader was on means nothing in it, so both lists start again.
        this.notePage = 1;
        this.taskPage = 1;
        await preferences.display.setSearchPageSize(message.size);
      },
      setRenderMode: (message) => preferences.display.setRenderMode(message.mode),
      setTagOverviewSort: (message) => preferences.display.setTagOverviewSortMode(message.mode),
      setTagOverviewLayout: (message) => preferences.display.setTagOverviewLayout(message.layout),
      setSearchPreview: (message) => preferences.display.setSearchPreview(message.preview),
      setSearchColumns: (message) => preferences.display.setDashboardColumns(message.section, message.columns),
      openHelp: openHelp(),
      saveTagOverviewFilter: () => this.saveSearch(),
      mergeTags: (message) => this.mergeTags(message.sourceKey, message.targetKey),
      // A preference about every tag's page, so it is the user's.
      excludeHubLinks: () =>
        vscode.workspace
          .getConfiguration('deckard')
          .update('tagOverview.includeHubLinks', false, vscode.ConfigurationTarget.Global),
      createHubNote: async () => {
        const tagKey = this.currentSnapshot().tag?.key;
        if (tagKey) {
          await createHubNote(indexer, tagKey);
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
        findTask: (taskId) => this.currentSnapshot().tasks.find((candidate) => candidate.task.id === taskId)?.task,
      }),
      // A result is an entry, so pinning one pins that entry rather than
      // the file it is written in.
      pinNote: (message) => this.setPinned(message.filePath, message.line, true),
      unpinNote: (message) => this.setPinned(message.filePath, message.line, false),
      editResults: (message) => editResults(search.writes.history, message.kind, this.currentResults()),
      exportResults: (message) => this.exportResults(message.kind),
      openSource: (message) => this.openSource(message.filePath, message.line, message),
    };
  }

  /** The page as its template draws it, in a theme. */
  public html(webview: vscode.Webview, theme: DeckardTheme): string {
    return getSearchPageHtml(webview, theme);
  }

  /** What names the page's search, so the same search reached two ways finds this page. */
  public key(): string {
    return getSearchKey(this.search.indexer.getSnapshot(), this.queryText);
  }

  /** The search the page shows, as typed. */
  public searchText(): string {
    return this.queryText;
  }

  /** Whether the page is about one tag the index no longer has. */
  public isForMissingTag(index: WorkspaceIndex): boolean {
    const parsed = parseQuery(this.queryText);
    const node = parsed.node;
    return (
      node?.type === 'condition' &&
      node.field === 'tag' &&
      node.operator === 'eq' &&
      this.queryText === this.originQuery &&
      resolveIndexedTagKey(index.tags, node.value) === undefined
    );
  }

  /**
   * Sends the page its snapshot, as the host does. Before the first scan
   * there is nothing to show but how far it has got, so nothing is sent and
   * a hidden page is not marked stale.
   */
  public refresh(page: PageContext): void {
    if (this.search.indexer.hasIndexed === false) {
      return;
    }
    page.refresh();
  }

  /** An index update redraws the page, once the first scan is done. */
  public onIndexUpdate(page: PageContext): void {
    this.refresh(page);
  }

  /** Sends the state again when the sidebar took or gave back Refine. */
  public refreshIfRefineMoved(page: PageContext): void {
    if (this.search.activeSearch.isRefineInSidebar(this.search.source) !== this.refineWasInSidebar) {
      this.refresh(page);
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
    return {
      ...snapshot,
      parkedTags: listedParkedTags(this.search.indexer),
      // The Markdown view shows each note's source, which the page's
      // search also reads, so only the HTML view is sent each note rendered.
      sections:
        snapshot.renderMode === 'html'
          ? snapshot.sections
          : snapshot.sections.map((card) => ({
              ...card,
              renderedHtml: '',
              ...(card.snippet ? { snippet: { ...card.snippet, renderedHtml: '' } } : {}),
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

  /** A page that is gone is no longer the active search. */
  public dispose(): void {
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

  private updateActivity(active: boolean): void {
    if (active) {
      this.search.activeSearch.setActive(this.search.source);
    } else {
      this.search.activeSearch.release(this.search.source);
    }
  }

  private createSnapshot(): SearchPageSnapshot {
    const index = this.search.indexer.getSnapshot();
    const preferences = this.search.preferences.reader.value;
    const queryContext = readQueryContext();
    const snapshot = createSearchPageSnapshot(
      index,
      preferences,
      this.queryText,
      {
        queryContext,
        originQuery: this.originQuery,
        tagTitleDisplayMode: getTagTitleDisplayMode(),
        notePage: this.notePage,
        taskPage: this.taskPage,
        previewWords: this.previewWords,
        includeHubLinks: includesHubLinks(),
        enableHeadingTagRelationships: vscode.workspace
          .getConfiguration('deckard')
          .get<boolean>('enableHeadingTagRelationships', true),
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
        ? { hub: { ...snapshot.hub, expanded: isHubNoteExpanded() } }
        : {}),
      // The results come from the last search that parsed; only the box
      // shows the text that did not.
      ...(this.invalidQueryText === undefined
        ? {}
        : {
            query: createQueryViewState({
              index,
              parsed: parseQuery(this.queryText),
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
    if (text && parseQuery(text).node === undefined) {
      this.invalidQueryText = text;
      this.refresh(page);
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
    this.queryText = entry.query;
    // The draft has become the search, or been replaced by another, so it is
    // no longer narrowing anything on its own.
    this.previewWords = [];
    this.notePage = entry.notePage;
    this.taskPage = entry.taskPage;
    this.refresh(page);
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
    this.refresh(page);
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
      ? () => formatQueryBlock(search, sort === 'created' || sort === 'updated' ? { sort } : {})
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
      ? parseQuery(this.queryText).node
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
      includeHubLinks: includesHubLinks(),
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

  /**
   * Opens a line the page shows: its hub, a card, or a task. A card's visit
   * is counted, unless it is a note's front matter.
   */
  private async openSource(
    filePath: string,
    line: number,
    how: ResultOpening = {},
  ): Promise<void> {
    const snapshot = this.currentSnapshot();
    const hub = snapshot.hub;
    if (
      hub &&
      (filePath === hub.filePath || hub.otherFilePaths.includes(filePath))
    ) {
      await openResultAt(filePath, line, how);
      return;
    }
    const card = snapshot.sections.find(
      (section) => section.filePath === filePath && section.startLine === line,
    );
    if (card) {
      if (!card.id.startsWith('frontmatter:')) {
        await this.search.preferences.usage.recordSectionAccess(card.id);
      }
      await openResultAt(card.filePath, card.startLine, how);
      return;
    }
    const task = snapshot.tasks.find(
      (candidate) =>
        candidate.task.filePath === filePath &&
        candidate.task.lineNumber === line,
    );
    if (task) {
      await openResultAt(task.task.filePath, task.task.lineNumber, how);
    }
  }

  /**
   * Names the page's search and keeps it as a saved view: a search of two
   * or more tags as that set of tags, and any other as its text.
   */
  private async saveSearch(): Promise<void> {
    const index = this.search.indexer.getSnapshot();
    const text = this.queryText.trim();
    if (!text) {
      return;
    }
    const tagKeys = resolveQueryTagIntersection(index, parseQuery(text));
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
 * a search of only tags is its set of tags, and any other search is its
 * canonical text.
 */
export function getSearchKey(index: WorkspaceIndex, queryText: string): string {
  const parsed = parseQuery(queryText.trim());
  if (!parsed.node) {
    return '';
  }
  const tagKeys = resolveQueryTagIntersection(index, parsed);
  return tagKeys
    ? `tags:${[...tagKeys].sort().join('\u0000')}`
    : `query:${formatQuery(parsed.node)}`;
}

/**
 * A page's tab title: its entity or tag, or its search.
 */
function getPageTitle(snapshot: SearchPageSnapshot): string {
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

/** Whether a tag's page lists what only links its hub note. */
function includesHubLinks(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('tagOverview.includeHubLinks', true);
}

/** Whether a tag's hub note starts open. */
function isHubNoteExpanded(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('tagOverview.hubNoteExpanded', true);
}

/** How a tag's title is drawn in a card, from `deckard.tagTitleDisplayMode`. */
function getTagTitleDisplayMode(): TagTitleDisplayMode {
  return normalizeTagTitleDisplayMode(
    vscode.workspace
      .getConfiguration('deckard')
      .get<unknown>('tagTitleDisplayMode', 'inline'),
  );
}
