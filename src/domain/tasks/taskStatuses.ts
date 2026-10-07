/**
 * Task statuses: what each checkbox character means. A status has a
 * character, a name, a type, and, optionally, the character a click moves
 * it to in the workflow, and an icon. A task's status is its box's
 * character and nothing else, as in Obsidian Tasks: a `#status/doing` tag is
 * a tag like any other. `deckard.tasks.statuses` lists them; this module
 * reads that list, fills in what it must have, and finds a character's
 * status. It is pure: a caller reads the setting and passes the value in.
 */
import type { Task, TaskStatus, TaskStatusType } from '../model';

/** The icons an open status may add to its box. */
export const TASK_STATUS_ICONS = ['blocked', 'question', 'alert', 'star', 'flag', 'clock'] as const;
/** An icon's name. */
export type TaskStatusIcon = (typeof TASK_STATUS_ICONS)[number];

/** Every type, in the order a picker offers them. */
export const TASK_STATUS_TYPES: readonly TaskStatusType[] = ['todo', 'inProgress', 'onHold', 'done', 'cancelled', 'nonTask'];

/** One status as `deckard.tasks.statuses` lists it. */
export interface TaskStatusDefinition {
  /** The character between the brackets. */
  readonly symbol: string;
  readonly name: string;
  readonly type: TaskStatusType;
  /** The character a click moves it to when `deckard.tasks.checkboxClick` is `workflow`. */
  readonly next?: string;
  readonly icon?: TaskStatusIcon;
}

/** Deckard's statuses when the setting names none. */
export const DEFAULT_TASK_STATUSES: readonly TaskStatusDefinition[] = [
  { symbol: ' ', name: 'Todo', type: 'todo', next: 'x' },
  { symbol: '/', name: 'In progress', type: 'inProgress', next: 'x' },
  { symbol: 'x', name: 'Done', type: 'done', next: ' ' },
  { symbol: 'X', name: 'Done', type: 'done', next: ' ' },
  { symbol: '-', name: 'Cancelled', type: 'cancelled', next: ' ' },
  { symbol: 'w', name: 'Waiting', type: 'onHold', next: ' ' },
  { symbol: 's', name: 'Someday', type: 'onHold', next: ' ' },
  { symbol: '=', name: 'Blocked', type: 'onHold', icon: 'blocked', next: ' ' },
];

/** The name a character no status names is given. */
export const UNKNOWN_STATUS_NAME = 'Unknown';

/**
 * The characters a status may not have: `>` is Deckard's migrated task and
 * `]` closes the box. A line break or a tab can't be written in one.
 */
const RESERVED_SYMBOLS = new Set(['>', ']', '\n', '\r', '\t']);

/** The two statuses every list has, as in Obsidian: their characters and types are fixed. */
const CORE_STATUSES: readonly TaskStatusDefinition[] = [DEFAULT_TASK_STATUSES[0], DEFAULT_TASK_STATUSES[2]];

/** Whether a value is a status type. */
export function isTaskStatusType(value: unknown): value is TaskStatusType {
  return typeof value === 'string' && (TASK_STATUS_TYPES as readonly string[]).includes(value);
}

/** Whether a character can be a status's: one character, and not one the box reserves. */
export function isStatusSymbol(value: unknown): value is string {
  return typeof value === 'string' && [...value].length === 1 && !RESERVED_SYMBOLS.has(value);
}

/**
 * One entry of the setting as a status, or undefined when it can't be one:
 * a status has a name, a type, and a character. An entry with no character,
 * which a status written as a tag once was, is left out.
 */
function readDefinition(value: unknown): TaskStatusDefinition | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name || !isTaskStatusType(entry.type) || !isStatusSymbol(entry.symbol)) {
    return undefined;
  }
  const icon = TASK_STATUS_ICONS.find((known) => known === entry.icon);
  return {
    symbol: entry.symbol,
    name,
    type: entry.type,
    ...(isStatusSymbol(entry.next) ? { next: entry.next } : {}),
    ...(icon ? { icon } : {}),
  };
}

/**
 * The statuses `deckard.tasks.statuses` lists, ready to read a note with:
 * an entry that can't be a status is left out; a character given twice is
 * read as the first status that gives it, as in Obsidian; ` ` and `x` are
 * always there, as Todo and Done, and keep their types, and `X` is Done
 * unless the list says what it is. A value that is not a list, or lists
 * nothing, reads as Deckard's own.
 */
export function readTaskStatuses(value: unknown): TaskStatusDefinition[] {
  const listed = Array.isArray(value) ? value.flatMap((entry) => readDefinition(entry) ?? []) : [];
  const symbols = new Set<string>();
  const statuses: TaskStatusDefinition[] = [];
  const add = (status: TaskStatusDefinition): void => {
    if (symbols.has(status.symbol)) {
      return;
    }
    statuses.push(status);
    symbols.add(status.symbol);
  };
  (listed.length ? listed : DEFAULT_TASK_STATUSES).forEach((status) => {
    const core = CORE_STATUSES.find((known) => known.symbol === status.symbol);
    add(core && status.type !== core.type ? { ...status, type: core.type } : status);
  });
  CORE_STATUSES.forEach((core) => {
    if (symbols.has(core.symbol)) {
      return;
    }
    statuses.splice(core.type === 'todo' ? 0 : statuses.length, 0, core);
    symbols.add(core.symbol);
  });
  // `X` has always been Done in Deckard; a list that doesn't say otherwise keeps it so.
  add(DEFAULT_TASK_STATUSES[3]);
  return statuses;
}

