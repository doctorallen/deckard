import { EntityNamespaceAliases, isPersonTag } from '../../domain/markdown/parser';
import { canAppendTerm, getTopLevelJoin, getTopLevelTerms } from '../../domain/query/queryEdit';
import { countTagMatches } from '../../domain/query/queryEvaluator';
import { QueryContext } from '../../domain/query/queryContext';
import {
  collectQueryTagKeys,
  getQueryTypeKeys,
  quoteValue,
  toBuilderTree,
  visitFieldConditions,
} from '../../domain/query/queryFormat';
import { FIELD_ALIASES } from '../../domain/query/queryParser';
import { parseWorkspaceQuery } from '../../domain/types/typeQueryFields';
import {
  ParsedQuery,
  QUERY_FIELD_OPERATORS,
  QUERY_FIELDS,
  QUERY_PRIORITY_VALUES,
  QUERY_RESERVED_STATUS_VALUES,
  QueryNode,
  typeFieldOperators,
} from '../../domain/query/queryTypes';
import { getTypeIndex, type TypeIndex } from '../../domain/types/typeIndex';
import { listTypeQueryFields, resolveTypeQueryPath, type TypeQueryField } from '../../domain/types/typeQueryFields';
import type { TypeDefinition } from '../../domain/types/typeRegistry';
import { DEFAULT_TASK_POLICY, type TaskPolicy } from '../../domain/tasks/taskPolicy';
import { normalizeStatusName, UNKNOWN_STATUS_NAME } from '../../domain/tasks/taskStatuses';
import {
  formatMonthName,
  formatShortDay,
  parseDatePhrase,
  resolveDatePeriod,
} from '../../domain/markdown/dates';
import { getBacklinkIndex, noteTitle } from '../../domain/index/backlinks';
import { getFileName } from '../../shared/paths';
import { pluralize } from '../../shared/text';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { addDays } from '../../domain/markdown/calendar';
import { formatDisplayDate } from '../../domain/markdown/dateFormat';
import {
  QueryOperator,
  TagInfo,
  TagReference,
  WorkspaceIndex,
  QueryFacet,
  QuerySuggestion,
  QuerySuggestions,
  QueryViewState,
} from '../../domain/model';

/**
 * What the query bar and its builder offer: the state of one parsed search,
 * and the completions for every field, value, and whole condition, each
 * worded for what it means today.
 */

/** One parsed search, and what its query bar shows beside it. */
export interface QueryViewStateOptions {
  index: WorkspaceIndex;
  parsed: ParsedQuery;
  matchCounts: { notes: number; tasks: number };
  isAdvanced: boolean;
  recentQueries: readonly string[];
  /** The facets to refine by; none by default. */
  facets?: QueryFacet[];
  /** Search text typed that does not parse, shown with its errors. */
  pending?: string;
  /** The settings and moment the date completions are worded in. */
  queryContext: QueryContext;
}

/**
 * Builds everything the query bar and its builder need from one parse. The
 * date completions say what each value means in `queryContext`.
 */
export function createQueryViewState({
  index,
  parsed,
  matchCounts,
  isAdvanced,
  recentQueries,
  facets,
  pending: typed,
  queryContext,
}: QueryViewStateOptions): QueryViewState {
  const pending = typed?.trim();
  return {
    text: parsed.text,
    ...(pending ? { pending } : {}),
    terms: getTopLevelTerms(parsed),
    termsJoin: getTopLevelJoin(parsed),
    canAppend: canAppendTerm(parsed),
    facets: facets ?? [],
    isAdvanced,
    diagnostics: pending ? parseWorkspaceQuery(index, pending).diagnostics : parsed.diagnostics,
    builder: toBuilderTree(parsed.node),
    tags: resolveQueryTags(index, parsed, queryContext.entityNamespaceAliases),
    suggestions: createQuerySuggestions(index, recentQueries, queryContext, parsed.node),
    matchCounts,
  };
}

/**
 * Resolves the tags a query names against the index so chips and titles can
 * show a tag's real label rather than the spelling that was typed, reading
 * a namespace through `entityNamespaceAliases` (the workspace's, when the
 * caller has them) as the index read the notes.
 */
