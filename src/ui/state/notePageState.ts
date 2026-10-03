import { getBacklinkIndex, noteTitle } from '../../domain/index/backlinks';
import { findFrontmatterEnd, splitFrontmatterValues } from '../../domain/markdown/frontmatter';
import { mapInlineTokens, tokenizeInline } from '../../domain/markdown/inline';
import { formatKeyWords, readTagNamespace } from '../../domain/markdown/tagKeys';
import { MarkdownToken, parseBlockMarkdown } from '../../domain/markdown/markdownTokens';
import { describeDueDate } from '../../domain/markdown/dueWording';
import { EMBED_LINE, resolveEmbed, createSourceParser } from '../../domain/notes/embeds';
import { BLOCK_ID_PATTERN } from '../../domain/markdown/taskFields';
import { DEFAULT_NOTE_COLUMNS, noteColumnLabel } from '../../domain/notes/noteColumns';
import { QueryContext } from '../../domain/query/queryContext';
import { computeTagProgress, describeTagProgress, summarizeTasks } from '../../domain/tasks/tagProgress';
import type { InlineToken, ParsedFile, WorkspaceIndex } from '../../domain/model';
import type {
  NoteBacklink,
  NoteBlock,
  NoteListItem,
  NotePageSnapshot,
  NoteProperty,
  NoteQueryResult,
  NoteQueryRow,
} from '../protocol/notePage';
import { findBreadcrumbs, hubNoteLabel } from './hubTree';
import {
  describeNoteCell,
  describeQueryBlockCounts,
  getQueryBlockSnapshot,
  parseQueryBlockInfo,
  QueryBlockItem,
  toTableTask,
} from './queryBlockState';
import { createTaskCells, DEFAULT_TASK_COLUMNS, getTaskColumn } from './resultTable';

/**
 * One note as the note page draws it: its blocks read from its Markdown as
 * the pages read a card's, each with the line it starts on, with its tasks'
 * boxes, its query blocks' results, and its embeds read out of them; and
 * around them, its title, its properties, where it sits under its hubs, and
 * what links to it. Everything is data the page draws as elements, never
 * HTML.
 */

/** How deep an embed inside an embed is drawn, as the preview draws them. */
const MAX_EMBED_DEPTH = 3;

/** How many notes Linked from lists, and how many of each one's lines. */
const BACKLINK_NOTE_LIMIT = 30;
const BACKLINK_LINE_LIMIT = 3;

/** What a note page is built in besides the index and the note. */
export interface NotePageOptions {
  queryContext: QueryContext;
  /** The namespace of status tags; `status` unless given. */
  statusNamespace?: string;
  /** The line to show and mark. */
  focusLine?: number;
  history: { back: boolean; forward: boolean };
  /** Changes with each note asked for. */
  visit: number;
}

/** The note page for one note, or one that says the index has no such note. */
export function createNotePageSnapshot(
  index: WorkspaceIndex,
  filePath: string,
  options: NotePageOptions,
): NotePageSnapshot {
  const base = {
    filePath,
    folder: filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '',
    history: options.history,
    visit: options.visit,
    ...(options.focusLine === undefined ? {} : { focusLine: options.focusLine }),
  };
  const file = index.files.get(filePath);
  if (!file) {
    return {
      ...base,
      missing: true,
      title: noteTitle(filePath),
      properties: [],
      breadcrumbs: [],
      tags: [],
      blocks: [],
      backlinks: [],
      backlinkCount: 0,
    };
  }
  const title = hubNoteLabel(index, filePath);
  const reading: Reading = { index, file, options, depth: 0 };
  const lines = file.content.split(/\r?\n/);
  const frontmatterEnd = findFrontmatterEnd(lines);
  const bodyStart = frontmatterEnd === undefined ? 0 : frontmatterEnd + 1;
  const blocks = readNoteBlocks(lines.slice(bodyStart).join('\n'), bodyStart, reading);
  const { backlinks, count } = collectBacklinks(index, filePath);
  return {
    ...base,
    title,
    properties: readProperties(file, lines, frontmatterEnd),
    breadcrumbs: findBreadcrumbs(index, filePath).map((crumb) => ({ labels: crumb.labels, notes: crumb.notes })),
    ...describeHub(index, file, options.queryContext),
    ...describeNoteTasks(index, file, options.queryContext),
    tags: collectTags(file),
    blocks: withoutTitleHeading(blocks, title),
    backlinks,
    backlinkCount: count,
  };
}

