import { findLinkedBlock, findLinkedSection, getBacklinkIndex, noteTitle, parseWikiTarget } from '../../domain/index/backlinks';
import { findFrontmatterEnd, splitFrontmatterValues } from '../../domain/markdown/frontmatter';
import { mapInlineTokens, tokenizeInline } from '../../domain/markdown/inline';
import { readFrontmatterValueTag, stripTags } from '../../domain/markdown/parser';
import { formatKeyWords, readTagNamespace } from '../../domain/markdown/tagKeys';
import { MarkdownToken, NoteEmbedMeta, parseBlockMarkdown } from '../../domain/markdown/markdownTokens';
import { describeDueDate } from '../../domain/markdown/dueWording';
import { resolveEmbed, createSourceParser } from '../../domain/notes/embeds';
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
import { linkProgressParts } from './progressLinks';
import { quoteValue } from '../../domain/query/queryFormat';

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
  const heading = file.sections.find((section) => !section.isInline);
  const title = (heading ? plainText(withoutBlockId(tokenizeInline(stripTags(heading.heading)))).trim() : '') || noteTitle(filePath);
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
    blocks: withoutTitleHeading(blocks, heading?.startLine),
    backlinks,
    backlinkCount: count,
  };
}

/**
 * A note's body as the note page draws it, its front matter left out and its
 * title heading kept, for a page that shows a note inside it, such as a
 * tag's hub note; and its tags, which the blocks draw as buttons.
 */
