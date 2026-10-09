import { parseWikiTarget } from '../../domain/index/backlinks';
import { findFencedLines } from '../../domain/markdown/lineShapes';
import { BLOCK_ID_PATTERN } from '../../domain/markdown/taskFields';
import { findWikiLinkSpans } from '../../domain/markdown/wikiLinks';
import { createSourceParser, findEmbedLines, resolveEmbed, withoutFrontmatter } from '../../domain/notes/embeds';
import { DEFAULT_NOTE_COLUMNS, noteColumnLabel } from '../../domain/notes/noteColumns';
import type { DateFormats } from '../../domain/markdown/dateFormat';
import { formatDueDate } from '../../domain/markdown/dueWording';
import { QueryContext } from '../../domain/query/queryContext';
import { WorkspaceIndex } from '../../domain/model';
import { createTaskCells, DEFAULT_TASK_COLUMNS, getTaskColumn } from './resultTable';
import {
  describeNoteCell,
  findQueryBlocks,
  getQueryBlockSnapshot,
  QueryBlockItem,
  QueryBlockOptions,
  toTableTask,
} from './queryBlockState';

/**
 * A note as plain Markdown, to paste where Deckard is not: a chat, an email,
 * a pull request. What only Deckard draws is written out as what it draws:
 * an embed is the text it names, a query block is its results as they stand,
 * and a `[[link]]` is its words. Front matter and `^markers`, which only
 * Deckard reads, are left out.
 */

/** How deep an embed inside an embed is written out, as the preview draws them. */
const MAX_EMBED_DEPTH = 3;

/** What a note is written out against. */
export interface PlainMarkdownContext {
  index: WorkspaceIndex;
  /** The moment and settings a query block's results are read at. */
  queryContext: QueryContext;
  /** The note being copied, by its index path: what `this` in its query blocks names. */
  notePath?: string;
}

/**
 * `text`, a note or a part of one, as plain Markdown. `documentSource` is
 * the whole note it is from, which an embed of one of its own headings
 * reads; it is `text` when the whole note is copied.
 */
export function toPlainMarkdown(
  text: string,
  context: PlainMarkdownContext,
  documentSource: string = text,
): string {
  // Front matter is the whole note's; a selection that starts with a rule
  // is not front matter, and keeps what follows it.
  const body = text === documentSource ? withoutFrontmatter(text) : text;
  return collapseBlankLines(writeOut(body, documentSource, context, 0)).replace(/^\n+/, '').trimEnd() + '\n';
}

/** Runs of blank lines as one, outside fenced code, where they are the code's own. */
function collapseBlankLines(text: string): string {
  const lines = text.split('\n');
  const fenced = findFencedLines(lines);
  return lines
    .filter((line, at) => fenced.has(at) || line.trim() !== '' || at === 0 || lines[at - 1].trim() !== '' || fenced.has(at - 1))
    .join('\n');
}

/** One piece of text written out, embeds `depth` deep already. */
function writeOut(text: string, documentSource: string, context: PlainMarkdownContext, depth: number): string {
  const lines = text.split(/\r?\n/);
  const replaced = new Map<number, { end: number; text: string }>();
  for (const block of findQueryBlocks(text)) {
    replaced.set(block.startLine, {
      end: block.endLine,
      text: writeQueryBlock(block.query, block.options, context),
    });
  }
  for (const embed of findEmbedLines(text)) {
    if (replaced.has(embed.line)) {
      continue;
    }
    replaced.set(embed.line, { end: embed.line, text: writeEmbed(embed.target, documentSource, context, depth) });
  }
  const fenced = findFencedLines(lines);
  const links = groupByLine(findWikiLinkSpans(text));
  const out: string[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const replacement = replaced.get(line);
    if (replacement) {
      // A blank line either side, so what follows is not read as part of a
      // list item, a table row, or the embed's last paragraph.
      out.push('', replacement.text, '');
      line = replacement.end;
      continue;
    }
    if (fenced.has(line)) {
      out.push(lines[line]);
      continue;
    }
    out.push(writeLine(lines[line], links.get(line) ?? []));
  }
  return out.join('\n');
}

/** The `[[links]]` of a text, by the line each is on. */
function groupByLine<T extends { line: number }>(spans: readonly T[]): Map<number, T[]> {
  const byLine = new Map<number, T[]>();
  for (const span of spans) {
    byLine.set(span.line, [...(byLine.get(span.line) ?? []), span]);
  }
  return byLine;
}

/**
 * One line with each `[[link]]` as its words, a `![[…]]` inside a sentence
 * the same, and a trailing `^marker` left out.
 */
function writeLine(text: string, links: ReadonlyArray<{ startColumn: number; endColumn: number; target: string }>): string {
  let written = text;
  for (const link of [...links].sort((left, right) => right.startColumn - left.startColumn)) {
    const whole = written.slice(link.startColumn, link.endColumn);
    const display = /\|([^\]]+)\]\]$/.exec(whole)?.[1];
    const start = link.startColumn > 0 && written[link.startColumn - 1] === '!' ? link.startColumn - 1 : link.startColumn;
    written = written.slice(0, start) + (display?.trim() || linkWords(link.target)) + written.slice(link.endColumn);
  }
  return written.replace(BLOCK_ID_PATTERN, '');
}

