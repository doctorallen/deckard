import * as vscode from 'vscode';

import type { IndexReader, IndexUpdates } from '../../core/workspace/indexReader';
import { NavigationService } from '../../services/navigationService';
import type { NotesGraphPageToHost, NotesGraphWireSnapshot } from '../protocol/notesGraph';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import {
  NotesGraphController,
  NotesGraphControllerOptions,
  postToGraph,
} from './pages/notesGraph/notesGraphController';
import type { ThemePreview } from './themePreview';

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

/** What the Notes Graph reads, and whom it tells what it is showing. */
export interface NotesGraphPanelOptions {
  indexer: IndexReader & IndexUpdates;
  extensionUri: vscode.Uri;
  /**
   * Told what the graph is showing, or that it shows nothing, so Related
   * Notes can list the connections; `reveal` asks it to show itself.
   */
  onGraphContext: NotesGraphControllerOptions['onGraphContext'];
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
}

/**
 * Owns the workspace-wide Notes Graph panel and validates navigation requests
 * against the current index before opening editors or tag overviews.
 *
 * The page is `NotesGraphController`, run by a `WebviewHost` in one panel;
 * this is the name the extension and its serializer know it by.
 */
export class NotesGraphPanel implements vscode.Disposable {
  private readonly controller: NotesGraphController;
  private readonly page: PanelAdapter<NotesGraphWireSnapshot, NotesGraphPageToHost>;

  /** Builds the page; nothing is shown until `show`, `showAround`, or `restore`. */
  public constructor(options: NotesGraphPanelOptions) {
    this.controller = new NotesGraphController({
      indexer: options.indexer,
      onGraphContext: options.onGraphContext,
      navigation: new NavigationService(),
      extensionUri: options.extensionUri,
    });
    this.page = new PanelAdapter(
      new WebviewHost(this.controller, { indexer: options.indexer, themePreview: options.themePreview }),
      {
        viewType: 'deckard.notesGraph',
        title: 'Deckard Notes Graph',
        extensionUri: options.extensionUri,
        icon: ['resources', 'notes-graph.svg'],
      },
    );
  }

  /**
   * Opens the graph, in its opening scope when it is not open yet, or
   * brings it to the front, and draws it once there are notes; then turns
   * on any filter `options` asks for.
   */
  public async show(options: NotesGraphShowOptions = {}): Promise<void> {
    if (!this.page.panel) {
      this.controller.applyOpeningScope();
    }
    await this.page.show();
    // After the graph itself, so the page has something to filter.
    if (options.onlyWrittenLinks) {
      postToGraph(this.page.host, { type: 'applyFilters', onlyWrittenLinks: true });
    }
  }

  /**
   * Opens the graph around one note, one hop out, from that note's own
   * menu. It is not the reader choosing a scope, so the graph's next plain
   * opening keeps its own default.
   */
  public showAround(filePath: string): Promise<void> {
    this.controller.aroundNote(filePath);
    return this.page.show();
  }

  /** Takes back the graph panel VS Code kept across a reload. */
  public restore(panel: vscode.WebviewPanel): Promise<void> {
    return this.page.restore(panel);
  }

  /** Closes the graph, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }

  /** Highlights a node Related Notes is hovering, or ends the highlight. */
  public highlightNode(nodeId?: string): void {
    this.controller.highlightNode(this.page.host, nodeId);
  }

  /** Opens or selects a node from Related Notes; see `NotesGraphController.activateNode`. */
  public activateNode(
    nodeId: string,
    open: boolean,
    revealConnections = false,
  ): Promise<void> {
    return this.controller.activateNode(this.page.host, nodeId, open, revealConnections);
  }
}
