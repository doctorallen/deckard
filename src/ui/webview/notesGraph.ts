import * as vscode from 'vscode';

import {
  NotesGraphMessage,
  NotesGraphNode,
  NotesGraphSnapshot,
  SidebarGraphContext,
} from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { openSourceAt } from '../commands/navigation';
import {
  createNotesGraphConnections,
  createNotesGraphSnapshot,
} from '../state/notesGraphState';
import { parseNotesGraphMessage } from './messages';
import { getNotesGraphHtml } from './notesGraphHtml';

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

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly extensionUri: vscode.Uri,
    private readonly onGraphContext: (
      context: SidebarGraphContext | undefined,
      reveal?: boolean,
    ) => void | Promise<void>,
  ) {
    this.disposables.push(
      indexer.onDidUpdate(() => {
        this.snapshot = undefined;
        this.refresh();
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          this.renderHtml();
          this.refresh();
        }
      }),
    );
  }

  public async show(): Promise<void> {
    if (!this.panel) {
      this.createPanel();
    }

    this.panel?.reveal(vscode.ViewColumn.Active);
    await this.indexer.ready;
    this.refresh();
  }

  public async restore(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }

    this.attachPanel(panel);
    await this.indexer.ready;
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
      this.panel.webview.html = getNotesGraphHtml(this.panel.webview);
    }
  }

  private refresh(): void {
    if (!this.panel) {
      return;
    }

    const snapshot = this.getSnapshot();
    if (
      this.selectedNodeId &&
      !snapshot.nodes.some((node) => node.id === this.selectedNodeId)
    ) {
      this.selectedNodeId = undefined;
    }
    void this.panel.webview.postMessage({
      type: 'state',
      data: snapshot,
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

    if (this.isKnownSourceLocation(message.filePath, message.line)) {
      await openSourceAt(message.filePath, message.line);
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

  private getSnapshot(): NotesGraphSnapshot {
    const index = this.indexer.getSnapshot();
    if (!this.snapshot || this.snapshot.updatedAt !== index.updatedAt) {
      this.snapshot = createNotesGraphSnapshot(index);
    }
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