export function resolveQueryTags(
  index: WorkspaceIndex,
  parsed: ParsedQuery,
  entityNamespaceAliases?: EntityNamespaceAliases,
): TagReference[] {
  const seen = new Set<string>();
  return collectQueryTagKeys(parsed.node)
    .map((tagKey) => resolveIndexedTagKey(index.tags, tagKey, entityNamespaceAliases))
    .flatMap((tagKey) => {
      if (!tagKey || seen.has(tagKey)) {
        return [];
      }
      seen.add(tagKey);
      const tag = index.tags.get(tagKey);
      return tag ? [{ key: tag.key, label: tag.label }] : [];
    });
}

/** Upper bound on tag completions sent across the webview boundary. */
const QUERY_TAG_SUGGESTION_LIMIT = 400;

/** Upper bound on file and path completions. */
const QUERY_PATH_SUGGESTION_LIMIT = 200;

/**
 * What searching for a tag finds, such as "2 notes · 3 tasks", written the
 * way a search's own result count is, so the two agree.
 */
export function describeTagMatches(
  index: WorkspaceIndex,
  tagKey: string,
): string {
  const count = countTagMatches(index).get(tagKey) ?? { notes: 0, tasks: 0 };
  return `${pluralize(count.notes, 'note')} · ${pluralize(count.tasks, 'task')}`;
}

/**
 * Builds the completions both editing surfaces use.
 *
 * Values are grouped by field rather than pre-joined to one, so the query bar
 * can complete a value once it knows which field the caret is in, and a
 * builder row can complete its own value field with the same list. A date
 * value says the days it means on the context's today, in weeks from its
 * week start.
 *
 * In a workspace with types, `node`, the search being edited, decides the
 * type fields offered: those of each type its top level names
 * (`type = team`), then those one relation away ("Through lead"), then the
 * built-in fields, each with its values by kind.
 */
export function createQuerySuggestions(
  index: WorkspaceIndex,
  recentQueries: readonly string[],
  context: Pick<QueryContext, 'now' | 'weekStart'> & Partial<Pick<QueryContext, 'taskPolicy' | 'dateFormats'>>,
  node?: QueryNode,
): QuerySuggestions {
  const types = getTypeIndex(index);
  const typed = types.isEmpty ? undefined : suggestTypeFields(types, node);
  const fields = listFields(typed);
  const tags = suggestTags(index, () => true);
  const kinds: QuerySuggestion[] = [
    ...new Set(
      [...index.entities.values()].map((entity) => String(entity.kind)),
    ),
  ]
    .sort((left, right) => left.localeCompare(right))
    .map((kind) => ({ value: kind, label: kind }));
  const filePaths = [...index.files.keys()].sort();
  const paths: QuerySuggestion[] = filePaths
    .slice(0, QUERY_PATH_SUGGESTION_LIMIT)
    .map((filePath) => ({ value: filePath, label: filePath }));
  const files: QuerySuggestion[] = [
    ...new Set(filePaths.map((filePath) => getFileName(filePath) ?? filePath)),
  ]
    .slice(0, QUERY_PATH_SUGGESTION_LIMIT)
    .map((fileName) => ({ value: fileName, label: fileName }));
  const { dates, taskDates, noDate } = suggestDates(context);
  const priorities: QuerySuggestion[] = QUERY_PRIORITY_VALUES.map((value) => ({
    value,
    label: value,
  }));
  // A task's assignee is a person, so the people in the index are what it
  // completes with, plus the way to ask for the tasks nobody was named on.
  const people: QuerySuggestion[] = [
    ...suggestTags(index, (tag) => isPersonTag(tag.key)),
    { value: 'none', label: 'none', detail: 'tasks that name nobody' },
  ];
  const links = createLinkSuggestions(index);
  const folders: QuerySuggestion[] = collectFolders(filePaths)
    .slice(0, QUERY_PATH_SUGGESTION_LIMIT)
    .map((folder) => ({ value: folder, label: folder }));

  return {
    fields,
    aliases: { ...FIELD_ALIASES, ...typed?.aliases },
    operators: { ...QUERY_FIELD_OPERATORS, ...typed?.operators },
    values: {
      ...typed?.values,
      tag: tags,
      link: links,
      kind: kinds,
      is: IS_SUGGESTIONS.map((item) => ({
        value: item.value.slice('is:'.length),
        label: item.value.slice('is:'.length),
        detail: item.detail,
      })),
      task: TASK_SUGGESTIONS,
      status: suggestStatuses(index, context.taskPolicy ?? DEFAULT_TASK_POLICY),
      has: [...HAS_SUGGESTIONS.map((value) => ({ value, label: value })), ...(typed?.has ?? [])],
      file: files,
      path: paths,
      in: folders,
      due: taskDates,
      scheduled: taskDates,
      start: taskDates,
      done: [...dates, noDate],
      cancelled: [...dates, noDate],
      priority: priorities,
      assignee: people,
      created: dates,
      updated: dates,
    },
    conditions: [...(typed?.conditions ?? []), ...suggestConditions(folders)],
    recent: recentQueries.map((query) => ({
      value: query,
      label: query,
      detail: 'Recent search',
    })),
  };
}

