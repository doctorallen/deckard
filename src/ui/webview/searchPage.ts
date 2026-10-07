import * as vscode from 'vscode';

import { describeMissingTag, reportFailure } from '../commands/notify';
import { readEntityNamespaceAliases } from '../commands/parseSettings';
import { askForIdentityOnce } from '../commands/identityPrompt';
import { onDidChangePageChrome } from './host/pageChrome';
import { ThemePreview } from './themePreview';

import { parseQuery } from '../../domain/query/queryParser';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { TaskWrites } from '../commands/taskActions';
import { ActiveSearch, SearchSource } from './activeSearch';
import { whenPublished } from '../../core/workspace/publishing';
import type { ExportService } from '../../services/exportService';
import { NavigationService } from '../../services/navigationService';
import type { SearchPagePageToHost, SearchPageState } from '../protocol/searchPage';
import type { SearchRefineState } from '../protocol/shared';
import { pageResourceRoots } from './host/surface';
import { PanelSurface } from './host/surface';
import { WebviewHost } from './host/webviewHost';
import {
  getSearchKey,
  SearchIndexer,
  SearchPageController,
  SearchPreferences,
} from './pages/searchPage/searchPageController';
import { isWritten } from '../../domain/search/facets';
import { resolveQueryTagIntersection } from '../state/searchPageState';
import { WorkspaceIndex } from '../../domain/model';

