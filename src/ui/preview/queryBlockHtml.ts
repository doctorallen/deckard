import type MarkdownIt from 'markdown-it';

import { formatIsoDate, describeDueDate } from '../../domain/markdown/taskMetadata';
import { QueryContext } from '../../domain/query/queryContext';
import { WorkspaceIndex } from '../../core/types';
import { createPreviewSourceHref } from '../../domain/markdown/sourceLinks';
import {
  getQueryBlockSnapshot,
  describeQueryBlockCounts,
  parseQueryBlockInfo,
  QueryBlockItem,
  QueryBlockMessage,
  QueryBlockOptions,
  QueryBlockSnapshot,
  toTableTask,
} from '../state/queryBlockState';
import {
  createTaskCells,
  DEFAULT_TASK_COLUMNS,
  getTaskColumn,
  TaskColumnId,
} from '../state/resultTable';
import { escapeHtml, escapeHtmlText } from '../../shared/html';
import { tokenizeInlineWithoutWikiLinks } from '../../domain/markdown/inline';
import type { InlineToken } from '../../domain/model/inline';

export { createPreviewSourceHref } from '../../domain/markdown/sourceLinks';

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
  /** The namespace of status tags, from `deckard.board.statusNamespace`. */
  getStatusNamespace?(): string;
  /** The settings a block is evaluated in, for a render made at `now`. */
  getQueryContext(now: number): QueryContext;
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
    const [tokens, index] = args;
    const token = tokens[index];
    const blockOptions = parseQueryBlockInfo(token.info);
    if (!blockOptions) {
      return fallback(...args);
    }
    source.onDidRender?.();
    return renderQueryBlockHtml(token.content, blockOptions, source.getIndex(), {
      queryContext: source.getQueryContext(Date.now()),
      sourceLine: token.map?.[0],
      statusNamespace: source.getStatusNamespace?.(),
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
  /** The namespace of status tags; `status` unless given. */
  statusNamespace?: string;
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
    statusNamespace: rendering.statusNamespace ?? 'status',
  });
  return [
    open,
    renderHeader(
      snapshot.query,
      snapshot.hasError ? undefined : describeQueryBlockCounts(snapshot),
    ),
    ...snapshot.messages.map(renderMessage),
    ...(snapshot.hasError ? [] : renderResults(snapshot, options, queryContext)),
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
): string[] {
  if (snapshot.noteCount === 0 && snapshot.taskCount === 0) {
    return ['<p class="deckard-query-message">Nothing matches this query yet.</p>'];
  }
  return [
    ...renderGroup(
      { kind: 'notes', label: 'Notes', items: snapshot.notes, total: snapshot.noteCount },
      renderNote,
    ),
    ...(options.view === 'table'
      ? renderTaskTable(snapshot, options.columns ?? [...DEFAULT_TASK_COLUMNS], context)
      : renderGroup(
          { kind: 'tasks', label: 'Tasks', items: snapshot.tasks, total: snapshot.taskCount },
          (item) => renderTask(item, context),
        )),
  ];
}

/**
 * The tasks as a table, one column per field named. The title cell keeps the
 * checkbox and the link to the source line; the rest are the cells the shared
 * column model makes, so a due date is overdue here the way it is on the
 * board. Notes stay a list above it: they have no columns of their own yet.
 */
function renderTaskTable(
  snapshot: QueryBlockSnapshot,
  columns: readonly TaskColumnId[],
  context: QueryContext,
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
        return `${open}<span class="deckard-query-checkbox" role="img" aria-label="${done ? 'Done' : 'Open'}">${done ? '☑' : '☐'}</span> ${renderLink(item)}</td>`;
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
function renderTask(item: QueryBlockItem, context: QueryContext): string {
  const done = item.completed === true;
  const details = [
    renderTaskDue(item, context),
    item.scheduledAt === undefined
      ? ''
      : `scheduled ${formatIsoDate(item.scheduledAt)}`,
    item.priority ? renderPriority(item.priority) : '',
    item.recurrence ? `repeats ${escapeHtml(item.recurrence)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    `<li class="deckard-query-item deckard-query-task${done ? ' is-done' : ''}">`,
    `<span class="deckard-query-checkbox" role="img" aria-label="${done ? 'Done' : 'Open'}">${done ? '☑' : '☐'}</span>`,
    '<div class="deckard-query-body">',
    renderLink(item),
    renderMeta(item, details),
    '</div>',
    '</li>',
  ].join('');
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
    return item.dueText ? `<span class="deckard-query-due">${escapeHtml(`due ${item.dueText}`)}</span>` : '';
  }
  const due = describeDueDate(item.dueAt, now, taskPolicy, item.dueText);
  if (!due.label) {
    return '';
  }
  const overdue = item.dueAt < startOfDay(now) && !due.stale;
  return `<span class="deckard-query-due${dueClass(overdue, due.stale)}">${escapeHtml(due.label)}</span>`;
}

/** The class a due date adds: overdue wins over stale, and neither adds none. */
function dueClass(overdue: boolean, stale: boolean | undefined): string {
  if (overdue) {
    return ' is-overdue';
  }
  return stale ? ' is-stale' : '';
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
