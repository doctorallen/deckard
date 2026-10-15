import { addDays, formatIsoDate, makeDay, parseIsoDate, startOfDay } from '../markdown/calendar';
import { DatePhraseOptions, parseDatePhrase, startOfWeek, Weekday } from '../markdown/dates';
import { findCodeAndLinkRanges, isInRanges } from '../markdown/inlineRanges';
import { isHeading } from '../markdown/lineShapes';
import { isListItemLine, lineIndent } from '../markdown/listNesting';
import { EntityNamespaceAliases, extractTagSpans, isPersonTag } from '../markdown/parser';
import { formatKeyWords } from '../markdown/tagKeys';
import { formatTaskDraft, isTaskLine, parseTaskDraft } from '../markdown/taskDraft';
import { TaskMetadataFormat } from '../markdown/taskFields';
import { maskNoteForWords } from '../markdown/wordCount';
import { matchesPerson } from '../query/queryEvaluator';
import { shortHash } from '../../shared/text';
import { DEFAULT_TASK_STATUSES, type TaskStatusDefinition } from './taskStatuses';

/**
 * Said they would (docs/implementation/41-said-they-would.md): a line in
 * today's daily note that names one person and a day to come, such as
 * `@sam-okafor says the loader retry fix lands by Friday`, read as a
 * promise that can be tracked as a waiting task for that person, due that
 * day, written under the line.
 *
 * The day is read with the same reader every date box uses
 * (`parseDatePhrase`), from the phrases a promise is said in; a phrase it
 * cannot read is not a promise. Everything here is pure: the caller says
 * which note is today's, what day it is, and who the reader is.
 */

/** The furthest ahead a promised day may be, in days from today. */
export const PROMISE_DAY_LIMIT = 60;

/** What reading a note for promises needs besides its lines. */
export interface PromiseReading {
  /** The moment the note is read at; the day must come after its day. */
  now: number;
  /** The week start and numeric order dates are read with. */
  dateOptions?: DatePhraseOptions;
  /** `deckard.me`: a line naming the reader alone is no promise to them. */
  identity?: string;
  aliases?: EntityNamespaceAliases;
}

/** A line read as a promise. */
export interface PromiseLine {
  /** The line, 0-based. */
  line: number;
  /** The person, as the line writes the tag: `@sam-okafor`. */
  person: string;
  /** The person's tag key, as the index keys it. */
  personKey: string;
  /** The day promised, `YYYY-MM-DD`. */
  due: string;
  /** The day words' columns, from the lead word such as `by` to the end. */
  start: number;
  end: number;
  /** The waiting task's title. */
  title: string;
}

/**
 * Every line of a note that reads as a promise, in order. The caller says
 * the note is today's; lines the reader marked as no promise are its to
 * leave out.
 *
 * A line must read as the same promise with what a reader never sees
 * blanked, as words are counted: front matter, fenced and indented code,
 * and HTML comments, so a task is never written inside one.
 */
export function findPromises(lines: readonly string[], reading: PromiseReading): PromiseLine[] {
  const shown = maskNoteForWords(lines);
  const promises: PromiseLine[] = [];
  lines.forEach((text, line) => {
    const promise = readPromiseLine(text, line, reading);
    if (promise && readPromiseLine(shown[line], line, reading)?.due === promise.due && !isTracked(lines, promise)) {
      promises.push(promise);
    }
  });
  return promises;
}

/**
 * One line read as a promise, or undefined when it is none: a task, a
 * question, or a heading is not, nor a line naming no person or more than
 * one, or only the reader, nor one whose day has passed, is today, or is
 * more than 60 days off. A question written `- [?]` is a checkbox line, as
 * a task is; one in prose ends in `?`. `@sam` and `#person/sam` on one line
 * are one person. Fenced code, front matter, and comments are
 * `findPromises`'s to leave out.
 *
 * Nor is a line a task could not be written under as its child: a table
 * row, which a line under it would end; a quote or a callout, whose child
 * would have to carry its `>`; or a line that is no list item and is
 * indented, which is code, or text a line indented under it would join.
 */
