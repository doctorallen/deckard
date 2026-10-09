import type MarkdownIt from 'markdown-it';

import { QueryContext } from '../../domain/query/queryContext';
import { createPreviewSourceHref } from '../../domain/markdown/sourceLinks';
import {
  getQueryBlockSnapshot,
  describeQueryBlockCounts,
  describeNoteCell,
  parseQueryBlockInfo,
  QueryBlockItem,
  QueryBlockMessage,
  QueryBlockOptions,
  QueryBlockSnapshot,
  toTableTask,
} from '../state/queryBlockState';
import { createTaskCells, DEFAULT_TASK_COLUMNS, getTaskColumn } from '../state/resultTable';
import { escapeHtml, escapeHtmlText } from '../../shared/html';
import { tokenizeInlineWithoutWikiLinks } from '../../domain/markdown/inline';
import type { InlineToken } from '../../domain/model/inline';
import { WorkspaceIndex, TaskColumnId } from '../../domain/model';
import { describeDueDate, formatDueDate } from '../../domain/markdown/dueWording';
import { type DateFormats, formatDisplayDate } from '../../domain/markdown/dateFormat';
import { DEFAULT_NOTE_COLUMNS, NoteColumnId, noteColumnLabel } from '../../domain/notes/noteColumns';
import { speakProgressText } from '../../domain/tasks/progressCount';

/** markdown-it's rule for a fenced block, which the query block rule wraps. */
type FenceRule = NonNullable<MarkdownIt['renderer']['rules']['fence']>;

/**
 * What the preview renderer needs from the extension host.
 */
export interface QueryBlockPreviewSource {
  /** Undefined until the first workspace scan finishes. */
  getIndex(): WorkspaceIndex | undefined;
  /** Called whenever a block renders, so the host knows a preview reads the index. */
  onDidRender?(): void;
  /** The settings a block is evaluated in, for a render made at `now`. */
  getQueryContext(now: number): QueryContext;
  /**
   * The index's path for the note a render draws, read from markdown-it's
   * `env`, which `this` in a block's query names; undefined when unknown.
   */
  getNotePath?(env: unknown): string | undefined;
  /**
   * The link a task's checkbox opens, which puts the task in the state the
   * box offers; without one, the box is drawn and does nothing.
   */
  getTaskHref?(item: QueryBlockItem): string | undefined;
}

/**
 * Draws ```deckard fences as their results.
 *
 * Every other fence goes to the rule that was installed before, so VS Code's
 * syntax highlighting and any other extension's fence handling still apply.
 */
export function addQueryBlockRenderer(
  md: MarkdownIt,
  source: QueryBlockPreviewSource,
): MarkdownIt {
  // markdown-it calls a rule with five arguments, so they are taken as one
  // rest tuple and handed on unchanged.
  const fallback: FenceRule =
    md.renderer.rules.fence ??
    ((...[tokens, index, options, , self]: Parameters<FenceRule>) =>
      self.renderToken(tokens, index, options));

  md.renderer.rules.fence = (...args) => {
    const [tokens, index, , env] = args;
    const token = tokens[index];
    const blockOptions = parseQueryBlockInfo(token.info);
    if (!blockOptions) {
      return fallback(...args);
    }
    source.onDidRender?.();
    const notePath = source.getNotePath?.(env);
    return renderQueryBlockHtml(token.content, blockOptions, source.getIndex(), {
      queryContext: source.getQueryContext(Date.now()),
      sourceLine: token.map?.[0],
      ...(notePath ? { notePath } : {}),
      ...(source.getTaskHref ? { taskHref: (item: QueryBlockItem) => source.getTaskHref?.(item) } : {}),
    });
  };
  return md;
}

