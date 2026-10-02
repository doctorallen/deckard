import { Task, WorkspaceIndex } from '../domain/model';
import { QueryContext } from '../domain/query/queryContext';
import {
  AgendaGroupBy,
  groupColumnId,
  readAgendaGroupNamespace,
  readAgendaGrouping,
  readAgendaQuery,
  readStatusNamespace,
  readUpcomingDays,
} from '../domain/tasks/agendaGroups';
import { TaskMove } from '../domain/tasks/boardMoves';
import { countLoad, RescheduleContext } from '../domain/tasks/reschedule';
import { quoteTitle, readMetadataFormat } from '../domain/tasks/taskLines';
import type { Configuration } from '../ports/configuration';
import { TaskMetadataFormat } from '../domain/markdown/taskFields';

/**
 * The Tasks view's decisions: what it lists and how it is grouped, which of
 * its groups a dropped task can join and with what edit, which checkbox
 * changes are real, what is overdue, how full a day is when tasks are
 * rescheduled, and which settings a new grouping writes.
 *
 * The view draws what this builds and says what it returns; the writes it
 * decides on go through the task commands, which offer each one's Undo.
 */

/** A group as the service reads one: its id, its name, and its tasks. */
export interface AgendaGroupLike {
  id: string;
  label: string;
  entries: readonly { task: Task }[];
}

/** What building the Agenda takes beyond the index and the moment. */
export interface AgendaBuild {
  tasks?: Iterable<Task>;
  upcomingDays: number;
  groupBy?: AgendaGroupBy;
  statusNamespace?: string;
  groupNamespace?: string;
  taskOrder?: readonly string[];
  doneToday?: boolean;
  upcomingByDay?: boolean;
}

/** The board settings a drop on a group writes with. */
export interface BoardMoveOptions {
  queryContext: QueryContext;
  statuses: readonly string[];
  statusNamespace: string;
  format: TaskMetadataFormat;
}

/**
 * The agenda's view model and the board's move rule, which the view-model
 * layer holds: the tasks a query selects, the groups built from them, the
 * status bar's count, the board's column moves, and what can be a tag
 * namespace. `G` is the group the view draws.
 */
export interface AgendaModel<G extends AgendaGroupLike> {
  select(index: WorkspaceIndex, query: string, context: QueryContext): { tasks: Task[]; error?: string };
  build(index: WorkspaceIndex, context: QueryContext, options: AgendaBuild): G[];
  countDue(index: WorkspaceIndex, context: QueryContext, query: string): { today: number };
  listOverdue(index: WorkspaceIndex, context: QueryContext, settings: { query: string; upcomingDays: number }): Task[];
  resolveMove(
    task: Task,
    columnId: string,
    options: BoardMoveOptions,
    context: { index?: WorkspaceIndex; from?: string },
  ): TaskMove;
  isNamespaceName(value: unknown): boolean;
}

/** The index as the Tasks view reads it. */
export interface AgendaIndex {
  getSnapshot(): WorkspaceIndex;
  getTask(taskId: string): Task | undefined;
  refresh(): PromiseLike<void>;
  /** Settles once the first index is built. */
  readonly ready: PromiseLike<void>;
}

/** What the agenda service reads and writes through. */
export interface AgendaServiceOptions<G extends AgendaGroupLike> {
  /** The `deckard` settings. */
  configuration: Configuration;
  index: AgendaIndex;
  /** The settings and moment a piece of work is done in, read as it starts. */
  readQueryContext(): QueryContext;
  model: AgendaModel<G>;
  /** Writes a `deckard` setting where the reader's own settings are; whether it was. */
  writeSetting(key: string, value: unknown): PromiseLike<boolean>;
}

/**
 * Why the Tasks view has nothing to show, or its search cannot be read;
 * undefined when it lists tasks as asked.
 */
export type AgendaStatus =
  | { kind: 'unreadable'; error: string }
  | { kind: 'empty'; query: string }
  | undefined;

/** The Tasks view as one build draws it. */
export interface AgendaView<G> {
  groups: G[];
  groupBy: AgendaGroupBy;
  /** Tasks overdue or due today however the view is grouped, which its badge counts. */
  urgent: number;
  status: AgendaStatus;
  /** The search, which the view's own line shows. */
  query: string;
  /** A search narrows the list, so the way back to every task is offered. */
  filtered: boolean;
  querySet: boolean;
}

/** One write a drop on a group makes: completing the task, or editing its line. */
export type GroupMoveStep =
  | { kind: 'complete'; task: Task }
  | { kind: 'edit'; task: Task; edit: (line: string) => string; label: string };

/**
 * What a drop on a group did: `no-edit` for a group that is not one change
 * to a task line; else how many tasks moved and the reasons for the ones
 * that could not.
 */
