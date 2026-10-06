import * as vscode from 'vscode';

import { describeSteps } from '../../domain/markdown/taskSteps';
import { escapeMarkdown } from '../../shared/text';
import { AgendaService, AgendaStatus } from '../../services/agendaService';
import { resolveSourceUri } from '../commands/navigation';
import { clickTask, TaskWrites, toggleTask, updateTaskLine } from '../commands/taskActions';
import { rankShown } from '../../domain/tasks/taskRank';
import { TASK_SORT_LABELS } from '../../domain/model/sortOrders';
import { AgendaEntry, AgendaGroup } from '../state/agendaState';
import { AgendaGroupBy } from '../../domain/tasks/agendaGroups';
import { stripTrailingTags } from '../../domain/ranking/entryLabels';
import { Task, WorkspaceIndex } from '../../domain/model';
import { speakRow } from './spokenRow';

/** What the Tasks view reads from the indexer, and when it redraws. */
interface AgendaIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getTask(taskId: string): Task | undefined;
  /** How far the first scan has got, which the waiting message says. */
  readonly scanProgress?: { completed: number; total: number };
  readonly onDidProgress?: vscode.Event<void>;
}

/**
 * What the Agenda reads from preferences, and writes: the order tasks were
 * dragged into, read from the blob and kept by the task layout.
 */
interface AgendaPreferences {
  reader: {
    readonly onDidChange: vscode.Event<unknown>;
    readonly value: { taskOrder: string[] };
  };
  taskLayout: { setTaskOrder(taskOrder: string[]): Promise<void> };
}

/**
 * What the Tasks view reads its groups from and writes through: the agenda
 * service, which builds the view and decides what a drop or a checkbox
 * writes; the task writes those go through; and the view's context keys,
 * which each build publishes.
 */
export interface AgendaTreeServices {
  agenda: AgendaService<AgendaGroup>;
  writes: TaskWrites;
  contextKeys: { publish(keys: { filtered: boolean; querySet: boolean }): void };
}

/**
 * A row of the Tasks view: a group, a task in it, the "Show N more" row
 * under a group cut short, or one of a task's steps.
 */
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

/** The icon each date group is drawn with; every upcoming day shares one. */
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

/**
 * The menus a group offers beyond the default, by group id. Overdue, and
 * what needs a new date, are told apart: they are the groups offered a date
 * for all beside their name.
 */
const GROUP_CONTEXT_VALUES: ReadonlyMap<string, string> = new Map([
  ['overdue', 'deckardAgendaGroup.overdue'],
  ['needsdate', 'deckardAgendaGroup.needsDate'],
  ['donetoday', 'deckardAgendaDoneGroup'],
]);

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