/**
 * The fields offered: the type fields, then the built-ins, under "Built in"
 * when there are type fields, and `type` only when the workspace has types.
 */
function listFields(typed: TypeFieldSuggestions | undefined): QuerySuggestion[] {
  return [
    ...(typed?.fields ?? []),
    ...QUERY_FIELDS.filter((field) => field !== 'type' || typed).map((field) => ({
      value: field,
      label: field,
      detail: describeQueryField(field),
      ...(typed ? { group: 'Built in' } : {}),
    })),
  ];
}

/** What a workspace's types add to the completions. */
interface TypeFieldSuggestions {
  /** The type fields offered, each under its type's or relation's heading. */
  fields: QuerySuggestion[];
  /** Each type field's values by its kind, and `type`'s, the types. */
  values: Record<string, QuerySuggestion[]>;
  operators: Record<string, readonly QueryOperator[]>;
  /** Each type field's name, naming itself, and `type`, so the bar knows the field its caret is in. */
  aliases: Record<string, string>;
  /** The type fields `has:` and `no:` ask about. */
  has: QuerySuggestion[];
  /** `type = <key>` for each type. */
  conditions: QuerySuggestion[];
}

/** Upper bound on the rows a relation's value completes with. */
const QUERY_ROW_SUGGESTION_LIMIT = 200;

/**
 * The type fields a search can be narrowed by: for each type its top level
 * names, its own fields, reverses, and computed fields under its name, then
 * each relation's target's fields, one level deep, under "Through
 * <relation>" as `<relation>.<field>`. Every type field the search already
 * uses is offered too, so a row the builder draws for it keeps its field.
 */
function suggestTypeFields(types: TypeIndex, node: QueryNode | undefined): TypeFieldSuggestions {
  const registry = types.registry;
  const fields: QuerySuggestion[] = [];
  const kinds = new Map<string, TypeQueryField[]>();
  const offer = (name: string, found: TypeQueryField[], group: string, detail: string): void => {
    if (kinds.has(name) || found.length === 0) {
      return;
    }
    kinds.set(name, found);
    fields.push({ value: name, label: name, detail, group });
  };
  getQueryTypeKeys(node).forEach((typeKey) => {
    const type = registry.get(typeKey);
    if (!type) {
      return;
    }
    const own = listTypeQueryFields(registry, type.key);
    own.forEach((field) => offer(field.name, [field], type.name, describeTypeField(field, registry.get(field.targets[0] ?? ''))));
    own
      .filter((field) => field.targets.length > 0 && field.name !== 'children' && field.name !== 'parent')
      .forEach((relation) =>
        relation.targets.forEach((targetKey) =>
          listTypeQueryFields(registry, targetKey)
            .filter((field) => field.source !== 'computed')
            .forEach((field) =>
              offer(`${relation.name}.${field.name}`, [field], `Through ${relation.name}`, describeTypeField(field, registry.get(field.targets[0] ?? ''))),
            ),
        ),
      );
  });
  visitFieldConditions(node, (condition) => {
    const found = resolveTypeQueryPath(registry, condition.name);
    offer(condition.name, found, 'In this search', found[0] ? describeTypeField(found[0], registry.get(found[0].targets[0] ?? '')) : '');
  });
  const values: Record<string, QuerySuggestion[]> = {
    type: registry.types.map((type) => ({ value: type.key, label: type.key, detail: describeType(type) })),
  };
  const operators: Record<string, readonly QueryOperator[]> = {};
  const aliases: Record<string, string> = { type: 'type' };
  kinds.forEach((found, name) => {
    values[name] = suggestTypeFieldValues(types, found);
    operators[name] = typeFieldOperators([...new Set(found.map((field) => field.kind.name))]);
    aliases[name] = name;
  });
  return {
    fields,
    values,
    operators,
    aliases,
    has: [...kinds.keys()].filter((name) => !name.includes('.') || name.startsWith('field.')).map((name) => ({ value: name, label: name, detail: 'Rows with this field filled' })),
    conditions: registry.types.map((type) => ({ value: `type = ${type.key}`, label: `type = ${type.key}`, detail: describeType(type) })),
  };
}