/** What reading a note's blocks needs: the index, the note it is in, and how deep in embeds it is. */
interface Reading {
  index: WorkspaceIndex;
  file: ParsedFile;
  options: NotePageOptions;
  depth: number;
}

/**
 * The note's first heading is its title, which the page draws above the
 * note; drawn again as the first block, it would say the title twice.
 */
function withoutTitleHeading(blocks: NoteBlock[], title: string): NoteBlock[] {
  const [first, ...rest] = blocks;
  if (first?.kind === 'heading' && first.level === 1 && plainText(first.children).trim() === title) {
    return rest;
  }
  return blocks;
}

/** Inline tokens' words, without their marks. */
function plainText(tokens: readonly InlineToken[]): string {
  return tokens
    .map((token) => {
      if (token.kind === 'break') {
        return ' ';
      }
      return 'children' in token ? plainText(token.children) : token.text;
    })
    .join('');
}

/**
 * Markdown read into blocks, each with its one-based line in the note:
 * `offset` is how many lines of the note come before `markdown`.
 */
function readNoteBlocks(markdown: string, offset: number, reading: Reading): NoteBlock[] {
  const tokens = parseBlockMarkdown(markdown);
  const sourceLines = markdown.split(/\r?\n/);
  const cursor: Cursor = { tokens, index: 0 };
  return readBlocks(cursor, -1, { offset, sourceLines, reading });
}

/** markdown-it's flat list of block tokens, and how far the reader has read. */
interface Cursor {
  readonly tokens: readonly MarkdownToken[];
  index: number;
}

/** Where the tokens came from: their offset in the note, their source lines, and the reading. */
interface Source {
  offset: number;
  sourceLines: readonly string[];
  reading: Reading;
}

/** Reads blocks up to the token that closes the container opened at `level`, or to the end. */
function readBlocks(cursor: Cursor, level: number, source: Source): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.nesting === -1 && token.level === level) {
      break;
    }
    const block = readBlock(token, cursor, source);
    if (Array.isArray(block)) {
      blocks.push(...block);
    } else if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

/** The one-based line in the note a token starts on. */
function lineOf(token: MarkdownToken, source: Source): number {
  return (token.map?.[0] ?? 0) + source.offset + 1;
}

