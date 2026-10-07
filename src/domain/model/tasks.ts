/**
 * Tasks: the checkbox lines of a note, with the Obsidian Tasks fields written
 * on them.
 */
import type { TagReference } from './tags';

/** Task priorities of the Obsidian Tasks format, 🔺 ⏫ 🔼 🔽 ⏬. */
export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/**
 * What a status means, whatever it is called: `todo`, `inProgress`, and
 * `onHold` are open; `done` is done; `cancelled` is closed but not done;
 * `nonTask` marks a checkbox line that is not a task at all.
 */
export type TaskStatusType = 'todo' | 'inProgress' | 'onHold' | 'done' | 'cancelled' | 'nonTask';

/** A task's status as its checkbox says it: the character, its status's name, and its type. */
export interface TaskStatus {
  /** The character between the brackets: ` `, `x`, `/`, or any other. */
  symbol: string;
  /** Its status's name, or Unknown for a character no status names. */
  name: string;
  type: TaskStatusType;
}

/**
 * A due date as the host words it, "overdue 15 days · 2026-09-08", in the
 * parts Display's Dates preference chooses between: the state, which is
 * always drawn so an overdue date always says "overdue"; how far off it is;
 * and the date. A page draws every part from these, never by reading the
 * words, since the date is in the reader's format.
 */
export interface DueParts {
  /** `overdue`, `due`, `due today`; the whole wording when it has no date of its own to draw, `due 2026-12-25` or `was due 2026-06-01`. */
  readonly state: string;
  /** ` 15 days`, ` in 3 days`, or ` tomorrow`; empty when the wording gives none. */
  readonly distance: string;
  /** The date, drawn after ` · `; empty when the state holds it. */
  readonly date: string;
}

/** A checkbox line in a note, with its tags, dates, and the fields written on it. */
export interface Task {
  id: string;
  filePath: string;
  sectionId?: string;
  /** The entry the task's heading belongs to, when that is not the heading itself (noteEntries.ts). */
  entryId?: string;
  title: string;
  /** Whether its status is of the done type. */
  completed: boolean;
  tags: string[];
  tagLabels: Record<string, string>;
  /** Explicit tags written on this task line, excluding inherited tags. */
  associationTagGroups?: TagReference[][];
  dueAt?: number;
  dueText?: string;
  /** ⏳ scheduled date: the day the author plans to work on the task. */
  scheduledAt?: number;
  /** 🛫 start date: the task is not actionable before this day. */
  startAt?: number;
  /** ✅ date the task was completed. */
  doneAt?: number;
  /** ❌ date the task was cancelled. */
  cancelledAt?: number;
  priority?: TaskPriority;
  /** 🔁 repeat rule as written, such as "every week". */
  recurrence?: string;
  /**
   * 👤 the person the task is for, as their tag is written. Anyone else named
   * on the line is mentioned rather than asked.
   */
  assignee?: string;
  /** 🆔 name other tasks use in ⛔ to depend on this one. */
  dependencyId?: string;
  /** ⛔ names of the tasks that must be done first. */
  dependsOn?: string[];
  lineNumber: number;
  checkboxColumn: number;
  /** Its checkbox's status, by the character in its box (taskStatuses.ts). */
  status: TaskStatus;
  sourceLineText: string;
  createdAt?: number;
  updatedAt?: number;
  /** The task this one is a step of: the checkbox it is indented under. */
  parentTaskId?: string;
  /** This task's own steps, the checkboxes indented directly under it. */
  steps?: TaskSteps;
}

/** How far along a task's direct steps are. */
export interface TaskSteps {
  /** The steps' task ids, in the order they are written. */
  ids: string[];
  total: number;
  done: number;
  /** The first open step's title, as the index holds it. */
  next?: string;
}
