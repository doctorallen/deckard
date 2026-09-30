import { needsNewDate, TaskPolicy } from '../tasks/taskPolicy';
import { TaskPriority } from '../model';
import {
  addDays,
  addMonths,
  DAY_MS,
  daysInMonth,
  formatIsoDate,
  parseIsoDate,
  startOfDay,
  WEEKDAY_NAMES,
} from './calendar';
import { TaskLineShape } from './lineShapes';

export { addDays, formatIsoDate, parseIsoDate, startOfDay } from './calendar';

/**
 * Reads and writes task metadata in both formats of the Obsidian Tasks
 * plugin, so a vault written for Obsidian keeps its dates, priorities, and
 * repeat rules in Deckard:
 *
 * ```
 * - [ ] Send proposal 📅 2026-09-20 ⏳ 2026-09-18 🔁 every week ⏫ 🆔 a1 ⛔ b2
 * - [ ] Send proposal [due:: 2026-09-20] [priority:: high] [repeat:: every week]
 * ```
 *
 * Deckard adds one field of its own in the same two formats, 👤 and
 * `[assignee:: …]`, because Tasks has no way to say who a task is for and a
 * person's name in the sentence says only that they were mentioned.
 *
 * The first line uses the emoji format and the second the text-only Dataview
 * format. Deckard reads a field wherever it appears on the line, which is more
 * lenient than Tasks, and writes new fields where Tasks would: at the end of
 * the line, ahead of a block id, in the format the line already uses.
 */

export type TaskMetadataFormat = 'emoji' | 'dataview';

export interface TaskMetadata {
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  priority?: TaskPriority;
  /** The 🔁 rule as written, such as "every week". */
  recurrence?: string;
  /** 🆔 name other tasks use in ⛔ to depend on this one. */
  id?: string;
  /** ⛔ names of the tasks that must be done first. */
  dependsOn: string[];
  /** 👤 the person the task is for, as written: `@dana`. */
  assignee?: string;
}

export type TaskDateField =
  | 'due'
  | 'scheduled'
  | 'start'
  | 'created'
  | 'done'
  | 'cancelled';

/** Metadata Deckard can write. */
export type TaskMetadataField =
  | TaskDateField
  | 'priority'
  | 'repeat'
  | 'id'
  | 'dependsOn'
  | 'assignee';

/** Each date marker, including the alternative emoji Tasks also accepts. */
const DATE_MARKERS: Readonly<Record<TaskDateField, string>> = {
  due: '(?:📅|📆|🗓)',
  scheduled: '(?:⏳|⌛)',
  start: '🛫',
  created: '➕',
  done: '✅',
  cancelled: '❌',
};

/** The emoji Deckard writes for each date. */
const DATE_EMOJI: Readonly<Record<TaskDateField, string>> = {
  due: '📅',
  scheduled: '⏳',
  start: '🛫',
  created: '➕',
  done: '✅',
  cancelled: '❌',
};

const DATE_FIELDS = Object.keys(DATE_MARKERS) as TaskDateField[];

/** The Dataview-format key for each field. */
const DATAVIEW_KEYS: Readonly<Record<TaskMetadataField, string>> = {
  due: 'due',
  scheduled: 'scheduled',
  start: 'start',
  created: 'created',
  done: 'completion',
  cancelled: 'cancelled',
  priority: 'priority',
  repeat: 'repeat',
  id: 'id',
  dependsOn: 'dependsOn',
  assignee: 'assignee',
};

/** Dataview keys, lowercased, mapped to the field they hold. */
const DATAVIEW_FIELDS = new Map<string, TaskMetadataField | 'onCompletion'>([
  ...(Object.entries(DATAVIEW_KEYS) as [TaskMetadataField, string][]).map(
    ([field, key]): [string, TaskMetadataField] => [key.toLowerCase(), field],
  ),
  ['oncompletion', 'onCompletion'],
]);

const PRIORITY_MARKERS: ReadonlyMap<string, TaskPriority> = new Map([
  ['🔺', 'highest'],
  ['⏫', 'high'],
  ['🔼', 'medium'],
  ['🔽', 'low'],
  ['⏬', 'lowest'],
]);

const PRIORITY_EMOJI: ReadonlyMap<TaskPriority, string> = new Map(
  [...PRIORITY_MARKERS].map(([emoji, priority]) => [priority, emoji]),
);

/**
 * How priorities compare. A task without one sits between medium and low,
 * which is where Tasks places it too.
 */
export const TASK_PRIORITY_RANKS: Readonly<Record<TaskPriority | 'none', number>> = {
  lowest: 0,
  low: 1,
  none: 2,
  medium: 3,
  high: 4,
  highest: 5,
};

/** Emoji are often followed by an invisible variation selector. */
const VARIATION = '\\uFE0F?';
const NAME = '[A-Za-z0-9_-]+';

