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
 * one entry of a daily note from another. Its task lines, and a
 * question's answer, are left out of the hash: a task done or added is
 * counted as a task, and a question answered as one, not again as a new
 * mention of the entry it is written in. A question is known as a task is,
 * by its note and its words (docs/implementation/38-questions.md).
 */
import { DAY_MS } from '../../domain/markdown/calendar';
import { describeDistance } from '../../domain/markdown/dates';
import { formatDisplayDate } from '../../domain/markdown/dateFormat';
import { getEntryTextOf, getFileEntryLines } from '../../domain/index/noteEntryIndex';
import { isAnswered } from '../../domain/index/questions';
import type { FrontmatterProperty, ParsedFile, Question, Section, Task, WorkspaceIndex } from '../../domain/model';
import type { QueryContext } from '../../domain/query/queryContext';
import type { QueryResults } from '../../domain/query/queryEvaluator';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { isTaskItemLine } from '../../domain/markdown/listNesting';
import { isAnswerLine } from '../../domain/markdown/parser';
import { shortHash } from '../../shared/text';
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
  return shortHash(text);
}

/**
 * An entry's key in a visit: its note and its heading, or its tagged line,
 * and, for the second entry of its note under the same heading and those
 * after it, which one it is (see `withOrdinal`).
 */
export function entryVisitKey(index: WorkspaceIndex, section: Section): string {
  return withOrdinal(visitHash(`${section.filePath}\u0000${section.heading}`), ordinalOf(index, section.filePath, section.id));
}

/** A note that is an entry of its own, by its path. */
export function fileVisitKey(filePath: string): string {
  return visitHash(`file\u0000${filePath}`);
}

/**
 * A task's key in a visit: its note and its title, which leaves out its
 * metadata, so writing its done date does not make it another task.
 */
export function taskVisitKey(index: WorkspaceIndex, task: Task): string {
  return withOrdinal(visitHash(`${task.filePath}\u0000${task.title.trim()}`), ordinalOf(index, task.filePath, task.id));
}

/**
 * A question's key in a visit: its note and its words, as a task's is, so
 * a line written above it, or its answer, does not make it another.
 */
export function questionVisitKey(index: WorkspaceIndex, question: Question): string {
  return withOrdinal(
    visitHash(`question\u0000${question.filePath}\u0000${question.title.trim()}`),
    ordinalOf(index, question.filePath, question.id),
  );
}

/** What marks a key as a second or later of its note with the same words. */
const ORDINAL_MARK = '~';

/**
 * A key with which of its note's entries, tasks, or questions with the same
 * words it is, so two standups under one heading, or two tasks with one
 * title, are two: the first's key is the words' alone, as every key was
 * before (`TagVisit.ordinals`), and the second's ends `~1`.
 */
function withOrdinal(key: string, ordinal: number): string {
  return ordinal > 0 ? `${key}${ORDINAL_MARK}${ordinal}` : key;
}

/** Each index's entries, tasks, and questions, by id, as the how-manyth of their note with the same words. */
const ordinals = new WeakMap<WorkspaceIndex, Map<string, number>>();

/**
 * Which of its note's entries, tasks, or questions with the same words one
 * is, in the order the note writes them, from 0; each note read once an
 * index.
 */
function ordinalOf(index: WorkspaceIndex, filePath: string, id: string): number {
  let byId = ordinals.get(index);
  if (!byId) {
    byId = new Map();
    ordinals.set(index, byId);
  }
  if (!byId.has(id)) {
    const file = index.files.get(filePath);
    const count = <Item extends { id: string }>(items: readonly Item[], words: (item: Item) => string): void => {
      const seen = new Map<string, number>();
      items.forEach((item) => {
        const key = words(item);
        const ordinal = seen.get(key) ?? 0;
        seen.set(key, ordinal + 1);
        byId?.set(item.id, ordinal);
      });
    };
    count(file?.sections ?? [], (section) => section.heading);
    count(file?.tasks ?? [], (task) => task.title.trim());
    count(file?.questions ?? [], (question) => question.title.trim());
    if (!byId.has(id)) {
      byId.set(id, 0);
    }
  }
  return byId.get(id) ?? 0;
}

