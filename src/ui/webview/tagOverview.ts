import * as vscode from 'vscode';

import { formatEntityTitle } from '../../core/markdown/parser';
import { getQueryTagIntersection } from '../../core/query/queryFormat';
import { parseQuery } from '../../core/query/queryParser';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { PreferencesStore } from '../../core/storage/preferences';
import {
  TagOverviewMessage,
  TagOverviewSnapshot,
  TagTitleDisplayMode,
  TaskFilter,
} from '../../core/types';
import {
  createQueryOverviewSnapshot,
  createQueryViewState,
  createTagOverviewSnapshot,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { createHubNote } from '../commands/hubNote';
import { openSourceAt } from '../commands/navigation';
import { renameIndexedTag } from '../commands/renameTag';
import { toggleTask } from '../commands/taskActions';
import { parseTagOverviewMessage } from './messages';
import { getTagOverviewHtml } from './tagOverviewHtml';

/**
 * Manages one reusable panel per tag and exposes the active tag to the sidebar.
 *
 * Panel identity is keyed by canonical tag key so links can switch context
 * without opening duplicate overview tabs.
 */
export class TagOverviewPanels implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panels = new Map<string, TagOverviewPanel>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private activeTagKey: string | undefined;
  private activeFilterTagKeys: string[] = [];
  private activeQueryText: string | undefined;
  private changeNotificationDepth = 0;
  private changeNotificationPending = false;

  public readonly onDidChange = this.changeEmitter.event;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.disposables.push(this.changeEmitter);
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.activeTagKey) {
          this.setActiveTagOverview(undefined, [], undefined);
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          this.panels.forEach((panel) => panel.renderHtml());
          this.refresh();
        }
        if (
          event.affectsConfiguration('deckard.tagTitleDisplayMode') ||
          event.affectsConfiguration('deckard.tagOverview.hubNoteExpanded')
        ) {
          this.refresh();
        }
        if (
          event.affectsConfiguration(
            'deckard.enableHeadingTagRelationships',
          )
        ) {
          this.refresh();
        }
      }),
    );
  }

  /**
   * Returns the tag whose overview currently drives the sidebar.
   */
  public getActiveTagKey(): string | undefined {
    return this.activeTagKey;
  }

  /**
   * Returns the optional relationship filter for the active overview.
   */
  public getActiveTagFilterKey(): string | undefined {
    return this.activeFilterTagKeys[0];
  }

  /**
   * Returns every relationship filter for the active overview.
   */
  public getActiveTagFilterKeys(): readonly string[] {
    return this.activeFilterTagKeys;
  }

  /**
   * Returns the advanced query driving the active overview, if any.
   */
  public getActiveQuery(): string | undefined {
    return this.activeQueryText;
  }

  /**
   * Records access only for current tags, then reveals the shared panel instance.
   */
  public async show(
    tagKey: string,
    filterTagKey?: string,
    filterTagKeys: readonly string[] = [],
  ): Promise<void> {
    this.changeNotificationDepth += 1;
    try {
      await this.indexer.ready;
      const index = this.indexer.getSnapshot();
      const canonicalTagKey = resolveIndexedTagKey(index.tags, tagKey);
      if (!canonicalTagKey) {
        void vscode.window.showWarningMessage(
          `Deckard could not find the tag: ${tagKey}`,
        );
        return;
      }
      const effectiveFilterTagKeys = resolveFilterTagKeys(
        index.tags,
        canonicalTagKey,
        filterTagKey,
        filterTagKeys,
      );
      await this.preferences.recordTagAccess(canonicalTagKey);
      if (index.entities.has(canonicalTagKey)) {
        await this.preferences.recordEntityAccess(canonicalTagKey);
      }

      let panel = this.panels.get(canonicalTagKey);
      if (!panel) {
        panel = this.createPanel(canonicalTagKey, canonicalTagKey);
      }
      panel.setFilterTagKeys(effectiveFilterTagKeys);
      panel.clearQuery();
      panel.show();
      this.setActiveTagOverview(canonicalTagKey, effectiveFilterTagKeys, undefined);
    } finally {
      this.changeNotificationDepth -= 1;
      if (
        this.changeNotificationDepth === 0 &&
        this.changeNotificationPending
      ) {
        this.changeNotificationPending = false;
        this.changeEmitter.fire();
      }
    }
  }

  /**
   * Opens a standalone query view.
   *
   * A query that is only an intersection of tags is handed to the ordinary tag
   * flow instead, so the familiar chip-based overview stays the page a user
   * lands on whenever it can express what they asked for.
   */
  public async showQuery(queryText: string): Promise<void> {
    const text = queryText.trim();
    if (!text) {
      return;
    }
    await this.indexer.ready;
    const index = this.indexer.getSnapshot();
    const intersection = resolveQueryIntersection(index.tags, text);
    if (intersection) {
      await this.show(intersection[0], undefined, intersection.slice(1));
      return;
    }

    const viewKey = `${QUERY_VIEW_PREFIX}${text}`;
    let panel = this.panels.get(viewKey);
    if (!panel) {
      panel = this.createPanel(viewKey, undefined);
    }
    panel.setQuery(text);
    panel.show();
    this.setActiveTagOverview(undefined, [], text);
  }

  /**
   * Restores a serialized panel only when its tag still exists in the index.
   */
  public async restore(
    webviewPanel: vscode.WebviewPanel,
    state: unknown,
  ): Promise<void> {
    await this.indexer.ready;
    const index = this.indexer.getSnapshot();
    const serializedTagKey = getSerializedTagKey(state);
    const serializedQuery = getSerializedQuery(state);
    const tagKey = serializedTagKey
      ? resolveIndexedTagKey(index.tags, serializedTagKey)
      : undefined;
    if (!tagKey) {
      // A standalone query view has no tag to validate, so it is restored from
      // its serialized query alone.
      if (serializedQuery) {
        webviewPanel.dispose();
        await this.showQuery(serializedQuery);
        return;
      }
      webviewPanel.dispose();
      return;
    }
    const filterTagKeys = resolveFilterTagKeys(
      index.tags,
      tagKey,
      getSerializedFilterTagKey(state),
      getSerializedFilterTagKeys(state),
    );

    const existingPanel = this.panels.get(tagKey);
    if (existingPanel) {
      webviewPanel.dispose();
      existingPanel.setFilterTagKeys(filterTagKeys);
      existingPanel.show();
      if (webviewPanel.active) {
        this.setActiveTagOverview(
          tagKey,
          existingPanel.getFilterTagKeys(),
          existingPanel.getQueryText(),
        );
      }
      return;
    }

    const panel = this.createPanel(tagKey, tagKey);
    panel.setFilterTagKeys(filterTagKeys);
    if (serializedQuery) {
      panel.setQuery(serializedQuery);
    }
    panel.restore(webviewPanel);
    if (webviewPanel.active) {
      this.setActiveTagOverview(
        tagKey,
        panel.getFilterTagKeys(),
        panel.getQueryText(),
      );
    }
  }

  /**
   * Releases the registry event source and every panel it owns.
   */
  public dispose(): void {
    this.setActiveTagOverview(undefined, [], undefined);
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    this.panels.forEach((panel) => panel.dispose());
    this.panels.clear();
  }

  /**
   * Refreshes surviving panels and removes overviews for deleted tags.
   */
  private refresh(): void {
    const index = this.indexer.getSnapshot();
    this.panels.forEach((panel, viewKey) => {
      const tagKey = panel.getTagKey();
      // A standalone query view survives index changes; a tag view closes with
      // the tag that named it.
      if (!tagKey || index.tags.has(tagKey)) {
        panel.normalizeFilterTagKeys();
        panel.refresh();
        if (tagKey && this.activeTagKey === tagKey) {
          this.setActiveTagOverview(
            tagKey,
            panel.getFilterTagKeys(),
            panel.getQueryText(),
          );
        }
      } else {
        panel.dispose();
        this.removePanel(viewKey, tagKey);
      }
    });
    this.notifyChange();
  }

  /**
   * Creates the private panel with callbacks back into the panel registry.
   */
  private createPanel(
    viewKey: string,
    tagKey: string | undefined,
  ): TagOverviewPanel {
    const panel: TagOverviewPanel = new TagOverviewPanel(
      tagKey,
      this.indexer,
      this.preferences,
      this.extensionUri,
      () => this.removePanel(viewKey, tagKey),
      (nextTagKey, filterTagKey, filterTagKeys) =>
        this.show(nextTagKey, filterTagKey, filterTagKeys),
      (queryText) => this.handleQueryChanged(panel, tagKey, queryText),
      (active) => this.handlePanelActivity(tagKey, active),
    );
    this.panels.set(viewKey, panel);
    return panel;
  }

  /**
   * Follows a standalone query view when its query changes.
   *
   * The panel keeps editing in place; only the key it is registered under
   * moves, so reopening the same query finds this panel instead of a second
   * one.
   */
  /**
   * Keeps the sidebar and the registry in step with a panel's query.
   *
   * The sidebar projects whatever the active overview is showing, so a query
   * applied in the page has to reach it the same way a tag does.
   */
  private handleQueryChanged(
    panel: TagOverviewPanel,
    tagKey: string | undefined,
    queryText: string | undefined,
  ): void {
    if (!tagKey) {
      this.rekeyQueryPanel(panel, queryText ?? '');
    }
    this.setActiveTagOverview(
      tagKey,
      panel.getFilterTagKeys(),
      queryText,
    );
  }

  private rekeyQueryPanel(panel: TagOverviewPanel, queryText: string): void {
    const nextKey = `${QUERY_VIEW_PREFIX}${queryText.trim()}`;
    if (this.panels.get(nextKey) === panel) {
      return;
    }
    this.forgetPanel(panel);
    this.panels.set(nextKey, panel);
  }

  /**
   * Removes registry state when a panel closes or its tag disappears.
   */
  private removePanel(viewKey: string, tagKey: string | undefined): void {
    const panel = this.panels.get(viewKey);
    if (panel) {
      // A query panel may have been re-keyed since it was created, so it is
      // removed by identity rather than by the key it started with.
      this.forgetPanel(panel);
    } else {
      this.panels.delete(viewKey);
    }
    if (tagKey && this.activeTagKey === tagKey) {
      this.setActiveTagOverview(undefined, [], undefined);
    }
  }

  private forgetPanel(panel: TagOverviewPanel): void {
    [...this.panels.entries()].forEach(([key, candidate]) => {
      if (candidate === panel) {
        this.panels.delete(key);
      }
    });
  }

  /**
   * Keeps sidebar state aligned with which overview is visibly active.
   */
  private handlePanelActivity(
    tagKey: string | undefined,
    active: boolean,
  ): void {
    const panel = this.findPanel(tagKey);
    if (active) {
      this.setActiveTagOverview(
        tagKey,
        panel?.getFilterTagKeys() ?? [],
        panel?.getQueryText(),
      );
    } else if (this.activeTagKey === tagKey) {
      this.setActiveTagOverview(undefined, [], undefined);
    }
  }

  /** Finds the panel showing a given focus tag, or the query-only panel. */
  private findPanel(tagKey: string | undefined): TagOverviewPanel | undefined {
    for (const panel of this.panels.values()) {
      if (panel.getTagKey() === tagKey) {
        return panel;
      }
    }
    return undefined;
  }

  /**
   * Emits only meaningful active-overview transitions to avoid sidebar churn.
   */
  private setActiveTagOverview(
    tagKey: string | undefined,
    filterTagKeys: readonly string[],
    queryText: string | undefined,
  ): void {
    if (
      this.activeTagKey === tagKey &&
      this.activeQueryText === queryText &&
      areTagKeyListsEqual(this.activeFilterTagKeys, filterTagKeys)
    ) {
      return;
    }
    this.activeTagKey = tagKey;
    this.activeFilterTagKeys = [...filterTagKeys];
    this.activeQueryText = queryText;
    this.notifyChange();
  }

  private notifyChange(): void {
    if (this.changeNotificationDepth > 0) {
      this.changeNotificationPending = true;
      return;
    }
    this.changeEmitter.fire();
  }
}

