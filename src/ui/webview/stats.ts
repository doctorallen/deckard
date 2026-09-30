import * as vscode from 'vscode';
import { onDidChangePageChrome } from './components';
import { getDeckardTheme } from './themes';
import { ThemePreview } from './themePreview';

import { PreferencesStore } from '../../core/storage/preferences';
import { WorkspaceIndex } from '../../core/types';
import { measure } from '../../shared/timing';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { openResultAt, resolveSourceUri } from '../commands/navigation';
import { createMissingNotes, reportCreatedNotes } from '../commands/linkHealth';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';
import { findMissingLinkTargets } from '../../domain/index/backlinks';
import { createDeckardStatsSnapshot } from '../state/dashboardState';
import { parseStatsMessage } from './messages';
import { getStatsHtml } from './statsHtml';
import { followIndexing } from './indexingProgress';
import { onIndexUpdateInTurn, whenPublished } from '../../core/workspace/publishing';
import { panelPriority } from './panelPriority';

/** What the Stats page is built from. */
export interface StatsPanelOptions {
  indexer: WorkspaceIndexer<vscode.Uri>;
  preferences: PreferencesStore;
  extensionUri: vscode.Uri;
  onOpenTag: (tagKey: string) => void | Promise<void>;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
}

/**
 * Provides an overview of indexed content and recorded local views. Each
 * most-viewed row opens the tag overview or note entry it counts.
 */
export class StatsPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  /** Whether the index changed while the panel was hidden. */
  private isStale = false;

  private readonly indexer: WorkspaceIndexer<vscode.Uri>;
  private readonly preferences: PreferencesStore;
  private readonly extensionUri: vscode.Uri;
  private readonly onOpenTag: (tagKey: string) => void | Promise<void>;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  private readonly themePreview: ThemePreview;

  public constructor(options: StatsPanelOptions) {
    this.indexer = options.indexer;
    this.preferences = options.preferences;
    this.extensionUri = options.extensionUri;
    this.onOpenTag = options.onOpenTag;
    this.themePreview = options.themePreview;
    const { indexer, preferences } = options;
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Stats', priority: () => panelPriority(this.panel) },
        () => this.refresh(),
      ),
    );
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      onDidChangePageChrome(() => {
        this.renderHtml();
        this.refresh();
      }, this.themePreview),
    );
  }

  public async show(): Promise<void> {
    if (!this.panel) {
      this.createPanel();
    }

    this.panel?.reveal(vscode.ViewColumn.Active);
    await whenPublished(this.indexer);
    this.refresh();
  }

  public async restore(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }

    this.attachPanel(panel);
    await whenPublished(this.indexer);
    this.refresh();
  }

  public dispose(): void {
    this.disposePanelListeners();
    this.panel?.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      'deckard.stats',
      'Deckard Stats',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
      },
    );
    this.attachPanel(panel);
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
    this.panelDisposables = [
      followIndexing(this.indexer, (message) => void panel.webview.postMessage(message)),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
      panel.webview.onDidReceiveMessage((message: unknown) =>
        this.handleMessage(message),
      ),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
      }),
    ];
  }

  /**
   * Opens what a row names, if the index still has it: the page may hold a
   * snapshot from before a tag was renamed or a note was edited.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseStatsMessage(value);
    if (!message) {
      return;
    }

    const index = this.indexer.getSnapshot();
    if (message.type === 'openTag') {
      const tagKey = resolveIndexedTagKey(index.tags, message.tagKey);
      if (tagKey) {
        await this.onOpenTag(tagKey);
      }
      return;
    }

    // A total opens the notes and tasks it counted, so the page is a way in
    // rather than a list of numbers.
    if (message.type === 'openSearch') {
      await vscode.commands.executeCommand('deckard.search', message.query);
      return;
    }

    // A pair that looks alike is merged by the same command the tag list
    // uses, so the merge is confirmed, previewed, and undoable as usual.
    if (message.type === 'mergeTags') {
      const sourceKey = resolveIndexedTagKey(index.tags, message.sourceKey);
      const targetKey = resolveIndexedTagKey(index.tags, message.targetKey);
      if (sourceKey && targetKey && sourceKey !== targetKey) {
        await vscode.commands.executeCommand(
          'deckard.mergeTag',
          sourceKey,
          targetKey,
        );
      }
      return;
    }

    // The Tags totals open a tag, chosen from the tags they count.
    if (message.type === 'openTagList') {
      const tagKey = await pickStatsTag(index, message.namespaced, vscode.window, message);
      if (tagKey) {
        await this.onOpenTag(tagKey);
      }
      return;
    }

    // The Wiki links total opens the graph drawing only those links.
    if (message.type === 'openNotesGraph') {
      await vscode.commands.executeCommand('deckard.showNotesGraph', {
        onlyWrittenLinks: true,
      });
      return;
    }

    // A tag used once with no lookalike is merged into one the reader
    // chooses, by the command that asks for it.
    if (message.type === 'mergeTagInto') {
      const sourceKey = resolveIndexedTagKey(index.tags, message.sourceKey);
      if (sourceKey) {
        await vscode.commands.executeCommand('deckard.mergeTag', sourceKey);
      }
      return;
    }

    // The page is where staleness shows, so it is also where it is fixed.
    if (message.type === 'reindexWorkspace') {
      await vscode.commands.executeCommand('deckard.reindexWorkspace');
      return;
    }

    if (message.type === 'createMissingNotes') {
      await this.createMissingNotes(message.names);
      return;
    }

    const section = [...index.sections.values()].find(
      (candidate) =>
        candidate.filePath === message.filePath &&
        candidate.startLine === message.line,
    );
    if (section) {
      await openResultAt(section.filePath, section.startLine, message);
      await this.preferences.recordSectionAccess(section.id);
      return;
    }
    // A note listed whole, such as one nothing links to, opens without
    // counting as a view of one of its entries.
    if (index.files.has(message.filePath)) {
      await openResultAt(message.filePath, message.line, message);
    }
  }

  /**
   * Makes the notes links name and no note carries. The names are read
   * again from the index as it is now, so only a name still missing and
   * able to be a file name is made; each goes in the notes folder of the
   * workspace folder its first link is in. Creating every one is confirmed
   * first.
   */
  private async createMissingNotes(requested: readonly string[]): Promise<void> {
    const wanted = new Set(requested.map((name) => name.toLocaleLowerCase()));
    const missing = findMissingLinkTargets(this.indexer.getSnapshot()).filter(
      (target) =>
        getExtractedNoteFileName(target.name) !== undefined &&
        (wanted.size === 0 || wanted.has(target.key)),
    );
    if (missing.length === 0) {
      return;
    }
    if (wanted.size === 0) {
      const create = 'Create';
      const choice = await vscode.window.showWarningMessage(
        `Create ${missing.length} ${missing.length === 1 ? 'note' : 'notes'} for links that open no note?`,
        {
          modal: true,
          detail: 'Each is an empty note named as the links write it, in the notes folder.',
        },
        create,
      );
      if (choice !== create) {
        return;
      }
    }
    const byFolder = new Map<string, { uri: vscode.Uri; names: string[] }>();
    for (const target of missing) {
      const uri = await resolveSourceUri(target.sourcePaths[0]);
      if (!uri) {
        continue;
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? '';
      const group = byFolder.get(folder) ?? { uri, names: [] };
      group.names.push(target.name);
      byFolder.set(folder, group);
    }
    if (byFolder.size === 0) {
      return;
    }
    let created = 0;
    for (const group of byFolder.values()) {
      created += await createMissingNotes(this.indexer, group.uri, group.names, { report: false });
    }
    reportCreatedNotes(created);
  }

  private disposePanelListeners(): void {
    this.panelDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getStatsHtml(this.panel.webview, getDeckardTheme(this.themePreview));
    }
  }

  private refresh(): void {
    if (!this.panel) {
      return;
    }
    // A hidden page keeps what it shows and catches up when shown again.
    if (!this.panel.visible) {
      this.isStale = true;
      return;
    }

    this.isStale = false;
    void this.panel.webview.postMessage({
      type: 'state',
      data: measure('Stats', () =>
        createDeckardStatsSnapshot(
          this.indexer.getSnapshot(),
          this.preferences.value,
          this.indexer.getUnreadable(),
          // The moment the page is drawn at, which its trends end on.
          Date.now(),
        ),
      ),
    });
  }
}

