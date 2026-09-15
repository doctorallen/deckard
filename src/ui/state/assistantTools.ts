import { formatIsoDate } from '../../core/markdown/taskMetadata';
import { TagInfo, WorkspaceIndex } from '../../core/types';
import {
  getQueryBlockSnapshot,
  QueryBlockItem,
  QueryBlockSort,
} from './queryBlockState';

/**
 * What Deckard answers when an AI assistant in VS Code calls one of its
 * language model tools.
 *
 * Every answer is read from the local index and returned as plain text for
 * the assistant to read. Deckard sends nothing anywhere; the assistant that
 * asked decides what happens to the answer.
 */

export const QUERY_TOOL_NAME = 'deckard_query';
export const TAGS_TOOL_NAME = 'deckard_list_tags';

const DEFAULT_QUERY_LIMIT = 25;
const MAX_QUERY_LIMIT = 200;
const DEFAULT_TAG_LIMIT = 50;
const MAX_TAG_LIMIT = 500;

/** How to write a query, sent back with a query that could not run. */
export const QUERY_SYNTAX_GUIDE = [
  'Deckard query syntax: conditions combine with AND, OR, NOT, and parentheses.',
  'tag = #project/atlas matches a tag, and tag = #risk/* a whole namespace; a bare #tag or @person also works.',
  'text ~ "vendor" matches words in note and task text.',
  'task = open, done, or any matches tasks only.',
  'due, scheduled, and start take a date such as 2026-09-20, today, tomorrow, a window such as 7d counted forward, or none.',
  'done = 7d matches tasks completed in the last seven days.',
  'priority takes highest, high, medium, none, low, or lowest, as in priority >= high.',
  'kind = project matches an entity namespace; file and path accept * and ? wildcards; created and updated take dates or windows such as 30d.',
  'Shorthands: is:open, is:done, is:overdue, is:due (open and due within seven days), is:task, is:note; has:due and no:due (also scheduled, start, done, priority); in:folder matches a folder and everything in it. Put - before one to negate it.',
  'Operators are = != ~ !~ > >= < <=.',
].join(' ');

export interface QueryToolInput {
  query: string;
  limit?: number;
  sort?: QueryBlockSort;
}

export interface TagsToolInput {
  search?: string;
  limit?: number;
}

/**
 * Reads a query tool call. VS Code checks input against the declared
 * schema, but an extension can call a tool directly, so it is checked again.
 */
export function readQueryToolInput(value: unknown): QueryToolInput | undefined {
  if (!isRecord(value) || typeof value.query !== 'string') {
    return undefined;
  }
  return {
    query: value.query,
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
    ...(value.sort === 'title' ||
    value.sort === 'created' ||
    value.sort === 'updated'
      ? { sort: value.sort }
      : {}),
  };
}

