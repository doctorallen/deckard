/**
 * What the Tasks view's groups are and how it is grouped and sorted, as its
 * preferences keep them; what it lists, from its setting; how far ahead
 * Upcoming reaches; and which board column a group stands for, so a task
 * dropped on it takes that column's edit.
 */

import type { AgendaGroupBy, PersistedPreferences, TaskSortMode } from '../model/preferences';

export { AGENDA_GROUP_BYS, type AgendaGroupBy } from '../model/preferences';

/** The part of a settings section the readers here need. */
export interface SettingsReader {
  get<T>(key: string, defaultValue: T): T;
}

/** The preferences the Tasks view's grouping and sort are kept in. */
export type AgendaViewChoices = Pick<PersistedPreferences, 'agendaGroupBy' | 'agendaGroupNamespace' | 'agendaSort'>;

/** How the Tasks view is grouped: by due date unless the reader chose otherwise. */
export function readAgendaGrouping(choices: AgendaViewChoices): AgendaGroupBy {
  return choices.agendaGroupBy ?? 'due';
}

/** How each of the Tasks view's groups orders its tasks: by rank unless the reader chose otherwise. */
export function readAgendaSort(choices: AgendaViewChoices): TaskSortMode {
  return choices.agendaSort ?? 'rank';
}

/**
 * The namespace the Tasks view groups by when it groups by tag, lowercased;
 * `project` until one is chosen, and for a name `isNamespaceName` refuses.
 */
export function readAgendaGroupNamespace(
  choices: AgendaViewChoices,
  isNamespaceName: (value: unknown) => boolean,
): string {
  const value = choices.agendaGroupNamespace;
  return value !== undefined && isNamespaceName(value) ? value.toLowerCase() : 'project';
}

/**
 * What the Agenda lists, from `deckard.tasks.viewQuery`; empty is every open
 * task, and so is a value that is not text, as a hand-edited settings.json
 * can hold.
 */
export function readAgendaQuery(settings: SettingsReader): string {
  const value = settings.get<unknown>('tasks.viewQuery', '');
  return typeof value === 'string' ? value : '';
}

/** How many days the Tasks view's Upcoming reaches: a week. */
export const UPCOMING_DAYS = 7;

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
    // The group's id is the key of the board's column for its status.
    return `status:${groupId}`;
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
