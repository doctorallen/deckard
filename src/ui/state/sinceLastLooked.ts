/**
 * Since you last looked (docs/implementation/37-since-you-last-looked.md):
 * what a tag's page holds now, set beside what it held at the reader's
 * last visit. The page draws a band of what changed, marks the new rows,
 * and a changed field shows its old value once (D9); the Hubs view says
 * how much is new under each hub.
 *
 * A visit counts once the page has been in front for five seconds (D7),
 * and the band shows only when something changed and the last visit was
 * more than a day ago (D8). There is no history: the snapshot is replaced
 * each time a visit counts.
 *
 * An entry or task is known by a key that outlasts a line moving above it,
 * which an index id does not: its note and heading, or its note and title.
 * An entry is new when its key is, or when its words changed, which a hash
 * of its lines says; a note's change time is its file's, so it cannot tell
 * one entry of a daily note from another. Its task lines are left out of
 * the hash: a task done or added is counted as a task, not again as a new
 * mention of the entry it is written in.
 */
import { DAY_MS } from '../../domain/markdown/calendar';
import { describeDistance } from '../../domain/markdown/dates';
import { formatDisplayDate } from '../../domain/markdown/dateFormat';
import { getEntryTextOf, getFileEntryLines } from '../../domain/index/noteEntryIndex';
import type { FrontmatterProperty, ParsedFile, Section, Task, WorkspaceIndex } from '../../domain/model';
import type { QueryContext } from '../../domain/query/queryContext';
import type { QueryResults } from '../../domain/query/queryEvaluator';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { isTaskItemLine } from '../../domain/markdown/listNesting';
import type { TagVisit } from '../../core/storage/tagVisits';
import type { DrawnFields } from '../protocol/fields';
import type { SearchPageSince, SinceChipKind } from '../protocol/searchPage';

/** How long a page must be in front before its visit counts (D7). */
export const VISIT_COUNTS_AFTER_MS = 5000;

/** How long ago the last visit must be before the band shows (D8). */
export const SINCE_AFTER_MS = DAY_MS;

/** What a tag's page holds, as a visit keeps it, without the moment it was seen. */
export type TagPageState = Omit<TagVisit, 'seenAt'>;

/**
 * A short hash of some text: two 32-bit hashes, each in base 36, so that
 * keys stay short in storage and a collision among a tag's entries is
 * remote.
 */