/** A type as a completion describes it: its name and what its rows are, `Team · #team/*`. */
function describeType(type: TypeDefinition): string {
  const rows = type.rows?.kind === 'notes' ? `notes with type: ${type.key}` : type.rows?.written;
  return rows ? `${type.name} · ${rows}` : type.name;
}

/**
 * A type field as a completion describes it: its kind, the type its values
 * are rows of, and whether it is computed: `Person`, `Team, many · reverse`,
 * `Number · computed from the notes`.
 */
function describeTypeField(field: TypeQueryField, target: TypeDefinition | undefined): string {
  const rows = field.kind.name === 'relation' || field.kind.name === 'person';
  const kind = `${rows ? (target?.name ?? 'Person') : describeKind(field.kind.name)}${field.kind.many ? ', many' : ''}`;
  switch (field.source) {
    case 'reverse':
      return `${kind} · reverse`;
    case 'computed':
      return `${kind} · computed from the notes`;
    case 'field':
      return kind;
  }
}

/** A kind's name as a completion says it: `Number`, `Select`. */
function describeKind(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The values a type field completes with, by its kind: the rows of the
 * types a relation or person names, their tag or title; a select's
 * options; true and false; the dates `created` takes.
 */
function suggestTypeFieldValues(types: TypeIndex, found: readonly TypeQueryField[]): QuerySuggestion[] {
  const values = new Map<string, QuerySuggestion>();
  const add = (suggestion: QuerySuggestion): void => {
    if (!values.has(suggestion.value.toLowerCase())) {
      values.set(suggestion.value.toLowerCase(), suggestion);
    }
  };
  found.forEach((field) => {
    switch (field.kind.name) {
      case 'person':
      case 'relation':
      case 'note':
        field.targets.forEach((typeKey) => {
          const typeName = types.registry.get(typeKey)?.name ?? typeKey;
          types
            .rows(typeKey)
            .slice(0, QUERY_ROW_SUGGESTION_LIMIT)
            .forEach((row) =>
              add({
                value: row.tagKeys.length > 0 ? row.id : row.title,
                label: row.title,
                detail: row.tagKeys.length > 0 ? `${typeName} · ${row.id}` : typeName,
              }),
            );
        });
        return;
      case 'select':
        (field.kind.options ?? []).forEach((option) => add({ value: option, label: option, detail: 'Option' }));
        return;
      case 'checkbox':
        add({ value: 'true', label: 'true', detail: 'Checked' });
        add({ value: 'false', label: 'false', detail: 'Not checked' });
        return;
      case 'date':
        ['today', '7d', '30d', 'this-month', 'last-month'].forEach((value) => add({ value, label: value }));
        return;
      case 'number':
      case 'text':
      case 'link':
      case 'email':
      case 'phone':
        return;
    }
  });
  return [...values.values()];
}

/** The tags `keep` lets through, most used first, each with what searching for it finds. */
function suggestTags(
  index: WorkspaceIndex,
  keep: (tag: TagInfo) => boolean,
): QuerySuggestion[] {
  return [...index.tags.values()]
    .filter(keep)
    .sort((left, right) => right.count - left.count)
    .slice(0, QUERY_TAG_SUGGESTION_LIMIT)
    .map((tag) => ({
      value: tag.key,
      label: tag.label,
      detail: describeTagMatches(index, tag.key),
    }));
}

/** The weekdays a date completes to, Monday first. */
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * The date completions: `dates` look back, for when a note was created or
 * changed, `taskDates` look ahead, for when a task is due, and `noDate` asks
 * for none. A week or a month says the days it covers, and a weekday the
 * day it is, in the reader's short format, so a value is chosen by what it
 * means today.
 */
function suggestDates(
  { now, weekStart, dateFormats }: Pick<QueryContext, 'now' | 'weekStart'> & Partial<Pick<QueryContext, 'dateFormats'>>,
): { dates: QuerySuggestion[]; taskDates: QuerySuggestion[]; noDate: QuerySuggestion } {
  const span = (value: string): string => {
    const range = resolveDatePeriod(value, now, weekStart);
    if (!range) {
      return '';
    }
    return value.endsWith('-month')
      ? formatMonthName(range.start, now)
      : `${formatDisplayDate(range.start, dateFormats, 'short', now)} to ${formatDisplayDate(addDays(range.end, -1), dateFormats, 'short', now)}`;
  };
  const period = (value: string): QuerySuggestion => ({ value, label: value, detail: span(value) });
  const weekday = (value: string, direction: 'past' | 'future'): QuerySuggestion => {
    const date = parseDatePhrase(value, now, { direction })?.date;
    return { value, label: value, detail: date ? formatShortDay(date, now, dateFormats) : undefined };
  };
  const dates: QuerySuggestion[] = [
    { value: 'today', label: 'today' },
    { value: 'yesterday', label: 'yesterday' },
    { value: '7d', label: '7d', detail: 'the last seven days' },
    { value: '30d', label: '30d', detail: 'the last thirty days' },
    { value: '90d', label: '90d', detail: 'the last ninety days' },
    period('this-week'),
    period('last-week'),
    period('this-month'),
    period('last-month'),
    ...WEEKDAYS.map((day) => weekday(day, 'past')),
  ];
  const noDate: QuerySuggestion = {
    value: 'none',
    label: 'none',
    detail: 'no date written',
  };
  const taskDates: QuerySuggestion[] = [
    { value: 'today', label: 'today' },
    { value: 'tomorrow', label: 'tomorrow' },
    { value: '7d', label: '7d', detail: 'today and the next six days' },
    { value: '30d', label: '30d', detail: 'the next thirty days' },
    period('this-week'),
    period('next-week'),
    period('this-month'),
    period('next-month'),
    ...WEEKDAYS.map((day) => weekday(day, 'future')),
    noDate,
  ];
  return { dates, taskDates, noDate };
}

/**
 * The whole conditions offered as the first word is typed: every `is:`, a
 * `has:` and `no:` for each value, three common comparisons, and the first
 * twenty folders.
 */
function suggestConditions(folders: readonly QuerySuggestion[]): QuerySuggestion[] {
  return [
    ...IS_SUGGESTIONS.map((item) => ({ ...item, label: item.value })),
    ...HAS_SUGGESTIONS.flatMap((value) => [
      { value: `has:${value}`, label: `has:${value}`, detail: describeHas(value, true) },
      { value: `no:${value}`, label: `no:${value}`, detail: describeHas(value, false) },
    ]),
    { value: 'priority >= high', label: 'priority >= high', detail: 'High or highest priority tasks' },
    { value: 'updated >= 7d', label: 'updated >= 7d', detail: 'Updated in the last seven days' },
    { value: 'created = today', label: 'created = today', detail: 'Created today' },
    ...folders.slice(0, 20).map((folder) => ({
      value: `in:${quoteValue(folder.value)}`,
      label: `in:${folder.value}`,
      detail: 'Notes in this folder',
    })),
  ];
}

/** Upper bound on note names offered after `[[`. */
const QUERY_LINK_SUGGESTION_LIMIT = 200;

/** Each index's `[[` completions, worked out once, since counting backlinks reads every note. */
const linkSuggestions = new WeakMap<WorkspaceIndex, QuerySuggestion[]>();

/**
 * The notes a `[[` completes to, most linked first: each note's title, and
 * each alias its front matter gives it. `value` is the name without brackets,
 * which a builder row's value takes; the label is the link as typed.
 */
function createLinkSuggestions(index: WorkspaceIndex): QuerySuggestion[] {
  const cached = linkSuggestions.get(index);
  if (cached) {
    return cached;
  }
  const backlinks = getBacklinkIndex(index);
  const linkedFrom = (filePath: string): number =>
    new Set(backlinks.toNote(filePath).map((link) => link.sourcePath)).size;
  const candidates: Array<QuerySuggestion & { count: number }> = [];
  index.files.forEach((file, filePath) => {
    const title = noteTitle(filePath);
    const count = linkedFrom(filePath);
    candidates.push({
      value: title,
      label: `[[${title}]]`,
      detail: `Linked from ${pluralize(count, 'note')}`,
      count,
    });
    file.aliases?.forEach((alias) =>
      candidates.push({
        value: alias,
        label: `[[${alias}]]`,
        detail: `alias of ${title}`,
        count,
      }),
    );
  });
  const suggestions = candidates
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, QUERY_LINK_SUGGESTION_LIMIT)
    .map(({ value, label, detail }) => ({ value, label, detail }));
  linkSuggestions.set(index, suggestions);
  return suggestions;
}

