import * as vscode from 'vscode';

import type { NewStatusRow, TaskStatusesPageToHost, TaskStatusesSnapshot } from '../protocol/taskStatuses';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost, type HostIndexer } from './host/webviewHost';
import { TaskStatusesController, type TaskStatusesControllerOptions } from './pages/taskStatuses/taskStatusesController';
import type { ThemePreview } from './themePreview';

/** What Edit Task Statuses is built from. */
export interface TaskStatusesPanelOptions extends TaskStatusesControllerOptions {
  indexer: TaskStatusesControllerOptions['indexer'] & HostIndexer;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
}

/**
 * Edit Task Statuses, in one panel. The page is `TaskStatusesController`,
 * run by a `WebviewHost`; this is the name the extension knows it by.
 */
export class TaskStatusesPanel implements vscode.Disposable {
  private readonly page: PanelAdapter<TaskStatusesSnapshot, TaskStatusesPageToHost>;
  private readonly controller: TaskStatusesController;

  /** Builds the page; nothing is shown until `show`. */
  public constructor(options: TaskStatusesPanelOptions) {
    this.controller = new TaskStatusesController(options);
    this.page = new PanelAdapter(
      new WebviewHost(this.controller, { indexer: options.indexer, themePreview: options.themePreview }),
      { viewType: 'deckard.taskStatuses', title: 'Task Statuses', extensionUri: options.extensionUri, icon: ['resources', 'deckard.svg'] },
    );
  }

  /** Opens the page, or brings it to the front, with a new row to fill in when one is given. */
  public show(newRow?: Omit<NewStatusRow, 'id'>): Promise<void> {
    if (newRow) {
      this.controller.addNewRow(newRow);
    }
    return this.page.show();
  }

  /** Closes the page, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }
}
