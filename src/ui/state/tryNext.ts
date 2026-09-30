import { Weekday } from '../../domain/markdown/dates';

/**
 * Home's Try next: one suggestion at a time, the first that applies, for
 * something the reader's notes are now ready for. Pure, so each rule can be
 * held to its case; the host gathers the input and keeps what was retired
 * or put off.
 */

export type TryNextId = 'weeklyReview' | 'mergeLookalike' | 'taskBoard' | 'pinNote';

export interface TryNextSuggestion {
  id: TryNextId;
  /** What retiring or putting it off is kept under: the id, or for a merge, the pair. */
  key: string;
  text: string;
  action: { label: string };
}

export interface TryNextInput {
  weekStart: Weekday;
  /** Every daily note's day, YYYY-MM-DD. */
  dailyNoteDates: readonly string[];
  /** Whether last week already has its weekly note. */
  hasLastWeekNote: boolean;
  /** The clearest pair of tags that look like one idea spelled twice. */
  lookalike?: { sourceKey: string; sourceLabel: string; targetKey: string; targetLabel: string };
  openTasks: number;
  /** The note opened most often lately, and how often. */
  frequentNote?: { filePath: string; title: string; line: number; opens: number };
  hasPins: boolean;
}

/** How long Not now puts a suggestion off. */
export const TRY_NEXT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** The fewest daily notes last week that make a review worth suggesting. */
const REVIEW_DAILY_NOTES = 5;
/** The fewest open tasks that make the Task board worth suggesting. */
const BOARD_OPEN_TASKS = 10;
/** The fewest opens in a fortnight that make a note worth pinning. */
export const PIN_OPENS = 5;

function isoDay(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/** Every suggestion that applies, in the order they are offered. */
function candidates(input: TryNextInput, now: number): TryNextSuggestion[] {
  const found: TryNextSuggestion[] = [];
  const today = new Date(now);
  if (today.getDay() === input.weekStart && !input.hasLastWeekNote) {
    const from = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7));
    const to = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
    const written = input.dailyNoteDates.filter((date) => date >= from && date <= to).length;
    if (written >= REVIEW_DAILY_NOTES) {
      found.push({
        id: 'weeklyReview',
        key: 'weeklyReview',
        text: `You wrote ${written} daily notes last week. A review lists what you finished and what is still open.`,
        action: { label: 'Write a review' },
      });
    }
  }
  if (input.lookalike) {
    const pair = input.lookalike;
    found.push({
      id: 'mergeLookalike',
      key: `mergeLookalike:${pair.sourceKey}|${pair.targetKey}`,
      text: `${pair.sourceLabel} looks like ${pair.targetLabel}. Merging rewrites every note that uses it.`,
      action: { label: 'Merge…' },
    });
  }
  if (input.openTasks >= BOARD_OPEN_TASKS) {
    found.push({
      id: 'taskBoard',
      key: 'taskBoard',
      text: `You have ${input.openTasks.toLocaleString('en-US')} open tasks. The Task board lays them out by status, and a drag rewrites the task.`,
      action: { label: 'Open Task board' },
    });
  }
  if (input.frequentNote && input.frequentNote.opens >= PIN_OPENS && !input.hasPins) {
    found.push({
      id: 'pinNote',
      key: 'pinNote',
      text: `You open ${input.frequentNote.title} often. Pin it to Home to keep it one click away.`,
      action: { label: 'Pin to Home' },
    });
  }
  return found;
}

/**
 * The one suggestion to show, or none: the first that applies and has been
 * neither retired nor put off until after `now`.
 */
export function chooseTryNext(
  input: TryNextInput,
  retired: ReadonlySet<string>,
  snoozed: Readonly<Record<string, number>>,
  now: number,
): TryNextSuggestion | undefined {
  return candidates(input, now).find(
    (suggestion) => !retired.has(suggestion.key) && !((snoozed[suggestion.key] ?? 0) > now),
  );
}
