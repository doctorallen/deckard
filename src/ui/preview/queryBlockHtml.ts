import MarkdownIt = require('markdown-it');

import { formatIsoDate } from '../../core/markdown/taskMetadata';
import { WorkspaceIndex } from '../../core/types';
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
import { renderMarkdownInline } from '../webview/rendering';
import {
  createTaskCells,
  DEFAULT_TASK_COLUMNS,
  getTaskColumn,
  TaskColumnId,
} from '../state/resultTable';

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
  const fallback: FenceRule =
    md.renderer.rules.fence ??
    ((tokens, index, options, _env, self) =>
      self.renderToken(tokens, index, options));

  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const blockOptions = parseQueryBlockInfo(token.info);
    if (!blockOptions) {
      return fallback(tokens, index, options, env, self);
    }
    source.onDidRender?.();
    return renderQueryBlockHtml(
      token.content,
      blockOptions,
      source.getIndex(),
      token.map?.[0],
      Date.now(),
      source.getStatusNamespace?.(),
    );
  };
  return md;
}

/**
 * Renders one block. `sourceLine` is the zero-based line of the opening fence,
 * which the preview uses to keep scrolling in step with the editor.
 */
export function renderQueryBlockHtml(
  queryText: string,
  options: QueryBlockOptions,
  index: WorkspaceIndex | undefined,
  sourceLine?: number,
  now: number = Date.now(),
  statusNamespace = 'status',
): string {
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

  const snapshot = getQueryBlockSnapshot(index, queryText, options, statusNamespace);
  return [
    open,
    renderHeader(
      snapshot.query,
      snapshot.hasError ? undefined : describeQueryBlockCounts(snapshot),
    ),
    ...snapshot.messages.map(renderMessage),
    ...(snapshot.hasError ? [] : renderResults(snapshot, options, now)),
    '</div>',
  ].join('');
}

/**
 * Links a result to its source line.
 *
 * Deckard keys files by workspace-relative path, and the preview resolves a
 * link that starts with `/` against the workspace folder, so the key needs no
 * translation. `#L12` is the line fragment the preview understands.
 */
export function createPreviewSourceHref(filePath: string, line: number): string {
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  return `/${path}#L${Math.max(1, line)}`;
}

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

function renderMessage(message: QueryBlockMessage): string {
  const className =
    message.severity === 'error'
      ? 'deckard-query-message is-error'
      : 'deckard-query-message';
  return `<p class="${className}">${escapeHtml(message.text)}</p>`;
}

function renderResults(
  snapshot: QueryBlockSnapshot,
  options: QueryBlockOptions,
  now: number,
): string[] {
  if (snapshot.noteCount === 0 && snapshot.taskCount === 0) {
    return ['<p class="deckard-query-message">Nothing matches this query yet.</p>'];
  }
  return [
    ...renderGroup('notes', 'Notes', snapshot.notes, snapshot.noteCount, renderNote),
    ...(options.view === 'table'
      ? renderTaskTable(snapshot, options.columns ?? [...DEFAULT_TASK_COLUMNS], now)
      : renderGroup('tasks', 'Tasks', snapshot.tasks, snapshot.taskCount, (item) =>
          renderTask(item, now),
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
  now: number,
): string[] {
  if (snapshot.tasks.length === 0) {
    return [];
  }
  const head = columns
    .map((column) => `<th scope="col">${escapeHtml(getTaskColumn(column).label)}</th>`)
    .join('');
  const rows = snapshot.tasks.map((item) => {
    const done = item.completed === true;
    const cells = createTaskCells(toTableTask(item), columns, now).map((cell, at) => {
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

/**
 * One labelled list. The label keeps notes and tasks apart, and the footer
 * says when `limit` has hidden some of them.
 */
function renderGroup(
  kind: 'notes' | 'tasks',
  label: string,
  items: QueryBlockItem[],
  total: number,
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

/**
 * Puts the checkbox in its own column so a wrapped title and its details line
 * up under the title rather than under the box.
 */
function renderTask(item: QueryBlockItem, now: number): string {
  const done = item.completed === true;
  const overdue =
    !done && item.dueAt !== undefined && item.dueAt < startOfDay(now);
  const details = [
    item.dueText
      ? `<span class="deckard-query-due${overdue ? ' is-overdue' : ''}">due ${escapeHtml(item.dueText)}</span>`
      : '',
    item.scheduledAt !== undefined
      ? `scheduled ${formatIsoDate(item.scheduledAt)}`
      : '',
    item.priority ? `${item.priority} priority` : '',
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

function renderLink(item: QueryBlockItem): string {
  const href = createPreviewSourceHref(item.filePath, item.line);
  return `<a class="deckard-query-title" href="${escapeHtml(href)}">${renderTitleHtml(item.title)}</a>`;
}

/**
 * A title as rendered inline Markdown, with any link inside it flattened to
 * its words. The whole title is already one link to the task's source, and an
 * anchor inside an anchor is not valid HTML: the browser closes the outer one
 * early and the rest of the row's title stops opening anything.
 */
function renderTitleHtml(title: string): string {
  return renderMarkdownInline(title).replace(/<a\b[^>]*>|<\/a>/g, '');
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

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
