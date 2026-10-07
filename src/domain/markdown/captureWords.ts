import { TaskPriority } from '../model';
import { DatePhraseOptions, parseDatePhrase } from './dates';
import { parseTaskDraft, formatTaskDraft, TaskDraft } from './taskDraft';
import { TaskMetadataFormat } from './taskFields';
import { parseRecurrence } from './recurrence';

/** What a captured task says about itself in plain words at its end, and the line it becomes. */
export interface CaptureReading {
  /** The line to write: the task with its metadata, as the editor writes it. */
  line: string;
  due?: string;
  priority?: TaskPriority;
  recurrence?: string;
  /** Who the task is for, as the tag is written, from `for @dana` at the end or `@dana to …` at the start. */
  assignee?: string;
}

/**
 * The priority words, as the priority each stands for. A Map, not an object
 * literal, because the key is a word the user typed: "Fix the constructor"
 * must not read Object's prototype as a priority.
 */
const PRIORITY_WORDS: ReadonlyMap<string, TaskPriority> = new Map([
  ['!!!', 'highest'],
  ['!!', 'high'],
  ['!', 'medium'],
  ['p1', 'highest'],
  ['p2', 'high'],
  ['p3', 'medium'],
  ['p4', 'low'],
]);

/** "daily" and its like, as the rule they stand for; a Map for the same reason. */
const REPEAT_WORDS: ReadonlyMap<string, string> = new Map([
  ['daily', 'every day'],
  ['weekly', 'every week'],
  ['monthly', 'every month'],
  ['yearly', 'every year'],
]);

const MONTH_NAME =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * A day that needs no lead word: today, tomorrow, a whole weekday name,
 * `in 3 days`, whose "in" already says it is a distance, `next week`,
 * `end of the month`, `this weekend`, or a month name with its day.
 */
const PLAIN_DAY = new RegExp(
  [
    '^(?:today|tomorrow',
    '(?:next )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)',
    'in \\d+ ?(?:days?|weeks?|months?)',
    'next (?:week|month)',
    'end of (?:the )?(?:week|month)',
    'this weekend',
    `${MONTH_NAME} \\d{1,2}(?:st|nd|rd|th)?`,
    `\\d{1,2}(?:st|nd|rd|th)? ${MONTH_NAME})$`,
  ].join('|'),
);

/**
 * Whether a phrase is a day without a lead word, as PLAIN_DAY lists them,
 * whatever its case and however many spaces or tabs sit between its words.
 */
export function isPlainDay(phrase: string): boolean {
  return PLAIN_DAY.test(phrase.toLowerCase().replace(/[ \t]+/g, ' '));
}

/** A day that reads as one only after a lead word: `fri`, `+2w`, `2026-10-02`. */
const LEAD_WORDS = new Set(['on', 'by', 'due']);

/**
 * Reads the words at the end of a captured task.
 *
 * "Call Ren tomorrow" was written as a task called "Call Ren tomorrow" with
 * no due date, and landed nowhere a date would put it. The words at the end
 * of a capture are read as a task manager's quick add reads them: a day, a
 * priority, a repeat rule, and `for @someone`, each taken off the end in any
 * order, and the rest is the task; `@someone to …` at the start hands it
 * over too. Only unambiguous words are taken: a weekday is a whole
 * weekday name, or a short one after `on`, `by`, or `due`, so "the cat sat"
 * stays a sentence. The first word is never taken, so a task keeps a name.
 * When nothing reads, the line is the text exactly as typed, trimmed.
 */
export function readCaptureText(
  text: string,
  format: TaskMetadataFormat,
  now: number = Date.now(),
  options: DatePhraseOptions = {},
): CaptureReading {
  const draft = parseTaskDraft(text.trim(), format);
  const words = draft.description.trim().split(/[ \t]+/).filter(Boolean);
  const reading: TrailingReading = {};
  const clock = { now, options };
  takeLeadingAssignee(words, reading);

  // Each pass takes one phrase off the end; the first that reads wins.
  let taken = true;
  while (taken && words.length > 1) {
    taken = TRAILING_READERS.some((take) => take(words, reading, clock));
  }

  // Nothing read leaves the line exactly as it was typed.
  if (reading.due === undefined && reading.priority === undefined && reading.recurrence === undefined && reading.assignee === undefined) {
    return { line: text.trim() };
  }
  const line = formatTaskDraft({
    ...draft,
    description: words.join(' '),
    due: reading.due ?? draft.due,
    priority: reading.priority ?? draft.priority,
    recurrence: reading.recurrence ?? draft.recurrence,
    assignee: reading.assignee ?? draft.assignee,
  });
  return { line, ...reading };
}

/** What the trailing words have said so far. */
type TrailingReading = Omit<CaptureReading, 'line'>;

/** The moment and the date options a trailing day is read against. */
interface DayClock {
  now: number;
  options: DatePhraseOptions;
}

/**
 * Takes one phrase off the end of `words` into `reading`, and says whether
 * it took one. A reader whose field is already read takes nothing.
 */