export function readTagsToolInput(value: unknown): TagsToolInput {
  if (!isRecord(value)) {
    return {};
  }
  return {
    ...(typeof value.search === 'string' ? { search: value.search } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

/**
 * Runs a Deckard query and lists what it matches: tasks first, since that is
 * what an assistant is most often asked for, then note sections. Each result
 * carries its path and line so the assistant can open or cite it.
 */
export function answerQuery(
  index: WorkspaceIndex,
  input: QueryToolInput,
): string {
  const limit = clampLimit(input.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
  const snapshot = getQueryBlockSnapshot(index, input.query, {
    limit,
    ...(input.sort ? { sort: input.sort } : {}),
    warnings: [],
  });
  const lines = [`Deckard query: ${snapshot.query}`];

  if (snapshot.hasError) {
    return [
      ...lines,
      '',
      'The query could not run:',
      ...snapshot.messages.map((message) => `- ${message.text}`),
      '',
      QUERY_SYNTAX_GUIDE,
    ].join('\n');
  }

  lines.push(
    `Found ${pluralize(snapshot.noteCount, 'note')} and ${pluralize(snapshot.taskCount, 'task')} (${snapshot.openTaskCount} open).`,
  );
  snapshot.messages
    .filter((message) => message.severity === 'warning')
    .forEach((message) => lines.push(`Warning: ${message.text}`));

  if (snapshot.tasks.length > 0) {
    lines.push('', 'Tasks:', ...snapshot.tasks.map(formatTask));
    if (snapshot.taskCount > snapshot.tasks.length) {
      lines.push(
        `Showing the first ${snapshot.tasks.length} of ${snapshot.taskCount} tasks.`,
      );
    }
  }
  if (snapshot.notes.length > 0) {
    lines.push('', 'Notes:', ...snapshot.notes.map(formatNote));
    if (snapshot.noteCount > snapshot.notes.length) {
      lines.push(
        `Showing the first ${snapshot.notes.length} of ${snapshot.noteCount} notes.`,
      );
    }
  }

  if (snapshot.noteCount === 0 && snapshot.taskCount === 0) {
    lines.push(
      '',
      `Nothing matches. If a tag name was a guess, ${TAGS_TOOL_NAME} lists the tags that exist.`,
    );
  } else {
    if (
      snapshot.taskCount > snapshot.tasks.length ||
      snapshot.noteCount > snapshot.notes.length
    ) {
      lines.push(
        `Ask with a higher limit (up to ${MAX_QUERY_LIMIT}) or a narrower query to see more.`,
      );
    }
    lines.push(
      '',
      'Paths are relative to the workspace, and each ends with its one-based line.',
    );
  }
  return lines.join('\n');
}

/**
 * Lists tags, most used first, so an assistant can find the exact tag to
 * query instead of guessing at a name.
 */
export function answerTags(
  index: WorkspaceIndex,
  input: TagsToolInput,
): string {
  const search = (input.search ?? '').trim().toLowerCase().replace(/^[#@]/, '');
  const matches = [...index.tags.values()]
    .filter(
      (tag) =>
        !search ||
        tag.key.toLowerCase().includes(search) ||
        tag.label.toLowerCase().includes(search),
    )
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
  const limit = clampLimit(input.limit, DEFAULT_TAG_LIMIT, MAX_TAG_LIMIT);
  const shown = matches.slice(0, limit);

  if (matches.length === 0) {
    return search
      ? `No tag matches "${input.search?.trim()}". Call ${TAGS_TOOL_NAME} without a search to see every tag.`
      : 'The workspace has no tags yet.';
  }

  const lines = [
    search
      ? `${pluralize(matches.length, 'tag')} match "${input.search?.trim()}".`
      : `The workspace has ${pluralize(matches.length, 'tag')}.`,
    shown.length < matches.length
      ? `The ${shown.length} most used:`
      : 'Most used first:',
    ...shown.map(formatTag),
  ];
  if (shown.length < matches.length) {
    lines.push(
      `Ask with a search or a higher limit (up to ${MAX_TAG_LIMIT}) to see the rest.`,
    );
  }
  lines.push(
    '',
    `Query a tag with ${QUERY_TOOL_NAME}, for example: tag = ${shown[0].label} AND task = open`,
  );
  return lines.join('\n');
}

function formatTask(item: QueryBlockItem): string {
  const details = [
    item.dueAt !== undefined
      ? `due ${formatIsoDate(item.dueAt)}`
      : item.dueText
        ? `due ${item.dueText}`
        : '',
    item.scheduledAt !== undefined
      ? `scheduled ${formatIsoDate(item.scheduledAt)}`
      : '',
    item.priority ? `${item.priority} priority` : '',
    item.recurrence ? `repeats ${item.recurrence}` : '',
  ].filter(Boolean);
  return `- [${item.completed ? 'x' : ' '}] ${item.title}${
    details.length > 0 ? ` — ${details.join(', ')}` : ''
  } — ${formatLocation(item)}`;
}

function formatNote(item: QueryBlockItem): string {
  return `- ${item.title} — ${formatLocation(item)}`;
}

function formatLocation(item: QueryBlockItem): string {
  const headings =
    item.context.length > 0 ? ` (under ${item.context.join(' > ')})` : '';
  return `${item.filePath}:${item.line}${headings}`;
}

function formatTag(tag: TagInfo): string {
  const hub = tag.hubFilePaths?.[0];
  return `- ${tag.label} — ${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}${
    hub ? `, described by ${hub}` : ''
  }`;
}

function clampLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
