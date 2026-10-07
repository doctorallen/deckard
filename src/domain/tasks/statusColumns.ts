/**
 * The board's status columns, as a view of the status list: the list says
 * what statuses there are, and the board's gear says which are columns and
 * in what order, by name (`taskBoardColumnOrder`, `taskBoardHiddenColumns`).
 * The Task Board and the Tasks view's By status read their order here, so
 * the two agree. It is pure: a caller passes the list and the choices in.
 */
import type { Task, TaskStatusType } from '../model';
import { isOpenType, normalizeStatusName, statusColumnKey, type TaskStatusDefinition, UNKNOWN_STATUS_NAME } from './taskStatuses';

/** The statuses the board hides when the gear has said nothing: Cancelled, as before. */
export const DEFAULT_HIDDEN_COLUMNS: readonly string[] = ['Cancelled'];

/** What the gear chose: the columns' order and the ones hidden, each by status name. */
export interface StatusColumnChoices {
  /** By status name; a status not named follows those named, in the list's order. */
  readonly order?: readonly string[];
  /** By status name; Cancelled when not given. */
  readonly hidden?: readonly string[];
}

/** One status the board may draw a column for, in the board's order. */
export interface StatusColumnEntry {
  /** What its column goes by: its name as a slug, or `unknown-<code point>` for a character no status names. */
  readonly key: string;
  readonly name: string;
  /** The character its box has: the first status of its name's. */
  readonly symbol: string;
  readonly type: TaskStatusType;
  /** Whether the gear hides it, so the board draws no column for it. */
  readonly hidden: boolean;
}

/** The key of the column for a character no status names: `unknown-63` for `?`. */
export function unknownColumnKey(symbol: string): string {
  return `unknown-${symbol.codePointAt(0) ?? 0}`;
}

/** The character an unknown column's key stands for, or undefined for any other key. */
export function readUnknownColumnKey(key: string): string | undefined {
  const match = /^unknown-(\d+)$/.exec(key);
  const code = match ? Number(match[1]) : NaN;
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

/** Whether a status name is among `names`, as a search compares names. */
function isNamed(names: readonly string[], name: string): boolean {
  const wanted = normalizeStatusName(name);
  return names.some((each) => normalizeStatusName(each) === wanted);
}

/**
 * The open statuses in the board's order, each once by name: those the
 * gear orders, in its order, then the rest in the list's; each says
 * whether the gear hides it. A status of a name given twice is the first.
 */
export function orderOpenStatuses(statuses: readonly TaskStatusDefinition[], choices: StatusColumnChoices = {}): StatusColumnEntry[] {
  const hidden = choices.hidden ?? DEFAULT_HIDDEN_COLUMNS;
  const byKey = new Map<string, StatusColumnEntry>();
  statuses.filter((status) => isOpenType(status.type)).forEach((status) => {
    const key = statusColumnKey(status);
    if (!byKey.has(key)) {
      byKey.set(key, { key, name: status.name, symbol: status.symbol, type: status.type, hidden: isNamed(hidden, status.name) });
    }
  });
  const ordered = (choices.order ?? []).flatMap((name) => {
    const entry = byKey.get(statusColumnKey({ name }));
    return entry ? [entry] : [];
  });
  return [...new Set([...ordered, ...byKey.values()])];
}

/**
 * The columns for characters no status names that open tasks use, one per
 * character, in code point order, each an Unknown to do.
 */
export function listUnknownColumns(tasks: Iterable<Pick<Task, 'status'>>, statuses: readonly TaskStatusDefinition[]): StatusColumnEntry[] {
  const named = new Set(statuses.map((status) => status.symbol));
  const found = new Set<string>();
  for (const task of tasks) {
    if (task.status.name === UNKNOWN_STATUS_NAME && !named.has(task.status.symbol)) {
      found.add(task.status.symbol);
    }
  }
  return [...found]
    .sort((left, right) => (left.codePointAt(0) ?? 0) - (right.codePointAt(0) ?? 0))
    .map((symbol) => ({ key: unknownColumnKey(symbol), name: UNKNOWN_STATUS_NAME, symbol, type: 'todo' as const, hidden: false }));
}

/** The status a closed column stands for, the first of its type in the list: Done's and Cancelled's. */
export function findClosedStatus(statuses: readonly TaskStatusDefinition[], type: 'done' | 'cancelled'): TaskStatusDefinition | undefined {
  return statuses.find((status) => status.type === type);
}

/** Whether the gear hides the Cancelled column: its status's name is among the hidden ones. */
export function isCancelledHidden(statuses: readonly TaskStatusDefinition[], choices: StatusColumnChoices = {}): boolean {
  return isNamed(choices.hidden ?? DEFAULT_HIDDEN_COLUMNS, findClosedStatus(statuses, 'cancelled')?.name ?? 'Cancelled');
}

/** The column key a task's status goes by: its status's, or its unknown character's. */
export function readTaskColumnKey(task: Pick<Task, 'status'>, statuses: readonly TaskStatusDefinition[]): string {
  const status = statuses.find((candidate) => candidate.symbol === task.status.symbol);
  return status ? statusColumnKey(status) : unknownColumnKey(task.status.symbol);
}