/** The block a token starts, read through its close; undefined for a token no block starts at. */
function readBlock(token: MarkdownToken, cursor: Cursor, source: Source): NoteBlock | NoteBlock[] | undefined {
  const line = lineOf(token, source);
  switch (token.type) {
    case 'paragraph_open':
      return readParagraph(token, cursor, source, line);
    case 'heading_open':
      return { kind: 'heading', line, level: Number(token.tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, children: readInline(cursor) };
    case 'bullet_list_open':
    case 'ordered_list_open':
      return readList(token, cursor, source, line);
    case 'blockquote_open':
      return { kind: 'quote', line, children: readBlocks(cursor, token.level, source) };
    case 'fence':
      return readFence(token, source, line);
    case 'code_block':
      return { kind: 'code', line, text: token.content };
    case 'hr':
      return { kind: 'rule', line };
    case 'table_open':
      return { kind: 'table', line, rows: readTableRows(cursor, token.level) };
    default:
      return undefined;
  }
}

/** A paragraph's or a heading's inline tokens, moving past its close. */
function readInline(cursor: Cursor): InlineToken[] {
  const inline = cursor.tokens[cursor.index];
  cursor.index += 2;
  return withoutBlockId(mapInlineTokens(inline.children ?? []));
}

/**
 * Inline tokens without the `^marker` a line may end with, which names the
 * line for a link to it and is no part of what it says.
 */
function withoutBlockId(tokens: InlineToken[]): InlineToken[] {
  const last = tokens[tokens.length - 1];
  if (last?.kind !== 'text' || !BLOCK_ID_PATTERN.test(last.text)) {
    return tokens;
  }
  return [...tokens.slice(0, -1), { kind: 'text', text: last.text.replace(BLOCK_ID_PATTERN, '') }];
}

/**
 * A paragraph, or the embeds in it: a `![[…]]` alone on its line is drawn
 * as what it names, as the preview's embed rule draws it, which takes such
 * a line out of the paragraph around it. The lines either side stay a
 * paragraph each.
 */
function readParagraph(token: MarkdownToken, cursor: Cursor, source: Source, line: number): NoteBlock | NoteBlock[] {
  const map = token.map;
  const lines = map ? source.sourceLines.slice(map[0], map[1]) : [];
  if (!map || !lines.some((text) => EMBED_LINE.test(text))) {
    return { kind: 'paragraph', line, children: readInline(cursor) };
  }
  cursor.index += 2;
  const blocks: NoteBlock[] = [];
  let run: { start: number; lines: string[] } | undefined;
  const closeRun = (): void => {
    if (!run) {
      return;
    }
    blocks.push({ kind: 'paragraph', line: run.start, children: withoutBlockId(tokenizeInline(run.lines.map((text) => text.trim()).join('\n'))) });
    run = undefined;
  };
  lines.forEach((text, at) => {
    const lineNumber = line + at;
    const embed = EMBED_LINE.exec(text);
    if (embed) {
      closeRun();
      blocks.push(readEmbed(embed[1], lineNumber, source.reading));
      return;
    }
    run ??= { start: lineNumber, lines: [] };
    run.lines.push(text);
  });
  closeRun();
  return blocks;
}

/** An embed, read as what it names, three deep, or as why it names nothing. */
function readEmbed(target: string, line: number, reading: Reading): NoteBlock {
  const resolved = resolveEmbed(target, reading.file.content, reading.index, createSourceParser());
  if (resolved.kind === 'missing') {
    return { kind: 'embed', line, target, title: target, missing: resolved.reason };
  }
  const where = resolved.href ? readHref(resolved.href) : undefined;
  const sourceFile = where ? reading.index.files.get(where.filePath) : undefined;
  if (reading.depth + 1 > MAX_EMBED_DEPTH) {
    return { kind: 'embed', line, target, title: resolved.title, ...(where ? { source: where } : {}) };
  }
  const nested: Reading = { ...reading, file: sourceFile ?? reading.file, depth: reading.depth + 1 };
  const startLine = where?.line ?? line;
  return {
    kind: 'embed',
    line,
    target,
    title: resolved.title,
    ...(where ? { source: where } : {}),
    blocks: readNoteBlocks(resolved.content, startLine - 1, nested),
  };
}

/** The note and line a preview link names, `/notes/Atlas.md#L12`. */
function readHref(href: string): { filePath: string; line: number } | undefined {
  const match = /^\/(.*)#L(\d+)$/.exec(href);
  if (!match) {
    return undefined;
  }
  return { filePath: match[1].split('/').map(decodeURIComponent).join('/'), line: Number(match[2]) };
}

/** A fence: a query block drawn as its results, or code, its language kept. */
function readFence(token: MarkdownToken, source: Source, line: number): NoteBlock {
  const options = parseQueryBlockInfo(token.info);
  if (!options) {
    const language = token.info.trim().split(/\s+/)[0];
    return { kind: 'code', line, text: token.content, ...(language ? { language } : {}) };
  }
  return { kind: 'query', line, query: token.content.trim(), result: runQueryBlock(token.content, options, source.reading) };
}

/** What a query block finds, drawn as the preview draws it: lists, or tables for `view=table`. */
function runQueryBlock(query: string, options: NonNullable<ReturnType<typeof parseQueryBlockInfo>>, reading: Reading): NoteQueryResult {
  const { queryContext, statusNamespace } = reading.options;
  const snapshot = getQueryBlockSnapshot(reading.index, query, options, { queryContext, statusNamespace: statusNamespace ?? 'status' });
  if (snapshot.hasError) {
    const error = snapshot.messages.find((message) => message.severity === 'error')?.text ?? 'This query cannot run.';
    return { counts: '', error, notes: [], tasks: [], noteCount: 0, taskCount: 0 };
  }
  const table = options.view === 'table';
  const noteColumns = (options.noteColumns ?? [...DEFAULT_NOTE_COLUMNS]).filter((column) => column !== 'title');
  const taskColumns = (options.columns ?? [...DEFAULT_TASK_COLUMNS]).filter((column) => column !== 'title');
  const row = (item: QueryBlockItem): NoteQueryRow => ({
    title: item.title,
    filePath: item.filePath,
    line: item.line,
    detail: describeRow(item, queryContext),
    ...(item.completed === undefined ? {} : { task: { taskId: item.id, completed: item.completed } }),
  });
  return {
    counts: describeQueryBlockCounts(snapshot),
    ...(table
      ? {
          table: {
            noteHead: noteColumns.map(noteColumnLabel),
            taskHead: taskColumns.map((column) => getTaskColumn(column).label),
          },
        }
      : {}),
    notes: snapshot.notes.map((item) => ({
      ...row(item),
      ...(table ? { cells: noteColumns.map((column) => describeNoteCell(item, column)) } : {}),
    })),
    tasks: snapshot.tasks.map((item) => ({
      ...row(item),
      ...(table ? { cells: createTaskCells(toTableTask(item), taskColumns, queryContext).map((cell) => cell.text) } : {}),
    })),
    noteCount: snapshot.noteCount,
    taskCount: snapshot.taskCount,
  };
}

/** A row's line under its title: a task's due date, then where it lives. */
function describeRow(item: QueryBlockItem, context: QueryContext): string {
  const where = item.fileName.replace(/\.md$/i, '');
  if (item.completed === undefined || item.dueAt === undefined) {
    return where;
  }
  const due = describeDueDate(item.dueAt, context.now, context.taskPolicy, item.dueText);
  return `${item.completed ? `due ${item.dueText ?? ''}`.trim() : due.label} · ${where}`;
}

/** A list, each item its blocks, an item that is a task with its box. */
function readList(open: MarkdownToken, cursor: Cursor, source: Source, line: number): NoteBlock {
  const start = Number(open.attrGet('start') ?? 1);
  const items: NoteListItem[] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.nesting === -1 && token.level === open.level) {
      break;
    }
    if (token.type === 'list_item_open') {
      items.push(readListItem(token, cursor, source));
    }
  }
  return {
    kind: 'list',
    line,
    ordered: open.type === 'ordered_list_open',
    ...(start === 1 || open.type !== 'ordered_list_open' ? {} : { start }),
    items,
  };
}

