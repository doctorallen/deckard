import * as vscode from 'vscode';

import type { IndexReader, IndexUpdates } from '../../../../core/workspace/indexReader';
import { isMarkdownFile } from '../../../../core/workspace/scanner';
import { noteTitle } from '../../../../domain/index/backlinks';
import { findDailyNoteDate, isPeriodicNoteFile, isPeriodicNotePath } from '../../../../domain/markdown/parser';
import type { WorkspaceIndex, NotesGraphFocus, NotesGraphSnapshot } from '../../../../domain/model';
import type { NavigationService } from '../../../../services/navigationService';
import { logTrace, measure } from '../../../../shared/timing';
import type { MessageOf } from '../../../protocol/messaging';
import type {
  NotesGraphHostToPage,
  NotesGraphNode,
  NotesGraphPageToHost,
  NotesGraphWireSnapshot,
  SidebarGraphContext,
} from '../../../protocol/notesGraph';
import { openSourceAt } from '../../../commands/navigation';
import { NotesGraphKinds, toWire } from '../../../state/notesGraphState';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { openSource, openTag } from '../../host/sharedHandlers';
import { PanelSurface } from '../../host/surface';
import { getNotesGraphHtml } from '../../notesGraphHtml';
import type { PageChrome } from '../../components';
import { narrowNotesGraphMessage } from './messages';
import { graphInputsChanged } from '../../../../domain/graph/graphChanges';
import { createNotesGraphSnapshot } from '../../../../domain/graph/notesGraph';
import { createNotesGraphConnections } from '../../../../domain/graph/graphConnections';
import { createLocalGraphSnapshot, findNoteNodeIds, MAXIMUM_LOCAL_GRAPH_DEPTH } from '../../../../domain/graph/localGraph';

/** What the Notes Graph reads, and whom it tells what it is showing. */
export interface NotesGraphControllerOptions {
  indexer: IndexReader & IndexUpdates;
  /**
   * Told what the graph is showing, or that it shows nothing, so Related
   * Notes can list the connections; `reveal` asks it to show itself.
   */
  onGraphContext: (
    context: SidebarGraphContext | undefined,
    reveal?: boolean,
  ) => void | Promise<void>;
  /** What a node's line or tag may open. */
  navigation: NavigationService;
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri;
}

/**
 * The workspace-wide Notes Graph: the graph it draws, the node selected in
 * it, which Related Notes lists the connections of, and the scope it is
 * drawn in. Each node, line, and tag the page names is checked against the
 * index as it is now before anything opens.
 *
 * A hidden graph keeps its layout and catches up when shown again.
 */