/**
 * Owns the webview mechanics for one canonical tag overview.
 */
class TagOverviewPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private taskFilter: TaskFilter = 'active';
  private filterTagKeys: string[] = [];
  /** Set only while an advanced query is overriding the tag intersection. */
  private queryText: string | undefined;
  /**
   * Query text that does not parse.
   *
   * It is kept separate from the applied query so the bar can show what the
   * author typed, and its errors, while the page keeps showing the results of
   * the last query that did parse.
   */
  private invalidQueryText: string | undefined;

  public constructor(
    private readonly tagKey: string | undefined,
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly extensionUri: vscode.Uri,
    private readonly onDispose: () => void,
    private readonly onOpenTag: (
      tagKey: string,
      filterTagKey?: string,
      filterTagKeys?: readonly string[],
    ) => Promise<void>,
    private readonly onQueryChanged: (queryText: string | undefined) => void,
    private readonly onViewStateChange: (active: boolean) => void,
  ) {}

  public getTagKey(): string | undefined {
    return this.tagKey;
  }

  public setFilterTagKeys(filterTagKeys: readonly string[]): void {
    this.filterTagKeys = [...filterTagKeys];
  }

  public getFilterTagKeys(): readonly string[] {
    return this.filterTagKeys;
  }

  public setQuery(queryText: string): void {
    this.queryText = queryText.trim() || undefined;
  }

  public getQueryText(): string | undefined {
    return this.queryText;
  }

  public clearQuery(): void {
    this.queryText = undefined;
  }

  /**
   * Drops filters deleted by an index refresh before projecting state again.
   */
  public normalizeFilterTagKeys(): void {
    if (!this.tagKey) {
      return;
    }
    this.filterTagKeys = resolveFilterTagKeys(
      this.indexer.getSnapshot().tags,
      this.tagKey,
      undefined,
      this.filterTagKeys,
    );
  }

  /**
   * Creates or reveals the panel, then projects the latest overview state.
   */
  public show(): void {
    if (!this.panel) {
      const title = this.tagKey
        ? `${getOverviewTitle(this.indexer.getSnapshot(), this.tagKey)} Overview`
        : 'Deckard Search';
      const panel = vscode.window.createWebviewPanel(
        'deckard.tagOverview',
        title,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          enableFindWidget: true,
        },
      );
      this.attachPanel(panel);
    }

    function getOverviewTitle(
      index: ReturnType<WorkspaceIndexer['getSnapshot']>,
      tagKey: string,
    ): string {
      const entity = index.entities.get(tagKey);
      if (entity) {
        return formatEntityTitle(entity.kind, entity.name);
      }
      return `${index.tags.get(tagKey)?.label ?? tagKey} Overview`;
    }

    this.panel?.reveal(vscode.ViewColumn.Active);
    this.refresh();
  }

  /**
   * Reuses a serialized panel after the registry has validated its tag key.
   */
  public restore(panel: vscode.WebviewPanel): void {
    if (this.panel) {
      panel.dispose();
      return;
    }

    this.attachPanel(panel);
    this.refresh();
  }

  /**
   * Sends the current tag snapshot without retaining mutable UI state locally.
   */
  public refresh(): void {
    if (!this.panel) {
      return;
    }

    const snapshot = this.createSnapshot();
    if (snapshot) {
      void this.panel.webview.postMessage({ type: 'state', data: snapshot });
    }
  }

  /**
   * Projects the view, preferring the original tag path whenever the page is
   * still showing a plain tag intersection.
   *
   * Keeping that path untouched means every overview the extension could
   * already produce — including association-scoped results — behaves exactly
   * as it did before advanced queries existed.
   */
  private createSnapshot(): TagOverviewSnapshot | undefined {
    const snapshot = this.createResultsSnapshot();
    if (!snapshot || this.invalidQueryText === undefined) {
      return snapshot;
    }
    // The results come from the last query that parsed; only the editor shows
    // the text that did not.
    return {
      ...snapshot,
      query: createQueryViewState(
        this.indexer.getSnapshot(),
        parseQuery(this.invalidQueryText),
        snapshot.query?.matchCounts ?? { notes: 0, tasks: 0 },
        snapshot.query?.isAdvanced ?? true,
      ),
    };
  }

  private createResultsSnapshot(): TagOverviewSnapshot | undefined {
    if (this.queryText) {
      return createQueryOverviewSnapshot(
        this.indexer.getSnapshot(),
        this.preferences.value,
        this.queryText,
        this.taskFilter,
        this.getTagTitleDisplayMode(),
        this.areHeadingTagRelationshipsEnabled(),
        this.tagKey,
      );
    }
    if (!this.tagKey) {
      return undefined;
    }
    const snapshot = createTagOverviewSnapshot(
      this.indexer.getSnapshot(),
      this.preferences.value,
      this.tagKey,
      this.taskFilter,
      this.getTagTitleDisplayMode(),
      this.areHeadingTagRelationshipsEnabled(),
      this.filterTagKeys[0],
      this.filterTagKeys,
    );
    return snapshot?.hub
      ? {
          ...snapshot,
          hub: { ...snapshot.hub, expanded: this.isHubNoteExpanded() },
        }
      : snapshot;
  }

  private isHubNoteExpanded(): boolean {
    return vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('tagOverview.hubNoteExpanded', true);
  }

  /**
   * Releases webview listeners and the panel itself.
   */
  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    this.panel?.dispose();
    this.panel = undefined;
  }

  /**
   * Installs HTML, lifecycle listeners, and the message boundary for the panel.
   */
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
        this.onDispose();
        this.dispose();
      }),
    );
    this.disposables.push(
      panel.onDidChangeViewState(() => this.onViewStateChange(panel.active)),
    );
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    );
    this.onViewStateChange(panel.active);
  }

  public renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getTagOverviewHtml(this.panel.webview);
    }
  }

  private getTagTitleDisplayMode(): TagTitleDisplayMode {
    return normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
  }

  private areHeadingTagRelationshipsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('enableHeadingTagRelationships', true);
  }

  /**
   * Validates raw webview input before dispatching any overview action.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseTagOverviewMessage(value);
    if (!message) {
      return;
    }

    await this.handleValidMessage(message);
  }

  /**
   * Rechecks tag/card membership against the current index before navigation.
   */
  private async handleValidMessage(message: TagOverviewMessage): Promise<void> {
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

    if (message.type === 'openTag') {
      const tagKey = resolveIndexedTagKey(
        this.indexer.getSnapshot().tags,
        message.tagKey,
      );
      if (tagKey) {
        await this.onOpenTag(
          tagKey,
          message.filterTagKey,
          message.filterTagKeys,
        );
      }
      return;
    }

    if (message.type === 'setRenderMode') {
      await this.preferences.setRenderMode(message.mode);
      return;
    }
    if (message.type === 'setTaskFilter') {
      this.taskFilter = message.filter;
      this.refresh();
      return;
    }
    if (message.type === 'setTagOverviewSort') {
      await this.preferences.setTagOverviewSortMode(message.mode);
      return;
    }
    if (message.type === 'setTagOverviewLayout') {
      await this.preferences.setTagOverviewLayout(message.layout);
      return;
    }
    if (message.type === 'saveTagOverviewFilter') {
      await this.saveCurrentFilter();
      return;
    }
    if (message.type === 'createHubNote') {
      if (this.tagKey) {
        await createHubNote(this.indexer, this.tagKey);
      }
      return;
    }
    if (message.type === 'setOverviewQuery') {
      await this.applyQuery(message.query);
      return;
    }
    if (message.type === 'clearOverviewQuery') {
      const hadError = this.invalidQueryText !== undefined;
      this.invalidQueryText = undefined;
      if (!this.queryText) {
        if (hadError) {
          this.refresh();
        }
        return;
      }
      if (this.tagKey) {
        this.queryText = undefined;
        this.onQueryChanged(undefined);
        this.refresh();
        return;
      }
      // A standalone query view has nothing to fall back to.
      this.panel?.dispose();
      return;
    }
    if (message.type === 'toggleTask') {
      const task = this.createSnapshot()?.tasks.find(
        (candidate) => candidate.task.id === message.taskId,
      )?.task;
      if (task) {
        await toggleTask(task, message.completed);
      }
      return;
    }
    if (message.type !== 'openSource') {
      return;
    }

    const snapshot = this.createSnapshot();
    const hub = snapshot?.hub;
    if (
      hub &&
      (message.filePath === hub.filePath ||
        hub.otherFilePaths.includes(message.filePath))
    ) {
      await openSourceAt(message.filePath, message.line);
      return;
    }
    const card = snapshot?.sections.find(
      (section) =>
        section.filePath === message.filePath &&
        section.startLine === message.line,
    );
    if (card) {
      await this.preferences.recordSectionAccess(card.id);
      await openSourceAt(card.filePath, card.startLine);
      return;
    }
    const task = snapshot?.tasks.find(
      (candidate) =>
        candidate.task.filePath === message.filePath &&
        candidate.task.lineNumber === message.line,
    );
    if (task) {
      await openSourceAt(task.task.filePath, task.task.lineNumber);
    }
  }

  /**
   * Applies a query typed in the bar or assembled in the builder.
   *
   * A query that reduces to a plain tag intersection is routed back through
   * the ordinary tag flow, so the page a user ends up on is always the
   * simplest one that can express what they asked for.
   */
  private async applyQuery(queryText: string): Promise<void> {
    const text = queryText.trim();
    if (!text) {
      this.invalidQueryText = undefined;
      if (this.tagKey) {
        this.queryText = undefined;
        this.refresh();
      }
      return;
    }

    if (parseQuery(text).node === undefined) {
      // Report the problem without emptying the page underneath it.
      this.invalidQueryText = text;
      this.refresh();
      return;
    }
    this.invalidQueryText = undefined;

    // Editing a query never moves the author to a different panel. Opening a
    // second overview would reset the editing surface they are working in,
    // and a refresh of this panel would then discard their in-progress row.
    const intersection = resolveQueryIntersection(
      this.indexer.getSnapshot().tags,
      text,
    );
    if (intersection && this.tagKey && intersection[0] === this.tagKey) {
      // Still a refinement of the tag this page was opened on, so the page
      // returns to its ordinary chips without changing identity.
      this.queryText = undefined;
      this.setFilterTagKeys(intersection.slice(1));
      this.onQueryChanged(undefined);
      this.refresh();
      return;
    }

    this.queryText = text;
    // The registry publishes the active overview to the sidebar, and a
    // standalone query view is identified by its query, so both need telling.
    this.onQueryChanged(text);
    this.refresh();
  }

  /**
   * Names the current host-owned view without trusting webview data.
   */
  private async saveCurrentFilter(): Promise<void> {
    const index = this.indexer.getSnapshot();
    if (this.queryText) {
      const name = await vscode.window.showInputBox({
        title: 'Save Deckard filter',
        prompt: 'Name this query',
        value: this.queryText,
        validateInput: (value) =>
          value.trim() ? undefined : 'A saved filter needs a name.',
      });
      if (name === undefined) {
        return;
      }
      const savedQuery = await this.preferences.saveSavedQueryFilter(
        name,
        this.queryText,
      );
      if (savedQuery) {
        void vscode.window.showInformationMessage(
          `Saved Deckard filter: ${savedQuery.name}`,
        );
      }
      return;
    }

    const tagKeys = [this.tagKey, ...this.filterTagKeys].filter(
      (tagKey): tagKey is string =>
        tagKey !== undefined && index.tags.has(tagKey),
    );
    if (new Set(tagKeys).size < 2) {
      return;
    }
    const defaultName = tagKeys
      .map((tagKey) => index.tags.get(tagKey)?.label ?? tagKey)
      .join(' + ');
    const name = await vscode.window.showInputBox({
      title: 'Save Deckard filter',
      prompt: 'Name this tag filter',
      value: defaultName,
      validateInput: (value) =>
        value.trim() ? undefined : 'A saved filter needs a name.',
    });
    if (name === undefined) {
      return;
    }

    const savedFilter = await this.preferences.saveSavedFilter(name, tagKeys);
    if (savedFilter) {
      void vscode.window.showInformationMessage(
        `Saved Deckard filter: ${savedFilter.name}`,
      );
    }
  }
}

