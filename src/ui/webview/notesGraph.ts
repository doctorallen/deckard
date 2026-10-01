import * as vscode from 'vscode';

import {
  findDailyNoteDate,
  isPeriodicNoteFile,
  isPeriodicNotePath,
} from '../../domain/markdown/parser';
import { onDidChangePageChrome } from './components';
import { getDeckardTheme } from './themes';
import { ThemePreview } from './themePreview';

import {
  NotesGraphMessage,
  NotesGraphNode,
  NotesGraphSnapshot,
  SidebarGraphContext,
  WorkspaceIndex,
} from '../../core/types';
import { logTrace, measure } from '../../shared/timing';
import { noteTitle } from '../../domain/index/backlinks';
import type { IndexReader, IndexUpdates } from '../../core/workspace/indexReader';
import { openResultAt, openSourceAt } from '../commands/navigation';
import {
  createLocalGraphSnapshot,
  createNotesGraphConnections,
  createNotesGraphSnapshot,
  findNoteNodeIds,
  graphInputsChanged,
  MAXIMUM_LOCAL_GRAPH_DEPTH,
  NotesGraphKinds,
  toWire,
} from '../state/notesGraphState';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { parseNotesGraphMessage } from './messages';
import { getNotesGraphHtml } from './notesGraphHtml';
import { onIndexUpdateInTurn, whenPublished } from '../../core/workspace/publishing';
import { panelPriority } from './panelPriority';

/** What the Notes Graph can be opened showing. */
export interface NotesGraphShowOptions {
  /** Turn on Only links I wrote. */
  onlyWrittenLinks?: boolean;
}

/**
 * The options `deckard.showNotesGraph` was run with, keeping only what it
 * understands: a command can be run from anywhere with anything.
 */
export function readNotesGraphOptions(value: unknown): NotesGraphShowOptions {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const onlyWrittenLinks = (value as { onlyWrittenLinks?: unknown }).onlyWrittenLinks;
  return onlyWrittenLinks === true ? { onlyWrittenLinks: true } : {};
}

/**
 * Owns the workspace-wide Notes Graph panel and validates navigation requests
 * against the current index before opening editors or tag overviews.
 */
