/**
 * Moving status tags into checkboxes, and importing a vault's statuses.
 *
 * A note written before statuses had characters says `- [ ] Draft
 * #status/doing`; one written after says `- [/] Draft`. The move rewrites
 * the first as the second where a status has both, takes away a tag a box
 * already contradicts, and leaves every other tag where it is, saying why.
 * Nothing here writes: it lists the edits, and the command shows them.
 */
import type { Task, TaskStatusType } from '../model';
import { readWrittenStatusTag, setTaskStatusTag } from './statusWrites';
import { setTaskLineMark } from '../markdown/taskLineEdits';
import { DEFAULT_TASK_STATUSES, readTaskStatuses, statusForTag, type TaskStatusDefinition } from './taskStatuses';

/**
 * Which group of the move a line is in:
 *
 * - `character`: its tag names a status that has a character, which takes
 *   the tag's place: `- [ ] … #status/doing` becomes `- [/] …`;
 * - `stale`: its box already says its status, so the tag goes:
 *   `- [x] … #status/doing` becomes `- [x] …`;
 * - `done`: an open box tagged done, which the move checks off only when
 *   asked;
 * - `kept`: a tag no status with a character stands for, such as Waiting
 *   or `#status/review`, which stays.
 */
export type StatusMoveGroup = 'character' | 'stale' | 'done' | 'kept';

/** One task line the move looks at: where it is, and what it would become. */
export interface StatusMoveLine {
  filePath: string;
  /** One-based. */
  lineNumber: number;
  before: string;
  /** The line as the move writes it; the same as `before` for a kept tag. */
  after: string;
  group: StatusMoveGroup;
  /** The tag as written after the namespace, `doing`. */
  tag: string;
}

/** What the move is read with: the statuses, the namespace, and the day a checked-off task is done. */
export interface StatusMoveOptions {
  statuses: readonly TaskStatusDefinition[];
  namespace: string;
  /** The ✅ date a task checked off gets; none when not given. */
  doneDate?: string;
}

/**
 * The move, task by task: every task line with a status tag on its own
 * line, in the group it falls in. Only a task's own line moves, as only its
 * own line sets a status.
 */
export function planStatusMove(tasks: Iterable<Task>, options: StatusMoveOptions): StatusMoveLine[] {
  const lines: StatusMoveLine[] = [];
  for (const task of tasks) {
    const before = task.sourceLineText;
    const column = task.checkboxColumn;
    const tag = readWrittenStatusTag(before, column, options.namespace);
    if (tag === undefined) {
      continue;
    }
    const at = { filePath: task.filePath, lineNumber: task.lineNumber, before, tag };
    const untagged = setTaskStatusTag(before, column, options.namespace, undefined);
    if (task.status.symbol !== ' ') {
      lines.push({ ...at, after: untagged, group: 'stale' });
      continue;
    }
    if (tag === 'done') {
      const after = setTaskLineMark(untagged, column, {
        symbol: 'x',
        closed: 'done',
        ...(options.doneDate ? { closedDate: options.doneDate } : {}),
      });
      lines.push({ ...at, after, group: 'done' });
      continue;
    }
    const status = statusForTag(options.statuses, tag);
    if (status?.symbol === undefined || status.symbol === ' ') {
      lines.push({ ...at, after: before, group: 'kept' });
      continue;
    }
    lines.push({ ...at, after: setTaskLineMark(untagged, column, { symbol: status.symbol, closed: undefined }), group: 'character' });
  }
  return lines;
}

/** How many lines each group of a move holds, for the sentence that offers it. */
export function countStatusMove(lines: readonly StatusMoveLine[]): Record<StatusMoveGroup, number> {
  const counts: Record<StatusMoveGroup, number> = { character: 0, stale: 0, done: 0, kept: 0 };
  lines.forEach((line) => {
    counts[line.group] += 1;
  });
  return counts;
}