const PRIORITY_PATTERN = /(?:🔺|⏫|🔼|🔽|⏬)\uFE0F?/gu;
const RECURRENCE_PATTERN = /🔁\uFE0F?[ \t]*([A-Za-z0-9, !]+)/gu;
const ID_PATTERN = new RegExp(`[ \\t]*🆔${VARIATION}[ \\t]*(${NAME})`, 'gu');
const DEPENDS_ON_PATTERN = new RegExp(
  `⛔${VARIATION}[ \\t]*(${NAME}(?:[ \\t]*,[ \\t]*${NAME})*)`,
  'gu',
);
const ON_COMPLETION_PATTERN = /🏁\uFE0F?[ \t]*(?:keep|delete)/giu;
/**
 * 👤 and the person the task is for, written as the tag is: `👤 @dana`,
 * `👤 #person/dana`, or the bare name. 🧑 is read too, since either emoji is
 * what a hand reaches for, but 👤 is what Deckard writes.
 */
const ASSIGNEE_PATTERN = new RegExp(
  `[ \\t]*(?:👤|🧑)${VARIATION}[ \\t]*([@#]?${NAME}(?:/${NAME})*)`,
  'gu',
);
/** A Dataview inline field in square or round brackets, `[due:: 2026-09-20]`. */
const DATAVIEW_FIELD_PATTERN =
  /\[[ \t]*([A-Za-z]+)[ \t]*::[ \t]*([^\]]*?)[ \t]*\]|\([ \t]*([A-Za-z]+)[ \t]*::[ \t]*([^)]*?)[ \t]*\)/gu;
/**
 * One Dataview field by its key, in square or round brackets, with the
 * spaces and tabs before it, so taking it out leaves no gap: `[id:: a1]`.
 * The key is matched in any case.
 */
function dataviewFieldPattern(key: string): RegExp {
  return new RegExp(`[ \\t]*(?:\\[[ \\t]*${key}[ \\t]*::[^\\]]*\\]|\\([ \\t]*${key}[ \\t]*::[^)]*\\))`, 'giu');
}
const DATAVIEW_ID_PATTERN = dataviewFieldPattern('id');
/**
 * A block id: the `^name` an author writes at the end of a line to make that
 * line something a `[[Note#^name]]` link can point at, as Obsidian does.
 *
 * It must be the last thing on the line and separated from the text, so a
 * caret written in prose is not mistaken for one. Deckard reads these
 * wherever they are written; `findBlockIds` collects them for a whole note.
 */
export const BLOCK_ID_PATTERN = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;

const PRIORITY_NAMES: ReadonlySet<string> = new Set(PRIORITY_MARKERS.values());

/**
 * Separates a task's metadata from its title.
 *
 * The title is what remains once every field and its value is removed, which
 * is how Tasks displays a task. `format` says which format the line uses,
 * preferring emoji when a line mixes both, and is undefined without metadata.
 */
export function parseTaskMetadata(text: string): {
  metadata: TaskMetadata;
  title: string;
  format?: TaskMetadataFormat;
} {
  const metadata: TaskMetadata = { dependsOn: [] };
  let usesEmoji = false;
  let usesDataview = false;

  let title = text.replace(
    DATAVIEW_FIELD_PATTERN,
    (
      match,
      squareKey?: string,
      squareValue?: string,
      roundKey?: string,
      roundValue?: string,
    ) => {
      const field = DATAVIEW_FIELDS.get((squareKey ?? roundKey ?? '').toLowerCase());
      // Other Dataview fields, such as [owner:: Ren], stay part of the title.
      if (!field) {
        return match;
      }
      usesDataview = true;
      readField(metadata, field, (squareValue ?? roundValue ?? '').trim());
      return ' ';
    },
  );

  for (const field of DATE_FIELDS) {
    title = title.replace(datePatterns(field)[0], (_match, date: string) => {
      usesEmoji = true;
      metadata[field] ??= date;
      return ' ';
    });
  }

  title = title
    .replace(PRIORITY_PATTERN, (marker) => {
      usesEmoji = true;
      metadata.priority ??= PRIORITY_MARKERS.get(marker.replace('\uFE0F', ''));
      return ' ';
    })
    .replace(RECURRENCE_PATTERN, (_match, rule: string) => {
      usesEmoji = true;
      metadata.recurrence ??= rule.trim() || undefined;
      return ' ';
    })
    .replace(ID_PATTERN, (_match, id: string) => {
      usesEmoji = true;
      metadata.id ??= id;
      return ' ';
    })
    .replace(DEPENDS_ON_PATTERN, (_match, ids: string) => {
      usesEmoji = true;
      metadata.dependsOn.push(...ids.split(',').map((id) => id.trim()));
      return ' ';
    })
    .replace(ON_COMPLETION_PATTERN, () => {
      usesEmoji = true;
      return ' ';
    })
    .replace(ASSIGNEE_PATTERN, (_match, person: string) => {
      usesEmoji = true;
      metadata.assignee ??= person;
      return ' ';
    })
    // A trailing `^block-id` is only a link target in Obsidian.
    .replace(BLOCK_ID_PATTERN, '');

  return {
    metadata,
    title: title.replace(/[ \t]{2,}/g, ' ').trim(),
    format: usesEmoji ? 'emoji' : usesDataview ? 'dataview' : undefined,
  };
}