/** What `task:` completes with. */
const TASK_SUGGESTIONS: QuerySuggestion[] = [
  { value: 'open', label: 'open' },
  { value: 'done', label: 'done' },
  { value: 'any', label: 'any' },
];

/**
 * What `status:` completes with: every status the workspace names, then the
 * characters no status names that its tasks use, each with how many open
 * tasks have it, and then open, done, and any.
 */
function suggestStatuses(index: WorkspaceIndex, policy: Pick<TaskPolicy, 'statuses'>): QuerySuggestion[] {
  const counts = new Map<string, number>();
  const unknown = new Set<string>();
  index.tasks.forEach((task) => {
    const status = task.status;
    const slug = normalizeStatusName(status.name).replace(/ /g, '-');
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
    if (status.name === UNKNOWN_STATUS_NAME) {
      unknown.add(status.symbol);
    }
  });
  const named = new Map<string, QuerySuggestion>();
  policy.statuses
    .filter((status) => status.type !== 'nonTask')
    .forEach((status) => {
      const slug = normalizeStatusName(status.name).replace(/ /g, '-');
      if (named.has(slug) || QUERY_RESERVED_STATUS_VALUES.includes(slug)) {
        return;
      }
      const count = counts.get(slug) ?? 0;
      named.set(slug, {
        value: slug,
        label: status.name,
        detail: `[${status.symbol}]${count ? ` · ${pluralize(count, 'task')}` : ''}`,
      });
    });
  const characters = [...unknown].sort().map((symbol) => ({
    value: `[${symbol}]`,
    label: `[${symbol}]`,
    detail: 'A character no status names, read as to do',
  }));
  return [
    ...named.values(),
    ...characters,
    { value: 'open', label: 'open', detail: 'Every open task' },
    { value: 'done', label: 'done', detail: 'Every done task' },
    { value: 'any', label: 'any', detail: 'Every task' },
  ];
}

