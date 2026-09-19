import * as vscode from 'vscode';

import { formatEntityTitle } from '../../core/markdown/parser';
import { formatQuery } from '../../core/query/queryFormat';
import { parseQuery } from '../../core/query/queryParser';
import { measure } from '../../core/timing';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { PreferencesStore } from '../../core/storage/preferences';
import {
  SearchPageMessage,
  SearchPageSnapshot,
  SearchRefineState,
  TagTitleDisplayMode,
  TaskFilter,
  WorkspaceIndex,
} from '../../core/types';
import {
  createQueryViewState,
  createSearchPageSnapshot,
  normalizeTagTitleDisplayMode,
  resolveQueryTagIntersection,
} from '../state/dashboardState';
import { isWritten } from '../state/searchFacets';
import { createHubNote } from '../commands/hubNote';
import { openSourceAt } from '../commands/navigation';
import { renameIndexedTag } from '../commands/renameTag';
import { toggleTask } from '../commands/taskActions';
import { ActiveSearch, SearchSource } from './activeSearch';
import { parseSearchPageMessage } from './messages';
import { getSearchPageHtml } from './searchPageHtml';

/**
 * Opens search pages: one editor tab per search, which a tag's overview is
 * the case of, when the search is that one tag.
 *
 * Opening a search that a page already shows reveals that page, so a link
 * followed twice does not open a second tab. A page edits its search in
 * place; it is found by the search it shows now, not the one it opened with.
 */
export class SearchPanels implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panels = new Set<SearchPanel>();

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly activeSearch: ActiveSearch,
  ) {
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      activeSearch.onDidChangeRefineVisibility(() =>
        this.panels.forEach((panel) => panel.refreshIfRefineMoved()),
      ),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          this.panels.forEach((panel) => panel.renderHtml());
          this.refresh();
        } else if (
          event.affectsConfiguration('deckard.tagTitleDisplayMode') ||
          event.affectsConfiguration('deckard.tagOverview.hubNoteExpanded') ||
          event.affectsConfiguration('deckard.enableHeadingTagRelationships')
        ) {
          this.refresh();
        }
      }),
    );
  }

  /**
   * Opens a tag's page: the search for that one tag.
   */
  public async show(tagKey: string): Promise<void> {
    await this.indexer.ready;
    const canonicalTagKey = resolveIndexedTagKey(
      this.indexer.getSnapshot().tags,
      tagKey,
    );
    if (!canonicalTagKey) {
      void vscode.window.showWarningMessage(
        `Deckard could not find the tag: ${tagKey}`,
      );
      return;
    }
    await this.showQuery(canonicalTagKey);
  }

  /**
   * Opens a page on a search, or reveals the page already showing it. An
   * empty search opens a page that lists every note.
   */
  public async showQuery(queryText: string): Promise<void> {
    await this.indexer.ready;
    const text = queryText.trim();
    const index = this.indexer.getSnapshot();
    const tagKeys = resolveQueryTagIntersection(index, parseQuery(text));
    if (tagKeys?.length === 1) {
      await this.preferences.recordTagAccess(tagKeys[0]);
      if (index.entities.has(tagKeys[0])) {
        await this.preferences.recordEntityAccess(tagKeys[0]);
      }
    }
    const key = getSearchKey(index, text);
    const existing = [...this.panels].find((panel) => panel.key() === key);
    (existing ?? this.createPanel(text)).show();
  }

  /**
   * Reopens a page VS Code kept across a reload. A page saved before search
   * pages kept their search as one string is read from its tag, the tags
   * added to it, and what was typed after them.
   */
  public async restore(
    webviewPanel: vscode.WebviewPanel,
    state: unknown,
  ): Promise<void> {
    await this.indexer.ready;
    const index = this.indexer.getSnapshot();
    const saved = readSerializedSearch(index, state);
    if (saved === undefined) {
      webviewPanel.dispose();
      return;
    }
    const key = getSearchKey(index, saved.query);
    const existing = [...this.panels].find((panel) => panel.key() === key);
    if (existing) {
      webviewPanel.dispose();
      existing.show();
      return;
    }
    this.createPanel(saved.origin, saved.query).restore(webviewPanel);
  }

  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    [...this.panels].forEach((panel) => panel.dispose());
    this.panels.clear();
  }

  /**
   * Refreshes every page. A page about a tag that no longer exists closes,
   * as a renamed tag's page is replaced by the new tag's.
   */
  private refresh(): void {
    const index = this.indexer.getSnapshot();
    [...this.panels].forEach((panel) => {
      if (panel.isForMissingTag(index)) {
        panel.dispose();
      } else {
        panel.refresh();
      }
    });
  }

  private createPanel(originQuery: string, queryText = originQuery): SearchPanel {
    const panel: SearchPanel = new SearchPanel(
      originQuery,
      queryText,
      this.indexer,
      this.preferences,
      this.extensionUri,
      this.activeSearch,
      {
        onDispose: () => this.panels.delete(panel),
        openTag: (tagKey) => this.show(tagKey),
      },
    );
    this.panels.add(panel);
    return panel;
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
 * The search a serialized page held, and the one it was opened with.
 */
function readSerializedSearch(
  index: WorkspaceIndex,
  state: unknown,
): { query: string; origin: string } | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined;
  }
  const saved = state as Record<string, unknown>;
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' ? value.trim() : undefined;
  const query = text(saved.query);
  if (query !== undefined && typeof saved.origin === 'string') {
    return { query, origin: saved.origin.trim() };
  }

  // A page saved before search pages: a tag, the tags added to it, and a
  // search typed after them, which held the tags too once they moved into
  // the box.
  const tagKey = text(saved.tagKey);
  const canonicalTagKey = tagKey
    ? resolveIndexedTagKey(index.tags, tagKey)
    : undefined;
  if (tagKey && !canonicalTagKey) {
    return undefined;
  }
  const filterTagKeys = Array.isArray(saved.filterTagKeys)
    ? saved.filterTagKeys.filter(
        (key): key is string => typeof key === 'string' && key.length > 0,
      )
    : [];
  const tags = [canonicalTagKey, ...filterTagKeys]
    .filter((key): key is string => Boolean(key))
    .join(' AND ');
  const legacy = query ?? text(saved.refinement);
  const search =
    legacy && canonicalTagKey && !isWritten(legacy, canonicalTagKey)
      ? `${tags} ${legacy}`
      : legacy ?? tags;
  if (!search && !canonicalTagKey) {
    return undefined;
  }
  return { query: search, origin: canonicalTagKey ?? search };
}

