/**
 * Moving status tags into checkboxes, and importing a vault's statuses.
 *
 * A note written before a status was its checkbox's character alone says
 * `- [ ] Draft #status/doing`; Deckard reads that as a plain to do with a
 * tag now. The move rewrites it as `- [/] Draft`, by what the tag meant
 * (legacyStatusTags.ts), takes away a tag a box already says, and leaves
 * every other tag where it is, saying why. Nothing here writes: it lists
 * the edits, and the command shows them.
 */
import { escapeRegExp } from '../../shared/text';
import type { Task, TaskStatusType } from '../model';
import { type LegacyStatusTags, readWrittenStatusTag, removeStatusTags } from './legacyStatusTags';
import { setTaskLineMark } from '../markdown/taskLineEdits';
import { DEFAULT_TASK_STATUSES, normalizeStatusName, readTaskStatuses, slugStatusName, statusForColumnKey, type TaskStatusDefinition } from './taskStatuses';

/**
 * Which group of the move a line is in:
 *
 * - `character`: its tag stood for a status the list has a character for,
 *   which takes the tag's place: `- [ ] … #status/doing` becomes `- [/] …`;
 * - `stale`: its box already says its status, so the tag goes:
 *   `- [x] … #status/doing` becomes `- [x] …`, and `- [ ] … #status/todo`
 *   becomes `- [ ] …`;
 * - `done`: an open box tagged done, which the move checks off only when
 *   asked;
 * - `kept`: a tag no status of the list has a character for, such as
 *   `#status/review`, which stays until a status is given one.
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
  /** Whether the tag was one of Deckard's statuses, which the move offers to fix: `done`, or one with a character. */
  known: boolean;
}

/** What the move is read with: the statuses now, what the tags meant, and the day a checked-off task is done. */
export interface StatusMoveOptions {
  statuses: readonly TaskStatusDefinition[];
  legacy: LegacyStatusTags;
  /** The ✅ date a task checked off gets; none when not given. */
  doneDate?: string;
}

/**
 * The move, task by task: every task line with a status tag on its own
 * line, in the group it falls in. Only a task's own line moves, as only its
 * own line ever set a status.
 */
export function planStatusMove(tasks: Iterable<Task>, options: StatusMoveOptions): StatusMoveLine[] {
  const lines: StatusMoveLine[] = [];
  const { namespace, characters } = options.legacy;
  const listed = new Set(options.statuses.map((status) => status.symbol));
  for (const task of tasks) {
    const before = task.sourceLineText;
    const column = task.checkboxColumn;
    const tag = readWrittenStatusTag(before, column, namespace);
    if (tag === undefined) {
      continue;
    }
    const symbol = characters.get(tag);
    const at = { filePath: task.filePath, lineNumber: task.lineNumber, before, tag, known: tag === 'done' || symbol !== undefined };
    const untagged = removeStatusTags(before, column, namespace);
    if (task.status.symbol !== ' ' || symbol === ' ') {
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
    if (symbol === undefined || !listed.has(symbol)) {
      lines.push({ ...at, after: before, group: 'kept' });
      continue;
    }
    lines.push({ ...at, after: setTaskLineMark(untagged, column, { symbol, closed: undefined }), group: 'character' });
  }
  return lines;
}

/** How many task lines still carry a status tag the move knows, which the notice and the strip count. */
export function countKnownStatusTags(lines: readonly StatusMoveLine[]): number {
  return lines.filter((line) => line.known).length;
}

/**
 * The tags the move leaves, each with how many lines carry it, the most
 * first: the ones Give It a Character offers to make a status of.
 */
export function listKeptStatusTags(lines: readonly StatusMoveLine[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  lines.filter((line) => line.group === 'kept').forEach((line) => counts.set(line.tag, (counts.get(line.tag) ?? 0) + 1));
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

/**
 * The status a status tag meant that the list has now: the one with the
 * character the tag stood for. Undefined for `done`, and for a tag no
 * status of the list has a character for.
 */
export function statusForLegacyTag(tag: string, legacy: LegacyStatusTags, statuses: readonly TaskStatusDefinition[]): TaskStatusDefinition | undefined {
  const symbol = legacy.characters.get(tag.toLowerCase());
  return symbol === undefined ? undefined : statuses.find((status) => status.symbol === symbol);
}

/**
 * A search with each status tag the move knows written as the status it
 * meant: `#status/doing` as `status:in-progress`, `-#status/waiting` as
 * `-status:waiting`, `tag:#status/done` as `status:done`. A tag no status
 * of the list has a character for stays, as does the rest of the search.
 */
export function moveStatusTagsInQuery(query: string, legacy: LegacyStatusTags, statuses: readonly TaskStatusDefinition[]): string {
  const namespace = escapeRegExp(legacy.namespace);
  const pattern = new RegExp(`(^|[\\s(-])(?:tag[ \\t]*[:=][ \\t]*#?|#)${namespace}/([\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}_-]*)(?=$|[\\s)])`, 'giu');
  return query.replace(pattern, (whole, head: string, tag: string) => {
    if (tag.toLowerCase() === 'done') {
      return `${head}status:done`;
    }
    const status = statusForLegacyTag(tag, legacy, statuses);
    return status ? `${head}status:${slugStatusName(status.name)}` : whole;
  });
}

/**
 * `deckard.board.statuses`, the board's old column order, as the names of
 * the statuses it meant, for the gear's order: each value by the tag it
 * was, or by a status's name; one that means no status is left out.
 * Undefined when the value is not a list.
 */
export function moveLegacyColumnOrder(value: unknown, legacy: LegacyStatusTags, statuses: readonly TaskStatusDefinition[]): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const names = value.flatMap((entry) => {
    if (typeof entry !== 'string') {
      return [];
    }
    const status = statusForLegacyTag(entry, legacy, statuses) ?? statusForColumnKey(statuses, entry);
    return status ? [status.name] : [];
  });
  return [...new Set(names)];
}

/**
 * `deckard.board.limits` with each key that names an old status tag
 * written as its status's slug, `doing` as `in-progress`; a whole column's
 * key, or one that names no status, as it was. Undefined when nothing
 * changes.
 */
export function moveLegacyLimits(value: unknown, legacy: LegacyStatusTags, statuses: readonly TaskStatusDefinition[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  let changed = false;
  const moved = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, limit]) => {
    const status = key.includes(':') ? undefined : statusForLegacyTag(key, legacy, statuses);
    const slug = status ? slugStatusName(status.name) : key;
    changed ||= slug !== key;
    return [slug, limit];
  }));
  return changed ? moved : undefined;
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
 * own, and its next symbol for the workflow. Deckard's Waiting `[w]` and
 * Someday `[s]` follow, each unless the vault has a status of its name or
 * its character, and `X` stays Done unless the vault says what it is.
 * Undefined for a file that holds no statuses.
 */