/** What a link reads as without its brackets: its note, and the heading it names after "›". */
export function linkWords(target: string): string {
  const { note, heading } = parseWikiTarget(target);
  if (heading && note) {
    return `${note} › ${heading}`;
  }
  return note || heading || target.replace(/^#\^?/, '');
}

/**
 * An embed written as what it names, its own embeds written out up to the
 * preview's depth; one that names nothing, or is too deep, is its words.
 */
function writeEmbed(target: string, documentSource: string, context: PlainMarkdownContext, depth: number): string {
  if (depth >= MAX_EMBED_DEPTH) {
    return linkWords(target);
  }
  const resolved = resolveEmbed(target, documentSource, context.index, createSourceParser());
  if (resolved.kind !== 'note') {
    return linkWords(target);
  }
  // An embed in what it names reads that note, not the part embedded here.
  const source = resolved.href ? /^\/(.*)#L\d+$/.exec(resolved.href)?.[1] : undefined;
  const sourcePath = source?.split('/').map(decodeURIComponent).join('/');
  const sourceContent = sourcePath ? context.index.files.get(sourcePath)?.content : undefined;
  return writeOut(resolved.content.trim(), sourceContent ?? documentSource, context, depth + 1);
}

/**
 * A query block as its results stand: its notes and tasks as lists, or as
 * tables for `view=table`, and a line saying how many more there are when
 * `limit` hid some. A query that cannot run is its query, as code.
 */
export function writeQueryBlock(query: string, options: QueryBlockOptions, context: PlainMarkdownContext): string {
  const snapshot = getQueryBlockSnapshot(context.index, query, options, {
    queryContext: context.queryContext,
    ...(context.notePath ? { notePath: context.notePath } : {}),
  });
  if (snapshot.hasError) {
    return `\`${query.trim()}\``;
  }
  if (snapshot.noteCount === 0 && snapshot.taskCount === 0) {
    return '_Nothing matches this search yet._';
  }
  const table = options.view === 'table';
  const parts = [
    ...(snapshot.notes.length ? [table ? writeNoteTable(snapshot.notes, options, context.queryContext.dateFormats) : snapshot.notes.map(writeNoteItem).join('\n')] : []),
    ...(snapshot.noteCount > snapshot.notes.length ? [`_Showing ${snapshot.notes.length} of ${snapshot.noteCount} notes._`] : []),
    ...(snapshot.tasks.length ? [table ? writeTaskTable(snapshot.tasks, options, context) : snapshot.tasks.map((item) => writeTaskItem(item, context.queryContext.dateFormats)).join('\n')] : []),
    ...(snapshot.taskCount > snapshot.tasks.length ? [`_Showing ${snapshot.tasks.length} of ${snapshot.taskCount} tasks._`] : []),
  ];
  return parts.join('\n\n');
}

/** A title with its `[[links]]` as their words, as the rest of the note is written. */
function plainTitle(title: string): string {
  return writeLine(title, findWikiLinkSpans(title));
}

/** A note as a list item: its title, and the note it is in when the title does not say. */
function writeNoteItem(item: QueryBlockItem): string {
  const stem = item.fileName.replace(/\.md$/i, '');
  const title = plainTitle(item.title);
  return item.title === stem ? `- ${title}` : `- ${title} (${stem})`;
}

/** A task as a list item, its box as it stands, its due date beside it in the reader's format. */
function writeTaskItem(item: QueryBlockItem, formats: DateFormats): string {
  const due = item.dueAt === undefined ? item.dueText ?? '' : formatDueDate(item.dueAt, item.dueText, formats);
  return `- [${item.completed ? 'x' : ' '}] ${plainTitle(item.title)}${due ? ` (due ${due})` : ''}`;
}

/** The notes as a Markdown table, in the block's note columns, their dates in the reader's format. */
function writeNoteTable(items: readonly QueryBlockItem[], options: QueryBlockOptions, formats: DateFormats): string {
  const columns = options.noteColumns ?? [...DEFAULT_NOTE_COLUMNS];
  return writeTable(
    columns.map((column) => noteColumnLabel(column)),
    items.map((item) => columns.map((column) => (column === 'title' ? plainTitle(item.title) : describeNoteCell(item, column, formats)))),
  );
}

/** The tasks as a Markdown table, in the block's task columns, the title with its box. */
function writeTaskTable(items: readonly QueryBlockItem[], options: QueryBlockOptions, context: PlainMarkdownContext): string {
  const columns = options.columns ?? [...DEFAULT_TASK_COLUMNS];
  return writeTable(
    columns.map((column) => getTaskColumn(column).label),
    items.map((item) =>
      createTaskCells(toTableTask(item), columns, context.queryContext).map((cell, at) =>
        columns[at] === 'title' ? `${item.completed ? '☑' : '☐'} ${plainTitle(cell.text)}` : cell.text,
      ),
    ),
  );
}

/**
 * A pipe table, each cell's own pipes escaped so they stay in it, and its
 * backslashes first, so a cell that ends in one does not take the escape
 * off the pipe after it.
 */
function writeTable(head: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const cellText = (cell: string): string => cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  const row = (cells: readonly string[]): string => `| ${cells.map(cellText).join(' | ')} |`;
  return [row(head), `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(row)].join('\n');
}
