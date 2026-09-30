import { Weekday } from '../markdown/dates';
import { DEFAULT_TASK_POLICY, TaskPolicy } from '../tasks/taskPolicy';

/**
 * What a search's answer depends on besides the index and the search: who
 * `is:mine` means, the day a week starts on, how tasks are read, and the
 * moment it is asked at.
 *
 * The UI reads it from settings and the clock once, where a view, command,
 * or tool begins its work, and passes it down; nothing below that reads a
 * setting or the clock, so one evaluation cannot straddle two values and a
 * test states every input it depends on.
 */
export interface QueryContext {
  /**
   * The person `is:mine` and `is:waiting` compare an assignee to, from
   * `deckard.me`, trimmed. Undefined when no one is named: `is:mine` is then
   * only what names nobody.
   */
  identity?: string;
  /** The day `this-week` and its like start on, from `deckard.calendar.weekStart`. */
  weekStart: Weekday;
  /** When a task needs a new date, where its status is written, and what is on hold. */
  taskPolicy: Readonly<TaskPolicy>;
  /** The moment the question is asked, in milliseconds since the epoch. */
  now: number;
}

/** The settings a QueryContext is built from, each one optional. */
export interface QueryContextSettings {
  identity?: string;
  weekStart?: Weekday;
  /** Anything left out takes its default, as the settings' defaults are. */
  taskPolicy?: Partial<TaskPolicy>;
}

/**
 * A QueryContext for `now`, with every setting it is not given at the
 * settings' own default: nobody named, weeks from Sunday, and
 * DEFAULT_TASK_POLICY. An identity of only spaces names nobody.
 */
export function createQueryContext(
  now: number,
  settings: QueryContextSettings = {},
): QueryContext {
  const identity = settings.identity?.trim();
  return {
    ...(identity ? { identity } : {}),
    weekStart: settings.weekStart ?? 0,
    taskPolicy: { ...DEFAULT_TASK_POLICY, ...settings.taskPolicy },
    now,
  };
}