export function readPromiseLine(text: string, line: number, reading: PromiseReading): PromiseLine | undefined {
  const trimmed = text.trim();
  if (
    trimmed === '' ||
    /^[|>]/.test(trimmed) ||
    (lineIndent(text) > 0 && !isListItemLine(text)) ||
    isTaskLine(text) ||
    isHeading(text) ||
    /\?["')\]*_]*$/.test(trimmed)
  ) {
    return undefined;
  }
  const people = extractTagSpans(text, true, reading.aliases).filter((span) => isPersonTag(span.key));
  if (people.some((span) => !matchesPerson(people[0].key, span.key))) {
    return undefined;
  }
  const person = people[0];
  if (!person) {
    return undefined;
  }
  if (reading.identity && matchesPerson(reading.identity, person.key)) {
    return undefined;
  }
  const day = findPromisedDay(text, reading.now, reading.dateOptions, people);
  if (!day) {
    return undefined;
  }
  return {
    line,
    person: person.label,
    personKey: person.key,
    due: day.date,
    start: day.start,
    end: day.end,
    title: titlePromise(
      text,
      people.map((span) => ({ start: span.startColumn, end: span.endColumn })),
      day,
    ),
  };
}

/** A stretch of a line, by columns. */
interface Span {
  start: number;
  end: number;
}

/** A day found in a line, and where its words are. */
export interface PromisedDay extends Span {
  date: string;
}

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORDINAL = '(?:st|nd|rd|th)';
/** A weekday short enough to be another word: read only after a lead word. */
const SHORT_WEEKDAY = /^(?:sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)$/i;
/**
 * A numeric day, `10/20`, which is as often a count, *merged 11/12 PRs*:
 * read only after a lead word or at the end of the line.
 */
const NUMERIC_DAY = /^\d{1,2}\//;
/** What may follow the last words of a line: closing punctuation. */
const LINE_END = /^[\s.,;:!)\]*_]*$/;

/**
 * The shapes a promised day is said in, each a phrase `parseDatePhrase`
 * reads, but for `the 20th`, `next week`, and `end of week`, read here.
 */
const DAY_SHAPES = [
  '\\d{4}-\\d{2}-\\d{2}',
  `${MONTH} \\d{1,2}${ORDINAL}?(?:,? \\d{4})?`,
  `\\d{1,2}${ORDINAL}? ${MONTH}(?: \\d{4})?`,
  `the \\d{1,2}${ORDINAL}`,
  '\\d{1,2}/\\d{1,2}(?:/\\d{2}(?:\\d{2})?)?',
  '(?:next |this )?(?:sun|mon|tues|wednes|thurs|fri|satur)day',
  'sun|mon|tues?|wed|thu(?:rs?)?|fri|sat',
  'tomorrow',
  'next week',
  'end of (?:the )?(?:week|month)',
  'eow',
  'eom',
  'in \\d+ ?(?:days?|weeks?)',
];

/**
 * A day phrase anywhere in a line, with the lead word before it when there
 * is one: `by Friday`, `on the 20th`, `Oct 20`. Neither end may touch a
 * letter, a digit, or a slash, so `Friday's` reads and `sunday-school` does
 * not.
 */
const DAY_PHRASE = new RegExp(
  `(?<![\\p{L}\\p{N}_/-])(?:(by|on|due|before|until)[ \\t]+)?(${DAY_SHAPES.join('|')})(?![\\p{L}\\p{N}_/]|-[\\p{L}\\p{N}])`,
  'giu',
);

/**
 * The day promised in a line: the last day phrase outside code, links, and
 * tags that names a day after today and no more than 60 days off, or
 * undefined when none does.
 */
export function findPromisedDay(
  text: string,
  now: number,
  options: DatePhraseOptions = {},
  tags: readonly { startColumn: number; endColumn: number }[] = [],
): PromisedDay | undefined {
  const skipped = findCodeAndLinkRanges(text);
  const today = startOfDay(now);
  const limit = addDays(today, PROMISE_DAY_LIMIT);
  let found: PromisedDay | undefined;
  for (const match of text.matchAll(DAY_PHRASE)) {
    const start = match.index;
    const end = start + match[0].length;
    const lead = match[1];
    const phrase = match[2].toLowerCase();
    if (
      (SHORT_WEEKDAY.test(phrase) && !lead) ||
      (NUMERIC_DAY.test(phrase) && !lead && !LINE_END.test(text.slice(end))) ||
      isInRanges(skipped, start) ||
      tags.some((tag) => start < tag.endColumn && end > tag.startColumn)
    ) {
      continue;
    }
    const at = readPromisedDay(phrase, today, options);
    if (at !== undefined && at > today && at <= limit) {
      found = { date: formatIsoDate(at), start, end };
    }
  }
  return found;
}