export class NotesGraphController implements PageController<NotesGraphWireSnapshot, NotesGraphPageToHost> {
  public readonly name = 'Notes Graph';
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: false,
    // The page has no loading line, so it is not told how far the first scan has got.
    followIndexing: false,
    // The graph's build is timed in buildSnapshot, with how many nodes it drew.
    measure: false,
  };
  public readonly narrow = narrowNotesGraphMessage;
  public readonly handlers: MessageHandlers<NotesGraphPageToHost>;
  private selectedNodeId: string | undefined;
  private snapshot: NotesGraphSnapshot | undefined;
  /** The index the whole-workspace snapshot was drawn from. */
  private builtFrom: WorkspaceIndex | undefined;
  /** The kinds of node the page shows, which are all it is sent. */
  private kinds: NotesGraphKinds = { notes: true, tasks: true };
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

  /** Reads from `graph.indexer`, and tells `graph.onGraphContext` what is selected. */
  public constructor(private readonly graph: NotesGraphControllerOptions) {
    const { indexer, navigation } = graph;
    this.handlers = {
      openSource: openSource({ indexer, navigation, policy: 'graphNodes' }),
      openTag: openTag({
        indexer,
        navigation,
        policy: 'exact',
        openTag: (tagKey) => vscode.commands.executeCommand('deckard.showTagOverview', tagKey),
      }),
      selectNode: (message, page) => this.activateNode(page, message.nodeId, false, true),
      clearSelection: (_message, page) => {
        this.selectedNodeId = undefined;
        return this.publishGraphContext(page, false);
      },
      setGraphFilter: (message, page) => {
        // Not a choice of scope: the opening scope rule is untouched.
        const kinds = { notes: message.showNotes, tasks: message.showTasks };
        if (kinds.notes === this.kinds.notes && kinds.tasks === this.kinds.tasks) {
          return;
        }
        this.kinds = kinds;
        page.refresh();
      },
      setGraphScope: (message, page) => {
        this.scopeChosen = true;
        this.scope = {
          skipPeriodic: message.skipPeriodic ?? this.scope.skipPeriodic,
          local: message.local,
          depth: Math.max(1, Math.min(MAXIMUM_LOCAL_GRAPH_DEPTH, message.depth)),
        };
        page.refresh();
      },
    };
  }

  /** The Notes Graph page's HTML. */
  public html(webview: vscode.Webview, chrome: PageChrome): string {
    return getNotesGraphHtml(webview, this.graph.extensionUri, chrome);
  }

  /**
   * The graph in its scope, with only the kinds of node the page shows. A
   * selection the page is not sent, because the graph no longer holds it or
   * the page hides its kind, is let go, so Related Notes stops listing what
   * it is joined to. The log times the graph alone, and counts every node it
   * holds, before the kinds hidden are left out, as it always has.
   */
  public buildSnapshot(): NotesGraphWireSnapshot {
    const snapshot = measure(
      'Notes Graph',
      () => this.getSnapshot(),
      (graph) => `${graph.nodes.length} nodes`,
    );
    const wire = toWire(snapshot, this.kinds);
    if (this.selectedNodeId && !wire.nodes.some((node) => node.id === this.selectedNodeId)) {
      this.selectedNodeId = undefined;
    }
    return wire;
  }

  /** A local graph follows the note being written. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    this.rememberNote(page, vscode.window.activeTextEditor);
    return [vscode.window.onDidChangeActiveTextEditor((editor) => this.rememberNote(page, editor))];
  }

  /**
   * A save that changes nothing the graph draws costs it nothing: no
   * rebuild, no message, and a hidden graph is not out of date.
   */
  public onIndexUpdate(page: PageContext): void {
    const index = this.graph.indexer.getSnapshot();
    if (this.snapshot && !graphInputsChanged(this.builtFrom, index)) {
      this.builtFrom = index;
      logTrace(() => 'Notes Graph unchanged by this update; not redrawn.');
      return;
    }
    this.snapshot = undefined;
    this.builtFrom = undefined;
    page.refresh();
  }

  /**
   * After each graph, the selection is sent again, and Related Notes is
   * told what it is while the graph is in front.
   */
  public onDidSendSnapshot(page: PageContext): void {
    if (this.selectedNodeId) {
      postToGraph(page, { type: 'selectNode', nodeId: this.selectedNodeId });
    }
    if (page.surface?.active) {
      void this.publishGraphContext(page, false);
    }
  }

  /** Related Notes lists the graph's connections only while it is in front. */
  public onDidChangeViewState(page: PageContext): void {
    if (page.surface?.active) {
      void this.publishGraphContext(page, false);
    } else {
      void this.graph.onGraphContext(undefined);
    }
  }

  /** A closed graph has no selection, and Related Notes lists none. */
  public onDidDetach(): void {
    this.selectedNodeId = undefined;
    void this.graph.onGraphContext(undefined);
  }

  /**
   * The graph opens around the note being written, one hop out, when there
   * is one: a whole workspace at once is hundreds of unlabeled dots, an
   * overview of density and nothing else, and the reader came from a note.
   * The full graph is the checkbox away, and a scope the reader has chosen
   * is kept.
   */
  public applyOpeningScope(): void {
    this.scope = {
      ...openingScope(this.focusPath, this.scopeChosen, this.scope),
      skipPeriodic: this.scope.skipPeriodic,
    };
  }

  /**
   * Draws the graph around one note, one hop out, from that note's own
   * menu. It is not the reader choosing a scope, so the graph's next plain
   * opening keeps its own default.
   */
  public aroundNote(filePath: string): void {
    this.focusPath = filePath;
    this.scope = aroundNoteScope(this.scope);
  }

  /** Highlights a node Related Notes is hovering, or ends the highlight. */
  public highlightNode(page: PageContext, nodeId?: string): void {
    const node = nodeId ? this.getNode(nodeId) : undefined;
    postToGraph(page, { type: 'highlightNode', nodeId: node?.id });
  }

  /**
   * Opens a node the graph still holds, or selects it: the graph comes to
   * the front without taking focus, and Related Notes lists what the node
   * is joined to, showing itself when `revealConnections` says.
   */
  public async activateNode(
    page: PageContext,
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

    if (page.surface instanceof PanelSurface) {
      page.surface.panel.reveal(vscode.ViewColumn.Active, true);
    }
    this.selectedNodeId = node.id;
    postToGraph(page, { type: 'selectNode', nodeId: node.id });
    await this.publishGraphContext(page, revealConnections);
  }

  /** Follows the note being written, so a local graph follows it too. */
  private rememberNote(page: PageContext, editor: vscode.TextEditor | undefined): void {
    const uri = editor?.document.uri;
    const { indexer } = this.graph;
    if (!uri || !isMarkdownFile(uri) || !indexer.isNotesFile(uri)) {
      return;
    }
    const filePath = indexer.getFilePath(uri);
    if (filePath === this.focusPath) {
      return;
    }
    this.focusPath = filePath;
    if (this.scope.local) {
      page.refresh();
      return;
    }
    // The whole workspace is drawn, and stays as it is; only the line
    // naming the note it would be drawn around changes.
    this.postFocus(page);
  }

  /**
   * Tells the page the focus as it is now, without the graph. Before a
   * graph is built, or after a change it has yet to redraw for, the next
   * graph carries the focus, so nothing is sent.
   */
  private postFocus(page: PageContext): void {
    if (!this.snapshot) {
      return;
    }
    postToGraph(page, { type: 'focus', focus: this.describeFocus(this.snapshot) });
  }

  /** The note the graph is drawn around, or would be, and its scope, over the workspace's graph. */
  private describeFocus(workspace: NotesGraphSnapshot): NotesGraphFocus {
    return {
      local: this.scope.local,
      depth: this.scope.depth,
      skipPeriodic: this.scope.skipPeriodic,
      workspaceNodeCount: workspace.nodes.length,
      ...(this.focusPath
        ? { filePath: this.focusPath, title: noteTitle(this.focusPath) }
        : {}),
    };
  }

  /** A node the graph in its scope holds now, by id. */
  private getNode(nodeId: string): NotesGraphNode | undefined {
    return this.getSnapshot().nodes.find((node) => node.id === nodeId);
  }

  /**
   * Tells Related Notes the selected node and what it is joined to, while
   * the graph is in front.
   */
  private async publishGraphContext(page: PageContext, reveal: boolean): Promise<void> {
    if (!page.surface?.active) {
      return;
    }
    const snapshot = this.getSnapshot();
    const selectedNode = this.selectedNodeId
      ? snapshot.nodes.find((node) => node.id === this.selectedNodeId)
      : undefined;
    await this.graph.onGraphContext(
      {
        selectedNode,
        connections: selectedNode
          ? createNotesGraphConnections(snapshot, selectedNode.id)
          : [],
      },
      reveal,
    );
  }

  /** Opens a tag node's page, or a note or task node at its line if the index still has it. */
  private async openNode(node: NotesGraphNode): Promise<void> {
    if (node.kind === 'tag') {
      await vscode.commands.executeCommand('deckard.showTagOverview', node.id.slice(4));
      return;
    }
    if (
      node.filePath &&
      node.line !== undefined &&
      this.graph.navigation.resolveSourceLocation(this.graph.indexer.getSnapshot(), node.filePath, node.line, 'graphNodes').kind === 'open'
    ) {
      await openSourceAt({ filePath: node.filePath, line: node.line });
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
    const focus = this.describeFocus(workspace);
    if (!this.scope.local || !this.focusPath) {
      return { ...workspace, focus };
    }
    return {
      ...createLocalGraphSnapshot(
        workspace,
        findNoteNodeIds(workspace, this.focusPath),
        this.scope.depth,
        this.scope.skipPeriodic
          ? (node: NotesGraphNode) => isPeriodicNode(node, this.graph.indexer.getSnapshot())
          : undefined,
      ),
      focus,
    };
  }

  /**
   * The whole workspace's graph, built again only when the index changed
   * something it draws.
   */
  private getWorkspaceSnapshot(): NotesGraphSnapshot {
    const index = this.graph.indexer.getSnapshot();
    if (!this.snapshot || graphInputsChanged(this.builtFrom, index)) {
      this.snapshot = createNotesGraphSnapshot(index);
    }
    this.builtFrom = index;
    return this.snapshot;
  }
}

/** Sends the graph one message its map names, while it is open. */
export function postToGraph(page: Pick<PageContext, 'post'>, message: MessageOf<NotesGraphHostToPage>): void {
  page.post(message);
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