/** What the search pages are built from. */
export interface SearchPanelsOptions {
  indexer: SearchIndexer;
  preferences: SearchPreferences;
  extensionUri: vscode.Uri;
  activeSearch: ActiveSearch;
  /** What a page's checkboxes, tag renames and merges, and bulk edits write through. */
  writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /** What a page's Export plans its results with. */
  exports: ExportService;
}

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

  private readonly indexer: SearchIndexer;
  private readonly preferences: SearchPreferences;
  private readonly extensionUri: vscode.Uri;
  private readonly activeSearch: ActiveSearch;
  /** What a page's checkboxes, tag renames and merges, and bulk edits write through. */
  private readonly writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  private readonly themePreview: ThemePreview;
  /** What a page's Export plans its results with. */
  private readonly exports: ExportService;
  /** What a tag a page names may open. */
  private readonly navigation = new NavigationService();

  /**
   * Starts listening for index updates, preference and settings changes, and
   * the page chrome, so every page open follows them; a page is only made
   * when a search is shown.
   */
  public constructor(options: SearchPanelsOptions) {
    this.indexer = options.indexer;
    this.preferences = options.preferences;
    this.extensionUri = options.extensionUri;
    this.activeSearch = options.activeSearch;
    this.writes = options.writes;
    this.themePreview = options.themePreview;
    this.exports = options.exports;
    const { indexer, preferences, activeSearch } = options;
    // A page about a tag that is gone closes at once; each page still open
    // redraws in a turn of its own.
    this.disposables.push(indexer.onDidUpdate(() => this.closeMissingTagPages()));
    this.disposables.push(preferences.reader.onDidChange(() => this.refresh()));
    this.disposables.push(
      activeSearch.onDidChangeRefineVisibility(() =>
        this.panels.forEach((panel) => panel.refreshIfRefineMoved()),
      ),
    );
    this.disposables.push(
      onDidChangePageChrome(() => {
        this.panels.forEach((panel) => panel.renderHtml());
        this.refresh();
      }, this.themePreview),
    );
  }

  /**
   * Opens a tag's page: the search for that one tag.
   */
  public async show(tagKey: string): Promise<void> {
    // Before the first scan the page opens at once and says how far it has
    // got; the tag is looked up once there is an index to look in.
    if (this.indexer.hasIndexed === false) {
      const early = this.openWhileIndexing(tagKey);
      await whenPublished(this.indexer);
      const found = resolveIndexedTagKey(this.indexer.getSnapshot().tags, tagKey, readEntityNamespaceAliases());
      if (found === tagKey) {
        this.settle(early);
        return;
      }
      early.dispose();
      if (!found) {
        void reportFailure({ outcome: describeMissingTag(tagKey) });
        return;
      }
      await this.showQuery(found);
      return;
    }
    const canonicalTagKey = resolveIndexedTagKey(
      this.indexer.getSnapshot().tags,
      tagKey,
      readEntityNamespaceAliases(),
    );
    if (!canonicalTagKey) {
      void reportFailure({ outcome: describeMissingTag(tagKey) });
      return;
    }
    await this.showQuery(canonicalTagKey);
  }

  /**
   * Opens a page on a search, or reveals the page already showing it. An
   * empty search opens a page that lists every note.
   */
  public async showQuery(queryText: string): Promise<void> {
    if (this.indexer.hasIndexed === false) {
      const early = this.openWhileIndexing(queryText.trim());
      await whenPublished(this.indexer);
      this.settle(early);
      return;
    }
    const text = queryText.trim();
    askForIdentityOnce(text);
    const index = this.indexer.getSnapshot();
    const aliases = readEntityNamespaceAliases();
    const tagKeys = resolveQueryTagIntersection(index, parseQuery(text), aliases);
    if (tagKeys?.length === 1) {
      await this.preferences.usage.recordTagAccess(tagKeys[0]);
      if (index.entities.has(tagKeys[0])) {
        await this.preferences.usage.recordEntityAccess(tagKeys[0]);
      }
    }
    const key = getSearchKey(index, text, aliases);
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
    // A page kept in the current shape names its search outright, so
    // before the first scan it is attached at once and shows how far the
    // scan has got, as a page opened then does, rather than staying blank
    // until the scan ends. An older shape names a tag, which waits for an
    // index to look it up in.
    const kept = this.indexer.hasIndexed === false ? readCurrentSearch(state) : undefined;
    if (kept) {
      const early = this.createPanel(kept.origin, kept.query);
      early.restore(webviewPanel);
      await whenPublished(this.indexer);
      this.settle(early, false);
      return;
    }
    await whenPublished(this.indexer);
    const index = this.indexer.getSnapshot();
    const saved = readSerializedSearch(index, state);
    if (saved === undefined) {
      webviewPanel.dispose();
      return;
    }
    const key = getSearchKey(index, saved.query, readEntityNamespaceAliases());
    const existing = [...this.panels].find((panel) => panel.key() === key);
    if (existing) {
      webviewPanel.dispose();
      existing.show();
      return;
    }
    this.createPanel(saved.origin, saved.query).restore(webviewPanel);
  }

  /** Stops listening, then closes every search page still open. */
  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    [...this.panels].forEach((panel) => panel.dispose());
    this.panels.clear();
  }

  /** A page opened before the index is ready, showing the scan's progress. */
  private openWhileIndexing(text: string): SearchPanel {
    const panel = this.createPanel(text);
    panel.show();
    return panel;
  }

  /**
   * A page opened while indexing, once the index is ready: it gives way to
   * a page already showing its search, or draws, recording the visit when
   * the reader opened it rather than a reload restoring it.
   */
  private settle(panel: SearchPanel, visited = true): void {
    const index = this.indexer.getSnapshot();
    const key = panel.key();
    const other = [...this.panels].find((candidate) => candidate !== panel && candidate.key() === key);
    if (other) {
      panel.dispose();
      other.show();
      return;
    }
    if (!visited) {
      panel.refresh();
      return;
    }
    const tagKeys = resolveQueryTagIntersection(index, parseQuery(panel.searchText()), readEntityNamespaceAliases());
    if (tagKeys?.length === 1) {
      void this.preferences.usage.recordTagAccess(tagKeys[0]);
      if (index.entities.has(tagKeys[0])) {
        void this.preferences.usage.recordEntityAccess(tagKeys[0]);
      }
    }
    panel.refresh();
  }

  /**
   * Refreshes every page. A page about a tag that no longer exists closes,
   * as a renamed tag's page is replaced by the new tag's.
   */
  private closeMissingTagPages(): void {
    const index = this.indexer.getSnapshot();
    [...this.panels]
      .filter((panel) => panel.isForMissingTag(index))
      .forEach((panel) => panel.dispose());
  }

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
    const panel: SearchPanel = new SearchPanel({
      originQuery,
      queryText,
      indexer: this.indexer,
      preferences: this.preferences,
      extensionUri: this.extensionUri,
      activeSearch: this.activeSearch,
      host: {
        onDispose: () => this.panels.delete(panel),
        openTag: (tagKey) => this.show(tagKey),
        writes: this.writes,
        themePreview: this.themePreview,
        exports: this.exports,
        navigation: this.navigation,
      },
    });
    this.panels.add(panel);
    return panel;
  }
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
  return readCurrentSearch(saved) ?? readLegacySearch(index, saved, readTrimmed(saved.query));
}

/**
 * The search a page saved in the current shape held, and the one it was
 * opened with, which needs no index to read; undefined for any other shape.
 */
function readCurrentSearch(state: unknown): { query: string; origin: string } | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined;
  }
  const saved = state as Record<string, unknown>;
  const query = readTrimmed(saved.query);
  return query !== undefined && typeof saved.origin === 'string'
    ? { query, origin: saved.origin.trim() }
    : undefined;
}