interface SearchPanelHost {
  onDispose(): void;
  openTag(tagKey: string): Promise<void>;
}

/**
 * One search page: its webview, its search, and the search it opened with.
 */
class SearchPanel implements SearchSource, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private taskFilter: TaskFilter = 'active';
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
  /** Whether the index changed while the page was hidden. */
  private isStale = false;
  /** Whether the last state sent put Refine in the sidebar. */
  private refineWasInSidebar = false;
  private lastSnapshot: SearchPageSnapshot | undefined;
  private disposed = false;

  public constructor(
    private readonly originQuery: string,
    private queryText: string,
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly activeSearch: ActiveSearch,
    private readonly host: SearchPanelHost,
  ) {}

  public key(): string {
    return getSearchKey(this.indexer.getSnapshot(), this.queryText);
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

  /** Creates or reveals the page, then sends its state. */
  public show(): void {
    if (!this.panel) {
      this.attachPanel(
        vscode.window.createWebviewPanel(
          'deckard.tagOverview',
          'Deckard Search',
          vscode.ViewColumn.Active,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            enableFindWidget: true,
          },
        ),
      );
    }
    this.panel?.reveal(vscode.ViewColumn.Active);
    this.refresh();
  }

  public restore(panel: vscode.WebviewPanel): void {
    this.attachPanel(panel);
    this.refresh();
  }

  public refresh(): void {
    if (!this.panel) {
      return;
    }
    // A hidden page keeps what it shows and catches up when shown again.
    if (!this.panel.visible) {
      this.isStale = true;
      this.lastSnapshot = undefined;
      this.activeSearch.notifyChanged(this);
      return;
    }
    this.isStale = false;
    const snapshot = measure('Search page', () => this.createSnapshot());
    // The snapshot clamps a page number to the pages the search has, and a
    // search shortens under an open page whenever a note is saved. Reading
    // the clamped numbers back keeps the page the reader is on and the page
    // the host asks for from drifting apart.
    this.notePage = snapshot.notePaging.page;
    this.taskPage = snapshot.taskPaging.page;
    this.lastSnapshot = snapshot;
    this.refineWasInSidebar = snapshot.refineInSidebar === true;
    this.panel.title = getPageTitle(snapshot);
    void this.panel.webview.postMessage({
      type: 'state',
      data: {
        ...snapshot,
        // The Markdown view shows each note's source, which the page's
        // search also reads, so only the HTML view is sent each note rendered.
        sections:
          snapshot.renderMode === 'html'
            ? snapshot.sections
            : snapshot.sections.map((card) => ({ ...card, renderedHtml: '' })),
      },
    });
    this.activeSearch.notifyChanged(this);
  }

  /** Sends the state again when the sidebar took or gave back Refine. */
  public refreshIfRefineMoved(): void {
    if (this.activeSearch.isRefineInSidebar(this) !== this.refineWasInSidebar) {
      this.refresh();
    }
  }

  public getRefineState(): SearchRefineState | undefined {
    const snapshot = this.lastSnapshot ?? this.createSnapshot();
    return {
      page: 'search',
      title: getPageTitle(snapshot),
      query: snapshot.query,
      resultKinds: ['notes', 'tasks'],
    };
  }

  public async applySearch(queryText: string): Promise<void> {
    await this.applyQuery(queryText);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeSearch.release(this);
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    const panel = this.panel;
    this.panel = undefined;
    panel?.dispose();
    this.host.onDispose();
  }

  public renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getSearchPageHtml(this.panel.webview);
    }
  }

  private createSnapshot(): SearchPageSnapshot {
    const index = this.indexer.getSnapshot();
    const preferences = this.preferences.value;
    const snapshot = createSearchPageSnapshot(
      index,
      preferences,
      this.queryText,
      {
        originQuery: this.originQuery,
        taskFilter: this.taskFilter,
        tagTitleDisplayMode: this.getTagTitleDisplayMode(),
        notePage: this.notePage,
        taskPage: this.taskPage,
        previewWords: this.previewWords,
        enableHeadingTagRelationships: vscode.workspace
          .getConfiguration('deckard')
          .get<boolean>('enableHeadingTagRelationships', true),
        suggestWords: (words) => this.indexer.suggestWords(words),
      },
    );
    return {
      ...snapshot,
      ...(snapshot.hub
        ? { hub: { ...snapshot.hub, expanded: this.isHubNoteExpanded() } }
        : {}),
      // The results come from the last search that parsed; only the box
      // shows the text that did not.
      ...(this.invalidQueryText !== undefined
        ? {
            query: createQueryViewState(
              index,
              parseQuery(this.queryText),
              snapshot.query.matchCounts,
              true,
              preferences.recentQueries ?? [],
              {
                facets: snapshot.query.facets,
                pending: this.invalidQueryText,
              },
            ),
          }
        : {}),
      refineInSidebar: this.activeSearch.isRefineInSidebar(this),
    };
  }

  private isHubNoteExpanded(): boolean {
    return vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('tagOverview.hubNoteExpanded', true);
  }

  private getTagTitleDisplayMode(): TagTitleDisplayMode {
    return normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'deckard.svg',
    );
    panel.webview.options = { enableScripts: true };
    this.renderHtml();
    this.disposables.push(
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.dispose();
      }),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
        this.updateActivity(panel.active);
      }),
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    );
    this.updateActivity(panel.active);
  }

  private updateActivity(active: boolean): void {
    if (active) {
      this.activeSearch.setActive(this);
    } else {
      this.activeSearch.release(this);
    }
  }

  /**
   * Runs a search typed, built, or refined on the page. A search that does
   * not parse is shown with its error, and the results stay as they were.
   */
  private async applyQuery(queryText: string, remember = true): Promise<void> {
    const text = queryText.trim();
    if (text && parseQuery(text).node === undefined) {
      this.invalidQueryText = text;
      this.refresh();
      return;
    }
    this.invalidQueryText = undefined;
    this.queryText = text;
    // The draft has become the search, or been replaced by another, so it is
    // no longer narrowing anything on its own.
    this.previewWords = [];
    // A different search is a different list, read from its first page.
    this.notePage = 1;
    this.taskPage = 1;
    this.refresh();
    if (remember && text) {
      await this.preferences.recordRecentQuery(text);
    }
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseSearchPageMessage(value);
    if (message) {
      await this.handleValidMessage(message);
    }
  }

  /**
   * Checks what a message names against the page's current results before
   * acting, since the page may still show an entry that has since changed.
   */
  private async handleValidMessage(message: SearchPageMessage): Promise<void> {
    switch (message.type) {
      case 'setOverviewQuery':
        await this.applyQuery(message.query, message.remember !== false);
        return;
      case 'clearOverviewQuery':
        await this.applyQuery(this.originQuery, false);
        return;
      case 'setResultPage':
        if (message.kind === 'notes') {
          this.notePage = message.page;
        } else {
          this.taskPage = message.page;
        }
        this.refresh();
        return;
      case 'previewSearch': {
        const words = message.words
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
        this.refresh();
        return;
      }
      case 'setResultsPerPage':
        // A different page size is a different set of pages, and the number
        // the reader was on means nothing in it, so both lists start again.
        this.notePage = 1;
        this.taskPage = 1;
        await this.preferences.setSearchPageSize(message.size);
        return;
      case 'setTaskFilter':
        this.taskFilter = message.filter;
        // A different filter is a different list of tasks, read from its
        // first page rather than from wherever the last list had got to.
        this.taskPage = 1;
        this.refresh();
        return;
      case 'setRenderMode':
        await this.preferences.setRenderMode(message.mode);
        return;
      case 'setTagOverviewSort':
        await this.preferences.setTagOverviewSortMode(message.mode);
        return;
      case 'setTagOverviewLayout':
        await this.preferences.setTagOverviewLayout(message.layout);
        return;
      case 'setSearchColumns':
        await this.preferences.setDashboardColumns(
          message.section,
          message.columns,
        );
        return;
      case 'openHelp':
        await vscode.commands.executeCommand('deckard.showHelp');
        return;
      case 'saveTagOverviewFilter':
        await this.saveSearch();
        return;
      case 'createHubNote': {
        const tagKey = this.currentSnapshot().tag?.key;
        if (tagKey) {
          await createHubNote(this.indexer, tagKey);
        }
        return;
      }
      case 'openTag': {
        const tagKey = resolveIndexedTagKey(
          this.indexer.getSnapshot().tags,
          message.tagKey,
        );
        if (tagKey) {
          await this.host.openTag(tagKey);
        }
        return;
      }
      case 'renameTag': {
        const replacement = await renameIndexedTag(
          this.indexer,
          message.tagKey,
          this.preferences,
        );
        if (replacement) {
          await this.host.openTag(replacement.key);
        }
        return;
      }
      case 'toggleTask': {
        const task = this.currentSnapshot().tasks.find(
          (candidate) => candidate.task.id === message.taskId,
        )?.task;
        if (task) {
          await toggleTask(task, message.completed);
        }
        return;
      }
      case 'openSource':
        await this.openSource(message.filePath, message.line);
        return;
    }
  }

  private currentSnapshot(): SearchPageSnapshot {
    return this.lastSnapshot ?? this.createSnapshot();
  }

  private async openSource(filePath: string, line: number): Promise<void> {
    const snapshot = this.currentSnapshot();
    const hub = snapshot.hub;
    if (
      hub &&
      (filePath === hub.filePath || hub.otherFilePaths.includes(filePath))
    ) {
      await openSourceAt(filePath, line);
      return;
    }
    const card = snapshot.sections.find(
      (section) => section.filePath === filePath && section.startLine === line,
    );
    if (card) {
      if (!card.id.startsWith('frontmatter:')) {
        await this.preferences.recordSectionAccess(card.id);
      }
      await openSourceAt(card.filePath, card.startLine);
      return;
    }
    const task = snapshot.tasks.find(
      (candidate) =>
        candidate.task.filePath === filePath &&
        candidate.task.lineNumber === line,
    );
    if (task) {
      await openSourceAt(task.task.filePath, task.task.lineNumber);
    }
  }

  /**
   * Names the page's search and keeps it as a saved view: a search of two
   * or more tags as that set of tags, and any other as its text.
   */
  private async saveSearch(): Promise<void> {
    const index = this.indexer.getSnapshot();
    const text = this.queryText.trim();
    if (!text) {
      return;
    }
    const tagKeys = resolveQueryTagIntersection(index, parseQuery(text));
    const isTagSet = tagKeys !== undefined && tagKeys.length >= 2;
    const name = await vscode.window.showInputBox({
      title: 'Save this search',
      prompt: 'Name this search',
      value: isTagSet
        ? tagKeys.map((tagKey) => index.tags.get(tagKey)?.label ?? tagKey).join(' + ')
        : text,
      validateInput: (value) =>
        value.trim() ? undefined : 'A saved filter needs a name.',
    });
    if (name === undefined) {
      return;
    }
    const saved = isTagSet
      ? await this.preferences.saveSavedFilter(name, tagKeys)
      : await this.preferences.saveSavedQueryFilter(name, text);
    if (saved) {
      void vscode.window.showInformationMessage(
        `Saved the search "${saved.name}".`,
      );
    }
  }
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
