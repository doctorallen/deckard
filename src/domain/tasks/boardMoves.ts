import { escapeRegExp } from '../../shared/text';
import { addDays, formatIsoDate, startOfDay } from '../markdown/calendar';
import { nameDisplayDay } from '../markdown/dateFormat';
import { findCodeAndLinkRanges, isInRanges } from '../markdown/inlineRanges';
import { parseMarkdown, readPerson, TAG_WORD_CHARACTERS } from '../markdown/parser';
import { Task, TaskPriority } from '../model';
import { QueryContext } from '../query/queryContext';
import { needsNewDate } from './taskPolicy';
import { isOpenTask, statusForColumnKey, type TaskStatusDefinition, UNKNOWN_STATUS_NAME } from './taskStatuses';
import { readUnknownColumnKey } from './statusColumns';
import { setTaskStatus } from './statusWrites';
import { parseTaskMetadata, TaskMetadataFormat } from '../markdown/taskFields';
import { appendToTaskText, setTaskAssignee, setTaskDate, setTaskLineCompletion, setTaskPriority } from '../markdown/taskLineEdits';

/**
 * What dropping a task on a board column means for its line.
 *
 * A column stands for what a task already says about itself, so a move is an
 * ordinary edit to the task line: a status's character, a priority, a due date, the
 * person it is for, or a tag of one namespace. The Task Board's drop, the
 * Tasks view's drop on a group, and capturing into a column all read the
 * edit from here, so the three agree on what a column means.
 */

/** What dropping a task on a column means for its line. */
export type TaskMove =
  | { kind: 'unchanged' }
  | { kind: 'complete' }
  | { kind: 'edit'; edit: (line: string) => string; label: string }
  | { kind: 'refused'; reason: string };

/** The board settings a move is resolved with. */
export interface TaskMoveOptions {
  /** The moment and task policy the due bands are drawn against. */
  queryContext: Pick<QueryContext, 'now' | 'taskPolicy'> & Partial<Pick<QueryContext, 'dateFormats'>>;
  /** Format for metadata written on a task that has none yet. */
  format: TaskMetadataFormat;
}

/**
 * Resolves a move to a tag column, given the column's value (`project/atlas`)
 * and the edit that reopens a completed task. Which tags a task inherits is
 * read from the index by the caller, so this module needs no index.
 */
export type TagMoveResolver = (value: string, reopen: (line: string) => string) => TaskMove;

const PRIORITIES: ReadonlySet<string> = new Set([
  'highest',
  'high',
  'medium',
  'low',
  'lowest',
]);

/** One move being resolved: the task, the column's value, and the settings. */
interface MoveRequest {
  task: Task;
  value: string;
  options: TaskMoveOptions;
  reopen: (line: string) => string;
}

/** How each kind of column, by the part of its id before the colon, moves a task. */
const COLUMN_MOVES: ReadonlyMap<string, (request: MoveRequest) => TaskMove> = new Map([
  ['status', moveToStatus],
  ['priority', moveToPriority],
  ['due', moveToDue],
  ['assignee', moveToAssignee],
]);

/**
 * The edit dropping a task on the column `columnId` makes to its line, or why
 * it makes none. `done` completes the task; any other column also reopens a
 * completed one. A column this does not know is refused, since the board it
 * came from is out of date.
 */
export function resolveTaskMove(
  task: Task,
  columnId: string,
  options: TaskMoveOptions,
  moveToTag: TagMoveResolver,
): TaskMove {
  if (columnId === 'done') {
    return task.completed ? { kind: 'unchanged' } : { kind: 'complete' };
  }
  if (columnId === 'cancelled') {
    return moveToCancelled(task, options);
  }

  const separator = columnId.indexOf(':');
  const kind = separator < 0 ? columnId : columnId.slice(0, separator);
  const value = separator < 0 ? '' : columnId.slice(separator + 1);
  const column = task.checkboxColumn;
  const reopen = (line: string): string =>
    task.completed ? setTaskLineCompletion(line, column, { completed: false }) : line;

  if (kind === 'tag') {
    return moveToTag(value, reopen);
  }
  const move = COLUMN_MOVES.get(kind);
  return move
    ? move({ task, value, options, reopen })
    : refuseMove('That column no longer exists on the board. Refresh the board and try again.');
}

