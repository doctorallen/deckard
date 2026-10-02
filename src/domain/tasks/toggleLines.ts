import { matchTaskLine, TaskLineMatch, TaskLineShape } from '../markdown/lineShapes';
import {
  formatIsoDate,
  parseTaskMetadata,
  setTaskLineCompletion,
  TaskMetadataFormat,
  writeCompletion,
} from '../markdown/taskMetadata';
import { readStepsForNextOccurrence } from '../markdown/taskSteps';

/**
 * Toggle Task Done's rule, the way Toggle Line Comment decides: which lines
 * a set of selections touches, and what completing or reopening the tasks
 * among them writes.
 */

/** The checkbox a line must open with to be toggled. */
const TASK_LINE: TaskLineShape = { indent: 'whitespace', marks: ' xX' };

/** One task line under a cursor, as it is and as it will be written. */
export interface ToggledLine {
  /** Zero-based. */
  line: number;
  before: string;
  after: string;
  title: string;
  next?: string;
  unreadRule?: string;
}

/** What one toggle wrote, and what it says about it. */
export interface ToggleResult {
  completed: boolean;
  lines: ToggledLine[];
}

/**
 * The lines a set of selections touches, each once, top to bottom. A
 * selection that ends at the very start of a line does not take that line,
 * the way Toggle Line Comment reads it.
 */
export function selectedLines(
  selections: readonly { start: { line: number; character: number }; end: { line: number; character: number } }[],
): number[] {
  const lines = new Set<number>();
  for (const selection of selections) {
    const last =
      selection.end.line > selection.start.line && selection.end.character === 0
        ? selection.end.line - 1
        : selection.end.line;
    for (let line = selection.start.line; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Completes or reopens the task lines given, the way Toggle Line Comment
 * decides: if any of them is open, every open one is completed; otherwise
 * every one is reopened. A completion writes its done date and, for a
 * repeating task, its next occurrence on the line above, through the same
 * path as every other completion.
 */
export function toggleTaskLines(
  lines: readonly { line: number; text: string }[],
  now: number,
  options: {
    addDoneDate: boolean;
    format: TaskMetadataFormat;
    eol: string;
    /** The whole note, so a repeating task's next occurrence takes its steps. */
    documentLines?: readonly string[];
  },
): ToggleResult {
  const tasks = lines
    .map((entry) => ({ ...entry, match: matchTaskLine(entry.text, TASK_LINE) }))
    .filter((entry): entry is typeof entry & { match: TaskLineMatch } => entry.match !== undefined);
  const completed = tasks.some((entry) => entry.match.mark === ' ');
  const toggled: ToggledLine[] = [];
  for (const { line, text, match } of tasks) {
    const open = match.mark === ' ';
    if (completed !== open) {
      continue;
    }
    const checkboxColumn = match.opening.length;
    const marked = setTaskLineCompletion(text, checkboxColumn, {
      completed,
      doneDate: options.addDoneDate ? formatIsoDate(now) : undefined,
      preferredFormat: options.format,
    });
    const title = parseTaskMetadata(text.slice(checkboxColumn + 2)).title;
    if (!completed) {
      toggled.push({ line, before: text, after: marked, title });
      continue;
    }
    const completion = writeCompletion(marked, checkboxColumn, {
      now,
      eol: options.eol,
      steps: options.documentLines ? readStepsForNextOccurrence(options.documentLines, line) : [],
    });
    toggled.push({
      line,
      before: text,
      after: completion.text,
      title,
      ...(completion.next === undefined ? {} : { next: completion.next }),
      ...(completion.unreadRule === undefined ? {} : { unreadRule: completion.unreadRule }),
    });
  }
  return { completed, lines: toggled };
}
