import * as vscode from 'vscode';

import type { PreferencesRepository } from '../../../../core/storage/preferencesRepository';
import type { IndexReader, IndexUpdates } from '../../../../core/workspace/indexReader';
import { findFencedLines } from '../../../../domain/markdown/lineShapes';
import { checkStatusList } from '../../../../domain/tasks/statusChecks';
import { findStatusRenames, renameStatusInQuery, type StatusRename } from '../../../../domain/tasks/statusMigration';
import { readStatusNamespace } from '../../../../domain/tasks/taskPolicy';
import { readTaskStatuses, readTaskStatusSettings, UNKNOWN_STATUS_NAME } from '../../../../domain/tasks/taskStatuses';
import { pluralize } from '../../../../shared/text';
import { resolveSourceUri } from '../../../commands/navigation';
import { writeSetting } from '../../../commands/settings';
import type { WorkspaceWriteHistory } from '../../../commands/workspaceWrites';
import type { TaskStatusesPageToHost, TaskStatusesSnapshot } from '../../../protocol/taskStatuses';
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

/** The fences whose lines are searches: a query block, and a block of searches to copy. */
const SEARCH_FENCE = /^\s*(`{3,}|~{3,})\s*(deckard|search)\b/;

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

  /** Reads the list and the notes through `statuses`. */
  public constructor(private readonly statuses: TaskStatusesControllerOptions) {}

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
      namespace: readStatusNamespace(configuration),
      found: [...counts].map(([symbol, count]) => ({ symbol, count })).sort((left, right) => right.count - left.count || left.symbol.localeCompare(right.symbol)),
      canImport: true,
      target: configuration.inspect('tasks.statuses')?.workspaceValue === undefined ? 'user' : 'workspace',
    };
  }

  /** Redraws when the statuses or the status settings change, and when the notes do. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    return [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.tasks') || event.affectsConfiguration('deckard.board.statusNamespace')) {
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
    const blocks = await this.findQueryBlockEdits(rename);
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

  /** The lines of query blocks in notes that search by a renamed status's old name, rewritten. */
  private async findQueryBlockEdits(rename: (query: string) => string): Promise<{ edit: vscode.WorkspaceEdit; lines: number }> {
    const edit = new vscode.WorkspaceEdit();
    let lines = 0;
    for (const file of this.statuses.indexer.getSnapshot().files.values()) {
      if (!/status[ \t]*(?:!=|[:=])/i.test(file.content)) {
        continue;
      }
      const text = file.content.split(/\r?\n/);
      const fenced = findFencedLines(text);
      const uri = await resolveSourceUri(file.filePath);
      let inSearch = false;
      text.forEach((line, at) => {
        if (!fenced.has(at)) {
          inSearch = false;
          return;
        }
        if (SEARCH_FENCE.test(line)) {
          inSearch = true;
          return;
        }
        const renamed = inSearch ? rename(line) : line;
        if (!uri || renamed === line) {
          return;
        }
        edit.replace(uri, new vscode.Range(at, 0, at, line.length), renamed);
        lines += 1;
      });
    }
    return { edit, lines };
  }
}
