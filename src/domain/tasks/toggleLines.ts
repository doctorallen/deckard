import { matchTaskLine, STATUS_MARKS, TaskLineMatch, TaskLineShape } from '../markdown/lineShapes';
import { readStepsForNextOccurrence } from '../markdown/taskSteps';
import { setTaskLineCompletion, writeCompletion } from '../markdown/taskLineEdits';
import { DEFAULT_TASK_STATUSES, isNonTaskSymbol, statusForSymbol, type TaskStatusDefinition } from './taskStatuses';
import { parseTaskMetadata, TaskMetadataFormat } from '../markdown/taskFields';
import { formatIsoDate } from '../markdown/calendar';

/**
 * Toggle Task Done's rule, the way Toggle Line Comment decides: which lines
 * a set of selections touches, and what completing or reopening the tasks
 * among them writes.
 */

/** The checkbox a line must open with to be toggled: any status's. */
const TASK_LINE: TaskLineShape = { indent: 'whitespace', marks: STATUS_MARKS };

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
 * decides: if any of them is not done, in progress or cancelled alike,
 * every one that is not is completed; otherwise every one is reopened, as
 * `[ ]`. A completion writes its done date and,
 * for a repeating task, its next occurrence on the line above, through the
 * same path as every other completion.
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
    /** What each character means; Deckard's own when not given. */
    statuses?: readonly TaskStatusDefinition[];
  },
): ToggleResult {
  const statuses = options.statuses ?? DEFAULT_TASK_STATUSES;
  const tasks = lines
    .map((entry) => ({ ...entry, match: matchTaskLine(entry.text, TASK_LINE) }))
    .filter((entry): entry is typeof entry & { match: TaskLineMatch } => entry.match !== undefined && !isNonTaskSymbol(statuses, entry.match.mark));
  const isDone = (mark: string): boolean => statusForSymbol(statuses, mark).type === 'done';
  const completed = tasks.some((entry) => !isDone(entry.match.mark));
  const toggled: ToggledLine[] = [];
  for (const { line, text, match } of tasks) {
    if (completed === isDone(match.mark)) {
      continue;
    }
    const checkboxColumn = match.opening.length;
    const box = setTaskLineCompletion(text, checkboxColumn, {
      completed,
      doneDate: options.addDoneDate ? formatIsoDate(now) : undefined,
      preferredFormat: options.format,
    });
    const title = parseTaskMetadata(text.slice(checkboxColumn + 2)).title;
    if (!completed) {
      toggled.push({ line, before: text, after: box, title });
      continue;
    }
    const completion = writeCompletion(box, checkboxColumn, {
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
