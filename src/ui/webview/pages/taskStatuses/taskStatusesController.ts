import * as vscode from 'vscode';

import type { PreferencesRepository } from '../../../../core/storage/preferencesRepository';
import type { IndexReader, IndexUpdates } from '../../../../core/workspace/indexReader';
import { checkStatusList } from '../../../../domain/tasks/statusChecks';
import { findStatusRenames, renameStatusInQuery, type StatusRename } from '../../../../domain/tasks/statusMigration';
import { readTaskStatuses, readTaskStatusSettings, UNKNOWN_STATUS_NAME } from '../../../../domain/tasks/taskStatuses';
import { pluralize } from '../../../../shared/text';
import { findQueryBlockEdits } from '../../../commands/queryBlockEdits';
import { writeSetting } from '../../../commands/settings';
import type { WorkspaceWriteHistory } from '../../../commands/workspaceWrites';
import type { NewStatusRow, TaskStatusesPageToHost, TaskStatusesSnapshot } from '../../../protocol/taskStatuses';
import type { PageChrome } from '../../components';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { getTaskStatusesHtml } from '../../taskStatusesHtml';
import { narrowTaskStatusesMessage } from './messages';

/** What Edit Task Statuses reads and writes through. */
export interface TaskStatusesControllerOptions {
  indexer: Pick<IndexReader, 'getSnapshot'> & Partial<IndexUpdates>;
  /** Saved searches and Home's widgets, which a renamed status's searches follow into. */
  preferences: Pick<PreferencesRepository, 'current' | 'update'>;
  /** Query blocks in notes, which a renamed status's searches follow into, as one write Undo takes back. */
  history: WorkspaceWriteHistory;
  extensionUri: vscode.Uri;
}

/**
 * Edit Task Statuses: `deckard.tasks.statuses` as rows to edit, since the
 * Settings editor offers only settings.json for a list of objects. The page
 * checks a list as it is typed; Save checks it again, writes it where the
 * list is set, and offers to carry a renamed status's searches with it.
 */