/** What a piece of a task line's metadata is. */
export type TaskMetadataSpanField = TaskMetadataField | 'onCompletion' | 'blockId';

/** One piece of a task line's metadata, where it is written and what it says. */
export interface TaskMetadataSpan {
  /** Offsets into the text given, from the marker to the end of its value. */
  start: number;
  end: number;
  field: TaskMetadataSpanField;
  /** The value as written: a date, a rule, a name, or a priority. */
  value: string;
}

/**
 * Where each piece of metadata is written on a task's text, read by the same
 * patterns and in the same order as `parseTaskMetadata`, so a piece it reads
 * first is never read again inside another: cutting every span out leaves
 * the title. A trailing `^block-id` is a span too.
 */
export function findTaskMetadataSpans(text: string): TaskMetadataSpan[] {
  const spans: TaskMetadataSpan[] = [];
  let masked = text;
  const take = (
    pattern: RegExp,
    read: (match: RegExpMatchArray) => { field: TaskMetadataSpanField; value: string } | undefined,
  ): void => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const found: TaskMetadataSpan[] = [];
    for (const match of masked.matchAll(new RegExp(pattern.source, flags))) {
      const piece = read(match);
      if (!piece) {
        continue;
      }
      let start = match.index ?? 0;
      let end = start + match[0].length;
      while (start < end && (masked[start] === ' ' || masked[start] === '\t')) {
        start += 1;
      }
      while (end > start && (masked[end - 1] === ' ' || masked[end - 1] === '\t')) {
        end -= 1;
      }
      found.push({ start, end, ...piece });
    }
    for (const span of found) {
      masked = masked.slice(0, span.start) + ' '.repeat(span.end - span.start) + masked.slice(span.end);
    }
    spans.push(...found);
  };

  take(DATAVIEW_FIELD_PATTERN, (match) => {
    const field = DATAVIEW_FIELDS.get((match[1] ?? match[3] ?? '').toLowerCase());
    return field ? { field, value: (match[2] ?? match[4] ?? '').trim() } : undefined;
  });
  for (const field of DATE_FIELDS) {
    take(datePatterns(field)[0], (match) => ({ field, value: match[1] }));
  }
  take(PRIORITY_PATTERN, (match) => ({
    field: 'priority',
    value: PRIORITY_MARKERS.get(match[0].replace('\uFE0F', '')) ?? '',
  }));
  take(RECURRENCE_PATTERN, (match) => ({ field: 'repeat', value: match[1].trim() }));
  take(ID_PATTERN, (match) => ({ field: 'id', value: match[1] }));
  take(DEPENDS_ON_PATTERN, (match) => ({ field: 'dependsOn', value: match[1] }));
  take(ON_COMPLETION_PATTERN, (match) => ({ field: 'onCompletion', value: match[0] }));
  take(ASSIGNEE_PATTERN, (match) => ({ field: 'assignee', value: match[1] }));
  take(BLOCK_ID_PATTERN, (match) => ({ field: 'blockId', value: match[1] }));
  return spans.sort((left, right) => left.start - right.start);
}

/**
 * Writes one field in the given format, such as `📅 2026-09-20` or
 * `[due:: 2026-09-20]`. An emoji priority is its marker alone.
 */
export function formatTaskMetadata(
  field: TaskMetadataField,
  value: string,
  format: TaskMetadataFormat,
): string {
  if (format === 'dataview') {
    return `[${DATAVIEW_KEYS[field]}:: ${value}]`;
  }
  switch (field) {
    case 'priority':
      return PRIORITY_EMOJI.get(value as TaskPriority) ?? '';
    case 'repeat':
      return `🔁 ${value}`;
    case 'id':
      return `🆔 ${value}`;
    case 'dependsOn':
      return `⛔ ${value}`;
    case 'assignee':
      return `👤 ${value}`;
    default:
      return `${DATE_EMOJI[field]} ${value}`;
  }
}

/**
 * Sets a task line's checkbox and keeps its done date in step: added when the
 * task is completed, removed when it is reopened.
 *
 * `checkboxColumn` is the index of the character between the brackets. An
 * existing done date is kept, and none is added when `doneDate` is omitted.
 * A new date uses the line's format, or `preferredFormat` when the line has
 * no metadata yet.
 */
export function setTaskLineCompletion(
  line: string,
  checkboxColumn: number,
  completed: boolean,
  doneDate?: string,
  preferredFormat: TaskMetadataFormat = 'emoji',
): string {
  const [prefix, text] = splitTaskLine(line, checkboxColumn, completed ? 'x' : ' ');
  const withoutDone = removeDates(text, 'done');
  if (!completed) {
    return prefix + withoutDone;
  }
  if (!doneDate || withoutDone !== text) {
    return prefix + text;
  }
  const format = parseTaskMetadata(text).format ?? preferredFormat;
  return prefix + appendToTaskText(text, formatTaskMetadata('done', doneDate, format));
}

/** A field a task holds at most one of, which setTaskField replaces whole. */
type SingleTaskField = 'priority' | 'assignee';

/**
 * Each single field's two spellings, as setTaskField takes them out: the
 * emoji form and the Dataview form, each with the spaces and tabs before
 * it, so the line keeps no gap where the old value was.
 */
