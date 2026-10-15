import { isObject } from '../../shared/guards';
import { pluralize } from '../../shared/text';
import { QueryContext } from '../../domain/query/queryContext';
import {
  getQueryBlockSnapshot,
  QueryBlockItem,
  QueryBlockSnapshot,
  QueryBlockSort,
} from './queryBlockState';
import {
  ADD_TASK_TOOL_NAME,
  AddTaskInput,
  ANSWER_QUESTION_TOOL_NAME,
  AnswerQuestionInput,
  CHANGE_TASK_TOOL_NAME,
  ChangeTaskInput,
  readAddTaskInput,
  readAnswerQuestionInput,
  readChangeTaskInput,
} from './assistantWriteInput';
import { listAllQuestions, questionText } from '../../domain/index/questions';
import { getHeadingPath } from '../../domain/ranking/entryLabels';
import { describeQuestionAge } from './questionsState';
import { TagInfo, WorkspaceIndex } from '../../domain/model';
import {
  answerDescribeTag,
  DESCRIBE_TAG_TOOL_NAME,
  describeWorkspaceTypes,
  readDescribeTagToolInput,
} from './assistantDescribe';
import { formatIsoDate } from '../../domain/markdown/calendar';

/**
 * What Deckard answers when an AI assistant in VS Code calls one of its
 * language model tools.
 *
 * Every answer is read from the local index and returned as plain text for
 * the assistant to read. Deckard sends nothing anywhere; the assistant that
 * asked decides what happens to the answer.
 */

/** The query tool's name, as the manifest declares it. */
export const QUERY_TOOL_NAME = 'deckard_query';
/** The tag-list tool's name, as the manifest declares it. */
export const TAGS_TOOL_NAME = 'deckard_list_tags';

/** How many query results an answer lists when the call does not say. */
const DEFAULT_QUERY_LIMIT = 25;
/** The most query results an answer lists, whatever the call asks for. */
const MAX_QUERY_LIMIT = 200;
/** How many tags an answer lists when the call does not say. */
const DEFAULT_TAG_LIMIT = 50;
/** The most tags an answer lists, whatever the call asks for. */
const MAX_TAG_LIMIT = 500;

/** How to write a query, sent back with a query that could not run. */
export const QUERY_SYNTAX_GUIDE = [
  'Deckard query syntax: conditions combine with AND, OR, NOT, and parentheses.',
  'tag = #project/atlas matches a tag, and tag = #risk/* a whole namespace; a bare #tag or @person also works.',
  'text ~ "vendor" matches words in note and task text.',
  'link = [[Atlas]], or a bare [[Atlas]], matches the entries that link to the note Atlas, by its name or an alias; [[Atlas#Decision]] matches links to one heading.',
  'task = open, done, or any matches tasks only.',
  'status:in-progress, status:waiting, or any status by its name (a hyphen for a space) matches tasks of that status, which is the character in the task\'s box, as [/] or [w]; a #status/… tag is only a tag. status:[/] matches a status by its character, and status:unknown the characters no status names.',
  'due, scheduled, and start take a date such as 2026-09-20, today, tomorrow, a weekday such as friday (the next one), a phrase such as "oct 3" or end-of-month, a whole week or month such as this-week or next-month, a window such as 7d counted forward, or none.',
  'done = 7d matches tasks completed in the last seven days, and cancelled = 7d those cancelled.',
  'priority takes highest, high, medium, none, low, or lowest, as in priority >= high.',
  'kind = project matches an entity namespace; file and path accept * and ? wildcards; created and updated take dates, a weekday such as friday (the last one), this-week, last-month, a month such as 2026-08, or windows such as 30d.',
  'Shorthands: is:open (to do, in progress, or on hold), is:in-progress, is:done, is:cancelled, is:closed (done or cancelled), is:overdue, is:due (open and due within seven days), is:today (what the Tasks view lists under Today), is:needs-date (open and more than 30 days past due), is:task, is:note, is:blocked (open and waiting for an open task, or marked Blocked), is:blocking (open and an open task waits for it), is:waiting (open and on hold, as Waiting or Someday, or assigned to someone else), is:available (open, not blocked, started, and not on hold), is:daily (written in a daily note), is:periodic (a daily, weekly, or monthly note), is:parked (in a parked folder or under a parked tag: left out of task lists unless asked for), is:step (a task written under another task), is:question (a - [?] line, which is not a task), is:unanswered (a question with no Answer: line under it), is:answered; has:due and no:due (also scheduled, start, done, cancelled, priority, id, dependsOn, steps: has:steps is a task broken into steps); in:folder matches a folder and everything in it. Put - before one to negate it.',
  'Operators are = != ~ !~ > >= < <=.',
].join(' ');