/** Each list's statuses by character, worked out once per list. */
const bySymbolCache = new WeakMap<readonly TaskStatusDefinition[], ReadonlyMap<string, TaskStatusDefinition>>();

/** A list's statuses by their characters. */
function bySymbol(statuses: readonly TaskStatusDefinition[]): ReadonlyMap<string, TaskStatusDefinition> {
  let known = bySymbolCache.get(statuses);
  if (!known) {
    known = new Map(statuses.map((status) => [status.symbol, status] as const));
    bySymbolCache.set(statuses, known);
  }
  return known;
}

/**
 * The status a checkbox's character gives a task: the one the list names
 * for it, or, for a character no status names, an Unknown to do, as in
 * Obsidian, so a vault's counts match.
 */
export function statusForSymbol(statuses: readonly TaskStatusDefinition[], symbol: string): TaskStatus {
  const status = bySymbol(statuses).get(symbol);
  return status ? { symbol, name: status.name, type: status.type } : { symbol, name: UNKNOWN_STATUS_NAME, type: 'todo' };
}

/** Whether a character marks a line that is not a task, by its status's `nonTask` type. */
export function isNonTaskSymbol(statuses: readonly TaskStatusDefinition[], symbol: string): boolean {
  return bySymbol(statuses).get(symbol)?.type === 'nonTask';
}

/** Whether a type is open: to do, in progress, or on hold. */
export function isOpenType(type: TaskStatusType): boolean {
  return type === 'todo' || type === 'inProgress' || type === 'onHold';
}

/** Whether a type is closed: done or cancelled. */
export function isClosedType(type: TaskStatusType): boolean {
  return type === 'done' || type === 'cancelled';
}

/**
 * The statuses from settings, `deckard.tasks.statuses`, given the settings
 * of the `deckard` section in the scope a note is read in.
 */
export function readTaskStatusSettings(settings: { get<T>(key: string): T | undefined }): TaskStatusDefinition[] {
  return readTaskStatuses(settings.get<unknown>('tasks.statuses'));
}

/** Whether a task is open: neither done nor cancelled, as its checkbox says. */
export function isOpenTask(task: Pick<Task, 'completed' | 'status'>): boolean {
  return !task.completed && task.status.type !== 'cancelled';
}

/** Whether a task is cancelled: closed, but not done. */
export function isCancelledTask(task: Pick<Task, 'status'>): boolean {
  return task.status.type === 'cancelled';
}

/**
 * How far along some tasks are: how many are done, out of those that count.
 * A cancelled task counts on neither side, so cancelling one moves nothing
 * nearer done and nothing further away.
 */
export function countTaskProgress(tasks: Iterable<Pick<Task, 'completed' | 'status'>>): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const task of tasks) {
    if (isCancelledTask(task)) {
      continue;
    }
    total += 1;
    done += task.completed ? 1 : 0;
  }
  return { done, total };
}

/** A status's name as a search compares it: lower case, a hyphen or an underscore read as a space. */
export function normalizeStatusName(name: string): string {
  return name.toLocaleLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

/**
 * What a task's status is called where a table or a card names it: its
 * status's name, or nothing for a plain `[ ]`, whose box says all there is.
 */
export function nameTaskStatus(task: Pick<Task, 'status'>): string | undefined {
  return task.status.symbol === ' ' ? undefined : task.status.name;
}

/** A status's name as a search or a column writes it: lower case, a hyphen for a space. */
export function slugStatusName(name: string): string {
  return normalizeStatusName(name).replace(/ /g, '-');
}

/**
 * The key a board's status column goes by, which `deckard.board.limits`
 * names: its status's name as a slug, `in-progress`.
 */
export function statusColumnKey(status: Pick<TaskStatusDefinition, 'name'>): string {
  return slugStatusName(status.name);
}

/** The open status a column key stands for, by its name as a slug. */
export function statusForColumnKey(statuses: readonly TaskStatusDefinition[], key: string): TaskStatusDefinition | undefined {
  const wanted = key.toLowerCase();
  return statuses.find((status) => isOpenType(status.type) && slugStatusName(status.name) === wanted);
}

/**
 * The status column a task sits in, by key: its box's status's. Undefined
 * for a character no status names.
 */
export function readStatusColumnKey(
  task: Pick<Task, 'status'>,
  statuses: readonly TaskStatusDefinition[],
): string | undefined {
  const status = bySymbol(statuses).get(task.status.symbol);
  return status ? statusColumnKey(status) : undefined;
}