const SINGLE_FIELD_PATTERNS: Readonly<Record<SingleTaskField, { emoji: RegExp; dataview: RegExp }>> = {
  priority: {
    emoji: new RegExp(`[ \\t]*${PRIORITY_PATTERN.source}`, 'gu'),
    dataview: dataviewFieldPattern('priority'),
  },
  assignee: { emoji: ASSIGNEE_PATTERN, dataview: dataviewFieldPattern('assignee') },
};

/** The value a single field is set to, or undefined to clear it, and the format for a line that has none. */
interface SingleFieldWrite {
  value: string | undefined;
  preferredFormat: TaskMetadataFormat;
}

/**
 * Sets or clears a field a task holds at most one of, replacing whichever
 * marker or Dataview field it had, in either format. A new value is written
 * in the line's own format, or the preferred one when the line has none, at
 * the end of its words and ahead of a block id.
 */
function setTaskField(
  line: string,
  checkboxColumn: number,
  field: SingleTaskField,
  write: SingleFieldWrite,
): string {
  const [prefix, text] = splitTaskLine(line, checkboxColumn, line[checkboxColumn]);
  const format = parseTaskMetadata(text).format ?? write.preferredFormat;
  const patterns = SINGLE_FIELD_PATTERNS[field];
  const cleared = text.replace(patterns.emoji, '').replace(patterns.dataview, '');
  return (
    prefix +
    (write.value
      ? appendToTaskText(cleared, formatTaskMetadata(field, write.value, format))
      : cleared)
  );
}

/**
 * Sets or clears a task's priority, replacing whichever marker or field it
 * had. A new priority is written in the line's format.
 */
export function setTaskPriority(
  line: string,
  checkboxColumn: number,
  priority: TaskPriority | undefined,
  preferredFormat: TaskMetadataFormat = 'emoji',
): string {
  return setTaskField(line, checkboxColumn, 'priority', { value: priority, preferredFormat });
}

/**
 * Sets or clears the person a task is for, replacing whichever marker or
 * field it had. A new one is written in the line's format.
 *
 * The person is written as the tag is — `@dana` — so the name on the line and
 * the name in the people index are the same string. Any other mention of a
 * person in the sentence is left alone: that is the point of the field.
 */
export function setTaskAssignee(
  line: string,
  checkboxColumn: number,
  person: string | undefined,
  preferredFormat: TaskMetadataFormat = 'emoji',
): string {
  return setTaskField(line, checkboxColumn, 'assignee', { value: person, preferredFormat });
}

/**
 * Sets or clears one of a task's dates. An existing date changes where it is
 * written; a new one is added in the line's format.
 */
export function setTaskDate(
  line: string,
  checkboxColumn: number,
  field: TaskDateField,
  date: string | undefined,
  preferredFormat: TaskMetadataFormat = 'emoji',
): string {
  const [prefix, text] = splitTaskLine(line, checkboxColumn, line[checkboxColumn]);
  if (date === undefined) {
    return prefix + removeDates(text, field);
  }
  const written = datePatterns(field).some((pattern) =>
    new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text),
  );
  if (written) {
    return prefix + replaceDates(text, field, () => date);
  }
  const format = parseTaskMetadata(text).format ?? preferredFormat;
  return prefix + appendToTaskText(text, formatTaskMetadata(field, date, format));
}

/**
 * Writes the next occurrence of a recurring task, the way Tasks does when one
 * is completed: an open copy whose dates move forward by the repeat rule.
 *
 * The due date, or else the scheduled or start date, is the reference the
 * rule advances; the other dates keep their distance from it. A "when done"
 * rule advances from `today` instead. The copy drops the done date and the
 * task and block ids, which must stay unique.
 *
 * Returns undefined when the line has no repeat rule or one Deckard cannot
 * read.
 */
export function createNextOccurrence(
  line: string,
  checkboxColumn: number,
  today: number,
): string | undefined {
  const [prefix, text] = splitTaskLine(line, checkboxColumn, ' ');
  const { metadata } = parseTaskMetadata(text);
  const rule = metadata.recurrence
    ? parseRecurrence(metadata.recurrence)
    : undefined;
  if (!rule) {
    return undefined;
  }

  const reference = recurrenceReference({
    due: parseIsoDate(metadata.due),
    scheduled: parseIsoDate(metadata.scheduled),
    start: parseIsoDate(metadata.start),
  });
  const nextReference = rule.next(
    rule.whenDone || reference === undefined ? startOfDay(today) : reference,
  );
  const move = (date: string): string => {
    const at = parseIsoDate(date);
    return at === undefined || reference === undefined
      ? date
      : formatIsoDate(addDays(nextReference, daysBetween(reference, at)));
  };

  let next = removeDates(removeDates(text, 'done'), 'cancelled')
    .replace(ID_PATTERN, '')
    .replace(DATAVIEW_ID_PATTERN, '')
    .replace(BLOCK_ID_PATTERN, '');
  for (const field of ['due', 'scheduled', 'start'] as const) {
    next = replaceDates(next, field, move);
  }
  next = replaceDates(next, 'created', () => formatIsoDate(today));
  return prefix + next.trimEnd();
}

