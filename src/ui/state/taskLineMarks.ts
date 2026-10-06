import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import { matchTaskLine, STATUS_MARKS, TaskLineShape, findFencedLines } from '../../domain/markdown/lineShapes';
import { QueryContext } from '../../domain/query/queryContext';
import { parseIsoDate } from '../../domain/markdown/calendar';
import { findTaskMetadataSpans } from '../../domain/markdown/taskFields';
import { describeDueDate } from '../../domain/markdown/dueWording';
import { isOpenType, statusForSymbol, UNKNOWN_STATUS_NAME } from '../../domain/tasks/taskStatuses';
import type { TaskStatus } from '../../domain/model';

/** A stretch of one line, zero-based. */
export interface LineSpan {
  line: number;
  start: number;
  end: number;
}

/** What is said after an open task's line. */
export interface TaskLineHint {
  line: number;
  text: string;
  tone: 'overdue' | 'hint';
}

/** What a note's editor draws over its task lines, as findTaskLineMarks finds it. */
export interface TaskLineMarks {
  /** Metadata drawn fainter than the words. */
  dim: LineSpan[];
  /** The due date of an open task that is overdue, drawn in its own color. */
  overdue: LineSpan[];
  hints: TaskLineHint[];
  /** The box of an in-progress task, drawn in its own color. */
  inProgress: LineSpan[];
  /** A cancelled task's words, struck through. */
  cancelled: LineSpan[];
  /** A box whose character no status names, underlined, with the character. */
  unknown: Array<LineSpan & { symbol: string }>;
}

/** A task line of any status; one space or tab after its box belongs to the box. */
const TASK_LINE: TaskLineShape = { indent: 'whitespace', marks: STATUS_MARKS, after: 'optional-blank' };
/** A block id at the end of any line. */
const BLOCK_ID = /[ \t]+(\^[A-Za-z0-9-]+)[ \t]*$/;

/** The lines front matter takes, which hold no tasks. */
function frontMatterLines(lines: readonly string[]): number {
  return (findFrontmatterEnd(lines) ?? -1) + 1;
}

/**
 * Where a note's task lines step back and where they speak up: every piece
 * of metadata is drawn fainter than the task's words, except an open task's
 * overdue date, which is drawn in the overdue color; and an open task that
 * is overdue, due today, or waiting for a new date says so after its line.
 * A block id on any line steps back too. Code and front matter are left
 * alone. Today and when a date needs replacing are the context's.
 */
export function findTaskLineMarks(
  lines: readonly string[],
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
  options: { dim: boolean; hints: boolean },
): TaskLineMarks {
  const marks: TaskLineMarks = { dim: [], overdue: [], hints: [], inProgress: [], cancelled: [], unknown: [] };
  const fenced = findFencedLines([...lines]);
  const skip = frontMatterLines(lines);
  lines.forEach((text, line) => {
    if (line < skip || fenced.has(line)) {
      return;
    }
    const task = matchTaskLine(text, TASK_LINE);
    if (task) {
      markTaskLine(marks, { text, line, task }, context, options);
      return;
    }
    if (options.dim) {
      markBlockId(marks, text, line);
    }
  });
  return marks;
}

/** One line the editor shows, matched as a task line. */
interface TaskLineAt {
  text: string;
  line: number;
  task: NonNullable<ReturnType<typeof matchTaskLine>>;
}

/** Steps back the block id at the end of a line that is not a task, when it has one. */
function markBlockId(marks: TaskLineMarks, text: string, line: number): void {
  const blockId = BLOCK_ID.exec(text);
  if (!blockId) {
    return;
  }
  const start = text.lastIndexOf(blockId[1]);
  marks.dim.push({ line, start, end: start + blockId[1].length });
}

/**
 * Marks one task line: its metadata dimmed, an open task's overdue date in
 * the overdue color, and the hint after an open task with a due date.
 */
function markTaskLine(
  marks: TaskLineMarks,
  { text, line, task }: TaskLineAt,
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
  options: { dim: boolean; hints: boolean },
): void {
  const offset = task.head.length + task.gap.length;
  const status = statusForSymbol(context.taskPolicy.statuses, task.mark);
  const open = isOpenType(status.type);
  markStatus(marks, { text, line, task }, status);
  const spans = findTaskMetadataSpans(text.slice(offset));
  const due = spans.find((span) => span.field === 'due');
  const dueAt = open && due ? parseIsoDate(due.value) : undefined;
  const described = dueAt === undefined ? undefined : describeDueDate(dueAt, context.now, context.taskPolicy);
  for (const span of spans) {
    const at = { line, start: offset + span.start, end: offset + span.end };
    if (span === due && described?.overdue) {
      marks.overdue.push(at);
    } else if (options.dim) {
      marks.dim.push(at);
    }
  }
  if (!options.hints || !described) {
    return;
  }
  const hint = hintFor(described);
  if (hint) {
    marks.hints.push({ line, ...hint });
  }
}

/** Marks a task's box or words by its status: in progress, cancelled, or a character no status names. */
function markStatus(marks: TaskLineMarks, { text, line, task }: TaskLineAt, status: TaskStatus): void {
  const box = { line, start: task.opening.length - 1, end: task.opening.length + 2 };
  if (status.name === UNKNOWN_STATUS_NAME) {
    marks.unknown.push({ ...box, symbol: status.symbol });
  } else if (status.type === 'inProgress') {
    marks.inProgress.push(box);
  } else if (status.type === 'cancelled') {
    marks.cancelled.push({ line, start: task.head.length + task.gap.length, end: text.trimEnd().length });
  }
}

/** What an open task says after its line: overdue, needs a new date, or due today; nothing otherwise. */
function hintFor(
  described: ReturnType<typeof describeDueDate>,
): Omit<TaskLineHint, 'line'> | undefined {
  if (described.overdue) {
    return { text: described.relative, tone: 'overdue' };
  }
  if (described.stale) {
    return { text: 'needs a new date', tone: 'hint' };
  }
  if (described.days === 0) {
    return { text: 'due today', tone: 'hint' };
  }
  return undefined;
}