/**
 * The day a phrase names, read as a promise is: `next week` and `end of
 * week` are that week's Friday, the last workday most readers have, and
 * `the 20th` the next 20th to come.
 */
function readPromisedDay(phrase: string, today: number, options: DatePhraseOptions): number | undefined {
  const weekStart: Weekday = options.weekStart ?? 0;
  if (phrase === 'next week') {
    return fridayOf(addDays(startOfWeek(today, weekStart), 7), weekStart);
  }
  if (/^(?:end of (?:the )?week|eow)$/.test(phrase)) {
    return fridayOf(startOfWeek(today, weekStart), weekStart);
  }
  const dayOfMonth = /^the (\d{1,2})/.exec(phrase);
  if (dayOfMonth) {
    return nextDayOfMonth(Number(dayOfMonth[1]), today);
  }
  const read = parseDatePhrase(phrase, today, { ...options, direction: 'future' });
  return read?.date === undefined ? undefined : parseIsoDate(read.date);
}

/** The Friday of the week starting on `weekStartDay`. */
function fridayOf(weekStartDay: number, weekStart: Weekday): number {
  return addDays(weekStartDay, (5 - weekStart + 7) % 7);
}

/**
 * The next day after today that is the `day`th of its month, within a
 * year, into the next year when it must be.
 */
function nextDayOfMonth(day: number, today: number): number | undefined {
  const date = new Date(today);
  for (let month = 0; month <= 12; month += 1) {
    const first = new Date(date.getFullYear(), date.getMonth() + month, 1);
    const at = makeDay(first.getFullYear(), first.getMonth(), day);
    if (at !== undefined && at > today) {
      return at;
    }
  }
  return undefined;
}

/** The words that say a person reported what follows: `says`, `will`, `promised`, and the like. */
const REPORTING_VERB = /^(?:says|said|will|promised|promises|to)\b[ \t]*/i;
/** The same words before a person who ends the line: `…by Friday, says @sam`. */
const REPORTED_BY = /[\s,;:–—-]*\b(?:says|said|promised|promises|per|according to)[ \t]*$/i;

/**
 * The waiting task's title: the words after the person and a reporting
 * verb, without the day phrase or the punctuation that ends the line, and
 * with a leading `that` or `the` dropped, first letter capitalized:
 * `@sam says the loader retry fix lands by Friday.` is "Loader retry fix
 * lands".
 * When that leaves fewer than two words, the whole line without the day
 * phrase, and without `says @sam` when it ends with that. `people` are the
 * person's tags on the line, in order, the first the one the words follow;
 * no tag of theirs is kept in the title, which is assigned to them anyway:
 * one in the middle of the line is written as their name, *Lunch with Sam*.
 */
export function titlePromise(text: string, people: readonly Span[], day: Span): string {
  const [person, ...others] = people;
  const line = [day, ...others].reduce(blankSpan, text).replace(/\([\s]*\)|\[[\s]*\]/g, (empty) => ' '.repeat(empty.length));
  const after = line
    .slice(person.end)
    .replace(/^[\s:,;–—-]+/, '')
    .replace(REPORTING_VERB, '')
    .replace(/^that\b[ \t]*/i, '')
    .replace(/^(?:the|a|an)\b[ \t]*/i, '');
  const title = tidyTitle(after);
  if (title.split(' ').filter(Boolean).length >= 2) {
    return title;
  }
  const before = line.slice(0, person.start);
  const rest = line.slice(person.end);
  const whole = LINE_END.test(rest) && REPORTED_BY.test(before)
    ? before.replace(REPORTED_BY, '')
    : `${before}${personWords(text.slice(person.start, person.end))}${rest}`;
  return tidyTitle(whole.replace(/^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?/, ''));
}