/**
 * The date a repeat rule advances: the due date, or else the scheduled or
 * start date. Completing a task and drawing its later dates on the calendar
 * both start from it, so the two never disagree about what comes next.
 */
export function recurrenceReference(dates: {
  due?: number;
  scheduled?: number;
  start?: number;
}): number | undefined {
  return dates.due ?? dates.scheduled ?? dates.start;
}

/** How many dates a task's projection may draw, a daily task across a year. */
export const PROJECTED_REPEATS = 370;
/** How many steps it may take to reach them, an overdue daily task included. */
const PROJECTION_STEPS = 20000;

/**
 * The dates a repeating task falls on after its current one, from `from` to
 * `to`, as local midnights: where its rule will put it if it is kept on
 * schedule. Nothing is written; a projected date is not a task.
 *
 * Only dates after today are drawn. A weekly task left overdue since the
 * first of the month is drawn on its own date and again from today on, on
 * the rule's own sequence, since the weeks between did not happen. A `when
 * done` rule projects nothing: its next date depends on the day it is done,
 * and any date drawn would be a guess. Nor does a rule Deckard cannot read.
 */
export function projectRepeats(
  task: { recurrence?: string; dueAt?: number; scheduledAt?: number; startAt?: number },
  from: number,
  to: number,
  now: number,
): number[] {
  const rule = task.recurrence ? parseRecurrence(task.recurrence) : undefined;
  const reference = recurrenceReference({ due: task.dueAt, scheduled: task.scheduledAt, start: task.startAt });
  if (!rule || rule.whenDone || reference === undefined) {
    return [];
  }
  const today = startOfDay(now);
  const first = Math.max(startOfDay(from), today + 1);
  const dates: number[] = [];
  let at = startOfDay(reference);
  for (let step = 0; step < PROJECTION_STEPS && dates.length < PROJECTED_REPEATS; step += 1) {
    const next = rule.next(at);
    // A rule that does not move forward would never end.
    if (!(next > at) || next > to) {
      break;
    }
    at = next;
    if (at >= first) {
      dates.push(at);
    }
  }
  return dates;
}

/** What completing a task writes in place of its line. */
export interface CompletionWrite {
  /** The lines to write in place of the task: the next occurrence, if any, then the completed line. */
  text: string;
  /** The next occurrence's line, when one was started. */
  next?: string;
  /** The 🔁 rule as written, when there is one Deckard could not read. */
  unreadRule?: string;
}

/**
 * What a completed task line becomes, wherever it was completed: a repeating
 * task gets its next occurrence on the line above, where Tasks puts it.
 *
 * Every way of completing a task comes through here, so a checkbox, the
 * board, bulk edit, the task editor, and the assistant all leave the same
 * lines behind. `completedLine` is the line already marked done.
 */
export function writeCompletion(
  completedLine: string,
  checkboxColumn: number,
  now: number,
  eol: string,
  /**
   * The task's steps as its next occurrence takes them: unchecked, written
   * under it, so a routine checklist comes back fresh. The completed
   * occurrence keeps its own.
   */
  steps: readonly string[] = [],
): CompletionWrite {
  const next = createNextOccurrence(completedLine, checkboxColumn, now);
  if (next !== undefined) {
    return { text: [next, ...steps, completedLine].join(eol), next };
  }
  const [, text] = splitTaskLine(completedLine, checkboxColumn, ' ');
  const rule = parseTaskMetadata(text).metadata.recurrence;
  return rule ? { text: completedLine, unreadRule: rule } : { text: completedLine };
}

export interface RecurrenceRule {
  /** "when done" rules count from the day the task is completed. */
  whenDone: boolean;
  /** The first occurrence after `from`, a local midnight. */
  next(from: number): number;
}

/** The nth weekday of a month, as a rule names it. */
const ORDINALS: Readonly<Record<string, number | 'last'>> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  last: 'last',
};

/**
 * Reads the repeat rules Tasks writes, and a few more:
 *
 * - `every day`, `every 3 weeks`, `every month`, `every 2 years`
 * - `every other day`, `every other week`, and so on: the same as `every 2`
 * - `every weekday`, `every Monday`, `every week on Tuesday, Friday`
 * - `every 2 weeks on Monday, Thursday`, `every other Tuesday`
 * - `every month on the 15th`, `every month on the last`
 * - `every month on the second Tuesday`, `every month on the last Friday`
 * - `every quarter`, `every 2 quarters`, and `every weekend`, which are
 *   Deckard's own and not Obsidian Tasks'
 *
 * Any of them can end in `when done`. Anything else returns undefined rather
 * than a guess, so Deckard never writes a wrong next date.
 */
