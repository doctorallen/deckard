import * as vscode from 'vscode';

import type { IndexReader, IndexScanStatus, IndexUpdates } from '../../core/workspace/indexReader';
import type { ExportService } from '../../services/exportService';
import { NavigationService } from '../../services/navigationService';
import type { SearchRefineState } from '../protocol/shared';
import type { TaskBoardPageToHost, TaskBoardSnapshot } from '../protocol/taskBoard';
import type { TaskWrites } from '../commands/taskActions';
import type { ActiveSearch, SearchSource } from './activeSearch';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import { TaskBoardController, TaskBoardPreferences } from './pages/taskBoard/taskBoardController';
import type { ThemePreview } from './themePreview';

/** What the Task board is built from. */
export interface TaskBoardPanelOptions {
  indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  preferences: TaskBoardPreferences;
  extensionUri: vscode.Uri;
  openTag: (tagKey: string) => Promise<void>;
  activeSearch: ActiveSearch;
  /** What a card's checkbox, drop, date, move, or steps write through. */
  writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /** What the board's Export plans its tasks with. */
  exports: ExportService;
}

/**
 * Shows tasks as a Kanban board, a list, or a table, narrowed by the search
 * box every search page shares, and turns a card moved between columns into
 * an edit to its task line.
 *
 * The page is `TaskBoardController`, run by a `WebviewHost` in one panel;
 * this is the name the extension and its serializer know it by, and the
 * search the sidebar's Refine runs on while the board is in front.
 */
export class TaskBoardPanel implements SearchSource, vscode.Disposable {
  private readonly controller: TaskBoardController;
  private readonly page: PanelAdapter<TaskBoardSnapshot, TaskBoardPageToHost>;

  /** Builds the board; nothing is shown until `show` or `restore`. */
  public constructor(options: TaskBoardPanelOptions) {
    this.controller = new TaskBoardController({
      indexer: options.indexer,
      preferences: options.preferences,
      openTag: options.openTag,
      activeSearch: options.activeSearch,
      writes: options.writes,
      exports: options.exports,
      navigation: new NavigationService(),
      source: this,
      extensionUri: options.extensionUri,
    });
    const host = new WebviewHost(this.controller, { indexer: options.indexer, themePreview: options.themePreview });
    this.page = new PanelAdapter(host, {
      viewType: 'deckard.taskBoard',
      title: 'Deckard Task Board',
      extensionUri: options.extensionUri,
      icon: ['resources', 'deckard.svg'],
    });
  }

  /**
   * Opens the board, on a search when one is given, such as the one a Home
   * widget lists.
   */
  public async show(query?: string): Promise<void> {
    if (query !== undefined) {
      this.controller.applyQuery(query);
    }
    await this.page.show();
  }

  /** The board's search, as the sidebar's Refine shows it. */
  public getRefineState(): SearchRefineState | undefined {
    return this.controller.getRefineState();
  }

  /** Runs a search from the sidebar's Refine, as the board's own box does. */
  public applySearch(queryText: string): Promise<void> {
    return this.controller.applySearch(queryText, this.page.host);
  }

  /** Reopens a board VS Code kept across a reload, with its search. */
  public restore(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    return this.page.restore(panel, state);
  }

  /** Closes the board, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }
}