/** Obsidian Tasks' status types, as its data.json writes them, and Deckard's for each. */
const OBSIDIAN_TYPES: Readonly<Record<string, TaskStatusType>> = {
  TODO: 'todo',
  IN_PROGRESS: 'inProgress',
  ON_HOLD: 'onHold',
  DONE: 'done',
  CANCELLED: 'cancelled',
  NON_TASK: 'nonTask',
};

/** One status as Obsidian Tasks' settings write it. */
interface ObsidianStatus {
  symbol?: unknown;
  name?: unknown;
  nextStatusSymbol?: unknown;
  type?: unknown;
}

/**
 * The statuses an Obsidian Tasks `data.json` defines, core then custom, as
 * `deckard.tasks.statuses` lists them: each with Deckard's type for its
 * own, its next symbol for the workflow, and the tag Deckard's own status
 * of that character stands for, so a note written with tags still reads.
 * Deckard's statuses written only as tags (Waiting, Someday) follow, and
 * `X` stays Done unless the vault says what it is. Undefined for a file
 * that holds no statuses.
 */
export function importObsidianStatuses(data: unknown): TaskStatusDefinition[] | undefined {
  const settings = (data as { statusSettings?: { coreStatuses?: unknown; customStatuses?: unknown } } | null)?.statusSettings;
  const listed = [settings?.coreStatuses, settings?.customStatuses].flatMap((list) => (Array.isArray(list) ? (list as ObsidianStatus[]) : []));
  const imported = listed.flatMap((status): TaskStatusDefinition[] => {
    const type = typeof status.type === 'string' ? OBSIDIAN_TYPES[status.type] : undefined;
    if (typeof status.symbol !== 'string' || typeof status.name !== 'string' || !status.name.trim() || !type) {
      return [];
    }
    const own = DEFAULT_TASK_STATUSES.find((candidate) => candidate.symbol === status.symbol && candidate.type === type);
    return [{
      symbol: status.symbol,
      name: status.name.trim(),
      type,
      ...(own?.tag ? { tag: own.tag } : {}),
      ...(typeof status.nextStatusSymbol === 'string' && status.nextStatusSymbol ? { next: status.nextStatusSymbol } : {}),
    }];
  });
  if (imported.length === 0) {
    return undefined;
  }
  const tagOnly = DEFAULT_TASK_STATUSES.filter((status) => status.symbol === undefined);
  return readTaskStatuses([...imported, ...tagOnly]);
}

/** A status renamed: what it was called, and what it is called now. */
export interface StatusRename {
  from: string;
  to: string;
}

/**
 * The statuses a new list renames: one with the same character, or, with
 * no character, the same tag, called something else now. A search by the
 * old name finds nothing once it is saved, so these are the names to carry.
 */
export function findStatusRenames(before: readonly TaskStatusDefinition[], after: readonly TaskStatusDefinition[]): StatusRename[] {
  const renames: StatusRename[] = [];
  for (const old of before) {
    const now = after.find((status) =>
      old.symbol === undefined ? status.symbol === undefined && status.tag === old.tag : status.symbol === old.symbol,
    );
    if (now && normalizeName(now.name) !== normalizeName(old.name) && !renames.some((rename) => normalizeName(rename.from) === normalizeName(old.name))) {
      renames.push({ from: old.name, to: now.name });
    }
  }
  return renames;
}

/** A name as a search compares it. */
function normalizeName(name: string): string {
  return name.toLocaleLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

/** A `status:` condition: the field and its operator, then its value, quoted or not. */
const STATUS_CONDITION = /(\bstatus[ \t]*(?:!=|[:=])[ \t]*)("[^"]*"|[^\s()]+)/gi;

/**
 * A search with every `status:` naming the renamed status by its old name
 * naming it by its new one, a hyphen for a space, and the rest as written.
 */
export function renameStatusInQuery(query: string, rename: StatusRename): string {
  return query.replace(STATUS_CONDITION, (whole, head: string, value: string) => {
    const written = value.startsWith('"') ? value.slice(1, -1) : value;
    return normalizeName(written) === normalizeName(rename.from)
      ? `${head}${normalizeName(rename.to).replace(/ /g, '-')}`
      : whole;
  });
}
