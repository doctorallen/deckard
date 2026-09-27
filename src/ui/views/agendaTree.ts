import * as vscode from 'vscode';

import { describeSteps } from '../../core/markdown/taskSteps';
import { Task, WorkspaceIndex } from '../../core/types';
import { stripTrailingTags } from '../state/queryBlockState';
import { resolveSourceUri } from '../commands/navigation';
import { writeSetting } from '../commands/settings';
import {
  readTaskMetadataFormat,
  toggleTask,
  updateTaskLine,
} from '../commands/taskActions';
import { mergeOrder } from '../state/dashboardState';
import { describeNamespaceValues, isNamespaceName, listTaskNamespaces } from '../state/tagGrouping';
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
  selectAgendaTasks,
} from '../state/agendaState';

interface AgendaIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getTask(taskId: string): Task | undefined;
  /** How far the first scan has got, which the waiting message says. */
  readonly scanProgress?: { completed: number; total: number };
  readonly onDidProgress?: vscode.Event<void>;
}

/** What the Agenda reads from preferences: the order tasks were dragged into. */
interface AgendaPreferences {
  readonly onDidChange: vscode.Event<unknown>;
  readonly value: { taskOrder: string[] };
  setTaskOrder(taskOrder: string[]): Promise<void>;
}

export type AgendaNode =
  | { kind: 'group'; group: AgendaGroup; groupBy: AgendaGroupBy }
  | {
      kind: 'task';
      entry: AgendaEntry;
      uri: vscode.Uri | undefined;
      /** The group it is drawn in: a task with two tags is in two groups. */
      groupId?: string;
    }
  /** The row under a long group that shows the rest of it. */
  | { kind: 'more'; groupId: string; hidden: number }
  /** One of a task's steps, under its task. */
  | {
      kind: 'step';
      task: Task;
      parentId: string;
      uri: vscode.Uri | undefined;
      groupId?: string;
    };

/**
 * How many overdue tasks are drawn before "Show N more". Seventeen overdue
 * rows push Today off the screen; five say there is a pile without being it.
 */
export const OVERDUE_ROWS = 5;

const GROUP_ICONS: Readonly<Record<string, vscode.ThemeIcon>> = {
  overdue: new vscode.ThemeIcon(
    'warning',
    new vscode.ThemeColor('list.errorForeground'),
  ),
  today: new vscode.ThemeIcon('target'),
  upcoming: new vscode.ThemeIcon('calendar'),
  later: new vscode.ThemeIcon('history'),
  nodate: new vscode.ThemeIcon('inbox'),
  needsdate: new vscode.ThemeIcon('history'),
  donetoday: new vscode.ThemeIcon('pass'),
};

/** The groups that start folded: what can wait, out of the way of what cannot. */
const FOLDED_GROUPS: ReadonlySet<string> = new Set(['later', 'nodate', 'needsdate', 'donetoday']);

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
  tag: new vscode.ThemeIcon('tag'),
};

/**
 * Lists open tasks that need attention soon in the Deckard sidebar, grouped
 * by when they are wanted, by priority, by status, or by who they are for.
 *
 * The tasks are the same whichever grouping is chosen — the open ones
 * `deckard.agenda.query` finds, or every open one — so switching changes the
 * axis rather than the list.
 *
 * Checking a task's box completes it through the same source-safe edit the
 * Dashboard uses, so its ✅ date and next occurrence are written too. The
 * groups are rebuilt whenever the index changes and when the window regains
 * focus, because what counts as today moves at midnight.
 */