/** The box a task's item opens with: `[ ]`, `[x]`, or `[X]` and a space. */
const TASK_BOX = /^\[([ xX])\][ \t]+/;

/**
 * One item. When its first paragraph opens with a box, it is a task: the
 * box is taken off its words and given the task the index has on its line.
 */
function readListItem(item: MarkdownToken, cursor: Cursor, source: Source): NoteListItem {
  const line = lineOf(item, source);
  const first = cursor.tokens[cursor.index];
  const inline = first?.type === 'paragraph_open' ? cursor.tokens[cursor.index + 1] : undefined;
  const box = inline?.type === 'inline' ? TASK_BOX.exec(inline.content) : null;
  if (!box || !inline) {
    return { line, blocks: readBlocks(cursor, item.level, source) };
  }
  const children = withoutBlockId(tokenizeInline(inline.content.slice(box[0].length)));
  cursor.index += 3;
  const rest = readBlocks(cursor, item.level, source);
  const file = source.reading.file;
  const task = file.tasks.find((candidate) => candidate.lineNumber === line);
  const indexed = task ? (source.reading.index.tasks.get(task.id) ?? task) : undefined;
  return {
    line,
    ...(indexed ? { task: { taskId: indexed.id, completed: indexed.completed } } : {}),
    blocks: [{ kind: 'paragraph', line, children }, ...rest],
  };
}

/** A table's rows, header first, each its cells' inline tokens, moving past its close. */
function readTableRows(cursor: Cursor, level: number): InlineToken[][][] {
  const rows: InlineToken[][][] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.nesting === -1 && token.level === level) {
      break;
    }
    if (token.type === 'tr_open') {
      rows.push([]);
    } else if (token.type === 'inline') {
      rows[rows.length - 1].push(mapInlineTokens(token.children ?? []));
    }
  }
  return rows;
}

/** A front-matter line that starts a property: its name, and what follows the colon. */
const PROPERTY_LINE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;

/**
 * The note's front matter as properties, in the order written: each value
 * a tag when the note carries it as one, as `owner: "@dana"` or
 * `projects: [atlas]` do.
 */
