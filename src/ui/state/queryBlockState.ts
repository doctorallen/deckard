import { formatProgressCount } from '../../domain/tasks/progressCount';
import { countTaskProgress, isCancelledTask, nameTaskStatus } from '../../domain/tasks/taskStatuses';
import type { TagOverviewSortMode, TaskSortMode, TaskStatusType } from '../../domain/model';
import { getFileName } from '../../shared/paths';
import { type DateFormats, formatDisplayDate } from '../../domain/markdown/dateFormat';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { QueryContext } from '../../domain/query/queryContext';
import { parseWorkspaceQuery } from '../../domain/types/typeQueryFields';
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
import { getBacklinkIndex } from '../../domain/index/backlinks';
import { readTagNamespace } from '../../domain/markdown/tagKeys';
import {
  NOTE_COLUMNS,
  NoteColumnId,
  noteColumnField,
  noteColumnNamespace,
  parseNoteColumns,
  readNoteColumn,
} from '../../domain/notes/noteColumns';
import { isComputedFieldName, toFieldQueryName } from '../../domain/types/fieldKinds';
import { getTypeIndex } from '../../domain/types/typeIndex';
import { resolveTypeQueryPath } from '../../domain/types/typeQueryFields';
import { valueTitle } from './typeRows';

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
 * What a block sorts by: any column a task or a note has. Each list sorts
 * by the columns it has, and keeps its own order under one it does not.
 */
export type QueryBlockSort = TaskColumnId | NoteColumnId;

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
  /** Notes and tasks as tables, with `noteColumns` and `columns`. Undefined is the list. */
  view?: QueryBlockView;
  /** The task table's columns, in order; the defaults when omitted. */
  columns?: TaskColumnId[];
  /** The note table's columns, in order; the defaults when omitted. */
  noteColumns?: NoteColumnId[];
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
  /** The task's status's name, when it has one: In progress, Waiting, a status tag no status names. */
  status?: string;
  /** Present only for a cancelled task: closed, but not done. */
  cancelled?: boolean;
  /** The type of its status, for a task whose status has one worth drawing: in progress. */
  statusType?: TaskStatusType;
  /** Tag labels, as written on the line. */
  tags?: string[];
  dependsOn?: string[];
  dependencyId?: string;
  createdAt?: number;
  updatedAt?: number;
  /** For a note, how many other notes link to the note it is in. */
  linkCount?: number;
  /** For a note, its tasks, steps aside, and how many of them are done. */
  taskTotal?: number;
  taskDone?: number;
  /** For a note, every tag it carries, inherited ones too, as `{ key, label }`. */
  noteTags?: Array<{ key: string; label: string }>;
  /**
   * For a note in a table with field columns, each column's values by the
   * name it is written with, read from the typed row the note is, or else
   * the rows its tags are: `{ "team.lead": "Dana Whitfield" }`.
   */
  fieldValues?: Record<string, string>;
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
  noteColumns?: readonly string[];
}

/**
 * A page's sort as a query block writes it, so an exported block lists in
 * the order the page did. Rank and use have no column a block can sort by,
 * and A-Z is a block's own order for notes, so those write nothing.
 */
export function queryBlockSortOf(
  mode: TaskSortMode | TagOverviewSortMode,
  kind: 'notes' | 'tasks',
): Pick<QueryBlockWriteOptions, 'sort' | 'direction'> {
  switch (mode) {
    case 'created':
    case 'updated':
      return { sort: mode };
    case 'createdOldest':
      return { sort: 'created', direction: 'asc' };
    case 'updatedOldest':
      return { sort: 'updated', direction: 'asc' };
    case 'alphabetical':
      return kind === 'tasks' ? { sort: 'title' } : {};
    case 'alphabeticalReverse':
      return { sort: 'title', direction: 'desc' };
    case 'rank':
    case 'access':
      return {};
  }
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
    options.noteColumns?.length ? `noteColumns=${options.noteColumns.join(',')}` : '',
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
      ? read(value, options, match?.[2] ?? '')
      : `Unknown option "${attribute}". Use sort=, dir=, limit=, view=, columns=, or noteColumns=.`;
    if (warning) {
      options.warnings.push(warning);
    }
  }
  if (options.noteColumns && options.view !== 'table') {
    options.warnings.push('noteColumns= draws only with view=table; add view=table to see the notes as a table.');
  }
  return options;
}