/**
 * A status column: the status its key stands for, by its name as a slug,
 * or an unknown character's column, written as its character. A key no
 * status stands for is refused, since the board it came from is out of
 * date.
 */
function moveToStatus({ task, value, options }: MoveRequest): TaskMove {
  const statuses = options.queryContext.taskPolicy.statuses;
  const unknown = readUnknownColumnKey(value);
  const status: TaskStatusDefinition | undefined =
    unknown === undefined ? statusForColumnKey(statuses, value) : { symbol: unknown, name: UNKNOWN_STATUS_NAME, type: 'todo' };
  if (!status) {
    return refuseMove(value
      ? `No status in the "Tasks: Statuses" setting is called ${formatStatusLabel(value)}. Refresh the board and try again.`
      : 'That column no longer exists on the board. Refresh the board and try again.');
  }
  if (isOpenTask(task) && task.status.symbol === status.symbol) {
    return { kind: 'unchanged' };
  }
  return {
    kind: 'edit',
    label: status.name,
    edit: (line) => setTaskStatus(line, task.checkboxColumn, { to: status, preferredFormat: options.format }),
  };
}

/** The Cancelled column: the first cancelled status, with its ❌ date. */
function moveToCancelled(task: Task, options: TaskMoveOptions): TaskMove {
  if (task.status.type === 'cancelled') {
    return { kind: 'unchanged' };
  }
  const status = options.queryContext.taskPolicy.statuses.find((candidate) => candidate.type === 'cancelled');
  if (!status) {
    return refuseMove('No status in the "Tasks: Statuses" setting is of the cancelled type.');
  }
  return {
    kind: 'edit',
    label: status.name,
    edit: (line) => setTaskStatus(line, task.checkboxColumn, {
      to: status,
      cancelledDate: formatIsoDate(options.queryContext.now),
      preferredFormat: options.format,
    }),
  };
}

/** A priority column: the task's priority, or none. */
function moveToPriority({ task, value, options, reopen }: MoveRequest): TaskMove {
  if (value && !PRIORITIES.has(value)) {
    return refuseMove(`"${value}" is not a priority.`);
  }
  if (!task.completed && (task.priority ?? '') === value) {
    return { kind: 'unchanged' };
  }
  return {
    kind: 'edit',
    label: value ? `${formatStatusLabel(value)} priority` : 'No priority',
    edit: (line) =>
      setTaskPriority(
        reopen(line),
        task.checkboxColumn,
        (value || undefined) as TaskPriority | undefined,
        options.format,
      ),
  };
}

/**
 * A due column: one date, as a day of the Tasks view's Upcoming names it,
 * or a band. Only Today, Tomorrow, and No due date name one edit.
 */
function moveToDue(request: MoveRequest): TaskMove {
  const { task, value, options, reopen } = request;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return moveToDate(request);
  }
  if (!task.completed && getDueBand(task.dueAt, options.queryContext) === value) {
    return { kind: 'unchanged' };
  }
  const column = task.checkboxColumn;
  if (value === 'today' || value === 'tomorrow') {
    const date = formatIsoDate(
      addDays(startOfDay(options.queryContext.now), value === 'today' ? 0 : 1),
    );
    return {
      kind: 'edit',
      label: value === 'today' ? 'Due today' : 'Due tomorrow',
      edit: (line) =>
        setTaskDate(reopen(line), column, { field: 'due', date, preferredFormat: options.format }),
    };
  }
  if (value === '') {
    const written = parseTaskMetadata(task.sourceLineText.slice(column + 2))
      .metadata.due;
    if (task.dueAt !== undefined && !written) {
      return refuseMove(
        'This task’s due date is written in its sentence, so Deckard leaves it for you to edit.',
      );
    }
    return {
      kind: 'edit',
      label: 'No due date',
      edit: (line) => setTaskDate(reopen(line), column, { field: 'due', date: undefined }),
    };
  }
  return refuseMove(
    'Drop a task on Today, Tomorrow, or No due date to change its due date.',
  );
}

