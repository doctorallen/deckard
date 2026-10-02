/**
 * What the Tasks view's groups are and what its settings say: how it is
 * grouped, which namespace a tag grouping uses, what it lists, and how far
 * ahead Upcoming reaches; and which board column a group stands for, so a
 * task dropped on it takes that column's edit.
 */

/** What the Agenda's groups are: when a task is wanted, or what it carries. */
export type AgendaGroupBy = 'due' | 'priority' | 'status' | 'assignee' | 'tag';

/** Every grouping, in the order the picker offers them. */
export const AGENDA_GROUP_BYS: readonly AgendaGroupBy[] = ['due', 'priority', 'status', 'assignee', 'tag'];

/** The part of a settings section the readers here need. */
export interface SettingsReader {
  get<T>(key: string, defaultValue: T): T;
}

/** How the Agenda is grouped, from `deckard.agenda.groupBy`; `due` for anything else. */
export function readAgendaGrouping(settings: SettingsReader): AgendaGroupBy {
  const value = settings.get<string>('agenda.groupBy', 'due');
  return AGENDA_GROUP_BYS.some((grouping) => grouping === value) ? (value as AgendaGroupBy) : 'due';
}

/**
 * The namespace the Tasks view groups by, from `deckard.agenda.groupNamespace`,
 * lowercased; `project` for a name `isNamespaceName` refuses.
 */
export function readAgendaGroupNamespace(
  settings: SettingsReader,
  isNamespaceName: (value: unknown) => boolean,
): string {
  const value = settings.get<string>('agenda.groupNamespace', 'project');
  return isNamespaceName(value) ? value.toLowerCase() : 'project';
}

/** What the Agenda lists, from `deckard.agenda.query`; empty is every open task. */
export function readAgendaQuery(settings: SettingsReader): string {
  return settings.get<string>('agenda.query', '');
}

/** How many days Upcoming reaches, from `deckard.agenda.upcomingDays`: 1 to 90, 7 by default. */
export function readUpcomingDays(settings: SettingsReader): number {
  const value = settings.get<number>('agenda.upcomingDays', 7);
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), 90) : 7;
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