/**
 * Whether a visit kept before keys had ordinals cannot have told a key's
 * entry, task, or question apart: it names a second or later of its words,
 * kept under the first's key then, or it is the first's key, whose hash
 * was the last of them; either is no change, rather than new. `entries`
 * are the page's now, which say whether the first has others.
 */
function isUnknownToOlderVisit(visit: TagVisit, key: string, entries: Readonly<Record<string, string>> = {}): boolean {
  return !visit.ordinals && (key.includes(ORDINAL_MARK) || `${key}${ORDINAL_MARK}1` in entries);
}

/**
 * What a tag's page holds: the entries, tasks, and answered questions its
 * search found, the hub notes' own aside, since the hub's changes are its
 * fields; and its fields.
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
      entries[entryVisitKey(index, section)] = hashWords(getEntryTextOf(index, section).split(/\r?\n/));
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
      done.add(taskVisitKey(index, task));
    } else if (isOpenTask(task)) {
      open.add(taskVisitKey(index, task));
    }
  });
  const answered = new Set(results.questions.filter(isAnswered).map((question) => questionVisitKey(index, question)));
  return { entries, tasks: { open: [...open], done: [...done] }, fields, answered: [...answered], ordinals: true };
}

/**
 * An entry's words as a visit keeps them: a hash of its lines, its task and
 * question lines aside, and a question's `Answer:` line, so an answer
 * written since counts as a question answered, not again as a mention.
 */
function hashWords(lines: readonly string[]): string {
  return visitHash(lines.filter((line) => !isTaskItemLine(line) && !isAnswerLine(line)).join('\n'));
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
  /** The questions answered since, by visit key. */
  answeredQuestions: ReadonlySet<string>;
  /** Each field whose value changed, by name, with the value it had; empty for one it did not have. */
  was: Readonly<Record<string, string>>;
  /** How many fields changed, those now gone among them. */
  fieldsChanged: number;
  /** Everything counted: what the band adds up, and the Hubs view says is new. */
  total: number;
}

/**
 * What changed between the last visit and now. A task added and done since
 * counts as done; a task open then and still open is neither. A question is
 * answered since when it is answered now and was not then, asked since or
 * not; a visit kept before questions were, with no `answered`, counts none,
 * rather than every answer the page holds. A visit kept before keys had
 * ordinals counts a second entry, task, or question of the same words in a
 * note as no change, since it kept them under the first's key.
 */
export function compareTagPage(visit: TagVisit, now: TagPageState): TagChanges {
  const unknown = (key: string): boolean => isUnknownToOlderVisit(visit, key);
  const newEntries = new Set(
    Object.entries(now.entries)
      .filter(([key, hash]) => visit.entries[key] !== hash && !isUnknownToOlderVisit(visit, key, now.entries))
      .map(([key]) => key),
  );
  const before = new Set([...visit.tasks.open, ...visit.tasks.done]);
  const doneBefore = new Set(visit.tasks.done);
  const addedTasks = new Set(now.tasks.open.filter((key) => !before.has(key) && !unknown(key)));
  const doneTasks = new Set(now.tasks.done.filter((key) => !doneBefore.has(key) && (before.has(key) || !unknown(key))));
  const answeredBefore = visit.answered ? new Set(visit.answered) : undefined;
  const answeredQuestions = new Set(
    answeredBefore ? (now.answered ?? []).filter((key) => !answeredBefore.has(key) && !unknown(key)) : [],
  );
  const names = new Set([...Object.keys(visit.fields), ...Object.keys(now.fields)]);
  const changed = [...names].filter((name) => (visit.fields[name] ?? '') !== (now.fields[name] ?? ''));
  const was = Object.fromEntries(changed.filter((name) => name in now.fields).map((name) => [name, visit.fields[name] ?? '']));
  return {
    seenAt: visit.seenAt,
    newEntries,
    addedTasks,
    doneTasks,
    answeredQuestions,
    was,
    fieldsChanged: changed.length,
    total: newEntries.size + addedTasks.size + doneTasks.size + answeredQuestions.size + changed.length,
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
    { kind: 'answered' as const, count: changes.answeredQuestions.size, label: counted(changes.answeredQuestions.size, 'question answered', 'questions answered') },
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
