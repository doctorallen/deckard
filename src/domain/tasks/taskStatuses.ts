/**
 * Task statuses: what each checkbox character means. A status has a
 * character, a name, a type, and, optionally, the `#status/…` tag it stands
 * for, the character a click moves it to in the workflow, and an icon.
 * `deckard.tasks.statuses` lists them; this module reads that list, fills in
 * what it must have, and finds a character's status. It is pure: a caller
 * reads the setting and passes the value in.
 */
import type { TaskStatus, TaskStatusType } from '../model';
import { isStatusColumnName } from './taskColumns';

/** The icons an open status may add to its box. */
export const TASK_STATUS_ICONS = ['blocked', 'question', 'alert', 'star', 'flag', 'clock'] as const;
/** An icon's name. */
export type TaskStatusIcon = (typeof TASK_STATUS_ICONS)[number];

/** Every type, in the order a picker offers them. */
export const TASK_STATUS_TYPES: readonly TaskStatusType[] = ['todo', 'inProgress', 'onHold', 'done', 'cancelled', 'nonTask'];

/** One status as `deckard.tasks.statuses` lists it. */
export interface TaskStatusDefinition {
  /** The character between the brackets; none for a status written only as a tag, such as Waiting. */
  readonly symbol?: string;
  readonly name: string;
  readonly type: TaskStatusType;
  /** The part after the status namespace of the tag it stands for: `doing` for `#status/doing`. */
  readonly tag?: string;
  /** The character a click moves it to when `deckard.tasks.checkboxClick` is `workflow`. */
  readonly next?: string;
  readonly icon?: TaskStatusIcon;
}

/** Deckard's statuses when the setting names none. */
export const DEFAULT_TASK_STATUSES: readonly TaskStatusDefinition[] = [
  { symbol: ' ', name: 'Todo', type: 'todo', tag: 'todo', next: 'x' },
  { symbol: '/', name: 'In progress', type: 'inProgress', tag: 'doing', next: 'x' },
  { symbol: 'x', name: 'Done', type: 'done', next: ' ' },
  { symbol: 'X', name: 'Done', type: 'done', next: ' ' },
  { symbol: '-', name: 'Cancelled', type: 'cancelled', next: ' ' },
  { name: 'Waiting', type: 'onHold', tag: 'waiting' },
  { name: 'Someday', type: 'onHold', tag: 'someday' },
  { symbol: '=', name: 'Blocked', type: 'onHold', tag: 'blocked', icon: 'blocked', next: ' ' },
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

/** One entry of the setting as a status, or undefined when it can't be one. */
function readDefinition(value: unknown): TaskStatusDefinition | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name || !isTaskStatusType(entry.type)) {
    return undefined;
  }
  const symbol = isStatusSymbol(entry.symbol) ? entry.symbol : undefined;
  const tag = typeof entry.tag === 'string' ? entry.tag.trim().replace(/^#/, '').toLowerCase() : '';
  const hasTag = isStatusColumnName(tag) && entry.type !== 'nonTask';
  if (symbol === undefined && !hasTag) {
    return undefined;
  }
  const icon = TASK_STATUS_ICONS.find((known) => known === entry.icon);
  return {
    ...(symbol === undefined ? {} : { symbol }),
    name,
    type: entry.type,
    ...(hasTag ? { tag } : {}),
    ...(isStatusSymbol(entry.next) ? { next: entry.next } : {}),
    ...(icon ? { icon } : {}),
  };
}

/** A tag's name as a status's: `someday` to Someday. */
function nameTag(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1).replace(/[-_]/g, ' ');
}

/**
 * The statuses `deckard.tasks.statuses` lists, ready to read a note with:
 * an entry that can't be a status is left out; a character given twice is
 * read as the first status that gives it, as in Obsidian, and a tag
 * likewise; ` ` and `x` are always there, as Todo and Done, and keep their
 * types, and `X` is Done unless the list says what it is. A value that is not a list, or lists nothing, reads as Deckard's
 * own. `onHoldStatuses`, `deckard.tasks.onHoldStatuses`, is read as it was
 * before statuses had types: each tag it lists that no status stands for is
 * an on-hold status of its own.
 */
export function readTaskStatuses(value: unknown, onHoldStatuses?: unknown): TaskStatusDefinition[] {
  const listed = Array.isArray(value) ? value.flatMap((entry) => readDefinition(entry) ?? []) : [];
  const symbols = new Set<string>();
  const tags = new Set<string>();
  const statuses: TaskStatusDefinition[] = [];
  const add = (status: TaskStatusDefinition): void => {
    if (status.symbol !== undefined && symbols.has(status.symbol)) {
      return;
    }
    const tag = status.tag !== undefined && tags.has(status.tag) ? undefined : status.tag;
    if (status.symbol === undefined && tag === undefined) {
      return;
    }
    const { tag: _given, ...rest } = status;
    statuses.push(tag === undefined ? rest : { ...rest, tag });
    if (status.symbol !== undefined) {
      symbols.add(status.symbol);
    }
    if (tag !== undefined) {
      tags.add(tag);
    }
  };
  (listed.length ? listed : DEFAULT_TASK_STATUSES).forEach((status) => {
    const core = CORE_STATUSES.find((known) => known.symbol === status.symbol);
    add(core && status.type !== core.type ? { ...status, type: core.type } : status);
  });
  CORE_STATUSES.forEach((core) => {
    if (symbols.has(core.symbol as string)) {
      return;
    }
    statuses.splice(core.type === 'todo' ? 0 : statuses.length, 0, core);
    symbols.add(core.symbol as string);
  });
  // `X` has always been Done in Deckard; a list that doesn't say otherwise keeps it so.
  add(DEFAULT_TASK_STATUSES[3]);
  if (Array.isArray(onHoldStatuses)) {
    onHoldStatuses
      .filter(isStatusColumnName)
      .map((tag) => tag.toLowerCase())
      .forEach((tag) => add({ name: nameTag(tag), type: 'onHold', tag }));
  }
  return statuses;
}

/** Each list's statuses by character, worked out once per list. */
const bySymbolCache = new WeakMap<readonly TaskStatusDefinition[], ReadonlyMap<string, TaskStatusDefinition>>();

/** A list's statuses by their characters. */
function bySymbol(statuses: readonly TaskStatusDefinition[]): ReadonlyMap<string, TaskStatusDefinition> {
  let known = bySymbolCache.get(statuses);
  if (!known) {
    known = new Map(statuses.flatMap((status) => (status.symbol === undefined ? [] : [[status.symbol, status] as const])));
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
 * The statuses from settings, `deckard.tasks.statuses` with
 * `deckard.tasks.onHoldStatuses` read as an alias, given the settings of the
 * `deckard` section in the scope a note is read in.
 */
export function readTaskStatusSettings(settings: { get<T>(key: string): T | undefined }): TaskStatusDefinition[] {
  return readTaskStatuses(settings.get<unknown>('tasks.statuses'), settings.get<unknown>('tasks.onHoldStatuses'));
}
