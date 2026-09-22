import { stripTags } from '../../core/markdown/parser';
import { TASK_PRIORITY_RANKS } from '../../core/markdown/taskMetadata';
import { evaluateQuery } from '../../core/query/queryEvaluator';
import { parseQuery } from '../../core/query/queryParser';
import {
  ParsedFile,
  Section,
  Task,
  TaskPriority,
  WorkspaceIndex,
} from '../../core/types';
import { getHeadingPath } from './dashboardState';
import {
  compareTasksByColumn,
  isTaskColumnId,
  parseTaskColumns,
  TableSortDirection,
  TableTask,
  TASK_COLUMNS,
  TaskColumnId,
} from './resultTable';

/**
 * Query blocks are fenced ```deckard blocks holding a Deckard query. The
 * Markdown preview draws their results in place, and the editor summarizes
 * them above the fence.
 *
 * A block is still ordinary Markdown, so a note that embeds a query stays
 * readable in any other editor; only Deckard gives the fence a meaning.
 */

/** The fence language that marks a query block. */
export const QUERY_BLOCK_LANGUAGE = 'deckard';

/**
 * What a block sorts by: any column a task has. Notes know only `title`,
 * `created`, and `updated`, and keep their order under any other.
 */
export type QueryBlockSort = TaskColumnId;

/** How a block shows its tasks: rows of text, or a table of columns. */
export type QueryBlockView = 'list' | 'table';

/**
 * Display options written after the fence language, as in
 * ```deckard sort=updated limit=10.
 */
export interface QueryBlockOptions {
  /** Undefined keeps each list's natural order. */
  sort?: QueryBlockSort;
  /**
   * Which way `sort` runs. Undefined is newest first for `created` and
   * `updated`, as a block always sorted them, and ascending otherwise.
   */
  direction?: TableSortDirection;
  /** Most items shown in each list. The totals still count every match. */
  limit?: number;
  /** Tasks as a table, with `columns`. Undefined is the list. */
  view?: QueryBlockView;
  /** The table's columns, in order; the defaults when omitted. */
  columns?: TaskColumnId[];
  /**
   * Options that could not be understood. They are reported beside the
   * results instead of hiding them, so a typo never blanks the block.
   */
  warnings: string[];
}

/**
 * A query block found in note source.
 */
export interface QueryBlockSource {
  /** Zero-based line of the opening fence. */
  startLine: number;
  /** Zero-based line of the closing fence, or the last line when unclosed. */
  endLine: number;
  /** False when the fence is never closed, so the query runs to the end. */
  closed: boolean;
  query: string;
  options: QueryBlockOptions;
}