export function importObsidianStatuses(data: unknown): TaskStatusDefinition[] | undefined {
  const settings = (data as { statusSettings?: { coreStatuses?: unknown; customStatuses?: unknown } } | null)?.statusSettings;
  const listed = [settings?.coreStatuses, settings?.customStatuses].flatMap((list) => (Array.isArray(list) ? (list as ObsidianStatus[]) : []));
  const imported = listed.flatMap((status): TaskStatusDefinition[] => {
    const type = typeof status.type === 'string' ? OBSIDIAN_TYPES[status.type] : undefined;
    if (typeof status.symbol !== 'string' || typeof status.name !== 'string' || !status.name.trim() || !type) {
      return [];
    }
    return [{
      symbol: status.symbol,
      name: status.name.trim(),
      type,
      ...(typeof status.nextStatusSymbol === 'string' && status.nextStatusSymbol ? { next: status.nextStatusSymbol } : {}),
    }];
  });
  if (imported.length === 0) {
    return undefined;
  }
  const onHold = DEFAULT_TASK_STATUSES.filter((status) => status.symbol === 'w' || status.symbol === 's').filter((own) =>
    !imported.some((status) => status.symbol === own.symbol || normalizeStatusName(status.name) === normalizeStatusName(own.name)));
  return readTaskStatuses([...imported, ...onHold]);
}

/** A status renamed: what it was called, and what it is called now. */
export interface StatusRename {
  from: string;
  to: string;
}

/**
 * The statuses a new list renames: one with the same character, called
 * something else now. A search by the old name finds nothing once it is
 * saved, so these are the names to carry.
 */
export function findStatusRenames(before: readonly TaskStatusDefinition[], after: readonly TaskStatusDefinition[]): StatusRename[] {
  const renames: StatusRename[] = [];
  for (const old of before) {
    const now = after.find((status) => status.symbol === old.symbol);
    if (now && normalizeStatusName(now.name) !== normalizeStatusName(old.name) && !renames.some((rename) => normalizeStatusName(rename.from) === normalizeStatusName(old.name))) {
      renames.push({ from: old.name, to: now.name });
    }
  }
  return renames;
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
    return normalizeStatusName(written) === normalizeStatusName(rename.from)
      ? `${head}${normalizeStatusName(rename.to).replace(/ /g, '-')}`
      : whole;
  });
}