export function parseRecurrence(text: string): RecurrenceRule | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const whenDone = normalized.endsWith(' when done');
  const rule = (whenDone
    ? normalized.slice(0, -' when done'.length)
    : normalized
  ).replace(/^every other /, 'every 2 ');

  const quarters = /^every (?:(\d+) )?quarters?$/.exec(rule);
  if (quarters) {
    const count = Number(quarters[1] ?? '1');
    return count < 1 ? undefined : { whenDone, next: (from) => addMonths(from, 3 * count) };
  }

  if (rule === 'every weekend') {
    return {
      whenDone,
      next: (from) => nextDayWhere(from, (weekday) => weekday === 0 || weekday === 6),
    };
  }

  const nthWeekday = new RegExp(
    `^every (?:(\\d+) )?months? on the (${Object.keys(ORDINALS).join('|')}) (${WEEKDAY_NAMES.join('|')})$`,
  ).exec(rule);
  if (nthWeekday) {
    const count = Number(nthWeekday[1] ?? '1');
    const nth = ORDINALS[nthWeekday[2]];
    const weekday = WEEKDAY_NAMES.indexOf(nthWeekday[3]);
    return count < 1
      ? undefined
      : { whenDone, next: (from) => nextNthWeekday(from, count, weekday, nth) };
  }

  // Every N weeks on some days: the days of this week still to come, then
  // those of the week N weeks on, with weeks starting on Monday as Tasks
  // counts them.
  const everyWeeks = /^every (\d+) (?:weeks? on )?(.+)$/.exec(rule);
  if (everyWeeks) {
    const count = Number(everyWeeks[1]);
    const days = readWeekdays(everyWeeks[2]);
    if (days && count >= 1) {
      return { whenDone, next: (from) => nextWeekdayEveryNWeeks(from, days, count) };
    }
  }

  const interval = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(rule);
  if (interval) {
    const count = Number(interval[1] ?? '1');
    const unit = interval[2];
    if (count < 1) {
      return undefined;
    }
    return {
      whenDone,
      next: (from) =>
        unit === 'day'
          ? addDays(from, count)
          : unit === 'week'
            ? addDays(from, 7 * count)
            : addMonths(from, unit === 'month' ? count : 12 * count),
    };
  }

  if (rule === 'every weekday') {
    return {
      whenDone,
      next: (from) => nextDayWhere(from, (weekday) => weekday >= 1 && weekday <= 5),
    };
  }

  const monthDay =
    /^every (?:(\d+) )?months? on the (last|\d{1,2}(?:st|nd|rd|th)?)(?: day)?$/.exec(
      rule,
    );
  if (monthDay) {
    const count = Number(monthDay[1] ?? '1');
    const day = monthDay[2] === 'last' ? 'last' : parseInt(monthDay[2], 10);
    if (count < 1 || (day !== 'last' && (day < 1 || day > 31))) {
      return undefined;
    }
    return { whenDone, next: (from) => nextMonthDay(from, count, day) };
  }

  const weekdays = readWeekdays(/^every (?:week on )?(.+)$/.exec(rule)?.[1]);
  if (weekdays) {
    return {
      whenDone,
      next: (from) => nextDayWhere(from, (weekday) => weekdays.includes(weekday)),
    };
  }

  return undefined;
}

/** Whole-word spellings of a rule, as other apps and people write them. */
const RULE_SYNONYMS: Readonly<Record<string, string>> = {
  daily: 'every day',
  weekly: 'every week',
  monthly: 'every month',
  yearly: 'every year',
  annually: 'every year',
  biweekly: 'every 2 weeks',
  fortnightly: 'every 2 weeks',
  'every fortnight': 'every 2 weeks',
  quarterly: 'every 3 months',
  weekdays: 'every weekday',
  weekends: 'every week on saturday, sunday',
};

/** The words a repeat rule is written in. */
const RULE_WORDS: readonly string[] = [
  'every', 'other', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'quarter', 'quarters', 'weekday', 'weekend', 'on', 'the', 'last',
  'first', 'second', 'third', 'fourth', 'fifth', '1st', '2nd', '3rd', '4th', '5th',
  'when', 'done', ...WEEKDAY_NAMES,
];

/** Edits between two short words, stopping once past `limit`. */
function wordDistance(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1;
  }
  let previous = Array.from({ length: right.length + 1 }, (_, at) => at);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** A word outside the rule's vocabulary, as the nearest word inside it. */
function correctRuleWord(word: string): string[] {
  if (/^\d+(?:st|nd|rd|th)?$/.test(word) || RULE_WORDS.includes(word)) {
    return [word];
  }
  const limit = word.length <= 4 ? 1 : 2;
  const scored = RULE_WORDS.map((candidate) => ({ candidate, distance: wordDistance(word, candidate, limit) }))
    .filter((entry) => entry.distance <= limit)
    .sort((left, right) => left.distance - right.distance);
  const best = scored[0]?.distance;
  return scored.filter((entry) => entry.distance === best).map((entry) => entry.candidate);
}

/**
 * The rules Deckard can read that are nearest to one it cannot, best first
 * and at most three: a synonym such as `weekly`, the same rule with `every`
 * in front, or its misspelled words corrected. A `when done` is kept.
 */
