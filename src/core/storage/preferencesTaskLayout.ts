import type {
  AgendaGroupBy,
  TableSort,
  TaskBoardGroupBy,
  TaskColumnId,
  TaskLayout,
  TaskSortMode,
} from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import { normalizeStatusNames, normalizeTableColumns, normalizeTableSort } from './preferencesSchema';

/**
 * How tasks are ordered and laid out: the reader's own rank order, the sort
 * the task lists use, the Task Board's layout, grouping, table, and parent
 * tags, and how the Tasks view is grouped and sorted.
 */
export class TaskLayoutService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /**
   * Keeps a task's place in the rank order when Deckard's own edit rewrites
   * its line. A task's id comes from the text after its checkbox, so stamping
   * a done date on it, or taking one off again, makes it a new task to
   * anything keyed by id, and it would fall to the end of a ranked list.
   */
  public async replaceTaskInOrder(
    previousId: string,
    nextId: string,
  ): Promise<void> {
    const index = this.repository.current.taskOrder.indexOf(previousId);
    if (index < 0 || previousId === nextId) {
      return;
    }
    const taskOrder = [...this.repository.current.taskOrder];
    taskOrder[index] = nextId;
    await this.repository.update({ taskOrder: [...new Set(taskOrder)] });
  }

  /**
   * Stores custom task order independently of date-based task sorting.
   */
  public async setTaskOrder(taskOrder: string[]): Promise<void> {
    await this.repository.update({ taskOrder: [...new Set(taskOrder)] });
  }

  /**
   * Selects rank, creation-date, or update-date task ordering.
   */
  public async setTaskSortMode(taskSortMode: TaskSortMode): Promise<void> {
    await this.repository.update({ taskSortMode });
  }

  /**
   * Shows the Task Board's tasks as a list or as columns.
   */
  public async setTaskBoardLayout(taskBoardLayout: TaskLayout): Promise<void> {
    await this.repository.update({ taskBoardLayout });
  }

  /**
   * Chooses what the board's columns group by. A tag grouping takes the
   * namespace whose tags are the columns, kept lowercased; without one, the
   * namespace chosen before is kept.
   */
  public async setTaskBoardGroup(
    taskBoardGroup: TaskBoardGroupBy,
    namespace?: string,
  ): Promise<void> {
    await this.repository.update(
      taskBoardGroup === 'tag' && namespace
        ? { taskBoardGroup, taskBoardGroupNamespace: namespace.toLowerCase() }
        : { taskBoardGroup },
    );
  }

  /** Orders the board's status columns, by status name, as its gear's rows are dragged. */
  public async setTaskBoardColumnOrder(names: readonly string[]): Promise<void> {
    await this.repository.update({ taskBoardColumnOrder: normalizeStatusNames(names) ?? [] });
  }

  /** Chooses the statuses the board draws no column for, by name. */
  public async setTaskBoardHiddenColumns(names: readonly string[]): Promise<void> {
    await this.repository.update({ taskBoardHiddenColumns: normalizeStatusNames(names) ?? [] });
  }

  /** Chooses the table layout's columns; the title is always among them. */
  public async setTaskTableColumns(columns: TaskColumnId[]): Promise<void> {
    await this.repository.update({ taskTableColumns: normalizeTableColumns(columns) });
  }

  /** Sorts the table layout by a column, or by nothing: the rank order. */
  public async setTaskTableSort(sort: TableSort | undefined): Promise<void> {
    await this.repository.update({ taskTableSort: normalizeTableSort(sort) });
  }

  /** Shows each board card's and row's nearest parent tag, or not. */
  public async setBoardParentTag(shown: boolean): Promise<void> {
    await this.repository.update({ boardParentTag: shown ? true : undefined });
  }

  /**
   * Chooses what the Tasks view's groups are. A tag grouping takes the
   * namespace whose tags are the groups, kept lowercased; without one, the
   * namespace chosen before is kept. Each is kept only when it isn't the
   * default: by due date, and `project`.
   */
  public async setAgendaGrouping(groupBy: AgendaGroupBy, namespace?: string): Promise<void> {
    const kept = namespace?.toLowerCase();
    await this.repository.update({
      agendaGroupBy: groupBy === 'due' ? undefined : groupBy,
      ...(groupBy === 'tag' && kept ? { agendaGroupNamespace: kept === 'project' ? undefined : kept } : {}),
    });
  }

  /** Chooses how each of the Tasks view's groups orders its tasks; by rank is kept as nothing. */
  public async setAgendaSort(sort: TaskSortMode): Promise<void> {
    await this.repository.update({ agendaSort: sort === 'rank' ? undefined : sort });
  }
}