/** Distinguishes a standalone query view from a tag-keyed overview. */
const QUERY_VIEW_PREFIX = 'dql:';

/**
 * Returns the canonical tag keys of a query that is only an intersection of
 * tags that all exist in the index.
 */
function resolveQueryIntersection(
  tags: ReadonlyMap<string, unknown>,
  queryText: string,
): string[] | undefined {
  const parsed = parseQuery(queryText);
  if (!parsed.node) {
    return undefined;
  }
  const intersection = getQueryTagIntersection(parsed.node);
  if (!intersection || intersection.length === 0) {
    return undefined;
  }

  const resolved: string[] = [];
  for (const tagKey of intersection) {
    const canonical = resolveIndexedTagKey(tags, tagKey);
    if (!canonical) {
      return undefined;
    }
    if (!resolved.includes(canonical)) {
      resolved.push(canonical);
    }
  }
  return resolved;
}

 /**
  * Extracts the serialized tag key while rejecting malformed serializer state.
 */
function getSerializedTagKey(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined;
  }

  const tagKey = (state as { tagKey?: unknown }).tagKey;
  return typeof tagKey === 'string' && tagKey.length > 0 ? tagKey : undefined;
}

/**
 * Extracts a serialized advanced query, ignoring malformed serializer state.
 */
