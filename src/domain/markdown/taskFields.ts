import { TaskPriority } from '../model';
import { parseIsoDate } from './calendar';

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

/**
 * Which of Tasks' two formats a line's metadata is written in: emoji
 * markers, or Dataview `[key:: value]` fields.
 */
export type TaskMetadataFormat = 'emoji' | 'dataview';

/** Everything a task line's metadata says, each value as written. */
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

/** The dates a task can carry, each a `YYYY-MM-DD` day. */
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

/** The date fields in the order a line's dates are read. */
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

/** Each priority's emoji marker. */
const PRIORITY_MARKERS: ReadonlyMap<string, TaskPriority> = new Map([
  ['🔺', 'highest'],
  ['⏫', 'high'],
  ['🔼', 'medium'],
  ['🔽', 'low'],
  ['⏬', 'lowest'],
]);

/** The marker Deckard writes for each priority. */
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
/** A task id as 🆔 and ⛔ write it. */
const NAME = '[A-Za-z0-9_-]+';

/** A priority marker, and the variation selector that may follow it. */
export const PRIORITY_PATTERN = /(?:🔺|⏫|🔼|🔽|⏬)\uFE0F?/gu;
/** 🔁 and the rule after it. */
const RECURRENCE_PATTERN = /🔁\uFE0F?[ \t]*([A-Za-z0-9, !]+)/gu;
/** 🆔 and the task's id, with the spaces and tabs before it. */
export const ID_PATTERN = new RegExp(`[ \\t]*🆔${VARIATION}[ \\t]*(${NAME})`, 'gu');
/** ⛔ and the ids the task waits for, comma-separated. */
const DEPENDS_ON_PATTERN = new RegExp(
  `⛔${VARIATION}[ \\t]*(${NAME}(?:[ \\t]*,[ \\t]*${NAME})*)`,
  'gu',
);
/** 🏁 and what Tasks does with the line once done, which Deckard reads past. */
const ON_COMPLETION_PATTERN = /🏁\uFE0F?[ \t]*(?:keep|delete)/giu;
/**
 * 👤 and the person the task is for, written as the tag is: `👤 @dana`,
 * `👤 #person/dana`, or the bare name. 🧑 is read too, since either emoji is
 * what a hand reaches for, but 👤 is what Deckard writes.
 */
export const ASSIGNEE_PATTERN = new RegExp(
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
export function dataviewFieldPattern(key: string): RegExp {
  return new RegExp(`[ \\t]*(?:\\[[ \\t]*${key}[ \\t]*::[^\\]]*\\]|\\([ \\t]*${key}[ \\t]*::[^)]*\\))`, 'giu');
}
/** A Dataview `[id:: …]` field, which a task's next occurrence must not copy. */
export const DATAVIEW_ID_PATTERN = dataviewFieldPattern('id');
/**
 * A block id: the `^name` an author writes at the end of a line to make that
 * line something a `[[Note#^name]]` link can point at, as Obsidian does.
 *
 * It must be the last thing on the line and separated from the text, so a
 * caret written in prose is not mistaken for one. Deckard reads these
 * wherever they are written; `findBlockIds` collects them for a whole note.
 */
export const BLOCK_ID_PATTERN = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;

/** The priorities by name, as a Dataview `[priority:: …]` field writes them. */
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
  const seen = new Set<TaskMetadataFormat>();
  const title = readEmojiFields(readDataviewFields(text, metadata, seen), metadata, seen);
  return {
    metadata,
    title: title.replace(/[ \t]{2,}/g, ' ').trim(),
    format: chooseFormat(seen),
  };
}

/**
 * Reads the Dataview fields Deckard knows into `metadata`, and returns the
 * text with each one replaced by a space. Other Dataview fields, such as
 * `[owner:: Ren]`, stay part of the title.
 */
