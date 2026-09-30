import { matchTaskLine, TaskLineShape } from '../../core/markdown/lineShapes';
import { findFencedLines } from '../../core/markdown/parser';
import {
  describeDueDate,
  findTaskMetadataSpans,
  parseIsoDate,
} from '../../core/markdown/taskMetadata';
import { getTaskPolicy } from '../../core/taskPolicy';

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

export interface TaskLineMarks {
  /** Metadata drawn fainter than the words. */
  dim: LineSpan[];
  /** The due date of an open task that is overdue, drawn in its own color. */
  overdue: LineSpan[];
  hints: TaskLineHint[];
}

/** An open or done task line; one space or tab after its box belongs to the box. */
const TASK_LINE: TaskLineShape = { indent: 'whitespace', marks: ' xX', after: 'optional-blank' };
/** A block id at the end of any line. */
const BLOCK_ID = /[ \t]+(\^[A-Za-z0-9-]+)[ \t]*$/;

/** The lines front matter takes, which hold no tasks. */
function frontMatterLines(lines: readonly string[]): number {
  if (lines[0]?.trim() !== '---') {
    return 0;
  }
  const end = lines.findIndex((line, at) => at > 0 && /^(---|\.\.\.)\s*$/.test(line));
  return end > 0 ? end + 1 : 0;
}

/**
 * Where a note's task lines step back and where they speak up: every piece
 * of metadata is drawn fainter than the task's words, except an open task's
 * overdue date, which is drawn in the overdue color; and an open task that
 * is overdue, due today, or waiting for a new date says so after its line.
 * A block id on any line steps back too. Code and front matter are left
 * alone.
 */
export function findTaskLineMarks(
  lines: readonly string[],
  now: number,
  options: { dim: boolean; hints: boolean },
): TaskLineMarks {
  const marks: TaskLineMarks = { dim: [], overdue: [], hints: [] };
  const fenced = findFencedLines([...lines]);
  const skip = frontMatterLines(lines);
  lines.forEach((text, line) => {
    if (line < skip || fenced.has(line)) {
      return;
    }
    const task = matchTaskLine(text, TASK_LINE);
    if (!task) {
      const blockId = BLOCK_ID.exec(text);
      if (options.dim && blockId) {
        const start = text.lastIndexOf(blockId[1]);
        marks.dim.push({ line, start, end: start + blockId[1].length });
      }
      return;
    }
    const offset = task.head.length + task.gap.length;
    const open = task.mark === ' ';
    const spans = findTaskMetadataSpans(text.slice(offset));
    const due = spans.find((span) => span.field === 'due');
    const dueAt = open && due ? parseIsoDate(due.value) : undefined;
    const described = dueAt === undefined ? undefined : describeDueDate(dueAt, now, getTaskPolicy());
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
    if (described.overdue) {
      marks.hints.push({ line, text: described.relative, tone: 'overdue' });
    } else if (described.stale) {
      marks.hints.push({ line, text: 'needs a new date', tone: 'hint' });
    } else if (described.days === 0) {
      marks.hints.push({ line, text: 'due today', tone: 'hint' });
    }
  });
  return marks;
}
