import { getTaskLineId } from '../markdown/parser';
import { Task } from '../model';

/**
 * How a task keeps its place in the rank order across an edit Deckard makes.
 *
 * A task's id comes from its own text and line, so an edit Deckard writes
 * makes it a new task to anything keyed by id. Each rule here names the id a
 * task had and the id it has once the edit is written, for the rank keeper
 * to move its place from one to the other.
 */

/** A task's id before an edit, and after it. */
export type RankMove = readonly [previousId: string, nextId: string];

/**
 * The id of the task an edit wrote over one line. A completion may add a
 * line above, so the task is the last line written. `lineNumber` is the
 * first written line, one-based.
 */
export function writtenTaskId(
  filePath: string,
  lineNumber: number,
  replacement: string,
): string | undefined {
  const lines = replacement.split(/\r?\n/);
  return getTaskLineId(filePath, lineNumber + lines.length - 1, lines[lines.length - 1]);
}

/**
 * The rank move for a task whose line was rewritten: `task` is the line as
 * it was, its number one-based, and `replacement` what was written over it.
 */
export function rankMoveAfterEdit(
  task: Pick<Task, 'filePath' | 'lineNumber' | 'id'>,
  replacement: string,
): RankMove | undefined {
  const nextId = writtenTaskId(task.filePath, task.lineNumber, replacement);
  return nextId ? [task.id, nextId] : undefined;
}

/**
 * The rank move for a task put back by Undo: from the id the edit gave it to
 * the id its original line has, so it gets back the place the edit carried
 * away.
 */
export function rankMoveAfterRevert(
  filePath: string,
  lineNumber: number,
  written: { original: string; replacement: string },
): RankMove | undefined {
  const writtenId = writtenTaskId(filePath, lineNumber, written.replacement);
  const restoredId = getTaskLineId(filePath, lineNumber, written.original);
  return writtenId && restoredId ? [writtenId, restoredId] : undefined;
}

/**
 * The rank move for a task that now lives on another line, in its own note
 * or another one, as Move to… leaves it. The line is one-based.
 */
export function rankMoveTo(
  previousId: string,
  to: { filePath: string; lineNumber: number; lineText: string },
): RankMove | undefined {
  const nextId = getTaskLineId(to.filePath, to.lineNumber, to.lineText);
  return nextId ? [previousId, nextId] : undefined;
}

/**
 * The rank moves for task lines rewritten together in one note, top to
 * bottom, each zero-based line with what it was and what was written. A next
 * occurrence written above a line moves every line below it down by one.
 */
export function rankMovesAfterEdits(
  filePath: string,
  lines: readonly { line: number; before: string; after: string }[],
): RankMove[] {
  const moves: RankMove[] = [];
  let added = 0;
  for (const toggled of lines) {
    const lineNumber = toggled.line + 1;
    const previousId = getTaskLineId(filePath, lineNumber, toggled.before);
    const move = previousId
      ? rankMoveAfterEdit({ filePath, lineNumber: lineNumber + added, id: previousId }, toggled.after)
      : undefined;
    if (move) {
      moves.push(move);
    }
    added += toggled.after.split(/\r?\n/).length - 1;
  }
  return moves;
}
