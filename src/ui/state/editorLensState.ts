import { findDailyNoteDate } from '../../core/markdown/parser';
import { ParsedFile, Task, WorkspaceIndex } from '../../core/types';
import { findAdjacentDailyNote, listDailyNotes } from '../commands/dailyNote';
import { planRollover } from '../commands/rollover';

/**
 * What the editor's action lenses decide, apart from VS Code. Each function
 * returns only what is worth a lens, so an empty result means no lens at all.
 */

export interface TaskDependencies {
  /** Zero-based line of the task. */
  line: number;
  /** Open tasks whose `🆔` this task's `⛔` names. */
  waitingOn: Task[];
  /** Names in this task's `⛔` that no task in the workspace carries. */
  missingIds: string[];
  /** Open tasks whose `⛔` names this task's `🆔`, while it is open itself. */
  blocking: Task[];
}

/**
 * The tasks in a note that wait on, or hold up, another open task.
 *
 * `file` is usually parsed from the editor, so its own tasks follow unsaved
 * edits; every other note's tasks come from the index. A done task is neither
 * waited on nor blocking, which is how `is:blocked` and `is:blocking` read
 * the same markers.
 */
export function findTaskDependencies(
  file: ParsedFile,
  index: WorkspaceIndex,
): TaskDependencies[] {
  const own = file.tasks.filter(
    (task) => task.dependencyId || (task.dependsOn?.length ?? 0) > 0,
  );
  if (own.length === 0) {
    return [];
  }

  const tasks = [
    ...[...index.tasks.values()].filter(
      (task) => task.filePath !== file.filePath,
    ),
    ...file.tasks,
  ];
  const carriers = new Map<string, Task[]>();
  const waiters = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.dependencyId) {
      append(carriers, task.dependencyId, task);
    }
    if (!task.completed) {
      new Set(task.dependsOn).forEach((id) => append(waiters, id, task));
    }
  }

  return own.flatMap((task) => {
    const ids = [...new Set(task.dependsOn ?? [])];
    const waitingOn = task.completed
      ? []
      : ids.flatMap((id) =>
          (carriers.get(id) ?? []).filter(
            (carrier) => carrier !== task && !carrier.completed,
          ),
        );
    // A done task no longer waits, so a name it gives that went nowhere no
    // longer matters either.
    const missingIds = task.completed
      ? []
      : ids.filter((id) => !carriers.has(id));
    const blocking =
      task.completed || !task.dependencyId
        ? []
        : (waiters.get(task.dependencyId) ?? []).filter(
            (waiter) => waiter !== task,
          );
    return waitingOn.length > 0 || missingIds.length > 0 || blocking.length > 0
      ? [{ line: task.lineNumber - 1, waitingOn, missingIds, blocking }]
      : [];
  });
}

export interface DailyNoteActions {
  /** The nearest daily notes before and after this one, by date. */
  previous?: string;
  next?: string;
  /**
   * Unfinished tasks in earlier daily notes that a rollover would carry into
   * this one: only on today's note, and without the lines already in it.
   */
  carryIn: Task[];
}

/**
 * What a daily note offers: its neighbors, and on today's note, the tasks
 * still open in earlier ones. Undefined for a note that is not a daily note,
 * or a daily note with nothing to offer.
 *
 * A rollover leaves behind a task whose line is already in today's note, so
 * those are not counted; in copy mode they stay in the note they came from,
 * and would otherwise keep offering to carry in what is already there.
 */
export function findDailyNoteActions(
  file: ParsedFile,
  index: WorkspaceIndex,
  today: string,
  lookbackDays = 0,
): DailyNoteActions | undefined {
  const date = findDailyNoteDate(
    file.filePath,
    file.sections
      .filter((section) => section.headingLevel === 1)
      .map((section) => section.heading),
  );
  if (!date) {
    return undefined;
  }
  const notes = listDailyNotes(index).filter(
    (note) => note.filePath !== file.filePath,
  );
  const previous = findAdjacentDailyNote(notes, date, 'previous')?.date;
  const next = findAdjacentDailyNote(notes, date, 'next')?.date;
  const written = new Set(
    file.content.split(/\r?\n/).map((line) => line.trim()),
  );
  const carryIn =
    date === today
      ? (planRollover(index, today, lookbackDays)?.tasks ?? []).filter(
          (task) =>
            task.filePath !== file.filePath &&
            !written.has(task.sourceLineText.trim()),
        )
      : [];
  if (!previous && !next && carryIn.length === 0) {
    return undefined;
  }
  return {
    ...(previous ? { previous } : {}),
    ...(next ? { next } : {}),
    carryIn,
  };
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}