export function readNoteBody(
  index: WorkspaceIndex,
  filePath: string,
  options: Pick<NotePageOptions, 'queryContext' | 'statusNamespace'>,
): { blocks: NoteBlock[]; tags: Array<{ key: string; label: string }> } | undefined {
  const file = index.files.get(filePath);
  if (!file) {
    return undefined;
  }
  const reading: Reading = { index, file, options: { ...options, history: { back: false, forward: false }, visit: 0 }, depth: 0 };
  const lines = file.content.split(/\r?\n/);
  const frontmatterEnd = findFrontmatterEnd(lines);
  const bodyStart = frontmatterEnd === undefined ? 0 : frontmatterEnd + 1;
  return { blocks: readNoteBlocks(lines.slice(bodyStart).join('\n'), bodyStart, reading), tags: collectTags(file) };
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
 * note, its tags and marks aside; drawn again as the first block, it would
 * say the title twice. Only a top-level heading that opens the note is
 * taken: a note that starts with words keeps its heading where it is.
 */
function withoutTitleHeading(blocks: NoteBlock[], titleLine: number | undefined): NoteBlock[] {
  const [first, ...rest] = blocks;
  if (first?.kind === 'heading' && first.level === 1 && first.line === titleLine) {
    return rest;
  }
  return blocks;
}

/** Inline tokens' words, without their marks; a `[[link]]` is the words it shows. */
function plainText(tokens: readonly InlineToken[]): string {
  return tokens
    .map((token) => {
      if (token.kind === 'break') {
        return ' ';
      }
      if (token.kind === 'wikiLink') {
        return /\|([^\]]+)\]\]$/.exec(token.text)?.[1]?.trim() || token.target;
      }
      if (token.kind === 'image') {
        return token.alt;
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
  const tokens = parseBlockMarkdown(markdown, { embeds: true });
  const cursor: Cursor = { tokens, index: 0 };
  return readBlocks(cursor, -1, { offset, reading });
}

/** markdown-it's flat list of block tokens, and how far the reader has read. */
interface Cursor {
  readonly tokens: readonly MarkdownToken[];
  index: number;
}

/** Where the tokens came from: their offset in the note, and the reading. */
interface Source {
  offset: number;
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
    if (block) {
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
function readBlock(token: MarkdownToken, cursor: Cursor, source: Source): NoteBlock | undefined {
  const line = lineOf(token, source);
  switch (token.type) {
    case 'paragraph_open':
      return { kind: 'paragraph', line, children: readInline(cursor) };
    case 'note_embed':
      return readEmbed((token.meta as NoteEmbedMeta).target, line, source.reading);
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
  return withoutBlockId(mapInlineTokens(inline.children ?? [], { images: true }));
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
 * An embed, read as what it names, three deep, or as why it names nothing.
 * Its blocks carry the lines of the note they are written in, so a box in
 * them ticks that note's task and a double-click opens that note there.
 */
function readEmbed(target: string, line: number, reading: Reading): NoteBlock {
  // `![[diagram.png]]` embeds an image, drawn as one, read by the host.
  const image = /^([^#|]+\.(?:png|jpe?g|gif|webp|svg|avif))(?:\|([^\]]*))?$/i.exec(target.trim());
  if (image) {
    return { kind: 'paragraph', line, children: [{ kind: 'image', src: image[1].trim(), alt: image[2]?.trim() || image[1].trim() }] };
  }
  const resolved = resolveEmbed(target, reading.file.content, reading.index, createSourceParser());
  if (resolved.kind === 'missing') {
    return { kind: 'embed', line, target, title: target, missing: resolved.reason };
  }
  const where = locateEmbed(target, resolved.href, reading);
  const source = where ? { source: { filePath: where.file.filePath, line: where.line } } : {};
  if (!where || reading.depth + 1 > MAX_EMBED_DEPTH) {
    return { kind: 'embed', line, target, title: resolved.title || target, ...source };
  }
  const nested: Reading = { ...reading, file: where.file, depth: reading.depth + 1 };
  return {
    kind: 'embed',
    line,
    target,
    title: resolved.title || target,
    ...source,
    blocks: readNoteBlocks(resolved.content, where.contentLine - 1, nested),
    ...(where.file === reading.file ? {} : { tags: collectTags(where.file) }),
  };
}

/**
 * The note an embed reads, the line it names there, and the one-based line
 * its content starts on: the marked line, the heading, or for a whole note
 * the first line after its front matter and the blank lines the embed
 * leaves out. An embed with no note name reads the note it is written in.
 */
function locateEmbed(
  target: string,
  href: string | undefined,
  reading: Reading,
): { file: ParsedFile; line: number; contentLine: number } | undefined {
  const filePath = href ? readHref(href)?.filePath : reading.file.filePath;
  const file = filePath === reading.file.filePath ? reading.file : filePath && reading.index.files.get(filePath);
  if (!file) {
    return undefined;
  }
  const { block, heading } = parseWikiTarget(target);
  if (block) {
    const line = findLinkedBlock(file, block);
    return line === undefined ? undefined : { file, line, contentLine: line };
  }
  if (heading) {
    const line = findLinkedSection(file, heading)?.startLine;
    return line === undefined ? undefined : { file, line, contentLine: line };
  }
  const lines = file.content.split(/\r?\n/);
  const end = findFrontmatterEnd(lines);
  let contentLine = end === undefined ? 1 : end + 2;
  while (end !== undefined && contentLine <= lines.length && lines[contentLine - 1] === '') {
    contentLine += 1;
  }
  return { file, line: 1, contentLine };
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
 * One item. When its first paragraph opens with a box and the index has a
 * task on its line, it is that task: the box is taken off its words and
 * drawn as the task's. A box the index reads no task from, as in a quote or
 * an ordered list, stays written, so what it says is not lost.
 */
function readListItem(item: MarkdownToken, cursor: Cursor, source: Source): NoteListItem {
  const line = lineOf(item, source);
  const first = cursor.tokens[cursor.index];
  const inline = first?.type === 'paragraph_open' ? cursor.tokens[cursor.index + 1] : undefined;
  const box = inline?.type === 'inline' ? TASK_BOX.exec(inline.content) : null;
  const task = box ? source.reading.file.tasks.find((candidate) => candidate.lineNumber === line) : undefined;
  if (!box || !inline || !task) {
    return { line, blocks: readBlocks(cursor, item.level, source) };
  }
  const children = withoutBlockId(tokenizeInline(inline.content.slice(box[0].length)));
  cursor.index += 3;
  const rest = readBlocks(cursor, item.level, source);
  const indexed = source.reading.index.tasks.get(task.id) ?? task;
  return {
    line,
    task: { taskId: indexed.id, completed: indexed.completed },
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
      rows[rows.length - 1].push(mapInlineTokens(token.children ?? [], { images: true }));
    }
  }
  return rows;
}

/** A front-matter line that starts a property: its name, and what follows the colon. */
const PROPERTY_LINE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;

/** A YAML block scalar's opening, `|` or `>` with its chomping and indent marks. */
const BLOCK_SCALAR = /^[|>][+-]?\d*\s*$/;

/**
 * The note's front matter as properties, in the order written: each value
 * a tag when the index reads one from it under its field, as `owner:
 * "@dana"` or `projects: [atlas]`, and the note carries that tag. A list
 * may be indented under its name or not, and a `|` or `>` block is its
 * lines run together.
 */
function readProperties(file: ParsedFile, lines: readonly string[], end: number | undefined): NoteProperty[] {
  if (end === undefined) {
    return [];
  }
  const tags = [...file.frontmatterTags, ...(file.hub?.describes ?? [])];
  const tagOf = (name: string, value: string): string | undefined => {
    const named = readFrontmatterValueTag(name, value);
    if (!named) {
      return undefined;
    }
    const label = named.label.toLowerCase();
    return tags.find((tag) => tag.key === named.key || tag.label.toLowerCase() === label)?.key;
  };
  const properties: NoteProperty[] = [];
  for (let line = 1; line < end; line += 1) {
    const match = PROPERTY_LINE.exec(lines[line]);
    if (!match) {
      continue;
    }
    const [written, last] = readPropertyValues(lines, line, end, match[2]);
    line = last;
    const values = written.map((text) => {
      const tagKey = tagOf(match[1], text);
      return tagKey ? { text, tagKey } : { text };
    });
    if (values.length) {
      properties.push({ name: match[1], values });
    }
  }
  return properties;
}

/**
 * A property's values, from what follows its colon on `line` and the lines
 * under it: a `- item` list, or a block's indented lines. Also the last
 * line it takes, for the reader to go on after.
 */
function readPropertyValues(lines: readonly string[], line: number, end: number, value: string): [string[], number] {
  let last = line;
  if (BLOCK_SCALAR.test(value)) {
    const block: string[] = [];
    while (last + 1 < end && (/^\s+\S/.test(lines[last + 1]) || lines[last + 1].trim() === '')) {
      last += 1;
      block.push(lines[last].trim());
    }
    const text = block.filter(Boolean).join(' ');
    return [text ? [text] : [], last];
  }
  const written = [value];
  while (last + 1 < end && /^\s*-\s/.test(lines[last + 1])) {
    last += 1;
    written.push(lines[last].replace(/^\s*-\s+/, ''));
  }
  return [written.flatMap((text) => splitFrontmatterValues(text)), last];
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
      // The tasks a tag's progress counts: neither steps nor parked ones.
      parts: progress
        ? linkProgressParts(progress, context, (terms) => `${tag.key} ${terms} -is:step -is:parked`, 'the tag’s')
        : [{ text: 'No tasks yet' }],
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
  if (!progress) {
    return {};
  }
  // The note's own tasks, steps aside, as they were counted.
  const counted = (terms: string): string => `path = ${quoteValue(file.filePath)} ${terms} -is:step`;
  return {
    taskProgress: {
      done: progress.done,
      total: progress.total,
      label: describeTagProgress(progress, context.now, context.taskPolicy),
      parts: linkProgressParts(progress, context, counted, 'this note’s'),
    },
  };
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