export type GroupMoveResult =
  | { kind: 'no-edit' }
  | { kind: 'moved'; moved: number; refused: string[] };

/** What choosing a grouping wrote: the grouping now in force, nothing, or a refused write. */
export type GroupingChange =
  | { kind: 'grouped'; groupBy: AgendaGroupBy }
  | { kind: 'unchanged' }
  | { kind: 'unwritten' };

/**
 * The Tasks view's decisions, over the index and the settings. Made once,
 * where the extension starts; see the module comment.
 */
export class AgendaService<G extends AgendaGroupLike> {
  /** A service over the index, settings, and view model `options` name. */
  public constructor(private readonly options: AgendaServiceOptions<G>) {}

  /** How the view is grouped, from the settings as they are now. */
  public readGrouping(): { groupBy: AgendaGroupBy; groupNamespace: string } {
    const settings = this.settings();
    return {
      groupBy: readAgendaGrouping(settings),
      groupNamespace: readAgendaGroupNamespace(settings, this.options.model.isNamespaceName),
    };
  }

  /** What the view lists, from `deckard.agenda.query`. */
  public readQuery(): string {
    return readAgendaQuery(this.settings());
  }

  /** The namespace a task's status is written in. */
  public readStatusNamespace(): string {
    return readStatusNamespace(this.settings());
  }

  /**
   * The view for `index`: its groups, badge, and status, built at one
   * moment and one reading of the settings, so the list and its badge agree
   * about what today is. `taskOrder` is the order tasks were dragged into.
   */
  public buildView(index: WorkspaceIndex, taskOrder: readonly string[]): AgendaView<G> {
    const settings = this.settings();
    const days = readUpcomingDays(settings);
    const groupBy = readAgendaGrouping(settings);
    const query = readAgendaQuery(settings);
    const context = this.options.readQueryContext();
    const { model } = this.options;
    const selected = model.select(index, query, context);
    const groups = model.build(index, context, {
      tasks: selected.tasks,
      upcomingDays: days,
      groupBy,
      statusNamespace: readStatusNamespace(settings),
      groupNamespace: readAgendaGroupNamespace(settings, model.isNamespaceName),
      taskOrder,
      doneToday: true,
      upcomingByDay: true,
    });
    // The badge counts what is overdue or due today however the Agenda is
    // grouped, since that is what it is a badge for.
    const urgent = model
      .build(index, context, { tasks: selected.tasks, upcomingDays: days })
      .filter((group) => group.id === 'overdue' || group.id === 'today')
      .reduce((total, group) => total + group.entries.length, 0);
    return {
      groups,
      groupBy,
      urgent,
      status: describeStatus(selected.error, groups, query),
      query,
      filtered: Boolean(query) && !selected.error,
      querySet: Boolean(query),
    };
  }

  /** The open tasks the view lists as overdue now, once the first index is built. */
  public async listOverdue(): Promise<Task[]> {
    await this.options.index.ready;
    const settings = this.settings();
    return this.options.model.listOverdue(this.options.index.getSnapshot(), this.options.readQueryContext(), {
      query: readAgendaQuery(settings),
      upcomingDays: readUpcomingDays(settings),
    });
  }

  /**
   * How full a day is, of what the view lists, read beside the reschedule
   * choices and again after the write. A failed refresh is left for the
   * watcher to catch up; the load is read from what is there.
   */
  public rescheduleContext(): RescheduleContext {
    const { index, model } = this.options;
    return {
      load: (date) =>
        countLoad(model.select(index.getSnapshot(), this.readQuery(), this.options.readQueryContext()).tasks, date),
      refresh: async () => {
        try {
          await index.refresh();
        } catch {
          // The watcher catches up; the load is read from what is there.
        }
      },
      todayCount: () => model.countDue(index.getSnapshot(), this.options.readQueryContext(), this.readQuery()).today,
    };
  }

  /**
   * What a reschedule names its tasks: one by its words, several by how
   * many, as `3 tasks` or, with `noun`, `3 overdue tasks`.
   */
  public describeSubject(tasks: readonly Task[], noun = 'tasks'): string {
    return tasks.length === 1 ? quoteTitle(tasks[0].title) : `${tasks.length} ${noun}`;
  }

