import { getFileName } from '../../shared/paths';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { QueryContext } from '../../domain/query/queryContext';
import { parseQuery } from '../../domain/query/queryParser';
import { pluralize } from '../../shared/text';
import { getHeadingPath, stripTrailingTags } from '../../domain/ranking/entryLabels';

import { compareTasksByColumn, parseTaskColumns, TableTask } from './resultTable';
import { isTaskColumnId, TASK_COLUMNS } from '../../domain/tasks/taskColumns';
import {
  ParsedFile,
  Section,
  Task,
  TaskPriority,
  WorkspaceIndex,
  TableSortDirection,
  TaskColumnId,
} from '../../domain/model';
import { TASK_PRIORITY_RANKS } from '../../domain/markdown/taskFields';

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

/**
 * One result row, a note section, front-matter-only note, or task, as every
 * surface that draws a block's results reads it.
 */
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

/** A diagnostic or option warning shown beside a block's results. */
export interface QueryBlockMessage {
  severity: 'error' | 'warning';
  text: string;
}

/** What a block's query found, ordered and cut to its limit, with what to say about it. */
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

/** The options a live query block is written with. */
export interface QueryBlockWriteOptions {
  sort?: string;
  direction?: 'asc' | 'desc';
  view?: 'list' | 'table';
  columns?: readonly string[];
}

/**
 * A search written as a live query block, which a note keeps up to date:
 * the fence grows past any run of backticks the search holds.
 */
export function formatQueryBlock(query: string, options: QueryBlockWriteOptions = {}): string {
  const longest = Math.max(0, ...[...query.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const info = [
    QUERY_BLOCK_LANGUAGE,
    options.view ? `view=${options.view}` : '',
    options.columns?.length ? `columns=${options.columns.join(',')}` : '',
    options.sort ? `sort=${options.sort}` : '',
    options.direction ? `dir=${options.direction}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${fence}${info}\n${query.trim()}\n${fence}\n`;
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
    const read = name === undefined ? undefined : OPTION_READERS.get(name);
    const warning = read
      ? read(value, options)
      : `Unknown option "${attribute}". Use sort=, dir=, limit=, view=, or columns=.`;
    if (warning) {
      options.warnings.push(warning);
    }
  }
  return options;
}

/**
 * Reads one `name=value` option into the block's options, and answers the
 * warning to show when the value is not one the option takes.
 */
type OptionReader = (value: string, options: QueryBlockOptions) => string | undefined;

/** The options a query block's info string may set, by lowercased name. */
const OPTION_READERS = new Map<string, OptionReader>([
  ['sort', (value, options) => {
    if (!isTaskColumnId(value)) {
      return `sort must be a column, such as title, due, priority, created, or updated, not "${value}".`;
    }
    options.sort = value;
    return undefined;
  }],
  ['dir', (value, options) => {
    if (value !== 'asc' && value !== 'desc') {
      return `dir must be asc or desc, not "${value}".`;
    }
    options.direction = value;
    return undefined;
  }],
  ['view', (value, options) => {
    if (value !== 'table' && value !== 'list') {
      return `view must be list or table, not "${value}".`;
    }
    options.view = value;
    return undefined;
  }],
  ['columns', (value, options) => {
    // Unknown names are reported, and the known ones are still shown.
    const parsed = parseTaskColumns(value);
    options.columns = parsed.columns;
    if (parsed.unknown.length === 0) {
      return undefined;
    }
    return `columns has no ${parsed.unknown.map((name) => `"${name}"`).join(', ')}; the columns are ${TASK_COLUMNS.map((column) => column.id).join(', ')}.`;
  }],
  ['limit', (value, options) => {
    if (!/^\d+$/.test(value) || Number(value) <= 0) {
      return `limit must be a positive whole number, not "${value}".`;
    }
    options.limit = Number(value);
    return undefined;
  }],
]);

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
 * What a block is read in besides its own options: the settings and moment
 * its query is evaluated in, and the namespace its task rows read a status in.
 */
export interface QueryBlockReading {
  queryContext: QueryContext;
  /** The namespace of the status tags, from `deckard.board.statusNamespace`; `status` unless given. */
  statusNamespace?: string;
}

/**
 * Results by index, then by day and block. The lenses above a block are asked
 * for after every edit, and the preview renders as the note is typed, so a
 * block's query runs once per index instead. The day, the one the context's
 * `now` falls on, is part of the key because `today` and `7d` move at
 * midnight; the rest of the context is not, so a block keeps the answer it
 * gave first for as long as the index and the day last.
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
  reading: QueryBlockReading,
): QueryBlockSnapshot {
  let snapshots = snapshotCache.get(index);
  if (!snapshots) {
    snapshots = new Map();
    snapshotCache.set(index, snapshots);
  }
  const key = JSON.stringify([
    new Date(reading.queryContext.now).toDateString(),
    queryText,
    options,
    reading.statusNamespace ?? 'status',
  ]);
  let snapshot = snapshots.get(key);
  if (!snapshot) {
    snapshot = createQueryBlockSnapshot(index, queryText, options, reading);
    snapshots.set(key, snapshot);
  }
  return snapshot;
}

/**
 * Runs a block's query against the index, in the reading's context, and
 * orders what it matched.
 */
export function createQueryBlockSnapshot(
  index: WorkspaceIndex,
  queryText: string,
  options: QueryBlockOptions,
  reading: QueryBlockReading,
): QueryBlockSnapshot {
  const statusNamespace = reading.statusNamespace ?? 'status';
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

  const results = evaluateQuery(index, parsed.node, reading.queryContext);
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

/** A matched section as a row, titled by its heading under the headings above it. */
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

/** A matched task as a row, with the status its `#<statusNamespace>/` tag names. */
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

/** Which way a sort runs when the block does not say: dates newest first. */
function directionOf(
  sort: QueryBlockSort | undefined,
  direction: TableSortDirection | undefined,
): TableSortDirection {
  return direction ?? (sort === 'created' || sort === 'updated' ? 'desc' : 'asc');
}

/**
 * Orders notes alphabetically unless a date sort puts the newest first.
 */
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

/** Titles alphabetically, ignoring case and accents, then source order. */
function compareTitles(left: QueryBlockItem, right: QueryBlockItem): number {
  return (
    left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }) ||
    compareSource(left, right)
  );
}

/** Source order: by file path, then line. */
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

/** Newest first, with undated items still last. */
function compareDescending(left?: number, right?: number): number {
  if (left === undefined || right === undefined) {
    return (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0);
  }
  return right - left;
}