/** What a dragged task carries: the ids being moved, in the order drawn. */
export const AGENDA_TASK_MIME = 'application/vnd.code.tree.deckard.agenda';

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
  /** Groups shown in full after "Show N more", for the rest of the session. */
  private readonly expanded = new Set<string>();

  public constructor(
    private readonly indexer: AgendaIndexSource,
    private readonly preferences?: AgendaPreferences,
  ) {
    this.disposables.push(
      this.changeEmitter,
      ...(preferences ? [preferences.onDidChange(() => this.refresh())] : []),
      ...(indexer.onDidProgress
        ? [indexer.onDidProgress(() => {
            if (!this.index) {
              this.refresh();
            }
          })]
        : []),
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
        if (
          event.affectsConfiguration('deckard.agenda') ||
          event.affectsConfiguration('deckard.tasks')
        ) {
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
    if (node.kind === 'more') {
      return createMoreItem(node);
    }
    if (node.kind === 'step') {
      return createStepItem(node);
    }
    return node.kind === 'group'
      ? createGroupItem(node.group, node.groupBy)
      : createTaskItem(node.entry, node.uri, node.groupId);
  }

  /** Shows every task in a group that was cut short, until the window closes. */
  public showMore(groupId: string): void {
    this.expanded.add(groupId);
    this.refresh();
  }

  public async getChildren(node?: AgendaNode): Promise<AgendaNode[]> {
    if (node?.kind === 'task') {
      // A task with steps opens to them, each read again from the index.
      const steps = (node.entry.steps ?? []).map(
        (step) => this.indexer.getTask(step.id) ?? step,
      );
      return Promise.all(
        steps.map(async (task) => ({
          kind: 'step' as const,
          task,
          parentId: node.entry.task.id,
          uri: await resolveSourceUri(task.filePath),
          groupId: node.groupId,
        })),
      );
    }
    if (node?.kind === 'more' || node?.kind === 'step') {
      return [];
    }
    if (node?.kind === 'group') {
      const { group } = node;
      const cut =
        node.groupBy === 'due' &&
        group.id === 'overdue' &&
        !this.expanded.has(group.id) &&
        group.entries.length > OVERDUE_ROWS;
      const shown = cut ? group.entries.slice(0, OVERDUE_ROWS) : group.entries;
      const tasks: AgendaNode[] = await Promise.all(
        shown.map(async (entry) => ({
          kind: 'task' as const,
          entry,
          uri: await resolveSourceUri(entry.task.filePath),
          groupId: group.id,
        })),
      );
      return cut
        ? [...tasks, { kind: 'more', groupId: group.id, hidden: group.entries.length - OVERDUE_ROWS }]
        : tasks;
    }

    if (!this.index) {
      this.setStatus(describeIndexing(this.indexer.scanProgress), 0);
      return [];
    }
    const days = getUpcomingDays();
    const groupBy = getAgendaGrouping();
    const query = getAgendaQuery();
    const selected = selectAgendaTasks(this.index, query);
    const groups = createAgenda(this.index, Date.now(), {
      tasks: selected.tasks,
      upcomingDays: days,
      groupBy,
      statusNamespace: getStatusNamespace(),
      groupNamespace: getAgendaGroupNamespace(),
      taskOrder: this.preferences?.value.taskOrder ?? [],
      doneToday: true,
      upcomingByDay: true,
    });
    // The badge counts what is overdue or due today however the Agenda is
    // grouped, since that is what it is a badge for.
    const urgent = createAgenda(this.index, Date.now(), {
      tasks: selected.tasks,
      upcomingDays: days,
    })
      .filter((group) => group.id === 'overdue' || group.id === 'today')
      .reduce((total, group) => total + group.entries.length, 0);
    this.setStatus(
      selected.error
        ? `The Tasks view's search cannot be read: ${selected.error} It lists every open task until the search is fixed.`
        : groups.every((group) => group.id === 'donetoday')
          ? query
            ? `No open task matches the Tasks view's search, "${query}".`
            : 'No open tasks.'
          : undefined,
      urgent,
    );
    // The way back to every open task is offered while a search narrows it.
    void vscode.commands.executeCommand(
      'setContext',
      'deckard.agendaFiltered',
      Boolean(query) && !selected.error,
    );
    void vscode.commands.executeCommand('setContext', 'deckard.agendaQuerySet', Boolean(query));
    // The view's own line says what it lists, when that is not everything.
    if (this.view) {
      this.view.description = query || undefined;
    }
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

  /**
   * The tasks a menu command was run on: every selected item when the one
   * right-clicked is among them, else that item; a group stands for its
   * tasks. Each is read again from the index, so a date is written on the
   * line as it is now.
   */
  public tasksFor(node?: AgendaNode, selected?: readonly AgendaNode[]): Task[] {
    const nodes =
      node && selected?.includes(node) ? selected : node ? [node] : [];
    const seen = new Set<string>();
    const tasks: Task[] = [];
    for (const each of nodes) {
      if (each.kind === 'more') {
        continue;
      }
      if (each.kind === 'step') {
        if (!seen.has(each.task.id)) {
          seen.add(each.task.id);
          tasks.push(this.indexer.getTask(each.task.id) ?? each.task);
        }
        continue;
      }
      const entries = each.kind === 'task' ? [each.entry] : each.group.entries;
      for (const entry of entries) {
        if (seen.has(entry.task.id)) {
          continue;
        }
        seen.add(entry.task.id);
        tasks.push(this.indexer.getTask(entry.task.id) ?? entry.task);
      }
    }
    return tasks;
  }

  /** Carries the tasks being dragged, and only tasks. */
  public handleDrag(
    source: readonly AgendaNode[],
    data: vscode.DataTransfer,
  ): void {
    // Each task goes with the group it was dragged from, which a move
    // between tags needs: the tag to replace is the one it came from. A
    // step stays where it is written, under its task, so it is not dragged.
    const dragged: DraggedTask[] = source.flatMap((node) =>
      node.kind === 'task' ? [{ taskId: node.entry.task.id, groupId: node.groupId }] : [],
    );
    if (dragged.length > 0) {
      data.set(AGENDA_TASK_MIME, new vscode.DataTransferItem(dragged));
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
    const value = data.get(AGENDA_TASK_MIME)?.value as unknown;
    const dragged = readDraggedTasks(value);
    if (!target || dragged.length === 0) {
      return;
    }
    const from = new Map(dragged.map((item) => [item.taskId, item.groupId]));
    const tasks = [...new Set(dragged.map((item) => item.taskId))]
      .map((taskId) => this.indexer.getTask(taskId))
      .filter((task): task is Task => task !== undefined);
    if (tasks.length === 0) {
      return;
    }
    if (target.kind === 'more' || target.kind === 'step') {
      return;
    }
    if (target.kind === 'task') {
      await this.rankBefore(tasks, target.entry.task.id);
      return;
    }
    await this.moveToGroup(tasks, target, from);
  }

  /** Puts the dragged tasks in front of the one they were dropped on. */
  private async rankBefore(
    tasks: readonly Task[],
    targetId: string,
  ): Promise<void> {
    if (!this.preferences || !this.index) {
      return;
    }
    // A task drawn in two groups is ranked once.
    const drawnIds = [
      ...new Set(this.drawn.flatMap((group) => group.entries.map((entry) => entry.task.id))),
    ];
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
    from: ReadonlyMap<string, string | undefined> = new Map(),
  ): Promise<void> {
    const columnId = groupColumnId(target.group.id, target.groupBy);
    if (!columnId) {
      void vscode.window.showInformationMessage(
        `"${target.group.label}" is not one change to a task line, so Deckard wrote nothing. Drag the task on the Task Board instead, or edit the task.`,
      );
      return;
    }
    const options = readBoardOptions();
    // A refusal explains a rule, so it is said once, after the moves that
    // could be made, rather than once for every task it held back.
    const refused: string[] = [];
    let moved = 0;
    for (const task of tasks) {
      const source = from.get(task.id);
      const move = resolveTaskMove(task, columnId, options, {
        index: this.index,
        from: source ? groupColumnId(source, target.groupBy) : undefined,
      });
      if (move.kind === 'refused') {
        refused.push(move.reason);
        continue;
      }
      moved += 1;
      if (move.kind === 'unchanged') {
        continue;
      }
      if (move.kind === 'complete') {
        await toggleTask(task, true);
        continue;
      }
      await updateTaskLine(task, (line) => move.edit(line), move.label);
    }
    if (refused.length > 0) {
      void (moved === 0
        ? vscode.window.showInformationMessage(refused[0])
        : vscode.window.showWarningMessage(
            `Moved ${moved} ${moved === 1 ? 'task' : 'tasks'}. ${refused.length} ${
              refused.length === 1 ? 'was' : 'were'
            } left as ${refused.length === 1 ? 'it is' : 'they are'}: ${refused[0]}`,
          ));
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
      if (node.kind !== 'task' && node.kind !== 'step') {
        continue;
      }
      // An open task's box completes it; a box under Done today, or a done
      // step's, reopens it.
      const complete = state === vscode.TreeItemCheckboxState.Checked;
      const drawn = node.kind === 'task' ? node.entry.task : node.task;
      if (complete === drawn.completed) {
        continue;
      }
      const task = this.indexer.getTask(drawn.id) ?? drawn;
      if (!(await toggleTask(task, complete))) {
        failed = true;
      }
    }
    // A task that could not be completed gets its empty box back.
    if (failed) {
      this.refresh();
    }
  }
}

/** What a view says while the first scan runs, with how far it has got. */
export function describeIndexing(
  progress: { completed: number; total: number } | undefined,
): string {
  return progress && progress.total > 0
    ? `Deckard is indexing the workspace: ${progress.completed.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} notes read…`
    : 'Deckard is indexing the workspace…';
}

/**
 * What a task item says when hovered: its words, what it is due and how
 * urgent it is, and where it is written, under the headings above it, so
 * the right one of two similar tasks can be told apart without opening it.
 */
export function createTaskTooltip(entry: AgendaEntry): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.appendMarkdown(`**${escapeMarkdown(entry.title)}**`);
  if (entry.details.length > 0) {
    tooltip.appendMarkdown(`\n\n${entry.details.map(escapeMarkdown).join(' · ')}`);
  }
  tooltip.appendMarkdown(
    `\n\n$(file) ${escapeMarkdown([entry.fileName, ...entry.context].join(' › '))}, line ${entry.task.lineNumber}`,
  );
  tooltip.appendMarkdown('\n\nRight-click to date, edit, or break it into steps.');
  return tooltip;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

function createGroupItem(
  group: AgendaGroup,
  groupBy: AgendaGroupBy,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    group.label,
    FOLDED_GROUPS.has(group.id)
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded,
  );
  item.id = `agenda:${group.id}`;
  item.description = String(group.entries.length);
  if (groupBy === 'tag' && group.id.startsWith('tag:')) {
    const tag = `#${group.id.slice('tag:'.length)}`;
    item.tooltip = tag.endsWith('/')
      ? `Open tasks with no ${tag}… tag.`
      : `Tasks tagged ${tag} on their line, a heading above them, or their note's front matter. Drag a task here to tag it.`;
  }
  item.iconPath =
    GROUP_ICONS[group.id.startsWith('upcoming:') ? 'upcoming' : group.id] ??
    GROUPING_ICONS[groupBy];
  // Overdue, and what needs a new date, are told apart: they are the groups
  // offered a date for all beside their name.
  item.contextValue =
    group.id === 'overdue'
      ? 'deckardAgendaGroup.overdue'
      : group.id === 'needsdate'
        ? 'deckardAgendaGroup.needsDate'
        : group.id === 'donetoday'
          ? 'deckardAgendaDoneGroup'
          : 'deckardAgendaGroup';
  return item;
}

function createMoreItem(node: { groupId: string; hidden: number }): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `Show ${node.hidden} more`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `agenda:more:${node.groupId}`;
  item.iconPath = new vscode.ThemeIcon('ellipsis');
  item.command = {
    command: 'deckard.agenda.showMore',
    title: 'Show More',
    arguments: [node.groupId],
  };
  return item;
}

function createTaskItem(
  entry: AgendaEntry,
  uri: vscode.Uri | undefined,
  groupId?: string,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    entry.title,
    entry.steps && entry.steps.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  // The group is part of the id: a task with two tags is drawn twice, and
  // VS Code refuses two items with one id.
  item.id = groupId ? `agenda:task:${groupId}:${entry.task.id}` : `agenda:task:${entry.task.id}`;
  item.description = entry.details.join(' · ');
  item.tooltip = createTaskTooltip(entry);
  const done = entry.task.completed;
  item.checkboxState = {
    state: done
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked,
    tooltip: done ? 'Reopen this task' : 'Complete this task',
  };
  // A done task has no dates to set, so it has no date menus.
  item.contextValue = done ? 'deckardAgendaDoneTask' : 'deckardAgendaTask';
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

/**
 * One of a task's steps, under it: checked when done, and its box completes
 * or reopens it; it opens its line, and takes the same menu as a task.
 */
function createStepItem(node: {
  task: Task;
  parentId: string;
  uri: vscode.Uri | undefined;
  groupId?: string;
}): vscode.TreeItem {
  const { task } = node;
  const item = new vscode.TreeItem(
    stripTrailingTags(task.title) || task.title,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `agenda:step:${node.groupId ?? ''}:${node.parentId}:${task.id}`;
  const done = task.completed;
  item.checkboxState = {
    state: done ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked,
    tooltip: done ? 'Reopen this step' : 'Complete this step',
  };
  item.description = task.steps ? describeSteps(task.steps) : undefined;
  item.contextValue = done ? 'deckardAgendaDoneTask' : 'deckardAgendaTask';
  if (node.uri) {
    const position = new vscode.Position(Math.max(task.lineNumber - 1, 0), 0);
    item.command = {
      command: 'vscode.open',
      title: 'Open Task',
      arguments: [node.uri, { selection: new vscode.Range(position, position), preview: false }],
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
export async function pickAgendaGrouping(
  index?: WorkspaceIndex,
): Promise<AgendaGroupBy | undefined> {
  const current = getAgendaGrouping();
  const namespace = getAgendaGroupNamespace();
  const chosen = await vscode.window.showQuickPick(
    AGENDA_GROUPINGS.map((grouping) => ({
      label: grouping.label,
      description:
        grouping.id === current
          ? grouping.id === 'tag'
            ? `Current: #${namespace}`
            : 'Current'
          : undefined,
      detail: grouping.detail,
      id: grouping.id,
    })),
    { title: 'Group tasks by', placeHolder: 'Choose what the groups are' },
  );
  if (!chosen) {
    return undefined;
  }
  if (chosen.id === 'tag') {
    const picked = index ? await pickTagNamespace(index, current === 'tag' ? namespace : undefined) : undefined;
    if (!picked) {
      return undefined;
    }
    const target = vscode.ConfigurationTarget.Global;
    if (!(await writeSetting('agenda.groupNamespace', picked, target))) {
      return undefined;
    }
    return current === 'tag' || (await writeSetting('agenda.groupBy', 'tag', target))
      ? 'tag'
      : undefined;
  }
  if (chosen.id === current) {
    return undefined;
  }
  const written = await writeSetting(
    'agenda.groupBy',
    chosen.id,
    vscode.ConfigurationTarget.Global,
  );
  return written ? chosen.id : undefined;
}

/** The namespace the Tasks view groups by, from `deckard.agenda.groupNamespace`. */
export function getAgendaGroupNamespace(): string {
  const value = vscode.workspace
    .getConfiguration('deckard')
    .get<string>('agenda.groupNamespace', 'project');
  return isNamespaceName(value) ? value.toLowerCase() : 'project';
}

/** Asks which namespace to group by, busiest first; nothing when none is in use. */
export async function pickTagNamespace(
  index: WorkspaceIndex,
  current?: string,
): Promise<string | undefined> {
  const namespaces = listTaskNamespaces(index, [getStatusNamespace()]);
  if (namespaces.length === 0) {
    void vscode.window.showInformationMessage(
      'No open task carries a namespaced tag, such as #context/phone, yet. Write one on a task, or on the heading above it, to group by it.',
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    namespaces.map((namespace) => ({
      label: `#${namespace.name}`,
      description: `${namespace.openTasks} open ${namespace.openTasks === 1 ? 'task' : 'tasks'}${namespace.name === current ? ' · Current' : ''}`,
      detail: describeNamespaceValues(namespace.values),
      name: namespace.name,
    })),
    {
      title: 'Group tasks by tag namespace',
      placeHolder: 'Choose the namespace whose tags are the groups',
    },
  );
  return picked?.name;
}

/** A dragged task and the group it was drawn in. */
interface DraggedTask {
  taskId: string;
  groupId?: string;
}

/** What a drag carries: tasks with their groups, or task ids alone. */
function readDraggedTasks(value: unknown): DraggedTask[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): DraggedTask[] => {
    if (typeof item === 'string') {
      return [{ taskId: item }];
    }
    if (item && typeof item === 'object' && typeof (item as DraggedTask).taskId === 'string') {
      const groupId = (item as DraggedTask).groupId;
      return [{ taskId: (item as DraggedTask).taskId, ...(typeof groupId === 'string' ? { groupId } : {}) }];
    }
    return [];
  });
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
  // Dropped on Done today, a task is done: the board's Done column.
  if (groupId === 'donetoday') {
    return 'done';
  }
  if (groupBy === 'priority') {
    const priority = groupId.slice('priority:'.length);
    return `priority:${priority === 'none' ? '' : priority}`;
  }
  if (groupBy === 'status') {
    return `status:${groupId === 'none' ? '' : groupId}`;
  }
  if (groupBy === 'assignee') {
    // The group's id is the person's tag key, which is what the field holds.
    return `assignee:${groupId === 'none' ? '' : groupId}`;
  }
  if (groupBy === 'tag') {
    // A tag group's id is already the board's column for it.
    return groupId.startsWith('tag:') ? groupId : undefined;
  }
  if (groupBy === 'due') {
    // A day of Upcoming is one date, so a task dropped on it is due then.
    if (groupId.startsWith('upcoming:')) {
      return `due:${groupId.slice('upcoming:'.length)}`;
    }
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

/** The open tasks the Tasks view lists as overdue, as its query selects them. */
export function listOverdueTasks(index: WorkspaceIndex, now = Date.now()): Task[] {
  const selected = selectAgendaTasks(index, getAgendaQuery());
  return (
    createAgenda(index, now, {
      tasks: selected.tasks,
      upcomingDays: getUpcomingDays(),
    })
      .find((group) => group.id === 'overdue')
      ?.entries.map((entry) => entry.task) ?? []
  );
}

/** What the Agenda lists, from `deckard.agenda.query`; empty is every open task. */
export function getAgendaQuery(): string {
  return vscode.workspace.getConfiguration('deckard').get<string>('agenda.query', '');
}

function getUpcomingDays(): number {
  const value = vscode.workspace
    .getConfiguration('deckard')
    .get<number>('agenda.upcomingDays', 7);
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), 90) : 7;
}