function readProperties(file: ParsedFile, lines: readonly string[], end: number | undefined): NoteProperty[] {
  if (end === undefined) {
    return [];
  }
  const tags = [...file.frontmatterTags, ...(file.hub?.describes ?? [])];
  const tagOf = (value: string): string | undefined => {
    const lowered = value.toLowerCase().replace(/^['"]|['"]$/g, '');
    const found = tags.find(
      (tag) =>
        tag.key.toLowerCase() === lowered ||
        tag.label.toLowerCase() === lowered ||
        tag.key.toLowerCase() === `#${lowered}` ||
        tag.key.toLowerCase().endsWith(`/${lowered}`),
    );
    return found?.key;
  };
  const properties: NoteProperty[] = [];
  for (let line = 1; line < end; line += 1) {
    const match = PROPERTY_LINE.exec(lines[line]);
    if (!match) {
      continue;
    }
    const written = [match[2]];
    while (line + 1 < end && /^\s+-\s/.test(lines[line + 1])) {
      line += 1;
      written.push(lines[line].replace(/^\s+-\s+/, ''));
    }
    const values = written.flatMap((value) => splitFrontmatterValues(value)).map((text) => {
      const tagKey = tagOf(text);
      return tagKey ? { text, tagKey } : { text };
    });
    if (values.length) {
      properties.push({ name: match[1], values });
    }
  }
  return properties;
}

/** For a hub note, its tag and how far along the tag's tasks are. */
function describeHub(index: WorkspaceIndex, file: ParsedFile, context: QueryContext): Pick<NotePageSnapshot, 'hub'> {
  const tag = file.hub?.describes.find((described) => index.tags.get(described.key)?.hubFilePaths?.[0] === file.filePath);
  if (!tag) {
    return {};
  }
  const progress = computeTagProgress(index, tag.key, context.now, context.taskPolicy);
  return {
    hub: {
      tagKey: tag.key,
      tagLabel: index.tags.get(tag.key)?.label ?? tag.label,
      kind: describeTagKind(tag.key),
      done: progress?.done ?? 0,
      total: progress?.total ?? 0,
      label: progress ? describeTagProgress(progress, context.now, context.taskPolicy) : 'No tasks yet',
    },
  };
}

/**
 * What a hub's tag names, by its namespace, as its progress bar is labeled:
 * Project for `#project/atlas`, Person for an `@` tag, and Tag for one
 * with no namespace.
 */
export function describeTagKind(tagKey: string): string {
  if (tagKey.startsWith('@')) {
    return 'Person';
  }
  const namespace = readTagNamespace(tagKey);
  return namespace ? formatKeyWords(namespace) : 'Tag';
}

/** How far along the note's own tasks are, as the index has them now. */
function describeNoteTasks(index: WorkspaceIndex, file: ParsedFile, context: QueryContext): Pick<NotePageSnapshot, 'taskProgress'> {
  const tasks = file.tasks.map((task) => index.tasks.get(task.id) ?? task);
  const progress = summarizeTasks(tasks, context.now, context.taskPolicy);
  return progress
    ? { taskProgress: { done: progress.done, total: progress.total, label: describeTagProgress(progress, context.now, context.taskPolicy) } }
    : {};
}

/** Every tag the note writes, each by the words it is written in, longest first so `#a/b` is found before `#a`. */
function collectTags(file: ParsedFile): Array<{ key: string; label: string }> {
  const found = new Map<string, string>();
  const add = (key: string, label: string): void => {
    if (!found.has(label)) {
      found.set(label, key);
    }
  };
  file.frontmatterTags.forEach((tag) => add(tag.key, tag.label));
  for (const section of file.sections) {
    Object.entries(section.tagLabels).forEach(([key, label]) => add(key, label));
    section.bodyTags?.forEach((tag) => add(tag.key, tag.label));
  }
  file.tasks.forEach((task) => Object.entries(task.tagLabels).forEach(([key, label]) => add(key, label)));
  return [...found]
    .map(([label, key]) => ({ key, label }))
    .sort((left, right) => right.label.length - left.label.length || left.label.localeCompare(right.label));
}

/** The notes that link to this one, most links first, each with the lines that do. */
function collectBacklinks(index: WorkspaceIndex, filePath: string): { backlinks: NoteBacklink[]; count: number } {
  const bySource = new Map<string, number[]>();
  for (const link of getBacklinkIndex(index).toNote(filePath)) {
    bySource.set(link.sourcePath, [...(bySource.get(link.sourcePath) ?? []), link.line]);
  }
  const backlinks = [...bySource]
    .map(([source, lineIndexes]) => {
      const lines = index.files.get(source)?.content.split(/\r?\n/) ?? [];
      const unique = [...new Set(lineIndexes)];
      return {
        filePath: source,
        title: hubNoteLabel(index, source),
        lines: unique.slice(0, BACKLINK_LINE_LIMIT).map((lineIndex) => ({
          line: lineIndex + 1,
          text: (lines[lineIndex] ?? '').trim().replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').slice(0, 200),
        })),
        count: unique.length,
      };
    })
    .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));
  return { backlinks: backlinks.slice(0, BACKLINK_NOTE_LIMIT), count: backlinks.length };
}