export interface QueryBlockItem {
  id: string;
  title: string;
  /** Headings above the item, outermost first. */
  context: string[];
  filePath: string;
  fileName: string;
  /** One-based source line. */
  line: number;
  /** Present only for tasks. */
  completed?: boolean;
  dueAt?: number;
  dueText?: string;
  scheduledAt?: number;
  startAt?: number;
  doneAt?: number;
  priority?: TaskPriority;
  recurrence?: string;
  /** The person's tag as written, such as `@dana`. */
  assignee?: string;
  /** The `#status/…` name on the line, without the namespace. */
  status?: string;
  /** Tag labels, as written on the line. */
  tags?: string[];
  dependsOn?: string[];
  dependencyId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface QueryBlockMessage {
  severity: 'error' | 'warning';
  text: string;
}

export interface QueryBlockSnapshot {
  query: string;
  /** Query diagnostics, then option warnings. */
  messages: QueryBlockMessage[];
  /** True when the block could not run, so it has no results to show. */
  hasError: boolean;
  notes: QueryBlockItem[];
  tasks: QueryBlockItem[];
  /** Totals before `limit` is applied. */
  noteCount: number;
  taskCount: number;
  openTaskCount: number;
}

/**
 * Reads a fence's info string, returning undefined for any fence that is not
 * a query block.
 */
export function parseQueryBlockInfo(
  info: string,
): QueryBlockOptions | undefined {
  const [language = '', ...attributes] = info.trim().split(/\s+/);
  if (language.toLowerCase() !== QUERY_BLOCK_LANGUAGE) {
    return undefined;
  }

  const options: QueryBlockOptions = { warnings: [] };
  for (const attribute of attributes) {
    const match = /^([A-Za-z]+)=["']?([^"']*)["']?$/.exec(attribute);
    const name = match?.[1].toLowerCase();
    const value = match?.[2].toLowerCase() ?? '';
    if (name === 'sort') {
      if (isTaskColumnId(value)) {
        options.sort = value;
      } else {
        options.warnings.push(
          `sort must be a column, such as title, due, priority, created, or updated, not "${value}".`,
        );
      }
    } else if (name === 'dir') {
      if (value === 'asc' || value === 'desc') {
        options.direction = value;
      } else {
        options.warnings.push(`dir must be asc or desc, not "${value}".`);
      }
    } else if (name === 'view') {
      if (value === 'table' || value === 'list') {
        options.view = value;
      } else {
        options.warnings.push(`view must be list or table, not "${value}".`);
      }
    } else if (name === 'columns') {
      const parsed = parseTaskColumns(value);
      options.columns = parsed.columns;
      if (parsed.unknown.length > 0) {
        options.warnings.push(
          `columns has no ${parsed.unknown.map((name) => `"${name}"`).join(', ')}; the columns are ${TASK_COLUMNS.map((column) => column.id).join(', ')}.`,
        );
      }
    } else if (name === 'limit') {
      if (/^\d+$/.test(value) && Number(value) > 0) {
        options.limit = Number(value);
      } else {
        options.warnings.push(
          `limit must be a positive whole number, not "${value}".`,
        );
      }
    } else {
      options.warnings.push(
        `Unknown option "${attribute}". Use sort=, dir=, limit=, view=, or columns=.`,
      );
    }
  }
  return options;
}

/**
 * Finds query blocks using CommonMark's fence rules, which are the rules the
 * preview renders with, so the editor summarizes exactly the fences the
 * preview draws as results. A ```deckard example nested inside a longer fence
 * therefore stays an example.
 */
export function findQueryBlocks(text: string): QueryBlockSource[] {
  const lines = text.split(/\r?\n/);
  const blocks: QueryBlockSource[] = [];
  let open: { marker: string; startLine: number; info: string } | undefined;

  const close = (endLine: number, closed: boolean): void => {
    const options = open ? parseQueryBlockInfo(open.info) : undefined;
    if (open && options) {
      blocks.push({
        startLine: open.startLine,
        endLine,
        closed,
        query: lines
          .slice(open.startLine + 1, closed ? endLine : endLine + 1)
          .join('\n')
          .trim(),
        options,
      });
    }
    open = undefined;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!open) {
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      // A backtick fence's info string cannot itself contain a backtick.
      if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
        open = { marker: opening[1], startLine: lineIndex, info: opening[2] };
      }
      continue;
    }

    const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (
      closing &&
      closing[1][0] === open.marker[0] &&
      closing[1].length >= open.marker.length
    ) {
      close(lineIndex, true);
    }
  }

  // An unclosed fence runs to the end of the document, as it does in the
  // preview, so it still renders and still gets a summary.
  if (open) {
    close(lines.length - 1, false);
  }
  return blocks;
}

/**
 * True when a zero-based line holds query text inside a query block.
 *
 * Deckard ignores fenced code everywhere else, but a query block is where the
 * author is writing tags, so features such as tag completion make an
 * exception for these lines.
 */
export function isQueryBlockLine(
  blocks: readonly QueryBlockSource[],
  line: number,
): boolean {
  return blocks.some(
    (block) =>
      line > block.startLine &&
      (line < block.endLine || (!block.closed && line === block.endLine)),
  );
}

/**
 * Runs a block's query against the index and orders what it matched.
 */
/**
 * Results by index, then by day and block. The lenses above a block are asked
 * for after every edit, and the preview renders as the note is typed, so a
 * block's query runs once per index instead. The day is part of the key
 * because `today` and `7d` move at midnight.
 */
const snapshotCache = new WeakMap<
  WorkspaceIndex,
  Map<string, QueryBlockSnapshot>
>();