function getSerializedQuery(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined;
  }

  const query = (state as { query?: unknown }).query;
  return typeof query === 'string' && query.trim().length > 0
    ? query.trim()
    : undefined;
}

function getSerializedFilterTagKey(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined;
  }

  const filterTagKey = (state as { filterTagKey?: unknown }).filterTagKey;
  return typeof filterTagKey === 'string' && filterTagKey.length > 0
    ? filterTagKey
    : undefined;
}

/**
 * Extracts modern serialized filters only when every persisted value is safe.
 */
function getSerializedFilterTagKeys(state: unknown): string[] {
  if (typeof state !== 'object' || state === null) {
    return [];
  }

  const filterTagKeys = (state as { filterTagKeys?: unknown }).filterTagKeys;
  return Array.isArray(filterTagKeys) &&
    filterTagKeys.every(
      (filterTagKey) =>
        typeof filterTagKey === 'string' && filterTagKey.length > 0,
    )
    ? filterTagKeys
    : [];
}

/**
 * Resolves and deduplicates current plus legacy filter state against the index.
 */
function resolveFilterTagKeys(
  tags: ReturnType<WorkspaceIndexer['getSnapshot']>['tags'],
  focusTagKey: string,
  filterTagKey: string | undefined,
  filterTagKeys: readonly string[],
): string[] {
  const seen = new Set<string>();
  const focusLabel = tags.get(focusTagKey)?.label;
  return [...filterTagKeys, ...(filterTagKey ? [filterTagKey] : [])]
    .map((filterKey) => resolveIndexedTagKey(tags, filterKey))
    .filter(
      (filterKey): filterKey is string =>
        filterKey !== undefined &&
        filterKey !== focusTagKey &&
        tags.get(filterKey)?.label !== focusLabel &&
        !seen.has(filterKey) &&
        (seen.add(filterKey), true),
    );
}

function areTagKeyListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tagKey, index) => tagKey === right[index])
  );
}