export class TaskStatusesController implements PageController<TaskStatusesSnapshot, TaskStatusesPageToHost> {
  public readonly name = 'Task statuses';
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: false,
    followIndexing: false,
    readsInertState: true,
    embedsSnapshot: true,
  };
  public readonly narrow = narrowTaskStatusesMessage;
  public readonly handlers: MessageHandlers<TaskStatusesPageToHost> = {
    saveTaskStatuses: (message, page) => this.save(message.statuses, page),
    setCheckboxClick: (message) => this.write('tasks.checkboxClick', message.value),
    importTaskStatuses: async (_message, page) => {
      await vscode.commands.executeCommand('deckard.importObsidianStatuses');
      page.refresh();
    },
  };

  /** The new row the page opens with, until the list is saved. */
  private newRow: NewStatusRow | undefined;

  /** Reads the list and the notes through `statuses`. */
  public constructor(private readonly statuses: TaskStatusesControllerOptions) {}

  /** Asks the page to open with a new row of this name and type, the next time it is drawn. */
  public addNewRow(row: Omit<NewStatusRow, 'id'>): void {
    this.newRow = { ...row, id: (this.newRow?.id ?? 0) + 1 };
  }

  /** The page's HTML, carrying `state` to draw at once when given one. */
  public html(webview: vscode.Webview, chrome: PageChrome, state?: TaskStatusesSnapshot): string {
    return getTaskStatusesHtml(webview, this.statuses.extensionUri, chrome, state);
  }

  /** The list as the settings have it, and the characters the notes use that none names. */
  public buildSnapshot(): TaskStatusesSnapshot {
    const configuration = vscode.workspace.getConfiguration('deckard');
    const counts = new Map<string, number>();
    this.statuses.indexer.getSnapshot().tasks.forEach((task) => {
      if (task.status.name === UNKNOWN_STATUS_NAME) {
        counts.set(task.status.symbol, (counts.get(task.status.symbol) ?? 0) + 1);
      }
    });
    return {
      statuses: readTaskStatusSettings(configuration).map((status) => ({ ...status })),
      checkboxClick: configuration.get<string>('tasks.checkboxClick', 'done') === 'workflow' ? 'workflow' : 'done',
      found: [...counts].map(([symbol, count]) => ({ symbol, count })).sort((left, right) => right.count - left.count || left.symbol.localeCompare(right.symbol)),
      canImport: true,
      target: configuration.inspect('tasks.statuses')?.workspaceValue === undefined ? 'user' : 'workspace',
      ...(this.newRow ? { newRow: { ...this.newRow } } : {}),
    };
  }

  /** Redraws when the task settings change, and when the notes do. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    return [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.tasks')) {
          page.refresh();
        }
      }),
      ...(this.statuses.indexer.onDidUpdate ? [this.statuses.indexer.onDidUpdate(() => page.refresh())] : []),
    ];
  }

  /** Writes one `deckard` setting where it is set: the workspace when it sets it, else the user's. */
  private async write(key: string, value: unknown): Promise<void> {
    const inWorkspace = vscode.workspace.getConfiguration('deckard').inspect(key)?.workspaceValue !== undefined;
    await writeSetting(key, value, inWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  }

  /**
   * Saves a list the page sent, unless it has a problem that stops a save,
   * which is said instead; then offers to carry a renamed status's searches.
   */
  private async save(statuses: TaskStatusesSnapshot['statuses'], page: PageContext): Promise<void> {
    const workflow = vscode.workspace.getConfiguration('deckard').get<string>('tasks.checkboxClick', 'done') === 'workflow';
    const problem = checkStatusList(statuses, workflow).find((found) => found.severity === 'error');
    if (problem) {
      void vscode.window.showWarningMessage(`The statuses were not saved: row ${problem.row + 1}: ${problem.text}`);
      return;
    }
    const before = readTaskStatusSettings(vscode.workspace.getConfiguration('deckard'));
    this.newRow = undefined;
    await this.write('tasks.statuses', statuses);
    page.refresh();
    const renames = findStatusRenames(before, readTaskStatuses(statuses));
    if (renames.length) {
      await this.carryRenames(renames);
    }
  }

  /**
   * Offers to rename a renamed status in the searches that name it: saved
   * searches, Home's widgets, and the query blocks written in notes, which
   * go through the previewed write Undo takes back.
   */
  private async carryRenames(renames: readonly StatusRename[]): Promise<void> {
    const rename = (query: string): string => renames.reduce((text, each) => renameStatusInQuery(text, each), query);
    const current = this.statuses.preferences.current;
    const widgets = current.dashboardWidgets.map((widget) => (widget.query ? { ...widget, query: rename(widget.query) } : widget));
    const filters = current.savedFilters.map((filter) => (filter.query ? { ...filter, query: rename(filter.query) } : filter));
    const searches =
      widgets.filter((widget, at) => widget.query !== current.dashboardWidgets[at].query).length +
      filters.filter((filter, at) => filter.query !== current.savedFilters[at].query).length;
    const blocks = await findQueryBlockEdits(this.statuses.indexer.getSnapshot().files.values(), rename, /status[ \t]*(?:!=|[:=])/i);
    if (searches + blocks.lines === 0) {
      return;
    }
    const names = renames.map((each) => `${each.from} to ${each.to}`).join(', ');
    const where = [searches ? pluralize(searches, 'saved search', 'saved searches') : '', blocks.lines ? pluralize(blocks.lines, 'line of a query block', 'lines of query blocks') : '']
      .filter(Boolean)
      .join(' and ');
    const chosen = await vscode.window.showInformationMessage(`Renamed ${names}. ${where} search by the old name. Update them?`, 'Update Them');
    if (chosen !== 'Update Them') {
      return;
    }
    if (searches) {
      await this.statuses.preferences.update({ dashboardWidgets: widgets, savedFilters: filters });
    }
    if (blocks.lines) {
      await this.statuses.history.write(blocks.edit, { label: `Rename ${names} in query blocks`, preview: 'always' });
    }
  }
}