/** How one block is rendered, beyond its query and options. */
export interface QueryBlockRendering {
  /** The settings and moment the block is evaluated, and its dates worded, in. */
  queryContext: QueryContext;
  /**
   * The zero-based line of the opening fence, which the preview uses to keep
   * scrolling in step with the editor.
   */
  sourceLine?: number;
  /** The link a task's checkbox opens; the box does nothing without one. */
  taskHref?: (item: QueryBlockItem) => string | undefined;
  /** The note the block is in, by its index path: what `this` in its query names. */
  notePath?: string;
}

/** Renders one block, in the rendering's context. */
export function renderQueryBlockHtml(
  queryText: string,
  options: QueryBlockOptions,
  index: WorkspaceIndex | undefined,
  rendering: QueryBlockRendering,
): string {
  const { queryContext, sourceLine } = rendering;
  const open =
    sourceLine === undefined
      ? '<div class="deckard-query">'
      : `<div class="deckard-query code-line" data-line="${sourceLine}">`;

  if (!index) {
    return [
      open,
      renderHeader(queryText.trim()),
      '<p class="deckard-query-message">Deckard is indexing the workspace…</p>',
      '</div>',
    ].join('');
  }

  const snapshot = getQueryBlockSnapshot(index, queryText, options, {
    queryContext,
    ...(rendering.notePath ? { notePath: rendering.notePath } : {}),
  });
  return [
    open,
    renderHeader(
      snapshot.query,
      snapshot.hasError ? undefined : describeQueryBlockCounts(snapshot),
    ),
    ...snapshot.messages.map(renderMessage),
    ...(snapshot.hasError ? [] : renderResults(snapshot, options, queryContext, rendering.taskHref)),
    '</div>',
  ].join('');
}

/** The block's label and query, and its counts when the query ran without error. */
function renderHeader(query: string, counts?: string): string {
  return [
    '<div class="deckard-query-header">',
    '<span class="deckard-query-label">Deckard query</span>',
    query ? `<code class="deckard-query-text">${escapeHtml(query)}</code>` : '',
    counts
      ? `<span class="deckard-query-count">${escapeHtml(counts)}</span>`
      : '',
    '</div>',
  ].join('');
}

/** A warning or error from evaluating the query; an error is marked so it reads as one. */
function renderMessage(message: QueryBlockMessage): string {
  const className =
    message.severity === 'error'
      ? 'deckard-query-message is-error'
      : 'deckard-query-message';
  return `<p class="${className}">${escapeHtml(message.text)}</p>`;
}

/**
 * The notes, then the tasks as a list or a table, or one line saying nothing
 * matches when there are neither.
 */
function renderResults(
  snapshot: QueryBlockSnapshot,
  options: QueryBlockOptions,
  context: QueryContext,
  taskHref?: (item: QueryBlockItem) => string | undefined,
): string[] {
  if (snapshot.noteCount === 0 && snapshot.taskCount === 0) {
    return ['<p class="deckard-query-message">Nothing matches this query yet.</p>'];
  }
  return [
    ...(options.view === 'table'
      ? renderNoteTable(snapshot, options.noteColumns ?? [...DEFAULT_NOTE_COLUMNS], context.dateFormats)
      : renderGroup(
          { kind: 'notes', label: 'Notes', items: snapshot.notes, total: snapshot.noteCount },
          renderNote,
        )),
    ...(options.view === 'table'
      ? renderTaskTable(snapshot, options.columns ?? [...DEFAULT_TASK_COLUMNS], context, taskHref)
      : renderGroup(
          { kind: 'tasks', label: 'Tasks', items: snapshot.tasks, total: snapshot.taskCount },
          (item) => renderTask(item, context, taskHref),
        )),
  ];
}

/**
 * The notes as a table, one column per field named: the title cell links to
 * the entry's line, the rest are what the index knows of it. An empty cell
 * is left empty rather than saying "0" or "none", so what a note does have
 * stands out down a column.
 */