export function suggestRecurrence(text: string): string[] {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized || parseRecurrence(normalized)) {
    return [];
  }
  const whenDone = / when done$/.test(normalized);
  const body = whenDone ? normalized.slice(0, -' when done'.length) : normalized;
  const tail = whenDone ? ' when done' : '';
  const candidates: string[] = [];
  const synonym = RULE_SYNONYMS[body];
  if (synonym) {
    candidates.push(synonym);
  }
  const bodies = body.startsWith('every ') || body === 'every' ? [body] : [body, `every ${body}`];
  for (const candidate of bodies) {
    candidates.push(candidate);
    // Each misspelled word, as each of its nearest words.
    let spellings: string[][] = [[]];
    for (const word of candidate.split(/(,? )/)) {
      const options = /^,? $/.test(word) ? [word] : correctRuleWord(word);
      if (options.length === 0) {
        spellings = [];
        break;
      }
      spellings = spellings.flatMap((prefix) => options.map((option) => [...prefix, option])).slice(0, 12);
    }
    candidates.push(...spellings.map((words) => words.join('')));
  }
  const seen = new Set<string>();
  return candidates
    .map((candidate) => `${candidate}${tail}`)
    .filter((candidate) => {
      if (seen.has(candidate) || !parseRecurrence(candidate)) {
        return false;
      }
      seen.add(candidate);
      return true;
    })
    .slice(0, 3);
}

/** Weekday names as a rule lists them, `tuesday, friday`, as day numbers. */
function readWeekdays(list: string | undefined): number[] | undefined {
  const days = list?.split(/, and |, | and |,/).map((name) => WEEKDAY_NAMES.indexOf(name.trim()));
  return days && days.length > 0 && days.every((day) => day >= 0) ? days : undefined;
}

/** The Monday a day's week starts on, as Tasks counts weeks. */
function mondayOf(timestamp: number): number {
  const weekday = new Date(timestamp).getDay();
  return addDays(startOfDay(timestamp), -((weekday + 6) % 7));
}

/**
 * The next of some weekdays, every N weeks: a day later this week comes
 * first, and a day in a later week moves N - 1 more weeks on.
 */
function nextWeekdayEveryNWeeks(from: number, weekdays: readonly number[], weeks: number): number {
  const next = nextDayWhere(from, (weekday) => weekdays.includes(weekday));
  return weeks > 1 && mondayOf(next) !== mondayOf(from) ? addDays(next, 7 * (weeks - 1)) : next;
}

/** The nth weekday of a month, or its last; undefined when it has no fifth. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number | 'last',
): number | undefined {
  if (nth === 'last') {
    const last = new Date(year, month + 1, 0);
    return addDays(last.getTime(), -((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month, 1);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + 7 * (nth - 1);
  const date = new Date(year, month, day);
  return date.getMonth() === ((month % 12) + 12) % 12 ? date.getTime() : undefined;
}

/**
 * The first such weekday after `from`, in its month or every N months on. A
 * month without a fifth one is skipped, as Tasks skips it.
 */
function nextNthWeekday(from: number, months: number, weekday: number, nth: number | 'last'): number {
  const start = new Date(from);
  for (let step = 0; step < 120; step += 1) {
    const month = new Date(start.getFullYear(), start.getMonth() + step * months, 1);
    const candidate = nthWeekdayOfMonth(month.getFullYear(), month.getMonth(), weekday, nth);
    if (candidate !== undefined && candidate > from) {
      return candidate;
    }
  }
  return addMonths(from, months);
}

/** How a due date reads beside today, and whether it has passed. */
export interface DueDescription {
  /**
   * `overdue 15 days`, `due today`, `due tomorrow`, or `due in 3 days`;
   * `overdue` or `due` alone once the date is more than a month away.
   */
  relative: string;
  /** The relative phrase with the date beside it, as a row or card writes it. */
  label: string;
  overdue: boolean;
  /**
   * Set once the date is more than `needsNewDateAfterDays` behind today: the
   * label says `was due 2026-07-01`, drawn muted rather than red, and
   * `overdue` is false, since it is no longer today's emergency.
   */
  stale?: boolean;
  /** Days from today to the due date; negative once it has passed. */
  days: number;
}

/** Beyond this many days either way, the distance is left to the date. */
const RELATIVE_DUE_LIMIT_DAYS = 30;

/**
 * Words a due date the way a reader decides on it: how far from today it is,
 * then the date itself for anyone who cites or compares dates. The word
 * "overdue" is in the text, so the state never rests on color alone.
 *
 * Today is the day `now` falls on, and `taskPolicy` says when an overdue date
 * is stale: the wording depends on nothing else.
 */
export function describeDueDate(
  dueAt: number,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
  dueText?: string,
): DueDescription {
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS);
  const date = dueText ?? formatIsoDate(dueAt);
  if (days < 0 && needsNewDate(dueAt, now, taskPolicy)) {
    return { relative: 'was due', label: `was due ${date}`, overdue: false, stale: true, days };
  }
  const overdue = days < 0;
  const distance = Math.abs(days);
  let relative: string;
  if (days === 0) {
    relative = 'due today';
  } else if (days === 1) {
    relative = 'due tomorrow';
  } else if (days === -1) {
    relative = 'overdue 1 day';
  } else if (distance > RELATIVE_DUE_LIMIT_DAYS) {
    relative = overdue ? 'overdue' : 'due';
  } else {
    relative = overdue ? `overdue ${distance} days` : `due in ${days} days`;
  }
  const label = relative === 'due' ? `due ${date}` : `${relative} · ${date}`;
  return { relative, label, overdue, days };
}