/** `createQueryBlockSnapshot`, run once per index, day, query, and options. */
export function getQueryBlockSnapshot(
  index: WorkspaceIndex,
  queryText: string,
  options: QueryBlockOptions,
  statusNamespace = 'status',
): QueryBlockSnapshot {
  let snapshots = snapshotCache.get(index);
  if (!snapshots) {
    snapshots = new Map();
    snapshotCache.set(index, snapshots);
  }
  const key = JSON.stringify([
    new Date().toDateString(),
    queryText,
    options,
    statusNamespace,
  ]);
  let snapshot = snapshots.get(key);
  if (!snapshot) {
    snapshot = createQueryBlockSnapshot(index, queryText, options, statusNamespace);
    snapshots.set(key, snapshot);
  }
  return snapshot;
}

export function createQueryBlockSnapshot(
  index: WorkspaceIndex,
  queryText: string,
  options: QueryBlockOptions,
  /** The namespace of the status tags, from `deckard.board.statusNamespace`. */
  statusNamespace = 'status',
): QueryBlockSnapshot {
  const query = queryText.trim();
  const optionMessages = options.warnings.map(
    (text): QueryBlockMessage => ({ severity: 'warning', text }),
  );
  const empty = {
    query,
    notes: [],
    tasks: [],
    noteCount: 0,
    taskCount: 0,
    openTaskCount: 0,
  };

  if (!query) {
    return {
      ...empty,
      messages: [
        {
          severity: 'error',
          text: 'Write a Deckard query in this block, such as tag = #project/atlas.',
        },
        ...optionMessages,
      ],
      hasError: true,
    };
  }

  const parsed = parseQuery(query);
  const messages = [
    ...parsed.diagnostics.map(
      (diagnostic): QueryBlockMessage => ({
        severity: diagnostic.severity,
        text: diagnostic.message,
      }),
    ),
    ...optionMessages,
  ];
  if (!parsed.node) {
    return { ...empty, messages, hasError: true };
  }

  const results = evaluateQuery(index, parsed.node);
  const notes = [
    ...results.sections.map((section) => createSectionItem(section, index)),
    ...results.files.map(createFileItem),
  ].sort(createNoteComparator(options.sort, options.direction));
  const tasks = results.tasks
    .map((task) => createTaskItem(task, index, statusNamespace))
    .sort(createTaskComparator(options.sort, options.direction));

  return {
    query,
    messages,
    hasError: false,
    notes: notes.slice(0, options.limit),
    tasks: tasks.slice(0, options.limit),
    noteCount: notes.length,
    taskCount: tasks.length,
    openTaskCount: tasks.filter((task) => !task.completed).length,
  };
}

/**
 * Summarizes a block's totals in one line, as "3 notes · 5 tasks, 2 open".
 */
export function describeQueryBlockCounts(snapshot: QueryBlockSnapshot): string {
  const parts: string[] = [];
  if (snapshot.noteCount > 0 || snapshot.taskCount === 0) {
    parts.push(pluralize(snapshot.noteCount, 'note'));
  }
  if (snapshot.taskCount > 0) {
    parts.push(
      snapshot.openTaskCount === snapshot.taskCount
        ? pluralize(snapshot.taskCount, 'open task')
        : `${pluralize(snapshot.taskCount, 'task')}, ${snapshot.openTaskCount} open`,
    );
  }
  return parts.join(' · ');
}

function createSectionItem(
  section: Section,
  index: WorkspaceIndex,
): QueryBlockItem {
  const fileName = getFileName(section.filePath);
  const parent = section.parentSectionId
    ? index.sections.get(section.parentSectionId)
    : undefined;
  return {
    id: section.id,
    // A heading written as nothing but tags keeps those tags as its title.
    title:
      stripTrailingTags(section.heading) || section.heading.trim() || fileName,
    context: parent ? getHeadingPath(parent, index.sections) : [],
    filePath: section.filePath,
    fileName,
    line: section.startLine,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
  };
}

/**
 * Represents a note that matched only through its front matter.
 */