function renderNoteTable(snapshot: QueryBlockSnapshot, columns: readonly NoteColumnId[], formats: DateFormats): string[] {
  if (snapshot.notes.length === 0) {
    return [];
  }
  const head = columns.map((column) => `<th scope="col">${escapeHtml(noteColumnLabel(column))}</th>`).join('');
  const rows = snapshot.notes.map((item) => {
    const cells = columns.map((column) =>
      column === 'title' ? `<td>${renderLink(item)}</td>` : renderTextCell(describeNoteCell(item, column, formats)),
    );
    return `<tr class="deckard-query-row">${cells.join('')}</tr>`;
  });
  return [
    '<div class="deckard-query-group deckard-query-notes">',
    '<div class="deckard-query-group-title">Notes</div>',
    '<table class="deckard-query-table">',
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>${rows.join('')}</tbody>`,
    '</table>',
    snapshot.noteCount > snapshot.notes.length
      ? `<p class="deckard-query-message">Showing ${snapshot.notes.length} of ${snapshot.noteCount} notes.</p>`
      : '',
    '</div>',
  ];
}

/**
 * The tasks as a table, one column per field named. The title cell keeps the
 * checkbox and the link to the source line; the rest are the cells the shared
 * column model makes, so a due date is overdue here the way it is on the
 * board.
 */
function renderTaskTable(
  snapshot: QueryBlockSnapshot,
  columns: readonly TaskColumnId[],
  context: QueryContext,
  taskHref?: (item: QueryBlockItem) => string | undefined,
): string[] {
  if (snapshot.tasks.length === 0) {
    return [];
  }
  const head = columns
    .map((column) => `<th scope="col">${escapeHtml(getTaskColumn(column).label)}</th>`)
    .join('');
  const rows = snapshot.tasks.map((item) => {
    const done = item.completed === true;
    const cells = createTaskCells(toTableTask(item), columns, context).map((cell, at) => {
      const classes = [cell.kind === 'overdue' ? 'is-overdue' : '', cell.kind === 'muted' ? 'is-muted' : '']
        .filter(Boolean)
        .join(' ');
      const open = classes ? `<td class="${classes}">` : '<td>';
      if (columns[at] === 'title') {
        return `${open}${renderCheckbox(item, taskHref?.(item))} ${renderLink(item)}</td>`;
      }
      return `${open}${escapeHtml(cell.text)}</td>`;
    });
    return `<tr class="deckard-query-row${done ? ' is-done' : ''}">${cells.join('')}</tr>`;
  });
  return [
    '<div class="deckard-query-group deckard-query-tasks">',
    '<div class="deckard-query-group-title">Tasks</div>',
    '<table class="deckard-query-table">',
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>${rows.join('')}</tbody>`,
    '</table>',
    snapshot.taskCount > snapshot.tasks.length
      ? `<p class="deckard-query-message">Showing ${snapshot.tasks.length} of ${snapshot.taskCount} tasks.</p>`
      : '',
    '</div>',
  ];
}

/** One list of results: its kind, its label, the items shown, and how many matched. */
interface ResultGroup {
  kind: 'notes' | 'tasks';
  label: string;
  items: QueryBlockItem[];
  total: number;
}

/**
 * One labeled list. The label keeps notes and tasks apart, and the footer
 * says when `limit` has hidden some of them.
 */
function renderGroup(
  { kind, label, items, total }: ResultGroup,
  renderItem: (item: QueryBlockItem) => string,
): string[] {
  if (items.length === 0) {
    return [];
  }
  return [
    `<div class="deckard-query-group deckard-query-${kind}">`,
    `<div class="deckard-query-group-title">${label}</div>`,
    '<ul class="deckard-query-list">',
    ...items.map(renderItem),
    '</ul>',
    total > items.length
      ? `<p class="deckard-query-message">Showing ${items.length} of ${total} ${label.toLowerCase()}.</p>`
      : '',
    '</div>',
  ];
}

/**
 * Each result is its own row: the title, then where it lives on a smaller
 * line beneath, so a long title never runs into the next result.
 */
function renderNote(item: QueryBlockItem): string {
  return `<li class="deckard-query-item">${renderLink(item)}${renderMeta(item)}</li>`;
}

