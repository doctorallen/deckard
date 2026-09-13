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

export type QueryBlockSort = 'title' | 'created' | 'updated';

const QUERY_BLOCK_SORTS: readonly QueryBlockSort[] = [
  'title',
  'created',
  'updated',
];

/**
 * Display options written after the fence language, as in
 * ```deckard sort=updated limit=10.
 */
export interface QueryBlockOptions {
  /** Undefined keeps each list's natural order. */
  sort?: QueryBlockSort;
  /** Most items shown in each list. The totals still count every match. */
  limit?: number;
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
  priority?: TaskPriority;
  recurrence?: string;
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
      if (isQueryBlockSort(value)) {
        options.sort = value;
      } else {
        options.warnings.push(
          `sort must be title, created, or updated, not "${value}".`,
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
        `Unknown option "${attribute}". Use sort= or limit=.`,
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
export function createQueryBlockSnapshot(
  index: WorkspaceIndex,
  queryText: string,
  options: QueryBlockOptions,
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
  ].sort(createNoteComparator(options.sort));
  const tasks = results.tasks
    .map((task) => createTaskItem(task, index))
    .sort(createTaskComparator(options.sort));

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

function createTaskItem(task: Task, index: WorkspaceIndex): QueryBlockItem {
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
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
    priority: task.priority,
    recurrence: task.recurrence,
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
function createNoteComparator(
  sort: QueryBlockSort | undefined,
): (left: QueryBlockItem, right: QueryBlockItem) => number {
  return (left, right) =>
    compareBySort(left, right, sort) || compareTitles(left, right);
}

/**
 * Keeps open tasks ahead of done ones. Within each group the natural order is
 * soonest due date first, then highest priority, then source order, which
 * reads like an agenda.
 */
function createTaskComparator(
  sort: QueryBlockSort | undefined,
): (left: QueryBlockItem, right: QueryBlockItem) => number {
  return (left, right) =>
    (left.completed ? 1 : 0) - (right.completed ? 1 : 0) ||
    (sort === undefined
      ? compareAscending(left.dueAt, right.dueAt) ||
        comparePriority(left, right) ||
        compareSource(left, right)
      : sort === 'title'
        ? compareTitles(left, right)
        : compareBySort(left, right, sort) || compareSource(left, right));
}

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

function isQueryBlockSort(value: string): value is QueryBlockSort {
  return (QUERY_BLOCK_SORTS as readonly string[]).includes(value);
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}
