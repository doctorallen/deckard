import { isParkedTask } from '../index/parked';
import { Task, WorkspaceIndex } from '../model';
import { formatLocalDate, listDailyNotes, parseLocalDate } from './periodicNotes';

/** What a rollover would carry, and where from. */
export interface RolloverPlan {
  /** The daily notes it draws from, oldest first. */
  fromDates: string[];
  /** Their open tasks: oldest note first, and in the order each writes them. */
  tasks: Task[];
}

/**
 * What happens to a task carried forward: moved out of the note it came
 * from, or migrated, copied and its old line marked `[>]` with a link to
 * today, as a bullet journal does.
 */
export type RolloverMode = 'off' | 'move' | 'migrate';

/**
 * The unfinished tasks waiting in earlier daily notes, oldest first.
 *
 * Every earlier daily note is read, not only yesterday's: a task left open
 * on Friday is still open on Monday, and a week away leaves a gap wider than
 * that again. `lookbackDays` bounds how far back it reaches, and zero, the
 * default, reaches as far as the daily notes go.
 */
export function planRollover(
  index: WorkspaceIndex,
  today: string,
  lookbackDays = 0,
  /**
   * A copy left open by the old copy mode means Monday's task and Tuesday's
   * copy of it are both still open on Wednesday, so a migrate carries only
   * the newest; a migrated line is marked and never open again. Moving never
   * leaves a copy behind, so two alike lines there are two tasks, and both
   * are carried.
   */
  mode: RolloverMode = 'move',
): RolloverPlan | undefined {
  const earliest =
    lookbackDays > 0
      ? formatLocalDate(
          new Date(
            (parseLocalDate(today)?.getTime() ?? Date.now()) -
              lookbackDays * 24 * 60 * 60 * 1000,
          ),
        )
      : undefined;
  const notes = listDailyNotes(index).filter(
    (note) => note.date < today && (earliest === undefined || note.date >= earliest),
  );
  if (notes.length === 0) {
    return undefined;
  }
  const byPath = new Map(notes.map((note) => [note.filePath, note.date]));
  const open = [...index.tasks.values()]
    // A parked task stays where it is.
    .filter(
      (task) => !task.completed && byPath.has(task.filePath) && !isParkedTask(index, task.id),
    )
    .sort(
      (left, right) =>
        (byPath.get(left.filePath) ?? '').localeCompare(
          byPath.get(right.filePath) ?? '',
        ) || left.lineNumber - right.lineNumber,
    );
  const tasks = mode === 'migrate' ? keepNewestCopies(open, index) : open;
  if (tasks.length === 0) {
    return undefined;
  }
  const carried = new Set(tasks.map((task) => task.filePath));
  return {
    fromDates: notes
      .filter((note) => carried.has(note.filePath))
      .map((note) => note.date),
    tasks,
  };
}

/**
 * One task per line of text, from the newest note that holds it, in the
 * plan's order: oldest note first. A step is told apart by its task too,
 * so two tasks' "Call Dana" steps are two steps.
 */
function keepNewestCopies(tasks: Task[], index: WorkspaceIndex): Task[] {
  const seen = new Set<string>();
  const kept: Task[] = [];
  for (let at = tasks.length - 1; at >= 0; at -= 1) {
    const parent = tasks[at].parentTaskId ? index.tasks.get(tasks[at].parentTaskId as string) : undefined;
    const key = `${parent ? `${parent.sourceLineText.trim()}\n` : ''}${tasks[at].sourceLineText.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(tasks[at]);
    }
  }
  return kept.reverse();
}
