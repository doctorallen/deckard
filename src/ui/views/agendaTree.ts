import * as vscode from 'vscode';

import { Task, WorkspaceIndex } from '../../core/types';
import { resolveSourceUri } from '../commands/navigation';
import {
  quoteTaskTitle,
  readTaskMetadataFormat,
  toggleTask,
  updateTaskLine,
} from '../commands/taskActions';
import { assignTaskLine } from '../commands/taskEditor';
import { mergeOrder } from '../state/dashboardState';
import {
  resolveTaskMove,
  TaskBoardOptions,
} from '../state/taskBoardState';
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
  setTaskOrder(taskOrder: string[]): Promise<void>;
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
/** What a dragged task carries: the ids being moved, in the order drawn. */
const AGENDA_TASK_MIME = 'application/vnd.code.tree.deckard.agenda';

export class AgendaTreeProvider
  implements
    vscode.TreeDataProvider<AgendaNode>,
    vscode.TreeDragAndDropController<AgendaNode>,
    vscode.Disposable
{
  public readonly dragMimeTypes = [AGENDA_TASK_MIME];
  public readonly dropMimeTypes = [AGENDA_TASK_MIME];
  /** The groups as they were last drawn, which a drop reads to rank within. */
  private drawn: AgendaGroup[] = [];
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
    this.drawn = groups;
    return groups.map((group) => ({
      kind: 'group' as const,
      group,
      groupBy,
    }));
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  /** Carries the tasks being dragged, and only tasks. */
  public handleDrag(
    source: readonly AgendaNode[],
    data: vscode.DataTransfer,
  ): void {
    const taskIds = source
      .filter((node) => node.kind === 'task')
      .map((node) => (node as { entry: AgendaEntry }).entry.task.id);
    if (taskIds.length > 0) {
      data.set(AGENDA_TASK_MIME, new vscode.DataTransferItem(taskIds));
    }
  }

  /**
   * Dropping a task on another ranks it there; dropping it on a group makes
   * the task belong to that group.
   *
   * Ranking is a preference, so it writes nothing to a note. Changing a
   * group writes what the Task board's own drop writes, through the same
   * checked edit, and a group that names no single edit — an overdue day,
   * a person in a sentence — says so rather than guessing.
   */
  public async handleDrop(
    target: AgendaNode | undefined,
    data: vscode.DataTransfer,
  ): Promise<void> {
    const dragged = data.get(AGENDA_TASK_MIME)?.value as string[] | undefined;
    if (!target || !dragged?.length) {
      return;
    }
    const tasks = dragged
      .map((taskId) => this.indexer.getTask(taskId))
      .filter((task): task is Task => task !== undefined);
    if (tasks.length === 0) {
      return;
    }
    if (target.kind === 'task') {
      await this.rankBefore(tasks, target.entry.task.id);
      return;
    }
    await this.moveToGroup(tasks, target);
  }

  /** Puts the dragged tasks in front of the one they were dropped on. */
  private async rankBefore(
    tasks: readonly Task[],
    targetId: string,
  ): Promise<void> {
    if (!this.preferences || !this.index) {
      return;
    }
    const drawnIds = this.drawn.flatMap((group) =>
      group.entries.map((entry) => entry.task.id),
    );
    const moving = new Set(tasks.map((task) => task.id));
    if (moving.has(targetId)) {
      return;
    }
    const ordered: string[] = [];
    for (const taskId of drawnIds.filter((id) => !moving.has(id))) {
      if (taskId === targetId) {
        ordered.push(...tasks.map((task) => task.id));
      }
      ordered.push(taskId);
    }
    await this.preferences.setTaskOrder(
      mergeOrder(ordered, this.index.tasks.keys()),
    );
    this.refresh();
  }

  /** Writes what belonging to a group means, or says why it cannot. */
  private async moveToGroup(
    tasks: readonly Task[],
    target: { group: AgendaGroup; groupBy: AgendaGroupBy },
  ): Promise<void> {
    // Who a task is for is the first person written on its line, so handing
    // it over rewrites that name and leaves the rest of the line alone.
    if (target.groupBy === 'assignee') {
      const person =
        target.group.id === 'none' ? undefined : target.group.label;
      const format = readBoardOptions().format;
      for (const task of tasks) {
        await updateTaskLine(
          task,
          (line) => assignTaskLine(line, person, format),
          person
            ? `${quoteTaskTitle(task)} is for ${person}.`
            : `${quoteTaskTitle(task)} is for nobody now.`,
        );
      }
      this.refresh();
      return;
    }
    const columnId = groupColumnId(target.group.id, target.groupBy);
    if (!columnId) {
      void vscode.window.showInformationMessage(
        `Deckard cannot write "${target.group.label}" on a task: it is not one edit. Drag it on the Task board, or edit the task.`,
      );
      return;
    }
    const options = readBoardOptions();
    for (const task of tasks) {
      const move = resolveTaskMove(task, columnId, options);
      if (move.kind === 'refused') {
        void vscode.window.showWarningMessage(move.reason);
        continue;
      }
      if (move.kind === 'unchanged') {
        continue;
      }
      if (move.kind === 'complete') {
        await toggleTask(task, true);
        continue;
      }
      await updateTaskLine(task, (line) => move.edit(line), move.label);
    }
    this.refresh();
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

/**
 * The Task board column a group means, when it means one.
 *
 * A person is not one of these: a task is handed over by rewriting the name
 * on its line, which the view does itself. Due groups other than Today cover
 * a range of days rather than one date, so they name no edit at all.
 */
export function groupColumnId(
  groupId: string,
  groupBy: AgendaGroupBy,
): string | undefined {
  if (groupBy === 'priority') {
    const priority = groupId.slice('priority:'.length);
    return `priority:${priority === 'none' ? '' : priority}`;
  }
  if (groupBy === 'status') {
    return `status:${groupId === 'none' ? '' : groupId}`;
  }
  if (groupBy === 'due') {
    return groupId === 'today' ? 'due:today' : undefined;
  }
  return undefined;
}

/** The board settings a drop writes with, read the way the board reads them. */
function readBoardOptions(): TaskBoardOptions {
  const configuration = vscode.workspace.getConfiguration('deckard');
  return {
    now: Date.now(),
    statuses: configuration.get<string[]>('board.statuses', []) ?? [],
    statusNamespace:
      configuration.get<string>('board.statusNamespace', 'status').trim() ||
      'status',
    format: readTaskMetadataFormat(configuration),
  };
}

function getUpcomingDays(): number {
  const value = vscode.workspace
    .getConfiguration('deckard')
    .get<number>('agenda.upcomingDays', 7);
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), 90) : 7;
}
