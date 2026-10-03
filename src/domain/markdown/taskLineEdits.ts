import { TaskPriority } from '../model';
import { addDays, DAY_MS, formatIsoDate, parseIsoDate, startOfDay } from './calendar';
import { TaskLineShape } from './lineShapes';
import { parseRecurrence, recurrenceReference } from './recurrence';
import {
  ASSIGNEE_PATTERN,
  BLOCK_ID_PATTERN,
  DATAVIEW_ID_PATTERN,
  datePatterns,
  dataviewFieldPattern,
  formatTaskMetadata,
  ID_PATTERN,
  parseTaskMetadata,
  PRIORITY_PATTERN,
  TaskDateField,
  TaskMetadataFormat,
} from './taskFields';

/**
 * Edits to one task line: its checkbox, one of its fields, the next
 * occurrence a repeating task leaves, and the mark a moved task leaves
 * behind. Each changes only what it is about and keeps the rest of the line
 * as written.
 */

/** The checkbox state setTaskLineCompletion writes, and the done date that goes with it. */
export interface CompletionChange {
  /** Whether the task is completed (`[x]`) or reopened (`[ ]`). */
  completed: boolean;
  /** The done date a completion adds; none is added when it is omitted. */
  doneDate?: string;
  /** The format of a new done date on a line with no metadata yet; emoji when omitted. */
  preferredFormat?: TaskMetadataFormat;
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
  { completed, doneDate, preferredFormat = 'emoji' }: CompletionChange,
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

/** The date setTaskDate writes: which field, its value or undefined to clear it, and the format for a line that has none. */
export interface DateChange {
  /** The date field to set or clear. */
  field: TaskDateField;
  /** The date, `YYYY-MM-DD`, or undefined to clear the field. */
  date: string | undefined;
  /** The format of a new date on a line with no metadata yet; emoji when omitted. */
  preferredFormat?: TaskMetadataFormat;
}

/**
 * Sets or clears one of a task's dates. An existing date changes where it is
 * written; a new one is added in the line's format.
 */
export function setTaskDate(
  line: string,
  checkboxColumn: number,
  { field, date, preferredFormat = 'emoji' }: DateChange,
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

/** What completing a task writes in place of its line. */
export interface CompletionWrite {
  /** The lines to write in place of the task: the next occurrence, if any, then the completed line. */
  text: string;
  /** The next occurrence's line, when one was started. */
  next?: string;
  /** The 🔁 rule as written, when there is one Deckard could not read. */
  unreadRule?: string;
}

/** When and how writeCompletion writes: the moment of completion, the line ending, and the steps the next occurrence takes. */
export interface CompletionContext {
  /** The moment the task was completed, which a "when done" rule advances from. */
  now: number;
  /** The line ending the next occurrence and its steps are joined with. */
  eol: string;
  /**
   * The task's steps as its next occurrence takes them: unchecked, written
   * under it, so a routine checklist comes back fresh. The completed
   * occurrence keeps its own. None when omitted.
   */
  steps?: readonly string[];
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
  { now, eol, steps = [] }: CompletionContext,
): CompletionWrite {
  const next = createNextOccurrence(completedLine, checkboxColumn, now);
  if (next !== undefined) {
    return { text: [next, ...steps, completedLine].join(eol), next };
  }
  const [, text] = splitTaskLine(completedLine, checkboxColumn, ' ');
  const rule = parseTaskMetadata(text).metadata.recurrence;
  return rule ? { text: completedLine, unreadRule: rule } : { text: completedLine };
}

/** Whole days from one day to another, negative when `to` comes first; the hour of either is ignored. */
function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** The text with every way of writing one date taken out, with the spaces and tabs before it. */
function removeDates(text: string, field: TaskDateField): string {
  return datePatterns(field).reduce(
    (result, pattern) =>
      result.replace(new RegExp(`[ \\t]*(?:${pattern.source})`, pattern.flags), ''),
    text,
  );
}

/** The text with every written date of one field changed by `replace`, in place. */
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