  /**
   * Makes the tasks dropped on a group belong to it: each takes the edit the
   * Task board's own drop on that column makes, written by `write` before
   * the next is resolved, from the index as it then is. Each note's tasks
   * are written from the bottom up, so a line one write adds, such as a
   * repeating task's next occurrence, never moves a task still to come. A
   * group that names no single edit writes nothing; a task the move cannot
   * change is left as it is, with the reason.
   */
  public async moveToGroup(
    tasks: readonly Task[],
    target: { groupId: string; groupBy: AgendaGroupBy },
    context: { from: ReadonlyMap<string, string | undefined>; index: () => WorkspaceIndex | undefined },
    write: (step: GroupMoveStep) => Promise<unknown>,
  ): Promise<GroupMoveResult> {
    const columnId = groupColumnId(target.groupId, target.groupBy);
    if (!columnId) {
      return { kind: 'no-edit' };
    }
    const options = this.readBoardOptions(this.options.readQueryContext());
    const refused: string[] = [];
    let moved = 0;
    for (const task of bottomUp(tasks, (task) => task)) {
      const source = context.from.get(task.id);
      const move = this.options.model.resolveMove(task, columnId, options, {
        index: context.index(),
        from: source ? groupColumnId(source, target.groupBy) : undefined,
      });
      if (move.kind === 'refused') {
        refused.push(move.reason);
        continue;
      }
      moved += 1;
      if (move.kind !== 'unchanged') {
        await write(move.kind === 'complete' ? { kind: 'complete', task } : { kind: 'edit', task, edit: move.edit, label: move.label });
      }
    }
    return { kind: 'moved', moved, refused };
  }

  /**
   * Completes or reopens the tasks whose boxes were checked or cleared: a
   * checked box completes an open task, a cleared one reopens a done one,
   * and a box that already says what the task is changes nothing. Each is
   * read again from the index before `toggle` writes it, each note's from
   * the bottom up, as {@link moveToGroup} writes them. Returns whether any
   * could not be written, so the view can give its box back.
   */
  public async setCompleted(
    changes: Iterable<{ task: Task; checked: boolean }>,
    toggle: (task: Task, complete: boolean) => Promise<boolean>,
  ): Promise<{ failed: boolean }> {
    let failed = false;
    for (const { task: drawn, checked } of bottomUp([...changes], (change) => change.task)) {
      if (checked === drawn.completed) {
        continue;
      }
      const task = this.options.index.getTask(drawn.id) ?? drawn;
      if (!(await toggle(task, checked))) {
        failed = true;
      }
    }
    return { failed };
  }

  /**
   * Writes a new grouping where the setting is kept. A tag grouping writes
   * its namespace first, then the grouping unless it is already by tag;
   * choosing the grouping already in force writes nothing.
   */
  public async setGrouping(change: {
    chosen: AgendaGroupBy;
    current: AgendaGroupBy;
    namespace?: string;
  }): Promise<GroupingChange> {
    const { chosen, current, namespace } = change;
    const write = this.options.writeSetting;
    if (chosen === 'tag') {
      if (!(await write('agenda.groupNamespace', namespace))) {
        return { kind: 'unwritten' };
      }
      return current === 'tag' || (await write('agenda.groupBy', 'tag'))
        ? { kind: 'grouped', groupBy: 'tag' }
        : { kind: 'unwritten' };
    }
    if (chosen === current) {
      return { kind: 'unchanged' };
    }
    return (await write('agenda.groupBy', chosen)) ? { kind: 'grouped', groupBy: chosen } : { kind: 'unwritten' };
  }

  /**
   * The board settings a drop writes with, read the way the board reads them,
   * for a drop made in `queryContext`.
   */
  private readBoardOptions(queryContext: QueryContext): BoardMoveOptions {
    const configuration = this.settings();
    return {
      queryContext,
      statuses: configuration.get<string[]>('board.statuses', []) ?? [],
      statusNamespace:
        configuration.get<string>('board.statusNamespace', 'status').trim() ||
        'status',
      format: readMetadataFormat(configuration),
    };
  }

  /** The `deckard` settings as they are now. */
  private settings() {
    return this.options.configuration.getConfiguration('deckard');
  }
}

/**
 * The items note by note, in the order each note first comes, and each
 * note's from its last line up: a write that adds or takes away a line then
 * moves no task written after it.
 */
function bottomUp<T>(items: readonly T[], taskOf: (item: T) => Pick<Task, 'filePath' | 'lineNumber'>): T[] {
  const byNote = new Map<string, T[]>();
  for (const item of items) {
    const note = byNote.get(taskOf(item).filePath) ?? [];
    note.push(item);
    byNote.set(taskOf(item).filePath, note);
  }
  return [...byNote.values()].flatMap((note) =>
    [...note].sort((left, right) => taskOf(right).lineNumber - taskOf(left).lineNumber),
  );
}

/** Why the view shows no task, or cannot read its search; see {@link AgendaStatus}. */
function describeStatus(
  error: string | undefined,
  groups: readonly AgendaGroupLike[],
  query: string,
): AgendaStatus {
  if (error) {
    return { kind: 'unreadable', error };
  }
  return groups.every((group) => group.id === 'donetoday') ? { kind: 'empty', query } : undefined;
}