function readDataviewFields(text: string, metadata: TaskMetadata, seen: Set<TaskMetadataFormat>): string {
  return text.replace(
    DATAVIEW_FIELD_PATTERN,
    (match: string, ...groups: (string | undefined)[]) => {
      const [squareKey, squareValue, roundKey, roundValue] = groups;
      const field = DATAVIEW_FIELDS.get((squareKey ?? roundKey ?? '').toLowerCase());
      if (!field) {
        return match;
      }
      seen.add('dataview');
      readField(metadata, field, (squareValue ?? roundValue ?? '').trim());
      return ' ';
    },
  );
}

/**
 * Reads the emoji fields into `metadata`, the dates first and then the
 * rest, and returns the text with each one replaced by a space and a
 * trailing block id taken off. A field Dataview already set keeps its
 * value, since the first value read wins.
 */
function readEmojiFields(text: string, metadata: TaskMetadata, seen: Set<TaskMetadataFormat>): string {
  let title = text;
  for (const field of DATE_FIELDS) {
    title = title.replace(datePatterns(field)[0], (_match, date: string) => {
      seen.add('emoji');
      metadata[field] ??= date;
      return ' ';
    });
  }

  return title
    .replace(PRIORITY_PATTERN, (marker) => {
      seen.add('emoji');
      metadata.priority ??= PRIORITY_MARKERS.get(marker.replace('\uFE0F', ''));
      return ' ';
    })
    .replace(RECURRENCE_PATTERN, (_match, rule: string) => {
      seen.add('emoji');
      metadata.recurrence ??= rule.trim() || undefined;
      return ' ';
    })
    .replace(ID_PATTERN, (_match, id: string) => {
      seen.add('emoji');
      metadata.id ??= id;
      return ' ';
    })
    .replace(DEPENDS_ON_PATTERN, (_match, ids: string) => {
      seen.add('emoji');
      metadata.dependsOn.push(...ids.split(',').map((id) => id.trim()));
      return ' ';
    })
    .replace(ON_COMPLETION_PATTERN, () => {
      seen.add('emoji');
      return ' ';
    })
    .replace(ASSIGNEE_PATTERN, (_match, person: string) => {
      seen.add('emoji');
      metadata.assignee ??= person;
      return ' ';
    })
    // A trailing `^block-id` is only a link target in Obsidian.
    .replace(BLOCK_ID_PATTERN, '');
}

/** The format a line uses: emoji when it has any emoji field, as Tasks prefers it, else Dataview. */
function chooseFormat(seen: ReadonlySet<TaskMetadataFormat>): TaskMetadataFormat | undefined {
  if (seen.has('emoji')) {
    return 'emoji';
  }
  if (seen.has('dataview')) {
    return 'dataview';
  }
  return undefined;
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
    case 'due':
    case 'scheduled':
    case 'start':
    case 'created':
    case 'done':
    case 'cancelled':
      return `${DATE_EMOJI[field]} ${value}`;
  }
}

/**
 * Stores one Dataview field's value. The first value written wins, so a
 * line that repeats a field keeps its first. A priority must be one of
 * the priority names and a date a real `YYYY-MM-DD` day, or the field is
 * read past; an empty repeat, id, or assignee is not stored; and `⛔`
 * names are added to the ones already read.
 */
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
    case 'due':
    case 'scheduled':
    case 'start':
    case 'created':
    case 'done':
    case 'cancelled':
      if (parseIsoDate(value) !== undefined) {
        metadata[field] ??= value;
      }
  }
}

/**
 * Every way a date can be written: its emoji, then the Dataview field in
 * square and round brackets. Each captures the date as its first group.
 */
export function datePatterns(field: TaskDateField): RegExp[] {
  const key = DATAVIEW_KEYS[field];
  const date = '(\\d{4}-\\d{2}-\\d{2})';
  return [
    new RegExp(`${DATE_MARKERS[field]}${VARIATION}[ \\t]*${date}`, 'gu'),
    new RegExp(`\\[[ \\t]*${key}[ \\t]*::[ \\t]*${date}[ \\t]*\\]`, 'giu'),
    new RegExp(`\\([ \\t]*${key}[ \\t]*::[ \\t]*${date}[ \\t]*\\)`, 'giu'),
  ];
}
