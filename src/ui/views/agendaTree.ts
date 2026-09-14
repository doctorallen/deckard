import * as vscode from 'vscode';

import { Task, WorkspaceIndex } from '../../core/types';
import { resolveSourceUri } from '../commands/navigation';
import { toggleTask } from '../commands/taskActions';
import {
  AgendaEntry,
  AgendaGroup,
  AgendaGroupId,
  createAgenda,
} from '../state/agendaState';

interface AgendaIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getTask(taskId: string): Task | undefined;
}

type AgendaNode =
  | { kind: 'group'; group: AgendaGroup }
  | { kind: 'task'; entry: AgendaEntry; uri: vscode.Uri | undefined };

const GROUP_ICONS: Readonly<Record<AgendaGroupId, vscode.ThemeIcon>> = {
  overdue: new vscode.ThemeIcon(
    'warning',
    new vscode.ThemeColor('list.errorForeground'),
  ),
  today: new vscode.ThemeIcon('target'),
  upcoming: new vscode.ThemeIcon('calendar'),
};

/**
 * Lists open tasks that need attention soon, grouped into Overdue, Today, and
 * Upcoming, in the Deckard sidebar.
 *
 * Checking a task's box completes it through the same source-safe edit the
 * Dashboard uses, so its ✅ date and next occurrence are written too. The
 * groups are rebuilt whenever the index changes and when the window regains
 * focus, because what counts as today moves at midnight.
 */
export class AgendaTreeProvider
  implements vscode.TreeDataProvider<AgendaNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.TreeView<AgendaNode> | undefined;
  private index: WorkspaceIndex | undefined;

  public constructor(private readonly indexer: AgendaIndexSource) {
    this.disposables.push(
      this.changeEmitter,
      indexer.onDidUpdate((index) => {
        this.index = index;
        this.refresh();
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.agenda')) {
          this.refresh();
        }
      }),
    );
  }

  /**
   * Binds the created view so the provider can set its badge and message and
   * hear its checkboxes.
   */
  public attach(view: vscode.TreeView<AgendaNode>): void {
    this.view = view;
    this.disposables.push(
      view.onDidChangeCheckboxState((event) => void this.completeTasks(event)),
    );
  }

  public getTreeItem(node: AgendaNode): vscode.TreeItem {
    return node.kind === 'group'
      ? createGroupItem(node.group)
      : createTaskItem(node.entry, node.uri);
  }

  public async getChildren(node?: AgendaNode): Promise<AgendaNode[]> {
    if (node?.kind === 'task') {
      return [];
    }
    if (node?.kind === 'group') {
      return Promise.all(
        node.group.entries.map(async (entry) => ({
          kind: 'task' as const,
          entry,
          uri: await resolveSourceUri(entry.task.filePath),
        })),
      );
    }

    if (!this.index) {
      this.setStatus('Deckard is indexing the workspace…', 0);
      return [];
    }
    const days = getUpcomingDays();
    const groups = createAgenda(this.index, Date.now(), days);
    const urgent = groups
      .filter((group) => group.id !== 'upcoming')
      .reduce((total, group) => total + group.entries.length, 0);
    this.setStatus(
      groups.length === 0
        ? `Nothing is overdue, due today, or coming up in the next ${days} days.`
        : undefined,
      urgent,
    );
    return groups.map((group) => ({ kind: 'group' as const, group }));
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private refresh(): void {
    this.changeEmitter.fire();
  }

  private setStatus(message: string | undefined, urgent: number): void {
    if (!this.view) {
      return;
    }
    this.view.message = message;
    this.view.badge =
      urgent > 0
        ? {
            value: urgent,
            tooltip: `${urgent} task${urgent === 1 ? '' : 's'} overdue or due today`,
          }
        : undefined;
  }

  private async completeTasks(
    event: vscode.TreeCheckboxChangeEvent<AgendaNode>,
  ): Promise<void> {
    let failed = false;
    for (const [node, state] of event.items) {
      if (
        node.kind !== 'task' ||
        state !== vscode.TreeItemCheckboxState.Checked
      ) {
        continue;
      }
      const task = this.indexer.getTask(node.entry.task.id) ?? node.entry.task;
      if (!(await toggleTask(task, true))) {
        failed = true;
      }
    }
    // A task that could not be completed gets its empty box back.
    if (failed) {
      this.refresh();
    }
  }
}

function createGroupItem(group: AgendaGroup): vscode.TreeItem {
  const item = new vscode.TreeItem(
    group.label,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.id = `agenda:${group.id}`;
  item.description = String(group.entries.length);
  item.iconPath = GROUP_ICONS[group.id];
  item.contextValue = 'deckardAgendaGroup';
  return item;
}

function createTaskItem(
  entry: AgendaEntry,
  uri: vscode.Uri | undefined,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    entry.title,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `agenda:task:${entry.task.id}`;
  item.description = entry.details.join(' · ');
  item.tooltip = [
    entry.title,
    [...entry.context, entry.fileName].join(' › '),
  ].join('\n');
  item.checkboxState = {
    state: vscode.TreeItemCheckboxState.Unchecked,
    tooltip: 'Complete this task',
  };
  item.contextValue = 'deckardAgendaTask';
  if (uri) {
    const position = new vscode.Position(
      Math.max(entry.task.lineNumber - 1, 0),
      0,
    );
    item.command = {
      command: 'vscode.open',
      title: 'Open Task',
      arguments: [
        uri,
        { selection: new vscode.Range(position, position), preview: false },
      ],
    };
  }
  return item;
}

function getUpcomingDays(): number {
  const value = vscode.workspace
    .getConfiguration('deckard')
    .get<number>('agenda.upcomingDays', 7);
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), 90) : 7;
}