/** What a dragged task carries: the ids being moved, in the order drawn. */
export const AGENDA_TASK_MIME = 'application/vnd.code.tree.deckard.agenda';

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

  /** Draws the index `indexer` publishes, redrawing as it, the settings, and the window's focus change. */
  public constructor(
    private readonly indexer: AgendaIndexSource,
    /** What the view is built from, and what completing, reopening, or moving a task writes through. */
    private readonly services: AgendaTreeServices,
    private readonly preferences?: AgendaPreferences,
  ) {
    this.disposables.push(
      this.changeEmitter,
      ...(preferences ? [preferences.reader.onDidChange(() => this.refresh())] : []),
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

  /** Draws a row: a group, a task, a step, or the row that shows the rest. */
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

  /** The rows under a node: a task's steps, a group's tasks, or the groups themselves. */
  public async getChildren(node?: AgendaNode): Promise<AgendaNode[]> {
    if (node?.kind === 'task') {
      return this.stepsOf(node);
    }
    if (node?.kind === 'more' || node?.kind === 'step') {
      return [];
    }
    if (node?.kind === 'group') {
      return this.entriesOf(node);
    }
    return this.groups();
  }

  /**
   * A task's steps, each read again from the index, so a step completed in
   * another view shows as done here.
   */
  private stepsOf(node: Extract<AgendaNode, { kind: 'task' }>): Promise<AgendaNode[]> {
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

  /** A group's tasks: Overdue cut short at {@link OVERDUE_ROWS} until shown whole. */
  private async entriesOf(node: Extract<AgendaNode, { kind: 'group' }>): Promise<AgendaNode[]> {
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

  /** The groups, as the agenda service builds them, with the badge and message they call for. */
  private groups(): AgendaNode[] {
    if (!this.index) {
      this.setStatus(describeIndexing(this.indexer.scanProgress), 0);
      return [];
    }
    const view = this.services.agenda.buildView(this.index, this.preferences?.reader.value.taskOrder ?? []);
    this.setStatus(describeAgendaStatus(view.status), view.urgent);
    // The way back to every open task is offered while a search narrows it.
    this.services.contextKeys.publish({ filtered: view.filtered, querySet: view.querySet });
    if (this.view) {
      this.view.description = view.query || undefined;
    }
    this.drawn = view.groups;
    return view.groups.map((group) => ({
      kind: 'group' as const,
      group,
      groupBy: view.groupBy,
    }));
  }

  /** Stops listening to the index, the settings, the window, and the checkboxes. */
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
    const nodes = menuNodes(node, selected);
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
      if (await this.sortedByRank()) {
        await this.rankBefore(tasks, target.entry.task.id);
      }
      return;
    }
    await this.moveToGroup(tasks, target, from);
  }

  /**
   * Whether a drop onto a task can rank it: only while the view is sorted by
   * rank, since under any other sort the task would land back where the sort
   * puts it. Offers to sort by rank, which then lets the drop through.
   */
  private async sortedByRank(): Promise<boolean> {
    const sort = this.services.agenda.readSort();
    if (sort === 'rank') {
      return true;
    }
    const choice = await vscode.window.showInformationMessage(
      `The Tasks view is sorted by ${TASK_SORT_LABELS[sort]}, so a task dragged onto another stays where that sort puts it. Sort by rank to put tasks in your own order.`,
      'Sort by Rank',
    );
    return choice === 'Sort by Rank' && (await this.services.agenda.setSort('rank'));
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
    await this.preferences.taskLayout.setTaskOrder(
      rankShown(this.preferences.reader.value.taskOrder, ordered, this.index.tasks.keys()),
    );
    this.refresh();
  }

  /** Writes what belonging to a group means, or says why it cannot. */
  private async moveToGroup(
    tasks: readonly Task[],
    target: { group: AgendaGroup; groupBy: AgendaGroupBy },
    from: ReadonlyMap<string, string | undefined> = new Map(),
  ): Promise<void> {
    const { writes } = this.services;
    const result = await this.services.agenda.moveToGroup(
      tasks,
      { groupId: target.group.id, groupBy: target.groupBy },
      { from, index: () => this.index },
      (step) =>
        step.kind === 'complete'
          ? toggleTask(writes, step.task, true)
          : updateTaskLine(writes, step.task, (line) => step.edit(line), step.label),
    );
    if (result.kind === 'no-edit') {
      void vscode.window.showInformationMessage(
        `"${target.group.label}" is not one change to a task line, so Deckard wrote nothing. Drag the task on the Task Board instead, or edit the task.`,
      );
      return;
    }
    // A refusal explains a rule, so it is said once, after the moves that
    // could be made, rather than once for every task it held back.
    const { moved, refused } = result;
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

  /** Asks VS Code to draw the view again, which rebuilds the groups. */
  private refresh(): void {
    this.changeEmitter.fire();
  }

  /**
   * Sets the view's message and its badge of overdue and due-today tasks;
   * nothing before the view is attached.
   */
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

  /**
   * Completes or reopens the tasks whose boxes were clicked, and redraws if
   * any write failed, so its box shows the line as it still is.
   */
  private async completeTasks(
    event: vscode.TreeCheckboxChangeEvent<AgendaNode>,
  ): Promise<void> {
    // An open task's box completes it; a box under Done today, or a done
    // step's, reopens it.
    const changes = event.items.flatMap(([node, state]) =>
      node.kind === 'task' || node.kind === 'step'
        ? [{ task: node.kind === 'task' ? node.entry.task : node.task, checked: state === vscode.TreeItemCheckboxState.Checked }]
        : [],
    );
    const { failed } = await this.services.agenda.setCompleted(changes, (task, complete) =>
      clickTask(this.services.writes, task, complete),
    );
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

/** What the view says when it lists nothing, or cannot read its search. */
export function describeAgendaStatus(status: AgendaStatus): string | undefined {
  if (!status) {
    return undefined;
  }
  if (status.kind === 'unreadable') {
    return `The Tasks view's search cannot be read: ${status.error} It lists every open task until the search is fixed.`;
  }
  return status.query
    ? `No open task matches the Tasks view's search, "${status.query}".`
    : 'No open tasks.';
}

/**
 * What a task item says when hovered: its words, what it is due and how
 * urgent it is, and where it is written, under the headings above it, so
 * the right one of two similar tasks can be told apart without opening it.
 */
export function createTaskTooltip(entry: AgendaEntry): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.appendMarkdown(`**${escapeMarkdown(entry.title, 'punctuationAndHyphen')}**`);
  if (entry.details.length > 0) {
    tooltip.appendMarkdown(`\n\n${entry.details.map((detail) => escapeMarkdown(detail, 'punctuationAndHyphen')).join(' · ')}`);
  }
  tooltip.appendMarkdown(
    `\n\n$(file) ${escapeMarkdown([entry.fileName, ...entry.context].join(' › '), 'punctuationAndHyphen')}, line ${entry.task.lineNumber}`,
  );
  tooltip.appendMarkdown('\n\nRight-click to date, edit, or break it into steps.');
  return tooltip;
}

/**
 * The rows a menu command was run on: every selected row when the one
 * right-clicked is among them, else that row, and none from the palette.
 */
function menuNodes(
  node: AgendaNode | undefined,
  selected: readonly AgendaNode[] | undefined,
): readonly AgendaNode[] {
  if (!node) {
    return [];
  }
  return selected?.includes(node) ? selected : [node];
}

/**
 * A group's row: its count, its icon, and the menus it offers. What can wait
 * starts folded, and a tag group says what dropping a task on it writes.
 */
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
  item.contextValue = GROUP_CONTEXT_VALUES.get(group.id) ?? 'deckardAgendaGroup';
  return item;
}

/** The row under a group cut short, which shows the rest of it when chosen. */
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

/**
 * A task's row: its checkbox, its details, its menus, and a click that
 * opens its line; it folds open onto its steps when it has any.
 */
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
  const spokenEntry = speakRow(String(item.label ?? ''), item.description);
  if (spokenEntry) {
    item.accessibilityInformation = spokenEntry;
  }
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
  const spokenStep = speakRow(String(item.label ?? ''), item.description);
  if (spokenStep) {
    item.accessibilityInformation = spokenStep;
  }
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