/** Whole `is:` conditions, with what each finds. */
const IS_SUGGESTIONS: QuerySuggestion[] = [
  { value: 'is:open', label: 'is:open', detail: 'Open tasks: to do, in progress, or on hold' },
  { value: 'is:in-progress', label: 'is:in-progress', detail: 'Tasks in progress, such as [/]' },
  { value: 'is:done', label: 'is:done', detail: 'Completed tasks' },
  { value: 'is:cancelled', label: 'is:cancelled', detail: 'Cancelled tasks, such as [-]' },
  { value: 'is:closed', label: 'is:closed', detail: 'Done or cancelled tasks' },
  { value: 'is:overdue', label: 'is:overdue', detail: 'Open tasks past their due date' },
  { value: 'is:due', label: 'is:due', detail: 'Open tasks due within seven days, overdue included' },
  { value: 'is:today', label: 'is:today', detail: 'Open tasks due today, or scheduled for today or earlier and started' },
  { value: 'is:needs-date', label: 'is:needs-date', detail: 'Open tasks more than 30 days past their due date' },
  { value: 'is:task', label: 'is:task', detail: 'Every task' },
  { value: 'is:note', label: 'is:note', detail: 'Note sections only, no tasks' },
  { value: 'is:blocked', label: 'is:blocked', detail: 'Open tasks marked Blocked, or waiting for a task that is still open' },
  { value: 'is:waiting', label: 'is:waiting', detail: 'Open tasks on hold, such as Waiting or Someday, or for someone else' },
  { value: 'is:available', label: 'is:available', detail: 'Open tasks you can start now: not blocked, started, not on hold' },
  { value: 'is:blocking', label: 'is:blocking', detail: 'Open tasks an open task is waiting for' },
  { value: 'is:mine', label: 'is:mine', detail: 'Tasks for the person the "Me" setting names' },
  { value: 'is:assigned', label: 'is:assigned', detail: 'Tasks that name a person' },
  { value: 'is:unassigned', label: 'is:unassigned', detail: 'Tasks that name nobody' },
  { value: 'is:daily', label: 'is:daily', detail: 'Written in a daily note' },
  { value: 'is:periodic', label: 'is:periodic', detail: 'Written in a daily, weekly, or monthly note' },
  { value: 'is:parked', label: 'is:parked', detail: 'Notes and tasks that are parked' },
  { value: 'is:step', label: 'is:step', detail: 'Tasks written under another task' },
];