/** A line with a stretch of it blanked to spaces, so its columns are kept. */
function blankSpan(text: string, span: Span): string {
  return text.slice(0, span.start) + ' '.repeat(Math.max(0, span.end - span.start)) + text.slice(span.end);
}

/** A person's tag as words: `Sam Okafor` for `@sam-okafor` or `#person/sam-okafor`. */
function personWords(tag: string): string {
  const bare = tag.replace(/^[#@]/, '');
  return formatKeyWords(bare.slice(bare.lastIndexOf('/') + 1));
}

/** Words as a title: spaces collapsed, punctuation at either end off, first letter capitalized. */
function tidyTitle(words: string): string {
  const tidy = words.replace(/\s+/g, ' ').trim().replace(/^[\s.,;:!–—-]+|[\s.,;:!–—-]+$/g, '');
  return tidy.charAt(0).toLocaleUpperCase() + tidy.slice(1);
}

/**
 * Whether a task under the line already tracks it: a line indented under
 * it, before the first line that is not, that is a task assigned to the
 * same person, whatever its status, so a promise kept and ticked off is
 * not offered again.
 */
function isTracked(lines: readonly string[], promise: PromiseLine): boolean {
  const indent = lineIndent(lines[promise.line]);
  for (let at = promise.line + 1; at < lines.length; at += 1) {
    const text = lines[at];
    if (text.trim() === '') {
      continue;
    }
    if (lineIndent(text) <= indent) {
      return false;
    }
    if (isTaskLine(text) && matchesPerson(promise.person, parseTaskDraft(text).assignee)) {
      return true;
    }
  }
  return false;
}

/** How the waiting task is written. */
export interface PromiseTaskWriting {
  /** `deckard.tasks.metadataFormat`, which a note whose tasks use Dataview's brackets overrides. */
  format: TaskMetadataFormat;
  /** The reader's statuses: the first of the on-hold type is the one written. */
  statuses?: readonly TaskStatusDefinition[];
}

/**
 * The waiting task a promise is tracked as, as the line written under it:
 * a child list item, indented one level under the promise's line, of the
 * reader's first on-hold status, assigned to the person and due the day.
 * `- [w] Loader retry fix lands 📅 2026-10-17 👤 @sam-okafor`.
 */
export function formatPromiseTask(lines: readonly string[], promise: PromiseLine, writing: PromiseTaskWriting): string {
  const statuses = writing.statuses ?? DEFAULT_TASK_STATUSES;
  const waiting = statuses.find((status) => status.type === 'onHold') ?? DEFAULT_TASK_STATUSES[5];
  const draft = parseTaskDraft(`${childIndent(lines[promise.line])}- [ ] `, readNoteFormat(lines, writing.format), statuses);
  return formatTaskDraft({
    ...draft,
    symbol: waiting.symbol,
    description: promise.title,
    due: promise.due,
    assignee: promise.person,
  });
}

/**
 * The format a note's own tasks are written in: Dataview's brackets when
 * any of its tasks uses them, else the setting's.
 */
function readNoteFormat(lines: readonly string[], fallback: TaskMetadataFormat): TaskMetadataFormat {
  return lines.some((line) => isTaskLine(line) && parseTaskDraft(line, 'emoji').format === 'dataview') ? 'dataview' : fallback;
}

/**
 * The whitespace a child of a line starts with: a list item's is as wide as
 * its marker and the space after it, so the child lines up with its words;
 * any other line's is two spaces more. A line indented with tabs takes one
 * more tab.
 */
function childIndent(text: string): string {
  const item = /^([ \t]*)((?:[-*+]|\d+[.)])[ \t]+)?/.exec(text);
  const whitespace = item?.[1] ?? '';
  if (whitespace.includes('\t')) {
    return `${whitespace}\t`;
  }
  return `${whitespace}${' '.repeat(item?.[2] ? item[2].length : 2)}`;
}

/** A short key for a line's words, by which "Not a promise" is remembered. */
export function promiseLineKey(text: string): string {
  return shortHash(text.trim());
}