/** A saved field's text, trimmed; undefined when it is not text. */
function readTrimmed(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * A page saved before search pages: a tag, the tags added to it, and a
 * search typed after them, which held the tags too once they moved into
 * the box. Undefined when the tag is gone from the index, or when nothing
 * was saved to search for.
 */
function readLegacySearch(
  index: WorkspaceIndex,
  saved: Record<string, unknown>,
  query: string | undefined,
): { query: string; origin: string } | undefined {
  const tagKey = readTrimmed(saved.tagKey);
  const canonicalTagKey = tagKey
    ? resolveIndexedTagKey(index.tags, tagKey, readEntityNamespaceAliases())
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
  const legacy = query ?? readTrimmed(saved.refinement);
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
  /** What the page's checkboxes, tag renames and merges, and bulk edits write through. */
  readonly writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  readonly themePreview: ThemePreview;
  /** What the page's Export plans its results with. */
  readonly exports: ExportService;
  /** What a tag the page names may open. */
  readonly navigation: NavigationService;
}

/** One search page's search, and what it reads, draws with, and tells. */
interface SearchPanelOptions {
  /** The search the page opened with, which clearing its search goes back to. */
  originQuery: string;
  /** The search the page shows first. */
  queryText: string;
  indexer: SearchIndexer;
  preferences: SearchPreferences;
  extensionUri: vscode.Uri;
  activeSearch: ActiveSearch;
  host: SearchPanelHost;
}

/**
 * One search page: its webview, its search, and the search it opened with.
 *
 * The page is a `SearchPageController`, run by a `WebviewHost` of its own,
 * since there are as many pages as searches. It is attached to its panel
 * directly rather than through a `PanelAdapter`: a page is drawn as soon as
 * it is shown, and before the first scan it shows how far the scan has got.
 * This is what `SearchPanels` and the Related Notes sidebar know a page by.
 */
class SearchPanel implements SearchSource, vscode.Disposable {
  private readonly controller: SearchPageController;
  private readonly host: WebviewHost<SearchPageState, SearchPagePageToHost>;
  private readonly extensionUri: vscode.Uri;
  private readonly onDispose: () => void;
  private disposed = false;

  public constructor(options: SearchPanelOptions) {
    this.extensionUri = options.extensionUri;
    this.onDispose = () => options.host.onDispose();
    this.controller = new SearchPageController({
      originQuery: options.originQuery,
      queryText: options.queryText,
      indexer: options.indexer,
      preferences: options.preferences,
      activeSearch: options.activeSearch,
      source: this,
      writes: options.host.writes,
      exports: options.host.exports,
      navigation: options.host.navigation,
      openTag: (tagKey) => options.host.openTag(tagKey),
      extensionUri: options.extensionUri,
      setTitle: (title) => {
        const panel = this.panel;
        if (panel) {
          panel.title = title;
        }
      },
      onDidClose: () => this.dispose(),
    });
    this.host = new WebviewHost(this.controller, {
      indexer: options.indexer,
      themePreview: options.host.themePreview,
    });
  }

  public key(): string {
    return this.controller.key();
  }

  /** The search the page shows, as typed. */
  public searchText(): string {
    return this.controller.searchText();
  }

  /** Whether the page is about one tag the index no longer has. */
  public isForMissingTag(index: WorkspaceIndex): boolean {
    return this.controller.isForMissingTag(index);
  }

  /** Creates or reveals the page, then sends its state. */
  public show(): void {
    if (!this.panel) {
      const { retainContextWhenHidden, enableFindWidget } = this.controller.options;
      this.attachPanel(
        vscode.window.createWebviewPanel(
          'deckard.tagOverview',
          'Deckard Search',
          vscode.ViewColumn.Active,
          {
            enableScripts: true,
            retainContextWhenHidden,
            enableFindWidget,
            localResourceRoots: pageResourceRoots(this.extensionUri),
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
    this.host.refresh();
  }

  /** Sends the state again when the sidebar took or gave back Refine. */
  public refreshIfRefineMoved(): void {
    this.controller.refreshIfRefineMoved(this.host);
  }

  public getRefineState(): SearchRefineState | undefined {
    return this.controller.getRefineState();
  }

  public async applySearch(queryText: string): Promise<void> {
    await this.controller.applySearch(this.host, queryText);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.host.dispose();
    this.onDispose();
  }

  public renderHtml(): void {
    this.host.renderHtml();
  }

  /** The page's panel, while it is open. */
  private get panel(): vscode.WebviewPanel | undefined {
    const surface = this.host.surface;
    return surface instanceof PanelSurface ? surface.panel : undefined;
  }

  /**
   * Gives a new or restored panel its icon, its scripts and the folders it
   * may load from, and the page. A panel restored after a reload keeps the
   * options it was made with, so they are set here too.
   */
  private attachPanel(panel: vscode.WebviewPanel): void {
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'deckard.svg',
    );
    panel.webview.options = { enableScripts: true, localResourceRoots: pageResourceRoots(this.extensionUri) };
    this.host.attach(new PanelSurface(panel));
  }
}