export function visitHash(text: string): string {
  let first = 0;
  let second = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    first = ((first << 5) - first + code) | 0;
    second = Math.imul(second ^ code, 0x01000193);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

/** An entry's key in a visit: its note and its heading, or its tagged line. */
export function entryVisitKey(section: Section): string {
  return visitHash(`${section.filePath}\u0000${section.heading}`);
}

/** A note that is an entry of its own, by its path. */
export function fileVisitKey(filePath: string): string {
  return visitHash(`file\u0000${filePath}`);
}

/**
 * A task's key in a visit: its note and its title, which leaves out its
 * metadata, so writing its done date does not make it another task.
 */
export function taskVisitKey(task: Task): string {
  return visitHash(`${task.filePath}\u0000${task.title.trim()}`);
}

/**
 * What a tag's page holds: the entries and tasks its search found, the hub
 * notes' own aside, since the hub's changes are its fields; and its fields.
 */
export function captureTagPage(
  index: WorkspaceIndex,
  results: QueryResults,
  { hubPaths, fields }: { hubPaths: readonly string[]; fields: Record<string, string> },
): TagPageState {
  const hubs = new Set(hubPaths);
  const entries: Record<string, string> = {};
  results.sections
    .filter((section) => !hubs.has(section.filePath))
    .forEach((section) => {
      entries[entryVisitKey(section)] = hashWords(getEntryTextOf(index, section).split(/\r?\n/));
    });
  results.files
    .filter((file) => !hubs.has(file.filePath))
    .forEach((file: ParsedFile) => {
      entries[fileVisitKey(file.filePath)] = hashWords(getFileEntryLines(index, file).map((line) => line.text));
    });
  const open = new Set<string>();
  const done = new Set<string>();
  results.tasks.forEach((task) => {
    if (task.completed) {
      done.add(taskVisitKey(task));
    } else if (isOpenTask(task)) {
      open.add(taskVisitKey(task));
    }
  });
  return { entries, tasks: { open: [...open], done: [...done] }, fields };
}

/** An entry's words as a visit keeps them: a hash of its lines, its task lines aside. */
function hashWords(lines: readonly string[]): string {
  return visitHash(lines.filter((line) => !isTaskItemLine(line)).join('\n'));
}

/**
 * A hub's fields as a visit keeps them, each by its name, its values as
 * they read: a typed row's fields and reverses, or a note's front matter.
 */
export function readFieldValues(fields: DrawnFields | undefined, properties: readonly FrontmatterProperty[] | undefined): Record<string, string> {
  const read: Record<string, string> = {};
  if (fields) {
    fields.fields.forEach((field) => {
      read[field.name] = field.values.map((value) => value.text).join(', ');
    });
    return read;
  }
  (properties ?? []).forEach((property) => {
    read[property.name] = property.values.map((value) => value.text).join(', ');
  });
  return read;
}

/** A visit to keep: what the page holds now, seen at a moment. */
export function toTagVisit(state: TagPageState, seenAt: number): TagVisit {
  return { seenAt, ...state };
}

/** What changed on a tag's page since the last visit. */
export interface TagChanges {
  seenAt: number;
  /** The entries written or changed since, by visit key. */
  newEntries: ReadonlySet<string>;
  /** The tasks added since, and those done since, by visit key. */
  addedTasks: ReadonlySet<string>;
  doneTasks: ReadonlySet<string>;
  /** Each field whose value changed, by name, with the value it had; empty for one it did not have. */
  was: Readonly<Record<string, string>>;
  /** How many fields changed, those now gone among them. */
  fieldsChanged: number;
  /** Everything counted: what the band adds up, and the Hubs view says is new. */
  total: number;
}

/**
 * What changed between the last visit and now. A task added and done since
 * counts as done; a task open then and still open is neither. Plan 38
 * adds the questions answered since, from `answered`.
 */
export function compareTagPage(visit: TagVisit, now: TagPageState): TagChanges {
  const newEntries = new Set(Object.entries(now.entries).filter(([key, hash]) => visit.entries[key] !== hash).map(([key]) => key));
  const before = new Set([...visit.tasks.open, ...visit.tasks.done]);
  const doneBefore = new Set(visit.tasks.done);
  const addedTasks = new Set(now.tasks.open.filter((key) => !before.has(key)));
  const doneTasks = new Set(now.tasks.done.filter((key) => !doneBefore.has(key)));
  const names = new Set([...Object.keys(visit.fields), ...Object.keys(now.fields)]);
  const changed = [...names].filter((name) => (visit.fields[name] ?? '') !== (now.fields[name] ?? ''));
  const was = Object.fromEntries(changed.filter((name) => name in now.fields).map((name) => [name, visit.fields[name] ?? '']));
  return {
    seenAt: visit.seenAt,
    newEntries,
    addedTasks,
    doneTasks,
    was,
    fieldsChanged: changed.length,
    total: newEntries.size + addedTasks.size + doneTasks.size + changed.length,
  };
}

/** Whether the band shows: something changed, and the last visit was over a day ago (D8). */
export function isSinceShown(changes: TagChanges | undefined, now: number): changes is TagChanges {
  return changes !== undefined && changes.total > 0 && now - changes.seenAt > SINCE_AFTER_MS;
}

/** `4 new mentions`, `1 field changed`: a count and its noun, one or many. */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The band: when the last visit was, `Fri, Oct 2, 12 days ago`, and a chip
 * for each kind of change there is, the one filtering the page marked.
 */
export function describeSince(
  changes: TagChanges,
  { filter, newNotes }: { filter: SinceChipKind | undefined; newNotes: number },
  context: Pick<QueryContext, 'now' | 'dateFormats'>,
): SearchPageSince {
  const day = formatDisplayDate(changes.seenAt, context.dateFormats, 'short', context.now);
  const distance = describeDistance(changes.seenAt, context.now);
  const chips: SearchPageSince['chips'] = [
    { kind: 'mentions' as const, count: changes.newEntries.size, label: counted(changes.newEntries.size, 'new mention', 'new mentions') },
    { kind: 'fields' as const, count: changes.fieldsChanged, label: counted(changes.fieldsChanged, 'field changed', 'fields changed') },
    { kind: 'done' as const, count: changes.doneTasks.size, label: counted(changes.doneTasks.size, 'task done', 'tasks done') },
    { kind: 'added' as const, count: changes.addedTasks.size, label: counted(changes.addedTasks.size, 'task added', 'tasks added') },
  ]
    .filter((chip) => chip.count > 0)
    .map((chip) => (chip.kind === filter ? { ...chip, active: true as const } : chip));
  return {
    when: distance ? `${day}, ${distance}` : day,
    day,
    chips,
    was: { ...changes.was },
    newNotes,
  };
}

/**
 * A hub's row in the Hubs view says how much is new since its page was last
 * open, `9 new`, under the band's rule; else when it was seen, `seen
 * today`, `seen Fri, Oct 9`; or `never opened`.
 */
export function describeHubSeen(
  seenAt: number | undefined,
  changes: TagChanges | undefined,
  context: Pick<QueryContext, 'now' | 'dateFormats'>,
): string {
  if (seenAt === undefined) {
    return 'never opened';
  }
  if (isSinceShown(changes, context.now)) {
    return `${changes.total} new`;
  }
  return describeDistance(seenAt, context.now) === 'today'
    ? 'seen today'
    : `seen ${formatDisplayDate(seenAt, context.dateFormats, 'short', context.now)}`;
}