function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

function nextDayWhere(
  from: number,
  matches: (weekday: number) => boolean,
): number {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(from, offset);
    if (matches(new Date(candidate).getDay())) {
      return candidate;
    }
  }
  return addDays(from, 7);
}

function nextMonthDay(
  from: number,
  months: number,
  day: number | 'last',
): number {
  const onDay = (year: number, month: number): number => {
    const last = daysInMonth(new Date(year, month, 1));
    return new Date(year, month, day === 'last' ? last : Math.min(day, last)).getTime();
  };
  const date = new Date(from);
  const sameMonth = onDay(date.getFullYear(), date.getMonth());
  return sameMonth > from
    ? sameMonth
    : onDay(date.getFullYear(), date.getMonth() + months);
}

function readField(
  metadata: TaskMetadata,
  field: TaskMetadataField | 'onCompletion',
  value: string,
): void {
  switch (field) {
    case 'priority':
      if (PRIORITY_NAMES.has(value.toLowerCase())) {
        metadata.priority ??= value.toLowerCase() as TaskPriority;
      }
      return;
    case 'repeat':
      metadata.recurrence ??= value || undefined;
      return;
    case 'id':
      metadata.id ??= value || undefined;
      return;
    case 'assignee':
      metadata.assignee ??= value || undefined;
      return;
    case 'dependsOn':
      metadata.dependsOn.push(
        ...value.split(',').map((id) => id.trim()).filter(Boolean),
      );
      return;
    case 'onCompletion':
      return;
    default:
      if (parseIsoDate(value) !== undefined) {
        metadata[field] ??= value;
      }
  }
}

/**
 * Every way a date can be written: its emoji, then the Dataview field in
 * square and round brackets. Each captures the date as its first group.
 */
function datePatterns(field: TaskDateField): RegExp[] {
  const key = DATAVIEW_KEYS[field];
  const date = '(\\d{4}-\\d{2}-\\d{2})';
  return [
    new RegExp(`${DATE_MARKERS[field]}${VARIATION}[ \\t]*${date}`, 'gu'),
    new RegExp(`\\[[ \\t]*${key}[ \\t]*::[ \\t]*${date}[ \\t]*\\]`, 'giu'),
    new RegExp(`\\([ \\t]*${key}[ \\t]*::[ \\t]*${date}[ \\t]*\\)`, 'giu'),
  ];
}

function removeDates(text: string, field: TaskDateField): string {
  return datePatterns(field).reduce(
    (result, pattern) =>
      result.replace(new RegExp(`[ \\t]*(?:${pattern.source})`, pattern.flags), ''),
    text,
  );
}

function replaceDates(
  text: string,
  field: TaskDateField,
  replace: (date: string) => string,
): string {
  return datePatterns(field).reduce(
    (result, pattern) =>
      result.replace(pattern, (match, date: string) =>
        match.replace(date, replace(date)),
      ),
    text,
  );
}

/**
 * Splits a task line after its closing bracket, setting the checkbox to
 * `mark` on the way.
 */
function splitTaskLine(
  line: string,
  checkboxColumn: number,
  mark: string,
): [string, string] {
  return [
    `${line.slice(0, checkboxColumn)}${mark}${line.slice(checkboxColumn + 1, checkboxColumn + 2)}`,
    line.slice(checkboxColumn + 2),
  ];
}

/**
 * Adds metadata at the end of a task line, ahead of a trailing block id such
 * as `^a1b2`, as Tasks does.
 */
export function appendToTaskText(text: string, token: string): string {
  const blockId = BLOCK_ID_PATTERN.exec(text);
  const body = (blockId ? text.slice(0, blockId.index) : text).trimEnd();
  return `${body} ${token}${blockId ? blockId[0].trimEnd() : ''}`;
}

/**
 * A task carried forward and left behind, as a bullet journal marks it:
 * `- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]`. It is not a task to the
 * index, so it stops counting as open, and it is not a note either.
 */
export const MIGRATED_TASK_LINE: TaskLineShape = { indent: 'whitespace', marks: '>' };

/**
 * Marks a task line as migrated to a day's note: its box becomes `[>]` and
 * a link to where it went follows its words, ahead of a trailing block id.
 */
export function markMigrated(line: string, checkboxColumn: number, target: string): string {
  const marked =
    line[checkboxColumn - 1] === '[' && line[checkboxColumn + 1] === ']'
      ? `${line.slice(0, checkboxColumn)}>${line.slice(checkboxColumn + 1)}`
      : line.replace(/\[[ xX]\]/, '[>]');
  const trimmed = marked.replace(/[ \t]+$/, '');
  const blockId = BLOCK_ID_PATTERN.exec(trimmed);
  const head = blockId ? trimmed.slice(0, blockId.index) : trimmed;
  const tail = blockId ? trimmed.slice(blockId.index) : '';
  return `${head} → [[${target}]]${tail}`;
}