/** A query tool call, read: the query, and how many results in what order. */
export interface QueryToolInput {
  query: string;
  limit?: number;
  sort?: QueryBlockSort;
}

/** A tag-list call, read: words the tags must contain, and how many to list. */
export interface TagsToolInput {
  search?: string;
  limit?: number;
}

/**
 * Reads a query tool call. VS Code checks input against the declared
 * schema, but an extension can call a tool directly, so it is checked again.
 */
export function readQueryToolInput(value: unknown): QueryToolInput | undefined {
  if (!isObject(value) || typeof value.query !== 'string') {
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

/**
 * Reads a tag-list call. It never refuses: input that is not an object, or
 * fields of the wrong type, are left out, which lists every tag.
 */
export function readTagsToolInput(value: unknown): TagsToolInput {
  if (!isObject(value)) {
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
 * carries its path and line so the assistant can open or cite it. The query
 * is evaluated in `context`.
 */
export function answerQuery(
  index: WorkspaceIndex,
  input: QueryToolInput,
  context: QueryContext,
): string {
  const limit = clampLimit(input.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
  const snapshot = getQueryBlockSnapshot(index, input.query, {
    limit,
    ...(input.sort ? { sort: input.sort } : {}),
    warnings: [],
  }, { queryContext: context });
  // The workspace's types, which the manifest's fixed description cannot name.
  const typesLine = describeWorkspaceTypes(index);
  const lines = [`Deckard query: ${snapshot.query}`, ...(typesLine ? [typesLine] : [])];

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

  lines.push(describeFound(snapshot));
  snapshot.messages
    .filter((message) => message.severity === 'warning')
    .forEach((message) => lines.push(`Warning: ${message.text}`));
  listFound(lines, { heading: 'Tasks', items: snapshot.tasks, total: snapshot.taskCount }, formatTask);
  listFound(lines, { heading: 'Notes', items: snapshot.notes, total: snapshot.noteCount }, formatNote);
  listFound(lines, { heading: 'Questions', items: snapshot.questions, total: snapshot.questionCount }, formatQuestion);

  if (snapshot.noteCount === 0 && snapshot.taskCount === 0 && snapshot.questionCount === 0) {
    lines.push(
      '',
      `Nothing matches. If a tag name was a guess, ${TAGS_TOOL_NAME} lists the tags that exist.`,
    );
  } else {
    if (
      snapshot.taskCount > snapshot.tasks.length ||
      snapshot.noteCount > snapshot.notes.length ||
      snapshot.questionCount > snapshot.questions.length
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

/** What a query found, in one line: its notes and tasks, and its questions when it found any. */
function describeFound(snapshot: QueryBlockSnapshot): string {
  const tasks = `${pluralize(snapshot.taskCount, 'task')} (${snapshot.openTaskCount} open)`;
  if (snapshot.questionCount === 0) {
    return `Found ${pluralize(snapshot.noteCount, 'note')} and ${tasks}.`;
  }
  const open = snapshot.questions.filter((item) => !item.answered).length;
  return `Found ${pluralize(snapshot.noteCount, 'note')}, ${tasks}, and ${pluralize(snapshot.questionCount, 'question')} (${open} open).`;
}

/** One kind of result under its heading, and how many more there are, when it found any. */
function listFound(
  lines: string[],
  { heading, items, total }: { heading: 'Tasks' | 'Notes' | 'Questions'; items: readonly QueryBlockItem[]; total: number },
  format: (item: QueryBlockItem) => string,
): void {
  if (items.length === 0) {
    return;
  }
  lines.push('', `${heading}:`, ...items.map(format));
  if (total > items.length) {
    lines.push(`Showing the first ${items.length} of ${total} ${heading.toLowerCase()}.`);
  }
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

  const typesLine = describeWorkspaceTypes(index);
  const lines = [
    search
      ? `${pluralize(matches.length, 'tag')} match "${input.search?.trim()}".`
      : `The workspace has ${pluralize(matches.length, 'tag')}.`,
    ...(typesLine ? [typesLine] : []),
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
    `Describe one, with its fields when a type has it, with ${DESCRIBE_TAG_TOOL_NAME}.`,
  );
  return lines.join('\n');
}

/** A task's box as the answer writes it: done, cancelled, in progress, or open. */
function boxOf(item: QueryBlockItem): string {
  if (item.completed) {
    return 'x';
  }
  if (item.cancelled) {
    return '-';
  }
  return item.statusType === 'inProgress' ? '/' : ' ';
}

/** A task result as a checklist line: its box, title, dates, priority, and status, and where it is. */
function formatTask(item: QueryBlockItem): string {
  const details = [
    formatDue(item),
    item.scheduledAt === undefined
      ? ''
      : `scheduled ${formatIsoDate(item.scheduledAt)}`,
    item.priority ? `${item.priority} priority` : '',
    item.recurrence ? `repeats ${item.recurrence}` : '',
    item.status ? `status ${item.status}` : '',
  ].filter(Boolean);
  return `- [${boxOf(item)}] ${item.title}${
    details.length > 0 ? ` — ${details.join(', ')}` : ''
  } — ${formatLocation(item)}`;
}

/**
 * A task's due date as an answer words it: the date when it parses, the
 * words as written when they do not, and nothing when it has none.
 */
function formatDue(item: QueryBlockItem): string {
  if (item.dueAt !== undefined) {
    return `due ${formatIsoDate(item.dueAt)}`;
  }
  return item.dueText ? `due ${item.dueText}` : '';
}

/** A note section result as a list line: its title and where it is. */
function formatNote(item: QueryBlockItem): string {
  return `- ${item.title} — ${formatLocation(item)}`;
}

/** A question as a list line: `[?]` while open, its answer once it has one, and where it is. */
function formatQuestion(item: QueryBlockItem): string {
  return `- [?] ${item.title}${item.answer === undefined ? ' — open' : ` — answered: ${item.answer}`} — ${formatLocation(item)}`;
}

/** Where a result is, as `path:line`, with the headings it sits under, so the assistant can open or cite it. */
function formatLocation(item: QueryBlockItem): string {
  const headings =
    item.context.length > 0 ? ` (under ${item.context.join(' > ')})` : '';
  return `${item.filePath}:${item.line}${headings}`;
}

/** A tag as a list line: its label, how many entries carry it, and the note that describes it, when one does. */
function formatTag(tag: TagInfo): string {
  const hub = tag.hubFilePaths?.[0];
  return `- ${tag.label} — ${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}${
    hub ? `, described by ${hub}` : ''
  }`;
}

/**
 * A requested limit as a whole number from 1 to `max`; the fallback when the
 * call gave none, or a number that is not finite.
 */
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

/**
 * Which caller a tool answers. The language-model tools are VS Code's: they
 * ask the user first, the `deckard.assistantTools` setting turns them off,
 * and VS Code shows a progress line while they run. The MCP server has none
 * of that; a client on this computer calls it with its token. Each surface
 * words a refused input its own way and times its calls under its own names,
 * so the table carries one text of each for both.
 */
export type ToolSurface = 'languageModel' | 'mcp';

/** One text for each surface, which may be the same text twice. */
export type SurfaceText = Readonly<Record<ToolSurface, string>>;

/** What a tool answers: text for the assistant, and whether it was refused. */
export interface ToolAnswer {
  text: string;
  isError?: boolean;
}

/**
 * What the tools reach to answer, supplied by the surface: the index, the
 * settings a query is evaluated under, and the two writes, which need VS
 * Code's editor and so cannot live here.
 */
export interface ToolRunners {
  /** The index to answer from, read when a tool runs. */
  getSnapshot(): WorkspaceIndex;
  /** The query context, read from settings when a query runs. */
  readQueryContext(): QueryContext;
  /** Adds a task through the refactor preview, and says what happened. */
  addTask(input: AddTaskInput): Promise<ToolAnswer>;
  /** Changes a task through the refactor preview, and says what happened. */
  changeTask(input: ChangeTaskInput): Promise<ToolAnswer>;
  /** Writes an answer under a question through the refactor preview, and says what happened. */
  answerQuestion(input: AnswerQuestionInput): Promise<ToolAnswer>;
}

/**
 * A call whose input has been read: either bound and ready to run, or
 * refused, with the words each surface refuses it in.
 */
export type ToolCall<Result> =
  | { readonly kind: 'run'; readonly run: () => Result }
  | { readonly kind: 'invalid'; readonly text: SurfaceText };

/** One tool: its name, how each surface times it, and how a call is read. */
interface ToolEntry<Kind extends 'read' | 'write', Result> {
  readonly kind: Kind;
  /** The name the manifest declares, which both surfaces dispatch on. */
  readonly name: string;
  /** The operation each surface times a call under, in Deckard's log. */
  readonly measure: SurfaceText;
  /** The line VS Code shows while the tool runs; the MCP server has none. */
  readonly progressMessage: (value: unknown) => string;
  /** Reads a call's input and binds it to what the tool does with it. */
  readonly read: (value: unknown, runners: ToolRunners) => ToolCall<Result>;
}

/** A tool that answers from the index at once. */
export type ReadTool = ToolEntry<'read', string>;

/** A tool that writes a note, always through the refactor preview. */
export type WriteTool = ToolEntry<'write', Promise<ToolAnswer>>;

/** Any of Deckard's assistant tools. */
export type AssistantTool = ReadTool | WriteTool;

/** The question-list tool's name, as the manifest declares it. */
export const LIST_QUESTIONS_TOOL_NAME = 'deckard_list_questions';

/** The most questions the list tool lists, and how many it lists when not asked. */
const MAX_QUESTION_LIMIT = 100;
const DEFAULT_QUESTION_LIMIT = 30;

/** A question-list call, read: which questions, words they hold, and how many. */
export interface ListQuestionsInput {
  /** `open`, the default; `answered`; or `all`. */
  state?: 'open' | 'answered' | 'all';
  /** Words or a tag every question listed holds. */
  search?: string;
  limit?: number;
}

/** Reads a question-list call; anything it cannot read is left at its default. */
export function readListQuestionsInput(value: unknown): ListQuestionsInput {
  if (!isObject(value)) {
    return {};
  }
  const state = value.state === 'answered' || value.state === 'all' || value.state === 'open' ? value.state : undefined;
  const search = typeof value.search === 'string' && value.search.trim() ? value.search.trim().slice(0, 200) : undefined;
  return {
    ...(state ? { state } : {}),
    ...(search ? { search } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

/**
 * Lists questions, the open ones by default, oldest first: each with its
 * age, its answer once it has one, and its note and line, which
 * deckard_answer_question takes. `search` keeps those whose words or tags
 * hold every word it names.
 */
export function answerListQuestions(index: WorkspaceIndex, input: ListQuestionsInput, context: QueryContext): string {
  const state = input.state ?? 'open';
  const limit = clampLimit(input.limit, DEFAULT_QUESTION_LIMIT, MAX_QUESTION_LIMIT);
  const words = (input.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const found = listAllQuestions(index)
    .filter((question) => (state === 'all' ? true : (question.answer !== undefined) === (state === 'answered')))
    .filter((question) => {
      const text = `${question.title} ${question.tags.join(' ')}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  const noun = state === 'all' ? 'question' : `${state} question`;
  if (found.length === 0) {
    return `No ${noun}s${input.search ? ` match "${input.search}"` : ''}. A question is a line written - [?] in a note; it is answered by an indented line under it that starts with Answer:.`;
  }
  const lines = [
    `Found ${pluralize(found.length, noun)}${input.search ? ` matching "${input.search}"` : ''}.`,
    '',
    ...found.slice(0, limit).map((question) => {
      const section = question.sectionId ? index.sections.get(question.sectionId) : undefined;
      const headings = section ? ` (under ${getHeadingPath(section, index.sections).join(' > ')})` : '';
      const said = question.answer ? `answered: ${question.answer.text}` : describeQuestionAge(question, context.now, context.dateFormats);
      return `- [?] ${questionText(question)} — ${said} — ${question.filePath}:${question.lineNumber}${headings}`;
    }),
  ];
  if (found.length > limit) {
    lines.push(`Showing the first ${limit} of ${found.length}. Ask with a higher limit (up to ${MAX_QUESTION_LIMIT}) or a search to see more.`);
  }
  lines.push('', 'Paths are relative to the workspace, and each ends with its one-based line, which deckard_answer_question takes.');
  return lines.join('\n');
}

/** A describe call without a tag, refused alike on both surfaces. */
const DESCRIBE_INVALID_INPUT = 'Send a tag, a title, or a few words naming one as "tag", such as #team/rates, @dana, or Bond trading.';

/** A query call without a query, refused alike on both surfaces. */
const QUERY_INVALID_INPUT =
  'Send a Deckard query as "query", such as tag = #project/atlas AND task = open.';

/**
 * Deckard's five assistant tools, in the order VS Code registers them. The
 * language-model tools and the MCP server both dispatch through this one
 * table, so the tools cannot drift apart; what differs between the surfaces,
 * the refusals and the timing names, is written here side by side. The
 * add-task and change-task refusals were written differently for each
 * surface, VS Code's the longer, and each is kept as a client receives it.
 */
export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  {
    kind: 'read',
    name: QUERY_TOOL_NAME,
    measure: { languageModel: 'Assistant query', mcp: 'MCP query' },
    progressMessage: (value) =>
      `Searching Deckard notes and tasks: ${shorten(readQueryToolInput(value)?.query ?? '')}`,
    read: (value, runners) => {
      const input = readQueryToolInput(value);
      if (!input) {
        return {
          kind: 'invalid',
          text: { languageModel: QUERY_INVALID_INPUT, mcp: QUERY_INVALID_INPUT },
        };
      }
      return {
        kind: 'run',
        run: () => answerQuery(runners.getSnapshot(), input, runners.readQueryContext()),
      };
    },
  },
  {
    kind: 'read',
    name: TAGS_TOOL_NAME,
    measure: { languageModel: 'Assistant tag list', mcp: 'MCP tag list' },
    progressMessage: (value) => {
      const search = readTagsToolInput(value).search?.trim();
      return search ? `Listing Deckard tags matching ${shorten(search)}` : 'Listing Deckard tags';
    },
    // Any input lists tags; one that is not an object lists them all.
    read: (value, runners) => {
      const input = readTagsToolInput(value);
      return { kind: 'run', run: () => answerTags(runners.getSnapshot(), input) };
    },
  },
  {
    kind: 'read',
    name: DESCRIBE_TAG_TOOL_NAME,
    measure: { languageModel: 'Assistant describe tag', mcp: 'MCP describe tag' },
    progressMessage: (value) => {
      const tag = readDescribeTagToolInput(value)?.tag;
      return tag ? `Describing ${shorten(tag)} in Deckard` : 'Describing a Deckard tag';
    },
    read: (value, runners) => {
      const input = readDescribeTagToolInput(value);
      if (!input) {
        return { kind: 'invalid', text: { languageModel: DESCRIBE_INVALID_INPUT, mcp: DESCRIBE_INVALID_INPUT } };
      }
      return {
        kind: 'run',
        run: () => {
          const context = runners.readQueryContext();
          return answerDescribeTag(runners.getSnapshot(), input, context.now, context);
        },
      };
    },
  },
  {
    kind: 'write',
    name: ADD_TASK_TOOL_NAME,
    measure: { languageModel: 'Assistant add task', mcp: 'MCP add task' },
    progressMessage: (value) => {
      const input = readAddTaskInput(value);
      return input
        ? `Adding a task${input.note ? ` to ${input.note}` : " to today's note"}: ${shorten(input.text)}`
        : 'Adding a task';
    },
    read: (value, runners) => {
      const input = readAddTaskInput(value);
      if (!input) {
        return {
          kind: 'invalid',
          text: {
            languageModel:
              'Send the task\'s words as "text", and optionally a workspace-relative "note" to add it to; today\'s note otherwise.',
            mcp: 'Send the task\'s words as "text", and optionally a workspace-relative "note".',
          },
        };
      }
      return { kind: 'run', run: () => runners.addTask(input) };
    },
  },
  {
    kind: 'write',
    name: CHANGE_TASK_TOOL_NAME,
    measure: { languageModel: 'Assistant change task', mcp: 'MCP change task' },
    progressMessage: (value) => {
      const input = readChangeTaskInput(value);
      return input
        ? `Changing the task at ${input.note} line ${input.line}`
        : 'Changing a task';
    },
    read: (value, runners) => {
      const input = readChangeTaskInput(value);
      if (!input) {
        return {
          kind: 'invalid',
          text: {
            languageModel:
              'Send the task\'s "note" and "line" as deckard_query reports them, and at least one of: title, complete, status (a status by name, as "In progress" or "Cancelled", or by its character, as "[/]"), due (YYYY-MM-DD or null), priority (highest, high, medium, low, lowest, or null), assignee (a person tag, or null).',
            mcp: 'Send "note" and "line" as deckard_query reports them, and at least one change.',
          },
        };
      }
      return { kind: 'run', run: () => runners.changeTask(input) };
    },
  },
  {
    kind: 'read',
    name: LIST_QUESTIONS_TOOL_NAME,
    measure: { languageModel: 'Assistant question list', mcp: 'MCP question list' },
    progressMessage: (value) => {
      const input = readListQuestionsInput(value);
      return `Listing Deckard's ${input.state === 'all' ? '' : `${input.state ?? 'open'} `}questions${input.search ? ` matching ${shorten(input.search)}` : ''}`;
    },
    // Any input lists questions; one that is not an object lists the open ones.
    read: (value, runners) => {
      const input = readListQuestionsInput(value);
      return { kind: 'run', run: () => answerListQuestions(runners.getSnapshot(), input, runners.readQueryContext()) };
    },
  },
  {
    kind: 'write',
    name: ANSWER_QUESTION_TOOL_NAME,
    measure: { languageModel: 'Assistant answer question', mcp: 'MCP answer question' },
    progressMessage: (value) => {
      const input = readAnswerQuestionInput(value);
      return input ? `Answering the question at ${input.note} line ${input.line}` : 'Answering a question';
    },
    read: (value, runners) => {
      const input = readAnswerQuestionInput(value);
      if (!input) {
        return {
          kind: 'invalid',
          text: {
            languageModel:
              'Send the question\'s "note" and "line" as deckard_list_questions reports them, and the answer\'s words as "answer", up to 500 characters.',
            mcp: 'Send "note" and "line" as deckard_list_questions reports them, and "answer".',
          },
        };
      }
      return { kind: 'run', run: () => runners.answerQuestion(input) };
    },
  },
];

/** A tool's input cut to 80 characters for a one-line progress message. */
function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
