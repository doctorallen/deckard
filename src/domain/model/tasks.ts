/**
 * Tasks: the checkbox lines of a note, with the Obsidian Tasks fields written
 * on them.
 */
import type { TagReference } from './tags';

/** Task priorities of the Obsidian Tasks format, 🔺 ⏫ 🔼 🔽 ⏬. */
export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/** A checkbox line in a note, with its tags, dates, and the fields written on it. */
export interface Task {
  id: string;
  filePath: string;
  sectionId?: string;
  title: string;
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
  checkboxValue: ' ' | 'x' | 'X';
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