/**
 * The tags a Tags total counts, as a quick pick: every tag, or only the
 * namespaced ones, most used first, each with how many entries carry it.
 * Returns the key chosen.
 */
export async function pickStatsTag(
  index: WorkspaceIndex,
  namespaced: boolean,
  window: Pick<typeof vscode.window, 'showQuickPick'> = vscode.window,
  band: { min?: number; max?: number } = {},
): Promise<string | undefined> {
  const items = listStatsTags(index, namespaced, band);
  const banded = band.min !== undefined;
  const choice = await window.showQuickPick(items, {
    title: banded ? describeBand(band) : namespaced ? 'Namespaced tags' : 'Tags',
    placeHolder: namespaced ? 'Choose a namespaced tag to open' : 'Choose a tag to open',
    matchOnDescription: true,
  });
  return choice?.tagKey;
}

/** The rows of that quick pick. */
export function listStatsTags(
  index: WorkspaceIndex,
  namespaced: boolean,
  band: { min?: number; max?: number } = {},
): (vscode.QuickPickItem & { tagKey: string })[] {
  const rows = namespaced
    ? [...index.entities.values()].map((entity) => ({ key: entity.key, label: entity.label, count: entity.count }))
    : [...index.tags.values()].map((tag) => ({ key: tag.key, label: tag.label, count: tag.count }));
  return rows
    .filter((row) => (band.min === undefined || row.count >= band.min) && (band.max === undefined || row.count <= band.max))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .map((row) => ({
      label: row.label,
      description: `${row.count} ${row.count === 1 ? 'entry' : 'entries'}`,
      tagKey: row.key,
    }));
}

/** A band of tag use, as a title: "Tags used 3–5 times". */
function describeBand(band: { min?: number; max?: number }): string {
  const { min = 1, max } = band;
  if (max === min) {
    return min === 1 ? 'Tags used once' : min === 2 ? 'Tags used twice' : `Tags used ${min} times`;
  }
  return max === undefined ? `Tags used ${min} or more times` : `Tags used ${min}–${max} times`;
}