/** The values `has:` and `no:` take. */
const HAS_SUGGESTIONS = [
  'due',
  'scheduled',
  'start',
  'done',
  'cancelled',
  'priority',
  'id',
  'dependsOn',
  'steps',
];

/** What `has:` and `no:` find, for each value they take. */
function describeHas(value: string, present: boolean): string {
  switch (value) {
    case 'priority':
      return present ? 'Tasks with a priority' : 'Tasks without a priority';
    case 'id':
      return present ? 'Tasks with an id (🆔) others can wait for' : 'Tasks without an id (🆔)';
    case 'dependsOn':
      return present ? 'Tasks that wait for another task (⛔)' : 'Tasks that wait for no other task';
    case 'steps':
      return present ? 'Tasks broken into steps' : 'Tasks with no steps';
    default:
      return present ? `Tasks with a ${value} date` : `Tasks without a ${value} date`;
  }
}

/**
 * Every folder that holds a note, parents before their children.
 */
function collectFolders(filePaths: readonly string[]): string[] {
  const folders = new Set<string>();
  filePaths.forEach((filePath) => {
    const parts = filePath.split('/').slice(0, -1);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join('/')));
  });
  return [...folders].sort((left, right) => left.localeCompare(right));
}

/**
 * One-line help shown beside each field in the query bar and the builder.
 */
export function describeQueryField(field: string): string {
  switch (field) {
    case 'tag':
      return 'A tag, including tags inherited from a parent heading';
    case 'link':
      return 'A note the entry links to, as [[Atlas]] or [[Atlas#Decision]]; aliases count';
    case 'text':
      return 'Words in the note, task, or file body';
    case 'is':
      return 'is:open, is:in-progress, is:done, is:cancelled, is:closed, is:overdue, is:due, is:today, is:needs-date, is:task, is:note, is:blocked, is:blocking, is:waiting, is:available, is:mine, is:assigned, is:unassigned, is:daily, is:periodic, is:parked, or is:step';
    case 'has':
      return 'has:due or no:due, and the same for scheduled, start, done, cancelled, priority, id, dependsOn, and steps';
    case 'in':
      return 'A folder and everything in it, as in in:notes/projects';
    case 'task':
      return 'open, done, or any';
    case 'status':
      return 'A status by name, as in-progress or blocked, or by its character, as [/]; or open, done, or any';
    case 'due':
      return 'A task due date (📅): 2026-09-13, today, 7d ahead, or none';
    case 'scheduled':
      return 'A task scheduled date (⏳): 2026-09-13, today, 7d ahead, or none';
    case 'start':
      return 'A task start date (🛫): 2026-09-13, today, 7d ahead, or none';
    case 'done':
      return 'A task completion date (✅): 2026-09-13, today, 7d back, or none';
    case 'cancelled':
      return 'A task cancelled date (❌): 2026-09-13, today, 7d back, or none';
    case 'priority':
      return 'highest, high, medium, none, low, or lowest';
    case 'assignee':
      return 'The person a task is for: whoever its 👤 field names, or none';
    case 'kind':
      return 'An entity namespace such as project or person';
    case 'type':
      return 'The rows of a type a note in Types/ defines, as type = team';
    case 'file':
      return 'A file name, with * as a wildcard';
    case 'path':
      return 'A workspace-relative path, with * as a wildcard';
    case 'created':
      return 'A date such as 2026-09-13, a window such as 30d, or today';
    case 'updated':
      return 'A date such as 2026-09-13, a window such as 30d, or today';
    default:
      return '';
  }
}
