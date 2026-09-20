import * as vscode from 'vscode';

import { Task, WorkspaceIndex } from '../../core/types';
import { resolveSourceUri } from '../commands/navigation';
import { toggleTask } from '../commands/taskActions';
import {
  AGENDA_GROUPINGS,
  AgendaEntry,
  AgendaGroup,
  AgendaGroupBy,
  createAgenda,
} from '../state/agendaState';

interface AgendaIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getTask(taskId: string): Task | undefined;
}

/** What the Agenda reads from preferences: the order tasks were dragged into. */
interface AgendaPreferences {
  readonly onDidChange: vscode.Event<unknown>;
  readonly value: { taskOrder: string[] };
}

type AgendaNode =
  | { kind: 'group'; group: AgendaGroup; groupBy: AgendaGroupBy }
  | { kind: 'task'; entry: AgendaEntry; uri: vscode.Uri | undefined };

const GROUP_ICONS: Readonly<Record<string, vscode.ThemeIcon>> = {
  overdue: new vscode.ThemeIcon(
    'warning',
    new vscode.ThemeColor('list.errorForeground'),
  ),
  today: new vscode.ThemeIcon('target'),
  upcoming: new vscode.ThemeIcon('calendar'),
};

/**
 * The icon a group takes when the Agenda is grouped by something else. A
 * priority group carries the marker the tasks themselves are written with,
 * so it needs no icon beside it.
 */
const GROUPING_ICONS: Readonly<
  Record<AgendaGroupBy, vscode.ThemeIcon | undefined>
> = {
  due: new vscode.ThemeIcon('calendar'),
  priority: undefined,
  status: new vscode.ThemeIcon('circle-outline'),
  assignee: new vscode.ThemeIcon('person'),
};

/**
 * Lists open tasks that need attention soon in the Deckard sidebar, grouped
 * by when they are wanted, by priority, by status, or by who they are for.
 *
 * The tasks are the same whichever grouping is chosen — the open ones inside
 * the Agenda's horizon — so switching changes the axis rather than the list.
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

  public constructor(
    private readonly indexer: AgendaIndexSource,
    private readonly preferences?: AgendaPreferences,
  ) {
    this.disposables.push(
      this.changeEmitter,
      ...(preferences ? [preferences.onDidChange(() => this.refresh())] : []),
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
      ? createGroupItem(node.group, node.groupBy)
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
    const groupBy = getAgendaGrouping();
    const groups = createAgenda(
      this.index,
      Date.now(),
      days,
      groupBy,
      getStatusNamespace(),
      this.preferences?.value.taskOrder ?? [],
    );
    // The badge counts what is overdue or due today however the Agenda is
    // grouped, since that is what it is a badge for.
    const urgent = createAgenda(this.index, Date.now(), days)
      .filter((group) => group.id !== 'upcoming')
      .reduce((total, group) => total + group.entries.length, 0);
    this.setStatus(
      groups.length === 0
        ? `Nothing is overdue, due today, or coming up in the next ${days} days.`
        : undefined,
      urgent,
    );
    return groups.map((group) => ({
      kind: 'group' as const,
      group,
      groupBy,
    }));
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

function createGroupItem(
  group: AgendaGroup,
  groupBy: AgendaGroupBy,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    group.label,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.id = `agenda:${group.id}`;
  item.description = String(group.entries.length);
  item.iconPath = GROUP_ICONS[group.id] ?? GROUPING_ICONS[groupBy];
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

/** How the Agenda is grouped, from `deckard.agenda.groupBy`. */
export function getAgendaGrouping(): AgendaGroupBy {
  const value = vscode.workspace
    .getConfiguration('deckard')
    .get<string>('agenda.groupBy', 'due');
  return AGENDA_GROUPINGS.some((grouping) => grouping.id === value)
    ? (value as AgendaGroupBy)
    : 'due';
}

/**
 * Asks how to group the Agenda, and keeps the answer where the setting is,
 * so the panel and the settings say the same thing.
 */
export async function pickAgendaGrouping(): Promise<AgendaGroupBy | undefined> {
  const current = getAgendaGrouping();
  const chosen = await vscode.window.showQuickPick(
    AGENDA_GROUPINGS.map((grouping) => ({
      label: grouping.label,
      description: grouping.id === current ? 'Current' : undefined,
      detail: grouping.detail,
      id: grouping.id,
    })),
    { title: 'Group tasks by', placeHolder: 'Choose what the groups are' },
  );
  if (!chosen || chosen.id === current) {
    return undefined;
  }
  await vscode.workspace
    .getConfiguration('deckard')
    .update(
      'agenda.groupBy',
      chosen.id,
      vscode.ConfigurationTarget.Global,
    );
  return chosen.id;
}

function getStatusNamespace(): string {
  const value = vscode.workspace
    .getConfiguration('deckard')
    .get<string>('board.statusNamespace', 'status');
  return value.trim() || 'status';
}

function getUpcomingDays(): number {
  const value = vscode.workspace
    .getConfiguration('deckard')
    .get<number>('agenda.upcomingDays', 7);
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), 90) : 7;
}
