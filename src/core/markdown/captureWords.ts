import { TaskPriority } from '../types';
import { parseTaskDateInput, parseTaskDraft, formatTaskDraft } from './taskDraft';
import { parseRecurrence, TaskMetadataFormat } from './taskMetadata';

/**
 * What a captured task says about itself in plain words at its end.
 *
 * "Call Ren tomorrow" was written as a task called "Call Ren tomorrow" with
 * no due date, and landed nowhere a date would put it. The words at the end
 * of a capture are read as a task manager's quick add reads them: a day, a
 * priority, and a repeat rule, each taken off the end in any order, and the
 * rest is the task. Only unambiguous words are taken: a weekday is a whole
 * weekday name, or a short one after `on`, `by`, or `due`, so "the cat sat"
 * stays a sentence.
 */
export interface CaptureReading {
  /** The line to write: the task with its metadata, as the editor writes it. */
  line: string;
  due?: string;
  priority?: TaskPriority;
  recurrence?: string;
}

const PRIORITY_WORDS: Readonly<Record<string, TaskPriority>> = {
  '!!!': 'highest',
  '!!': 'high',
  '!': 'medium',
  p1: 'highest',
  p2: 'high',
  p3: 'medium',
  p4: 'low',
};

/** "daily" and its like, as the rule they stand for. */
const REPEAT_WORDS: Readonly<Record<string, string>> = {
  daily: 'every day',
  weekly: 'every week',
  monthly: 'every month',
  yearly: 'every year',
};

/**
 * A day that needs no lead word: today, tomorrow, a whole weekday name, or
 * `in 3 days`, whose "in" already says it is a distance.
 */
const PLAIN_DAY = /^(?:today|tomorrow|(?:next[ \t]+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|in[ \t]+\d+[ \t]*(?:days?|weeks?|months?))$/;
/** A day that reads as one only after a lead word: `fri`, `+2w`, `2026-10-02`. */
const LEAD_WORDS = new Set(['on', 'by', 'due']);

export function readCaptureText(
  text: string,
  format: TaskMetadataFormat,
  now: number = Date.now(),
): CaptureReading {
  const draft = parseTaskDraft(text.trim(), format);
  const words = draft.description.trim().split(/[ \t]+/).filter(Boolean);
  const reading: Omit<CaptureReading, 'line'> = {};

  // Each pass takes one phrase off the end; the first that reads wins.
  for (let taken = true; taken && words.length > 1; ) {
    taken = false;
    const last = words[words.length - 1].toLowerCase();
    if (reading.priority === undefined && PRIORITY_WORDS[last]) {
      reading.priority = PRIORITY_WORDS[last];
      words.pop();
      taken = true;
      continue;
    }
    if (reading.recurrence === undefined) {
      if (REPEAT_WORDS[last]) {
        reading.recurrence = REPEAT_WORDS[last];
        words.pop();
        taken = true;
        continue;
      }
      const every = words.map((word) => word.toLowerCase()).lastIndexOf('every');
      if (every > 0 && words.length - every <= 3) {
        const rule = words.slice(every).join(' ').toLowerCase();
        if (parseRecurrence(rule)) {
          reading.recurrence = rule;
          words.splice(every);
          taken = true;
          continue;
        }
      }
    }
    if (reading.due === undefined) {
      const found = readTrailingDay(words, now);
      if (found) {
        reading.due = found.date;
        words.splice(words.length - found.length);
        taken = true;
      }
    }
  }

  // Nothing read leaves the line exactly as it was typed.
  if (reading.due === undefined && reading.priority === undefined && reading.recurrence === undefined) {
    return { line: text.trim() };
  }
  const line = formatTaskDraft({
    ...draft,
    description: words.join(' '),
    due: reading.due ?? draft.due,
    priority: reading.priority ?? draft.priority,
    recurrence: reading.recurrence ?? draft.recurrence,
  });
  return { line, ...reading };
}

/** The day at the end of the words, and how many words it took with its lead. */
function readTrailingDay(
  words: readonly string[],
  now: number,
): { date: string; length: number } | undefined {
  for (let length = Math.min(3, words.length - 1); length >= 1; length -= 1) {
    const phrase = words.slice(words.length - length).join(' ').toLowerCase();
    const lead = words[words.length - length - 1]?.toLowerCase();
    const hasLead = lead !== undefined && LEAD_WORDS.has(lead) && words.length - length - 1 > 0;
    if (!PLAIN_DAY.test(phrase) && !hasLead) {
      continue;
    }
    const parsed = parseTaskDateInput(phrase, now);
    if (parsed?.date) {
      return { date: parsed.date, length: length + (hasLead ? 1 : 0) };
    }
  }
  return undefined;
}