type TrailingReader = (words: string[], reading: TrailingReading, clock: DayClock) => boolean;

/** A priority word: `!!!` to `!`, or `p1` to `p4`. */
function takePriority(words: string[], reading: TrailingReading): boolean {
  const priority = PRIORITY_WORDS.get(words[words.length - 1].toLowerCase());
  if (reading.priority !== undefined || priority === undefined) {
    return false;
  }
  reading.priority = priority;
  words.pop();
  return true;
}

/**
 * A repeat: one word such as `daily`, or a rule of up to three words from
 * the last `every`, when parseRecurrence reads it.
 */
function takeRecurrence(words: string[], reading: TrailingReading): boolean {
  if (reading.recurrence !== undefined) {
    return false;
  }
  const repeat = REPEAT_WORDS.get(words[words.length - 1].toLowerCase());
  if (repeat !== undefined) {
    reading.recurrence = repeat;
    words.pop();
    return true;
  }
  const every = words.map((word) => word.toLowerCase()).lastIndexOf('every');
  if (every <= 0 || words.length - every > 3) {
    return false;
  }
  const rule = words.slice(every).join(' ').toLowerCase();
  if (!parseRecurrence(rule)) {
    return false;
  }
  reading.recurrence = rule;
  words.splice(every);
  return true;
}

/** A due day, with its lead word when it needs one. */
function takeDay(words: string[], reading: TrailingReading, clock: DayClock): boolean {
  if (reading.due !== undefined) {
    return false;
  }
  const found = readTrailingDay(words, clock.now, clock.options);
  if (!found) {
    return false;
  }
  reading.due = found.date;
  words.splice(words.length - found.length);
  return true;
}

/**
 * A person written as `@dana`, or as `@person/dana`. A bare mention is
 * only a mention; it says who a task is for only with the words below.
 */
const PERSON = /^@[\p{L}\p{N}_][\p{L}\p{N}_/.-]*$/u;

/**
 * `for @dana` at the end: who the task is for. "Ask `@dana` about the deck"
 * keeps Dana as a mention, since that is a task for whoever captured it.
 */
function takeAssignee(words: string[], reading: TrailingReading): boolean {
  const person = words[words.length - 1];
  if (reading.assignee !== undefined || words.length < 3 || !PERSON.test(person) || words[words.length - 2].toLowerCase() !== 'for') {
    return false;
  }
  reading.assignee = person;
  words.splice(words.length - 2);
  return true;
}

/** `@dana to send the deck`: a hand-off, written as a task for Dana to send the deck. */
function takeLeadingAssignee(words: string[], reading: TrailingReading): void {
  if (words.length <= 2 || !PERSON.test(words[0]) || words[1].toLowerCase() !== 'to') {
    return;
  }
  reading.assignee = words[0];
  words.splice(0, 2);
}

/** The readers in the order a pass tries them. */
const TRAILING_READERS: readonly TrailingReader[] = [takePriority, takeRecurrence, takeDay, takeAssignee];

/** The day at the end of the words, and how many words it took with its lead. */
function readTrailingDay(
  words: readonly string[],
  now: number,
  options: DatePhraseOptions,
): { date: string; length: number } | undefined {
  for (let length = Math.min(4, words.length - 1); length >= 1; length -= 1) {
    const phrase = words.slice(words.length - length).join(' ').toLowerCase();
    const lead = words[words.length - length - 1]?.toLowerCase();
    const hasLead = lead !== undefined && LEAD_WORDS.has(lead) && words.length - length - 1 > 0;
    if (!isPlainDay(phrase) && !hasLead) {
      continue;
    }
    const parsed = parseDatePhrase(phrase, now, options);
    if (parsed?.date) {
      return { date: parsed.date, length: length + (hasLead ? 1 : 0) };
    }
  }
  return undefined;
}

/** A draft with the words of its description read, and what they said. */
export interface DraftWordsReading {
  draft: TaskDraft;
  /** What the words at the end said, empty when they said nothing. */
  read: Omit<CaptureReading, 'line'>;
}

/**
 * A task's words, written into Add Task's Description, read as a quick add
 * reads them: a day, a priority, a repeat rule, and who the task is for,
 * taken off the end into the draft's own fields, which they replace. The
 * rest of the draft, its status and its other fields, is kept. When the
 * words say none of these, they are the description as typed, trimmed.
 */
export function readDraftWords(
  draft: TaskDraft,
  written: string,
  now: number = Date.now(),
  options: DatePhraseOptions = {},
): DraftWordsReading {
  const description = written.trim();
  const { line, ...read } = readCaptureText(`- [ ] ${description}`, draft.format, now, options);
  if (Object.keys(read).length === 0) {
    return { draft: { ...draft, description }, read };
  }
  return {
    draft: {
      ...draft,
      description: parseTaskDraft(line, draft.format).description,
      due: read.due ?? draft.due,
      priority: read.priority ?? draft.priority,
      recurrence: read.recurrence ?? draft.recurrence,
      assignee: read.assignee ?? draft.assignee,
    },
    read,
  };
}
