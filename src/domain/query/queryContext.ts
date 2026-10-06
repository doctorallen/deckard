import { DateFormats, DEFAULT_DATE_FORMATS } from '../markdown/dateFormat';
import { Weekday } from '../markdown/dates';
import { EntityNamespaceAliases, getEntityNamespaceAliases } from '../markdown/parser';
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
  /**
   * The namespace aliases the index was built with, `organization` for
   * `org` and those of `deckard.entityNamespaceAliases`, so a tag or a kind
   * written in a search the way a note writes it finds what the index keeps
   * under its canonical namespace.
   */
  entityNamespaceAliases: EntityNamespaceAliases;
  /**
   * How a date is written for the reader, from `deckard.display.dateFormat`
   * and `shortDateFormat`, so a state builder words dates without reading a
   * setting. A date written into a note or a search stays `YYYY-MM-DD`.
   */
  dateFormats: DateFormats;
}

/** The settings a QueryContext is built from, each one optional. */
export interface QueryContextSettings {
  identity?: string;
  weekStart?: Weekday;
  /** Anything left out takes its default, as the settings' defaults are. */
  taskPolicy?: Partial<TaskPolicy>;
  /** Already merged over the built-in aliases, as getEntityNamespaceAliases returns them. */
  entityNamespaceAliases?: EntityNamespaceAliases;
  /** The reader's date formats; the defaults, counting weeks from `weekStart`, when left out. */
  dateFormats?: DateFormats;
}

/**
 * A QueryContext for `now`, with every setting it is not given at the
 * settings' own default: nobody named, weeks from Sunday,
 * DEFAULT_TASK_POLICY, the built-in namespace aliases, and dates as
 * `YYYY-MM-DD`. An identity of only spaces, or one that is not text (a
 * setting written by hand), names nobody.
 */
export function createQueryContext(
  now: number,
  settings: QueryContextSettings = {},
): QueryContext {
  const identity = typeof settings.identity === 'string' ? settings.identity.trim() : undefined;
  return {
    ...(identity ? { identity } : {}),
    weekStart: settings.weekStart ?? 0,
    taskPolicy: { ...DEFAULT_TASK_POLICY, ...settings.taskPolicy },
    now,
    entityNamespaceAliases: settings.entityNamespaceAliases ?? getEntityNamespaceAliases(undefined),
    dateFormats: settings.dateFormats ?? { ...DEFAULT_DATE_FORMATS, weekStart: settings.weekStart ?? 0 },
  };
}
