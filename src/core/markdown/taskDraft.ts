import { TaskPriority } from '../types';
import {
  BLOCK_ID_PATTERN,
  formatTaskMetadata,
  formatIsoDate,
  parseTaskMetadata,
  startOfDay,
  TaskDateField,
  TaskMetadataFormat,
} from './taskMetadata';

/**
 * A task line taken apart, so each part can be edited on its own and the
 * line written again from all of them.
 *
 * Deckard's other task edits change one field where it is written and leave
 * the rest of the line untouched. An editor changes several at once, so it
 * reads the whole line into a draft and writes the whole line back — which
 * means the draft has to carry everything the line held, including the parts
 * Deckard does not offer to edit.
 */

export interface TaskDraft {
  /** The whitespace and list marker before the checkbox, as written. */
  prefix: string;
  completed: boolean;
  /** The words of the task, with its metadata taken out. */
  description: string;
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  priority?: TaskPriority;
  /** The 🔁 rule as written, such as "every week". */
  recurrence?: string;
  /** 🆔 the name other tasks depend on. */
  id?: string;
  /** ⛔ the names of the tasks this one waits for. */
  dependsOn: string[];
  /** 👤 the person the task is for, as the tag is written: `@dana`. */
  assignee?: string;
  /**
   * Parts of the line Deckard does not edit but must not lose: an
   * on-completion marker, and a trailing `^block-id`.
   */
  extras: string[];
  blockId?: string;
  /** The format its metadata is written in. */
  format: TaskMetadataFormat;
}

/** The checkbox line a draft is read from and written back to. */
const TASK_LINE = /^(\s*[-*+][ \t]+\[)([ xX])(\][ \t]?)/;
/** An on-completion marker, in either format, which is kept as written. */
const ON_COMPLETION =
  /🏁️?[ \t]*(?:keep|delete)|\[[ \t]*onCompletion[ \t]*::[^\]]*\]/giu;

/** The order Tasks writes metadata in, and the one a draft writes back. */
const DATE_ORDER: readonly TaskDateField[] = [
  'created',
  'start',
  'scheduled',
  'due',
  'cancelled',
  'done',
];

/** Whether a line is a checklist item Deckard can edit as a task. */
export function isTaskLine(line: string): boolean {
  return TASK_LINE.test(line);
}

/**
 * Reads a task line into a draft, or makes an empty one from a line that is
 * not a task yet — keeping whatever was written on it as the description.
 */
export function parseTaskDraft(
  line: string,
  fallbackFormat: TaskMetadataFormat = 'emoji',
): TaskDraft {
  const match = TASK_LINE.exec(line);
  const prefix = match
    ? `${match[1]}${match[2]}${match[3].trimEnd()} `
    : `${/^\s*/.exec(line)?.[0] ?? ''}- [ ] `;
  const body = match ? line.slice(match[0].length) : line.trim();

  const extras = body.match(ON_COMPLETION) ?? [];
  const blockId = BLOCK_ID_PATTERN.exec(body)?.[1];
  const { metadata, title, format } = parseTaskMetadata(body);
  return {
    prefix,
    completed: match ? match[2] !== ' ' : false,
    description: title,
    ...metadata,
    dependsOn: metadata.dependsOn,
    extras: extras.map((extra) => extra.trim()),
    ...(blockId ? { blockId } : {}),
    format: format ?? fallbackFormat,
  };
}

/**
 * Writes a draft back as one task line: the description, then its metadata
 * in the order Tasks writes it, then the parts Deckard kept but does not
 * edit, and last of all the block id, which has to end the line.
 */
export function formatTaskDraft(draft: TaskDraft): string {
  const write = (
    field: Parameters<typeof formatTaskMetadata>[0],
    value: string | undefined,
  ): string[] =>
    value === undefined || value === '' ? [] : [formatTaskMetadata(field, value, draft.format)];

  const tokens = [
    ...write('priority', draft.priority),
    ...write('repeat', draft.recurrence),
    ...DATE_ORDER.flatMap((field) => write(field, draft[field])),
    ...write('id', draft.id),
    ...(draft.dependsOn.length > 0
      ? [formatTaskMetadata('dependsOn', draft.dependsOn.join(', '), draft.format)]
      : []),
    // Who it is for reads last, where a reader looks for it.
    ...write('assignee', draft.assignee),
    ...draft.extras,
  ];
  const checkbox = draft.prefix.replace(
    /\[[ xX]\]/,
    draft.completed ? '[x]' : '[ ]',
  );
  const body = [draft.description.trim(), ...tokens].filter(Boolean).join(' ');
  return `${checkbox}${body}${draft.blockId ? ` ^${draft.blockId}` : ''}`.replace(
    /[ \t]+$/,
    '',
  );
}

/** What a draft's field reads as in the editor, or nothing when it is unset. */
export function describeTaskDraftField(
  draft: TaskDraft,
  field: keyof TaskDraft,
): string {
  const value = draft[field];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return typeof value === 'string' ? value : '';
}

/**
 * A date written the way people write one: a day, a weekday, or a distance
 * from today.
 *
 * Returns the date as `YYYY-MM-DD`, or `{ date: undefined }` for an empty
 * value, which clears the field. Undefined means it could not be read, which
 * is what the input box reports rather than guessing a day.
 */
export function parseTaskDateInput(
  written: string,
  now: number = Date.now(),
): { date: string | undefined } | undefined {
  const text = written.trim().toLowerCase();
  if (!text) {
    return { date: undefined };
  }
  const today = startOfDay(now);
  const day = (offset: number): { date: string } => ({
    date: formatIsoDate(today + offset * 24 * 60 * 60 * 1000),
  });

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, date] = text.split('-').map(Number);
    const made = new Date(year, month - 1, date);
    return made.getFullYear() === year &&
      made.getMonth() === month - 1 &&
      made.getDate() === date
      ? { date: text }
      : undefined;
  }
  if (text === 'today') {
    return day(0);
  }
  if (text === 'tomorrow') {
    return day(1);
  }
  if (text === 'yesterday') {
    return day(-1);
  }

  // "in 3 days", "+2w", "3 weeks"
  const distance = /^(?:in[ \t]+|\+)?(\d+)[ \t]*(d|w|m|days?|weeks?|months?)$/.exec(
    text,
  );
  if (distance) {
    const count = Number(distance[1]);
    const unit = distance[2][0];
    if (unit === 'd') {
      return day(count);
    }
    if (unit === 'w') {
      return day(count * 7);
    }
    const date = new Date(today);
    date.setMonth(date.getMonth() + count);
    return { date: formatIsoDate(date.getTime()) };
  }

  // "friday", "next friday": the next one to come, and never today.
  const weekday = /^(?:next[ \t]+)?(sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?)(?:day)?$/.exec(
    text,
  );
  if (weekday) {
    const wanted = WEEKDAYS.findIndex((name) => name.startsWith(weekday[1].slice(0, 3)));
    const current = new Date(today).getDay();
    const offset = ((wanted - current + 7) % 7) || 7;
    return day(offset);
  }
  return undefined;
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** A date as the editor shows it back: `Friday 2026-09-25`. */
export function describeTaskDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const made = new Date(year, month - 1, day);
  return `${WEEKDAYS[made.getDay()].replace(/^./, (letter) => letter.toUpperCase())} ${date}`;
}