export class NotesGraphPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private selectedNodeId: string | undefined;
  private snapshot: NotesGraphSnapshot | undefined;
  /** The index the whole-workspace snapshot was drawn from. */
  private builtFrom: WorkspaceIndex | undefined;
  /** The kinds of node the page shows, which are all it is sent. */
  private kinds: NotesGraphKinds = { notes: true, tasks: true };
  /** Whether the index changed while the panel was hidden. */
  private isStale = false;
  /**
   * Whether the graph is drawn around one note, and how far out it reaches.
   *
   * The whole workspace says what the workspace looks like; a neighborhood
   * says what one note is attached to, which is the question asked with a
   * note open.
   */
  private scope: { local: boolean; depth: number; skipPeriodic: boolean } = {
    local: false,
    depth: 1,
    skipPeriodic: true,
  };
  /** Whether the reader has chosen a scope, which the opening default respects. */
  private scopeChosen = false;
  /**
   * The note the graph is drawn around: the one last open in an editor. The
   * graph is itself an editor tab, so the note it is about has to be
   * remembered rather than read from whatever is active now.
   */
  private focusPath: string | undefined;

  public constructor(
    private readonly indexer: IndexReader & IndexUpdates,
    private readonly extensionUri: vscode.Uri,
    private readonly onGraphContext: (
      context: SidebarGraphContext | undefined,
      reveal?: boolean,
    ) => void | Promise<void>,
    /** The theme Choose Theme… is previewing, which the page draws in. */
    private readonly themePreview: ThemePreview,
  ) {
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Notes Graph', priority: () => panelPriority(this.panel) },
        () => {
          const index = this.indexer.getSnapshot();
          // A save that changes nothing the graph draws costs it nothing:
          // no rebuild, no message, and a hidden graph is not out of date.
          if (this.snapshot && !graphInputsChanged(this.builtFrom, index)) {
            this.builtFrom = index;
            logTrace(() => 'Notes Graph unchanged by this update; not redrawn.');
            return;
          }
          this.snapshot = undefined;
          this.builtFrom = undefined;
          this.refresh();
        },
      ),
    );
    this.disposables.push(
      onDidChangePageChrome(() => {
        this.renderHtml();
        this.refresh();
      }, this.themePreview),
    );
    this.rememberNote(vscode.window.activeTextEditor);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) =>
        this.rememberNote(editor),
      ),
    );
  }

  public async show(options: NotesGraphShowOptions = {}): Promise<void> {
    if (!this.panel) {
      this.applyOpeningScope();
      this.createPanel();
    }

    this.panel?.reveal(vscode.ViewColumn.Active);
    await whenPublished(this.indexer);
    this.refresh();
    // After the graph itself, so the page has something to filter.
    if (options.onlyWrittenLinks) {
      void this.panel?.webview.postMessage({
        type: 'applyFilters',
        onlyWrittenLinks: true,
      });
    }
  }

  /**
   * Opens the graph around one note, one hop out, from that note's own
   * menu. It is not the reader choosing a scope, so the graph's next plain
   * opening keeps its own default.
   */
  public async showAround(filePath: string): Promise<void> {
    this.focusPath = filePath;
    this.scope = aroundNoteScope(this.scope);
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

  public highlightNode(nodeId?: string): void {
    const node = nodeId ? this.getNode(nodeId) : undefined;
    void this.panel?.webview.postMessage({
      type: 'highlightNode',
      nodeId: node?.id,
    });
  }

  public async activateNode(
    nodeId: string,
    open: boolean,
    revealConnections = false,
  ): Promise<void> {
    const node = this.getNode(nodeId);
    if (!node) {
      return;
    }
    if (open) {
      await this.openNode(node);
      return;
    }

    this.panel?.reveal(vscode.ViewColumn.Active, true);
    this.selectedNodeId = node.id;
    void this.panel?.webview.postMessage({
      type: 'selectNode',
      nodeId: node.id,
    });
    await this.publishGraphContext(revealConnections);
  }

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      'deckard.notesGraph',
      'Deckard Notes Graph',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.attachPanel(panel);
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'notes-graph.svg',
    );
    panel.webview.options = { enableScripts: true };
    this.renderHtml();
    this.panelDisposables = [
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.selectedNodeId = undefined;
        void this.onGraphContext(undefined);
        this.disposePanelListeners();
      }),
      panel.onDidChangeViewState((event) => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
        if (event.webviewPanel.active) {
          void this.publishGraphContext(false);
        } else {
          void this.onGraphContext(undefined);
        }
      }),
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    ];
  }

  private disposePanelListeners(): void {
    this.panelDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getNotesGraphHtml(this.panel.webview, getDeckardTheme(this.themePreview));
    }
  }

  /**
   * The graph opens around the note being written, one hop out, when there
   * is one: a whole workspace at once is hundreds of unlabeled dots, an
   * overview of density and nothing else, and the reader came from a note.
   * The full graph is the checkbox away, and a scope the reader has chosen
   * is kept.
   */
  private applyOpeningScope(): void {
    this.scope = {
      ...openingScope(this.focusPath, this.scopeChosen, this.scope),
      skipPeriodic: this.scope.skipPeriodic,
    };
  }

  /** Follows the note being written, so a local graph follows it too. */
  private rememberNote(editor: vscode.TextEditor | undefined): void {
    const uri = editor?.document.uri;
    if (!uri || !isMarkdownFile(uri) || !this.indexer.isNotesFile(uri)) {
      return;
    }
    const filePath = this.indexer.getFilePath(uri);
    if (filePath === this.focusPath) {
      return;
    }
    this.focusPath = filePath;
    if (this.scope.local) {
      this.refresh();
    }
  }

  private refresh(): void {
    if (!this.panel) {
      return;
    }
    // A hidden graph keeps its layout and catches up when shown again.
    if (!this.panel.visible) {
      this.isStale = true;
      return;
    }

    this.isStale = false;
    const snapshot = measure(
      'Notes Graph',
      () => this.getSnapshot(),
      (graph) => `${graph.nodes.length} nodes`,
    );
    if (
      this.selectedNodeId &&
      !snapshot.nodes.some((node) => node.id === this.selectedNodeId)
    ) {
      this.selectedNodeId = undefined;
    }
    void this.panel.webview.postMessage({
      type: 'state',
      data: toWire(snapshot, this.kinds),
    });
    if (this.selectedNodeId) {
      void this.panel.webview.postMessage({
        type: 'selectNode',
        nodeId: this.selectedNodeId,
      });
    }
    if (this.panel.active) {
      void this.publishGraphContext(false);
    }
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseNotesGraphMessage(value);
    if (message) {
      await this.handleValidMessage(message);
    }
  }

  private async handleValidMessage(message: NotesGraphMessage): Promise<void> {
    const index = this.indexer.getSnapshot();

    if (message.type === 'openTag') {
      if (index.tags.has(message.tagKey)) {
        await vscode.commands.executeCommand(
          'deckard.showTagOverview',
          message.tagKey,
        );
      }
      return;
    }

    if (message.type === 'selectNode') {
      await this.activateNode(message.nodeId, false, true);
      return;
    }

    if (message.type === 'clearSelection') {
      this.selectedNodeId = undefined;
      await this.publishGraphContext(false);
      return;
    }

    if (message.type === 'setGraphFilter') {
      // Not a choice of scope: the opening scope rule is untouched.
      const kinds = { notes: message.showNotes, tasks: message.showTasks };
      if (kinds.notes !== this.kinds.notes || kinds.tasks !== this.kinds.tasks) {
        this.kinds = kinds;
        this.refresh();
      }
      return;
    }

    if (message.type === 'setGraphScope') {
      this.scopeChosen = true;
      this.scope = {
        skipPeriodic: message.skipPeriodic ?? this.scope.skipPeriodic,
        local: message.local,
        depth: Math.max(
          1,
          Math.min(MAXIMUM_LOCAL_GRAPH_DEPTH, message.depth),
        ),
      };
      this.refresh();
      return;
    }

    if (this.isKnownSourceLocation(message.filePath, message.line)) {
      await openResultAt(message.filePath, message.line, message);
    }
  }

  private getNode(nodeId: string): NotesGraphNode | undefined {
    return this.getSnapshot().nodes.find((node) => node.id === nodeId);
  }

  private async publishGraphContext(reveal: boolean): Promise<void> {
    if (!this.panel?.active) {
      return;
    }
    const snapshot = this.getSnapshot();
    const selectedNode = this.selectedNodeId
      ? snapshot.nodes.find((node) => node.id === this.selectedNodeId)
      : undefined;
    await this.onGraphContext(
      {
        selectedNode,
        connections: selectedNode
          ? createNotesGraphConnections(snapshot, selectedNode.id)
          : [],
      },
      reveal,
    );
  }

  private async openNode(node: NotesGraphNode): Promise<void> {
    if (node.kind === 'tag') {
      await vscode.commands.executeCommand(
        'deckard.showTagOverview',
        node.id.slice(4),
      );
      return;
    }
    if (
      node.filePath &&
      node.line !== undefined &&
      this.isKnownSourceLocation(node.filePath, node.line)
    ) {
      await openSourceAt(node.filePath, node.line);
    }
  }

  /**
   * The graph as the page should draw it: the whole workspace, or the
   * neighborhood of the note in the editor.
   *
   * The narrowing happens here rather than in the page, so a local graph
   * sends only the nodes it holds — a screenful, whatever the workspace
   * holds — instead of everything and a rule for hiding most of it.
   */
  private getSnapshot(): NotesGraphSnapshot {
    const workspace = this.getWorkspaceSnapshot();
    const focus = {
      local: this.scope.local,
      depth: this.scope.depth,
      skipPeriodic: this.scope.skipPeriodic,
      workspaceNodeCount: workspace.nodes.length,
      ...(this.focusPath
        ? { filePath: this.focusPath, title: noteTitle(this.focusPath) }
        : {}),
    };
    if (!this.scope.local || !this.focusPath) {
      return { ...workspace, focus };
    }
    return {
      ...createLocalGraphSnapshot(
        workspace,
        findNoteNodeIds(workspace, this.focusPath),
        this.scope.depth,
        this.scope.skipPeriodic
          ? (node: NotesGraphNode) => isPeriodicNode(node, this.indexer.getSnapshot())
          : undefined,
      ),
      focus,
    };
  }

  private getWorkspaceSnapshot(): NotesGraphSnapshot {
    const index = this.indexer.getSnapshot();
    if (!this.snapshot || graphInputsChanged(this.builtFrom, index)) {
      this.snapshot = createNotesGraphSnapshot(index);
    }
    this.builtFrom = index;
    return this.snapshot;
  }

  private isKnownSourceLocation(filePath: string, line: number): boolean {
    const index = this.indexer.getSnapshot();
    for (const task of index.tasks.values()) {
      if (task.filePath === filePath && task.lineNumber === line) {
        return true;
      }
    }
    for (const section of index.sections.values()) {
      if (section.filePath === filePath && section.startLine === line) {
        return true;
      }
    }
    const file = index.files.get(filePath);
    return Boolean(
      file &&
        file.sections.length === 0 &&
        (file.frontmatterTags.length > 0 || file.links.length > 0) &&
        line === 1,
    );
  }
}

/** The scope of a graph drawn around one note: that note, one hop out. */
export function aroundNoteScope<Scope extends { local: boolean; depth: number }>(
  current: Scope,
): Scope {
  return { ...current, local: true, depth: 1 };
}

/**
 * The scope a graph opens with: around the note in the editor when there is
 * one and the reader has not chosen otherwise, else what was chosen or the
 * whole workspace.
 */
export function openingScope(
  focusPath: string | undefined,
  chosen: boolean,
  current: { local: boolean; depth: number },
): { local: boolean; depth: number } {
  if (chosen || !focusPath) {
    return current;
  }
  return { local: true, depth: 1 };
}

/**
 * A daily, weekly, or monthly note's own entries, which a local graph passes
 * through rather than draws. The tasks written in them are still drawn.
 */
function isPeriodicNode(node: NotesGraphNode, index: WorkspaceIndex): boolean {
  if (node.kind === 'task' || node.kind === 'tag' || node.filePath === undefined) {
    return false;
  }
  const file = index.files.get(node.filePath);
  return file
    ? isPeriodicNoteFile(file)
    : isPeriodicNotePath(node.filePath) || findDailyNoteDate(node.filePath, []) !== undefined;
}