function createFileItem(file: ParsedFile): QueryBlockItem {
  const fileName = getFileName(file.filePath);
  return {
    id: `frontmatter:${file.filePath}`,
    title: fileName,
    context: [],
    filePath: file.filePath,
    fileName,
    line: 1,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function createTaskItem(
  task: Task,
  index: WorkspaceIndex,
  statusNamespace: string,
): QueryBlockItem {
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
  const statusPrefix = `#${statusNamespace.toLowerCase()}/`;
  const status = task.tags
    .map((key) => key.toLowerCase())
    .find((key) => key.startsWith(statusPrefix))
    ?.slice(statusPrefix.length);
  return {
    id: task.id,
    title: stripTrailingTags(task.title) || task.title.trim(),
    context: section ? getHeadingPath(section, index.sections) : [],
    filePath: task.filePath,
    fileName: getFileName(task.filePath),
    line: task.lineNumber,
    completed: task.completed,
    dueAt: task.dueAt,
    dueText: task.dueText,
    scheduledAt: task.scheduledAt,
    startAt: task.startAt,
    doneAt: task.doneAt,
    priority: task.priority,
    recurrence: task.recurrence,
    assignee: task.assignee,
    status,
    tags: task.tags.map((key) => task.tagLabels[key] ?? key),
    dependsOn: task.dependsOn,
    dependencyId: task.dependencyId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/**
 * Removes the tags written after a title, which only label it, and keeps the
 * tags inside the sentence, which are part of what it says. Removing every
 * tag would turn "Pair @ren with @dax." into "Pair with .".
 */
export function stripTrailingTags(text: string): string {
  const words = text.trim().split(/\s+/);
  while (words.length > 0 && stripTags(words[words.length - 1]) === '') {
    words.pop();
  }
  return words.join(' ');
}

/**
 * Orders notes alphabetically unless a date sort puts the newest first.
 */
/** Which way a sort runs when the block does not say: dates newest first. */
function directionOf(
  sort: QueryBlockSort | undefined,
  direction: TableSortDirection | undefined,
): TableSortDirection {
  return direction ?? (sort === 'created' || sort === 'updated' ? 'desc' : 'asc');
}

function createNoteComparator(
  sort: QueryBlockSort | undefined,
  direction: TableSortDirection | undefined,
): (left: QueryBlockItem, right: QueryBlockItem) => number {
  const sign = direction === 'asc' ? -1 : 1;
  return (left, right) =>
    sign * compareBySort(left, right, sort) || compareTitles(left, right);
}

/**
 * Keeps open tasks ahead of done ones. Within each group the natural order is
 * soonest due date first, then highest priority, then source order, which
 * reads like an agenda.
 */
function createTaskComparator(
  sort: QueryBlockSort | undefined,
  direction: TableSortDirection | undefined,
): (left: QueryBlockItem, right: QueryBlockItem) => number {
  const byColumn =
    sort === undefined
      ? undefined
      : compareTasksByColumn({ column: sort, direction: directionOf(sort, direction) });
  return (left, right) =>
    (left.completed ? 1 : 0) - (right.completed ? 1 : 0) ||
    (byColumn === undefined
      ? compareAscending(left.dueAt, right.dueAt) ||
        comparePriority(left, right) ||
        compareSource(left, right)
      : byColumn(toTableTask(left), toTableTask(right)) ||
        compareSource(left, right));
}

/** A block's item as the table model reads it. */
export function toTableTask(item: QueryBlockItem): TableTask {
  return { ...item, completed: item.completed === true };
}

/**
 * A note's part of a sort: its dates, newest first before the direction is
 * applied. A note has no other column, so any other sort leaves it be.
 */
function compareBySort(
  left: QueryBlockItem,
  right: QueryBlockItem,
  sort: QueryBlockSort | undefined,
): number {
  if (sort === 'created') {
    return compareDescending(left.createdAt, right.createdAt);
  }
  if (sort === 'updated') {
    return compareDescending(left.updatedAt, right.updatedAt);
  }
  return 0;
}

function compareTitles(left: QueryBlockItem, right: QueryBlockItem): number {
  return (
    left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }) ||
    compareSource(left, right)
  );
}

function compareSource(left: QueryBlockItem, right: QueryBlockItem): number {
  return left.filePath.localeCompare(right.filePath) || left.line - right.line;
}

/** Puts the higher priority first. */
function comparePriority(left: QueryBlockItem, right: QueryBlockItem): number {
  return (
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] -
    TASK_PRIORITY_RANKS[left.priority ?? 'none']
  );
}

/** Sorts undated items last so a missing date never looks like the oldest. */
function compareAscending(left?: number, right?: number): number {
  if (left === undefined || right === undefined) {
    return (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0);
  }
  return left - right;
}

function compareDescending(left?: number, right?: number): number {
  if (left === undefined || right === undefined) {
    return (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0);
  }
  return right - left;
}


function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}