/** One date, `YYYY-MM-DD`, as a day of Upcoming names it. */
function moveToDate({ task, value, options, reopen }: MoveRequest): TaskMove {
  if (!task.completed && task.dueAt !== undefined && formatIsoDate(task.dueAt) === value) {
    return { kind: 'unchanged' };
  }
  const [year, month, day] = value.split('-').map(Number);
  return {
    kind: 'edit',
    label: `Due ${nameDisplayDay(new Date(year, month - 1, day).getTime(), options.queryContext.dateFormats, { weekday: 'short' })}`,
    edit: (line) => setTaskDate(reopen(line), task.checkboxColumn, {
      field: 'due',
      date: value,
      preferredFormat: options.format,
    }),
  };
}

/** A person's column: who the task is for, or nobody. */
function moveToAssignee({ task, value, options, reopen }: MoveRequest): TaskMove {
  const person = value ? readPerson(value) : undefined;
  if (value && !person) {
    return refuseMove(`Deckard cannot read "${value}" as a person.`);
  }
  if (!task.completed && (task.assignee ?? '') === (person ?? '')) {
    return { kind: 'unchanged' };
  }
  return {
    kind: 'edit',
    label: person ? `For ${person}` : 'For nobody',
    edit: (line) => setTaskAssignee(reopen(line), task.checkboxColumn, person, options.format),
  };
}

/** The due band a date falls in on the context's today, or '' for none. */
export function getDueBand(
  dueAt: number | undefined,
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
): string {
  if (dueAt === undefined) {
    return '';
  }
  const { now } = context;
  const today = startOfDay(now);
  if (needsNewDate(dueAt, now, context.taskPolicy)) {
    return 'needsdate';
  }
  if (dueAt < today) {
    return 'overdue';
  }
  if (dueAt < addDays(today, 1)) {
    return 'today';
  }
  if (dueAt < addDays(today, 2)) {
    return 'tomorrow';
  }
  return dueAt < addDays(today, 8) ? 'week' : 'later';
}

/**
 * Takes tags out of a task line, by their written labels, and writes one:
 * in place of the first taken out, else at the end of the task's words,
 * ahead of a `^block-id`.
 */
export function setTaskNamespaceTags(
  line: string,
  checkboxColumn: number,
  change: { remove: readonly string[]; add?: string },
): string {
  const head = line.slice(0, checkboxColumn + 2);
  let text = line.slice(checkboxColumn + 2);
  let placed = change.add === undefined;
  change.remove.forEach((label) => {
    // A tag that goes on past the label, such as `#project/café` past
    // `#project/caf`, is another tag and stays.
    const pattern = new RegExp(`[ \\t]+${escapeRegExp(label)}(?![${TAG_WORD_CHARACTERS}/-])`, 'giu');
    const skipped = findCodeAndLinkRanges(text);
    text = text.replace(pattern, (match, offset: number) => {
      if (isInRanges(skipped, offset)) {
        return match;
      }
      if (!placed && change.add !== undefined) {
        placed = true;
        return match.replace(/\S+$/, change.add);
      }
      return '';
    });
  });
  if (!placed && change.add !== undefined) {
    text = appendToTaskText(text, change.add);
  }
  return head + text;
}

/** A status as a column names it: `waiting-on` is `Waiting on`. */
export function formatStatusLabel(status: string): string {
  const words = status.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A move that makes no edit, and the sentence that says why. */
export function refuseMove(reason: string): TaskMove {
  return { kind: 'refused', reason };
}

/** What capturing a task into a column writes: its line, or why it cannot. */
export type ColumnCapture =
  | { kind: 'capture'; line: string }
  | { kind: 'refused'; reason: string };

/**
 * A captured line as it lands in a board column: the edit the column stands
 * for made to the line, so the task arrives already in the column it was
 * added from. A line that reads as no task, or a column that names no edit
 * for it, is captured as it is; a refusal says why nothing is captured.
 */
export function resolveColumnCapture(
  line: string,
  resolveMove: (task: Task) => TaskMove,
): ColumnCapture {
  const [task] = parseMarkdown('capture.md', line).tasks;
  const move = task ? resolveMove(task) : undefined;
  if (move?.kind === 'refused') {
    return { kind: 'refused', reason: move.reason };
  }
  return { kind: 'capture', line: move?.kind === 'edit' ? move.edit(line) : line };
}