/** The arrow each known priority is drawn with; medium has none. */
const PRIORITY_MARKS: Record<string, string> = { highest: '↑↑', high: '↑', medium: '', low: '↓', lowest: '↓↓' };

/**
 * A task's priority as the badge the pages draw: an arrow and the word. A
 * priority Deckard does not know is written out as text, without a badge.
 */
function renderPriority(priority: string): string {
  const key = priority.toLowerCase();
  if (!(key in PRIORITY_MARKS)) {
    return escapeHtml(`${priority} priority`);
  }
  const word = key.charAt(0).toUpperCase() + key.slice(1);
  const mark = PRIORITY_MARKS[key];
  return `<span class="deckard-query-priority priority-${key}" title="${word} priority">${mark ? `<span aria-hidden="true">${mark}</span> ` : ''}${word}</span>`;
}

/**
 * One task row, its due date worded against the context's today and policy.
 * The checkbox sits in its own column so a wrapped title and its details line
 * up under the title rather than under the box.
 */
function renderTask(
  item: QueryBlockItem,
  context: QueryContext,
  taskHref?: (item: QueryBlockItem) => string | undefined,
): string {
  const done = item.completed === true;
  const details = [
    renderTaskDue(item, context),
    item.scheduledAt === undefined
      ? ''
      : `scheduled ${formatDisplayDate(item.scheduledAt, context.dateFormats)}`,
    item.priority ? renderPriority(item.priority) : '',
    item.recurrence ? `repeats ${escapeHtml(item.recurrence)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    `<li class="deckard-query-item deckard-query-task${done ? ' is-done' : ''}">`,
    renderCheckbox(item, taskHref?.(item)),
    '<div class="deckard-query-body">',
    renderLink(item),
    renderMeta(item, details),
    '</div>',
    '</li>',
  ].join('');
}

/**
 * A task's checkbox: with a link, one that completes or reopens the task
 * when selected, named for what it does; without one, a picture of the
 * task's state.
 */
function renderCheckbox(item: QueryBlockItem, href: string | undefined): string {
  const done = item.completed === true;
  // Closed, a cancelled task is checked too; in progress is half way.
  const closed = done || item.cancelled === true;
  const mixed = !closed && item.statusType === 'inProgress';
  let mark = '☐';
  if (closed) {
    mark = item.cancelled ? '☒' : '☑';
  } else if (mixed) {
    mark = '◐';
  }
  const status = item.status ? `, ${item.status}` : '';
  const kind = item.cancelled ? ' is-cancelled' : '';
  if (!href) {
    return `<span class="deckard-query-checkbox${kind}" role="img" aria-label="${escapeHtml(`${closed ? 'Done' : 'Open'}${status}`)}">${mark}</span>`;
  }
  const action = `${closed ? 'Reopen' : 'Complete'} ${plainTitle(item.title)}${status}`;
  return `<a class="deckard-query-checkbox is-action${kind}" href="${escapeHtml(href)}" role="checkbox" aria-checked="${mixed ? 'mixed' : closed}" aria-label="${escapeHtml(action)}" title="${escapeHtml(action)}">${mark}</a>`;
}

/** A title's words without its Markdown marks, for a label. */
function plainTitle(title: string): string {
  return title.replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * A task's due date as its details' lead, or nothing when it has none. An
 * open task's due date reads beside today, "overdue 12 days · 2026-09-01",
 * so the state is in the words and not the color alone; a done task keeps
 * the date as written.
 */
function renderTaskDue(item: QueryBlockItem, context: QueryContext): string {
  const { now, taskPolicy } = context;
  const done = item.completed === true;
  if (item.dueAt === undefined || done) {
    const written = item.dueAt === undefined ? item.dueText : formatDueDate(item.dueAt, item.dueText, context.dateFormats);
    return written ? `<span class="deckard-query-due">${escapeHtml(`due ${written}`)}</span>` : '';
  }
  const due = describeDueDate(item.dueAt, now, taskPolicy, { dueText: item.dueText, formats: context.dateFormats });
  if (!due.label) {
    return '';
  }
  const overdue = item.dueAt < startOfDay(now) && !due.stale;
  return `<span class="deckard-query-due${dueClass(overdue, due.stale, due.days === 0)}">${escapeHtml(due.label)}</span>`;
}

/** The class a due date adds: overdue, stale, or due today; none for a later date. */
function dueClass(overdue: boolean, stale: boolean | undefined, today: boolean): string {
  if (overdue) {
    return ' is-overdue';
  }
  if (stale) {
    return ' is-stale';
  }
  return today ? ' is-today' : '';
}

/** An item's title, linked to its line in the source so a click opens it there. */
function renderLink(item: QueryBlockItem): string {
  const href = createPreviewSourceHref(item.filePath, item.line);
  return `<a class="deckard-query-title" href="${escapeHtml(href)}">${renderTitleHtml(item.title)}</a>`;
}

/**
 * A title as inline Markdown, written from its tokens, with any link inside
 * it flattened to its words. The whole title is already one link to the
 * task's source, and an anchor inside an anchor is not valid HTML: the
 * browser closes the outer one early and the rest of the row's title stops
 * opening anything.
 */
function renderTitleHtml(title: string): string {
  return writeInlineHtml(tokenizeInlineWithoutWikiLinks(title));
}

/**
 * Tokens as the HTML the preview has always been given for them: what
 * markdown-it wrote and sanitize-html kept, byte for byte. Text is escaped
 * as the sanitizer escaped it, quotes left as written; a line break is
 * `<br />` and the line's end; strikethrough, which the sanitizer stripped,
 * is its words; and a link is its words, flattened as above. The tokens are
 * read without wiki links, as markdown-it read them, so a wiki link token
 * never comes; were one to, it would be its words.
 */
function writeInlineHtml(tokens: readonly InlineToken[]): string {
  return tokens.map(writeInlineToken).join('');
}

/** One token as HTML, by the rules writeInlineHtml lists. */
function writeInlineToken(token: InlineToken): string {
  switch (token.kind) {
    case 'text':
    case 'wikiLink':
      return escapeHtmlText(token.text);
    case 'code':
      return `<code>${escapeHtmlText(token.text)}</code>`;
    case 'break':
      return '<br />\n';
    case 'strong':
      return `<strong>${writeInlineHtml(token.children)}</strong>`;
    case 'em':
      return `<em>${writeInlineHtml(token.children)}</em>`;
    case 'del':
    case 'link':
      return writeInlineHtml(token.children);
    case 'image':
      // Only the Note page reads images; a title shows its alt text.
      return escapeHtmlText(token.alt);
  }
}

/**
 * The line under a title: an optional lead such as a due date, then where the
 * item lives.
 */
function renderMeta(item: QueryBlockItem, lead = ''): string {
  const location = describeLocation(item);
  const parts = [lead, location ? escapeHtml(location) : ''].filter(Boolean);
  return parts.length > 0
    ? `<div class="deckard-query-meta">${parts.join(' · ')}</div>`
    : '';
}

/**
 * Says where an item lives. The file name is left out when the first heading
 * already says it, as a daily note's date heading does, and when the item is
 * already titled by its file name.
 */
function describeLocation(item: QueryBlockItem): string {
  const stem = item.fileName.replace(/\.md$/i, '');
  const showFileName =
    item.title !== item.fileName && item.context[0] !== stem;
  return [item.context.join(' › '), showFileName ? item.fileName : '']
    .filter(Boolean)
    .join(' · ');
}

/** Local midnight of the day a timestamp falls on. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** A table cell of text; one holding a progress figure says it to a screen reader as it is spoken. */
function renderTextCell(text: string): string {
  const spoken = speakProgressText(text);
  return spoken === text ? `<td>${escapeHtml(text)}</td>` : `<td aria-label="${escapeHtml(spoken)}">${escapeHtml(text)}</td>`;
}