/**
 * Reads one `name=value` option into the block's options, and answers the
 * warning to show when the value is not one the option takes. `value` is
 * lowercased; `written` is as the fence writes it.
 */
type OptionReader = (value: string, options: QueryBlockOptions, written: string) => string | undefined;

/** The options a query block's info string may set, by lowercased name. */
const OPTION_READERS = new Map<string, OptionReader>([
  ['sort', (value, options) => {
    // A task column by its id or a name it goes by, such as for, or a note's.
    const named = parseTaskColumns(value).columns.find((id) => id !== 'title');
    const column = isTaskColumnId(value) ? value : (named ?? readNoteColumn(value));
    if (!column) {
      return `sort must be a column, such as title, due, priority, created, updated, or links, not "${value}".`;
    }
    options.sort = column;
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
  ['notecolumns', (_value, options, written) => {
    // A field column is headed as written, so its case is kept.
    const parsed = parseNoteColumns(written);
    options.noteColumns = parsed.columns;
    if (parsed.unknown.length === 0) {
      return undefined;
    }
    return describeUnknownNoteColumns(parsed.unknown);
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
 * its query is evaluated in.
 */
export interface QueryBlockReading {
  queryContext: QueryContext;
  /**
   * The note the block is written in, by path: what `this` names in its
   * query (`team = this`). Without it, `this` names nothing.
   */
  notePath?: string;
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
    reading.notePath ?? null,
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

  const parsed = parseWorkspaceQuery(index, query);
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

  const results = evaluateQuery(
    index,
    parsed.node,
    reading.notePath ? { ...reading.queryContext, thisNotePath: reading.notePath } : reading.queryContext,
  );
  // A table reads the note columns, and so does a sort by one only notes have.
  const table = options.view === 'table' || isNoteOnlySort(options.sort);
  const fields = table ? readFieldColumns(index, options.noteColumns, messages) : [];
  const now = reading.queryContext.now;
  const notes = [
    ...results.sections.map((section) => withFieldValues(createSectionItem(section, index, table), index, fields, now)),
    ...results.files.map((file) => withFieldValues(createFileItem(file, index, table), index, fields, now)),
  ].sort(createNoteComparator(options.sort, options.direction));
  const tasks = results.tasks
    .map((task) => createTaskItem(task, index))
    .sort(createTaskComparator(options.sort, options.direction));

  return {
    query,
    messages,
    hasError: false,
    notes: notes.slice(0, options.limit),
    tasks: tasks.slice(0, options.limit),
    noteCount: notes.length,
    taskCount: tasks.length,
    openTaskCount: tasks.filter((task) => !task.completed && !task.cancelled).length,
  };
}

/** What a `noteColumns=` warning says of names that are no column. */
function describeUnknownNoteColumns(names: readonly string[]): string {
  return `noteColumns has no ${names.map((name) => `"${name}"`).join(', ')}; the columns are ${NOTE_COLUMNS.map((column) => column.id).join(', ')}, a namespace such as #status, or a field of a type.`;
}

/**
 * The field columns a block asks for, as written: those some type's rows
 * have, by name, path, or reverse, or a computed field's name. The rest
 * are warned of, and draw empty.
 */
function readFieldColumns(index: WorkspaceIndex, columns: readonly NoteColumnId[] | undefined, messages: QueryBlockMessage[]): string[] {
  const names = (columns ?? []).flatMap((column) => noteColumnField(column) ?? []);
  if (names.length === 0) {
    return [];
  }
  const registry = getTypeIndex(index).registry;
  const unknown = names.filter((name) => !isComputedFieldName(toFieldQueryName(name)) && resolveTypeQueryPath(registry, name).length === 0);
  if (unknown.length) {
    messages.push({ severity: 'warning', text: describeUnknownNoteColumns(unknown) });
  }
  return names.filter((name) => !unknown.includes(name));
}

/**
 * A note with its field columns' values: read from the typed rows its
 * note is, or else the rows its tags are, each value by the title of the
 * row or note it names, several joined with commas.
 */
function withFieldValues(item: QueryBlockItem, index: WorkspaceIndex, fields: readonly string[], now: number): QueryBlockItem {
  if (fields.length === 0) {
    return item;
  }
  const types = getTypeIndex(index);
  const ofFile = types.rowsOfFile(item.filePath).map((row) => row.id);
  const rowIds = ofFile.length ? ofFile : [...new Set((item.noteTags ?? []).flatMap((tag) => types.rowOfTag(tag.key)?.id ?? []))];
  const fieldValues: Record<string, string> = {};
  fields.forEach((name) => {
    const titles = rowIds.flatMap((rowId) => types.path(rowId, name.toLowerCase(), now).map((value) => valueTitle(types, value)));
    fieldValues[name] = [...new Set(titles)].join(', ');
  });
  return { ...item, fieldValues };
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
  table: boolean,
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
    ...(table
      ? describeNoteColumns(index, section.filePath, {
          tasks: (index.files.get(section.filePath)?.tasks ?? []).filter(
            (task) => task.lineNumber > section.startLine && task.lineNumber <= section.endLine,
          ),
          tagKeys: collectSectionTagKeys(index, section),
          labels: section.tagLabels,
        })
      : {}),
  };
}

/**
 * Represents a note that matched only through its front matter.
 */
function createFileItem(file: ParsedFile, index: WorkspaceIndex, table: boolean): QueryBlockItem {
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
    ...(table
      ? describeNoteColumns(index, file.filePath, {
          tasks: file.tasks,
          tagKeys: file.frontmatterTags.map((tag) => tag.key),
          labels: Object.fromEntries(file.frontmatterTags.map((tag) => [tag.key, tag.label])),
        })
      : {}),
  };
}

/** Whether a sort names a column only notes have, which only the note columns can answer. */
function isNoteOnlySort(sort: QueryBlockSort | undefined): boolean {
  return sort === 'links' || sort === 'tasks' || sort === 'tags' || (typeof sort === 'string' && sort.startsWith('#'));
}

/**
 * Every tag an entry carries as a search finds it: its own heading's, the
 * headings' above it, and its note's front matter, as `noteTags` promises.
 */
function collectSectionTagKeys(index: WorkspaceIndex, section: Section): string[] {
  const keys = new Set(section.tags);
  const visited = new Set<string>();
  for (let parentId = section.parentSectionId; parentId && !visited.has(parentId); ) {
    visited.add(parentId);
    const parent = index.sections.get(parentId);
    if (!parent) {
      break;
    }
    parent.tags.forEach((key) => keys.add(key));
    parentId = parent.parentSectionId;
  }
  index.files.get(section.filePath)?.frontmatterTags.forEach((tag) => keys.add(tag.key));
  return [...keys];
}

/**
 * What a table of notes shows of one entry besides its title and dates: the
 * notes that link to its note, its tasks and how many are done, and its tags.
 * Only a table reads them, so a list never pays for the links.
 */
function describeNoteColumns(
  index: WorkspaceIndex,
  filePath: string,
  entry: { tasks: readonly Task[]; tagKeys: readonly string[]; labels: Readonly<Record<string, string>> },
): Pick<QueryBlockItem, 'linkCount' | 'taskTotal' | 'taskDone' | 'noteTags'> {
  const sources = new Set(getBacklinkIndex(index).toNote(filePath).map((link) => link.sourcePath));
  const tasks = entry.tasks
    .map((task) => index.tasks.get(task.id) ?? task)
    .filter((task) => !task.parentTaskId);
  return {
    linkCount: sources.size,
    taskTotal: countTaskProgress(tasks).total,
    taskDone: countTaskProgress(tasks).done,
    noteTags: entry.tagKeys.map((key) => ({ key, label: entry.labels[key] ?? index.tags.get(key)?.label ?? key })),
  };
}

/**
 * The names an entry's tags in one namespace give, as a `#status` column
 * shows them: `doing` for `#status/doing`, in the order written.
 */
export function namespaceValues(item: Pick<QueryBlockItem, 'noteTags'>, namespace: string): string[] {
  const wanted = namespace.toLowerCase();
  return (item.noteTags ?? []).flatMap((tag) => {
    const found = readTagNamespace(tag.key);
    if (found?.toLowerCase() !== wanted) {
      return [];
    }
    const label = tag.label.replace(/^#/, '');
    return [label.slice(label.indexOf('/') + 1)];
  });
}

/** A matched task as a row, with its status's name: its checkbox's. */
function createTaskItem(
  task: Task,
  index: WorkspaceIndex,
): QueryBlockItem {
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
  // A done task's box says it is done; a status is named for an open or a cancelled one.
  const status = task.completed ? undefined : nameTaskStatus(task);
  return {
    id: task.id,
    title: stripTrailingTags(task.title) || task.title.trim(),
    context: section ? getHeadingPath(section, index.sections) : [],
    filePath: task.filePath,
    fileName: getFileName(task.filePath),
    line: task.lineNumber,
    completed: task.completed,
    ...(isCancelledTask(task) ? { cancelled: true } : {}),
    ...(task.status.type === 'inProgress' ? { statusType: 'inProgress' as const } : {}),
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
 * Orders notes alphabetically unless a sort says otherwise: dates newest
 * first and every other column ascending, until `dir=` turns it around. A
 * note with nothing in the sorted column comes last either way.
 */
function createNoteComparator(
  sort: QueryBlockSort | undefined,
  direction: TableSortDirection | undefined,
): (left: QueryBlockItem, right: QueryBlockItem) => number {
  const natural = directionOf(sort, undefined);
  const sign = (direction ?? natural) === natural ? 1 : -1;
  return (left, right) => compareBySort(left, right, sort, sign) || compareTitles(left, right);
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
  // A column only notes have leaves the tasks in their own order.
  const byColumn =
    sort === undefined || !isTaskColumnId(sort)
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
 * A note's part of a sort: an empty value last, then the values in the
 * column's natural order (dates newest first, the rest ascending) turned
 * by `sign`. A column only tasks have leaves the notes be.
 */
function compareBySort(
  left: QueryBlockItem,
  right: QueryBlockItem,
  sort: QueryBlockSort | undefined,
  sign: number,
): number {
  const read = sort === undefined ? undefined : noteSortValue(sort);
  if (!read) {
    return 0;
  }
  const [a, b] = [read(left), read(right)];
  if (a === undefined || b === undefined) {
    return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0);
  }
  const ascending =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  const natural = sort === 'created' || sort === 'updated' ? -ascending : ascending;
  return sign * natural;
}

/** How a note's value in a sorted column is read; undefined for a column notes do not have. */
function noteSortValue(sort: QueryBlockSort): ((item: QueryBlockItem) => number | string | undefined) | undefined {
  const namespace = noteColumnNamespace(sort as NoteColumnId);
  if (namespace !== undefined) {
    return (item) => namespaceValues(item, namespace).join(' ') || undefined;
  }
  return Object.hasOwn(NOTE_SORTS, sort) ? NOTE_SORTS[sort as keyof typeof NOTE_SORTS] : undefined;
}

/** Each fixed column's value as notes sort by it; undefined is an empty cell. */
const NOTE_SORTS: Readonly<Record<Exclude<NoteColumnId, `#${string}` | `field:${string}`>, (item: QueryBlockItem) => number | string | undefined>> = {
  created: (item) => item.createdAt,
  updated: (item) => item.updatedAt,
  title: (item) => item.title,
  note: (item) => item.fileName,
  links: (item) => item.linkCount,
  tasks: (item) => openTasksOf(item),
  tags: (item) => item.noteTags?.map((tag) => tag.label).join(' ') || undefined,
};

/** A note's open tasks, or undefined when it has none, so a note without tasks sorts last. */
function openTasksOf(item: QueryBlockItem): number | undefined {
  return item.taskTotal ? item.taskTotal - (item.taskDone ?? 0) : undefined;
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

/**
 * One cell of a table of notes, as text, its dates in the reader's
 * `formats`; empty when the entry has nothing to show there.
 */
export function describeNoteCell(item: QueryBlockItem, column: NoteColumnId, formats?: DateFormats): string {
  switch (column) {
    case 'title':
      return item.title;
    case 'note':
      return item.fileName.replace(/\.md$/i, '');
    case 'created':
      return item.createdAt === undefined ? '' : formatDisplayDate(item.createdAt, formats);
    case 'updated':
      return item.updatedAt === undefined ? '' : formatDisplayDate(item.updatedAt, formats);
    case 'links':
      return item.linkCount ? String(item.linkCount) : '';
    case 'tasks':
      return item.taskTotal ? formatProgressCount(item.taskDone ?? 0, item.taskTotal) : '';
    case 'tags':
      return (item.noteTags ?? []).map((tag) => tag.label).join(' ');
    default: {
      const field = noteColumnField(column);
      if (field !== undefined) {
        return item.fieldValues?.[field] ?? '';
      }
      const namespace = noteColumnNamespace(column);
      return namespace === undefined ? '' : namespaceValues(item, namespace).join(', ');
    }
  }
}
