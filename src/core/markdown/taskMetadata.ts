import { TaskPriority } from '../types';

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
const DATAVIEW_ID_PATTERN =
  /[ \t]*(?:\[[ \t]*id[ \t]*::[^\]]*\]|\([ \t]*id[ \t]*::[^)]*\))/giu;
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

const DAY = 24 * 60 * 60 * 1000;

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
  const [prefix, text] = splitTaskLine(line, checkboxColumn, line[checkboxColumn]);
  const format = parseTaskMetadata(text).format ?? preferredFormat;
  const cleared = text
    .replace(/[ \t]*(?:🔺|⏫|🔼|🔽|⏬)\uFE0F?/gu, '')
    .replace(
      /[ \t]*(?:\[[ \t]*priority[ \t]*::[^\]]*\]|\([ \t]*priority[ \t]*::[^)]*\))/giu,
      '',
    );
  return (
    prefix +
    (priority
      ? appendToTaskText(cleared, formatTaskMetadata('priority', priority, format))
      : cleared)
  );
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
  const [prefix, text] = splitTaskLine(line, checkboxColumn, line[checkboxColumn]);
  const format = parseTaskMetadata(text).format ?? preferredFormat;
  const cleared = text
    .replace(ASSIGNEE_PATTERN, '')
    .replace(
      /[ \t]*(?:\[[ \t]*assignee[ \t]*::[^\]]*\]|\([ \t]*assignee[ \t]*::[^)]*\))/giu,
      '',
    );
  return (
    prefix +
    (person
      ? appendToTaskText(cleared, formatTaskMetadata('assignee', person, format))
      : cleared)
  );
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

  const reference =
    parseIsoDate(metadata.due) ??
    parseIsoDate(metadata.scheduled) ??
    parseIsoDate(metadata.start);
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

export interface RecurrenceRule {
  /** "when done" rules count from the day the task is completed. */
  whenDone: boolean;
  /** The first occurrence after `from`, a local midnight. */
  next(from: number): number;
}

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Reads the repeat rules Tasks writes most often:
 *
 * - `every day`, `every 3 weeks`, `every month`, `every 2 years`
 * - `every weekday`, `every Monday`, `every week on Tuesday, Friday`
 * - `every month on the 15th`, `every month on the last`
 *
 * Any of them can end in `when done`. Anything else returns undefined rather
 * than a guess, so Deckard never writes a wrong next date.
 */
export function parseRecurrence(text: string): RecurrenceRule | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const whenDone = normalized.endsWith(' when done');
  const rule = whenDone
    ? normalized.slice(0, -' when done'.length)
    : normalized;

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

  const weekdays = /^every (?:week on )?(.+)$/
    .exec(rule)?.[1]
    .split(/, and |, | and /)
    .map((name) => WEEKDAY_NAMES.indexOf(name));
  if (weekdays && weekdays.length > 0 && weekdays.every((day) => day >= 0)) {
    return {
      whenDone,
      next: (from) => nextDayWhere(from, (weekday) => weekdays.includes(weekday)),
    };
  }

  return undefined;
}

/** Reads a `YYYY-MM-DD` date as local midnight, rejecting impossible dates. */
export function parseIsoDate(value: string | undefined): number | undefined {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date.getTime()
    : undefined;
}

/** Writes a timestamp as the local `YYYY-MM-DD` date Tasks uses. */
export function formatIsoDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
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
  /** Days from today to the due date; negative once it has passed. */
  days: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Beyond this many days either way, the distance is left to the date. */
const RELATIVE_DUE_LIMIT_DAYS = 30;

/**
 * Words a due date the way a reader decides on it: how far from today it is,
 * then the date itself for anyone who cites or compares dates. The word
 * "overdue" is in the text, so the state never rests on color alone.
 */
export function describeDueDate(
  dueAt: number,
  now: number,
  dueText?: string,
): DueDescription {
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS);
  const date = dueText ?? formatIsoDate(dueAt);
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

/** Moves by calendar days, so a daylight-saving change never shifts the date. */
export function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
  ).getTime();
}

/** Moves by calendar months, keeping the day where the month allows it. */
function addMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp);
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  target.setDate(Math.min(date.getDate(), daysInMonth(target)));
  return target.getTime();
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
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
