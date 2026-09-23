/**
 * Shared shapes for DQL, the Deckard query language used by the entity
 * overview's advanced filter.
 *
 * The parser, the formatter, and the evaluator all agree on this AST so the
 * webview's query text and its visual builder can round-trip through one
 * canonical representation.
 */

/**
 * Every value a condition can be written against.
 *
 * `tag` matches a canonical tag key, including tags inherited from parent
 * headings and note front matter. `text` matches note, task, and file body
 * text. `due`, `scheduled`, `start`, `done`, and `priority` read a task's
 * Obsidian Tasks metadata, so only tasks can satisfy them. The remaining
 * fields describe the source unit itself.
 *
 * `assignee` reads the person a task is for: whoever the 👤 field on its
 * line names. Only tasks can satisfy it, the way the date fields work.
 *
 * `is`, `has`, and `in` are shorthands for filters people reach for often,
 * written GitHub-style as `is:open`, `has:due`, `no:due`, or `in:notes/work`.
 * Each is one short token for something that otherwise takes one or two
 * conditions.
 */
export type QueryField =
  | 'tag'
  | 'text'
  | 'is'
  | 'task'
  | 'due'
  | 'scheduled'
  | 'start'
  | 'done'
  | 'priority'
  | 'assignee'
  | 'has'
  | 'kind'
  | 'file'
  | 'path'
  | 'in'
  | 'created'
  | 'updated';

export const QUERY_FIELDS: readonly QueryField[] = [
  'tag',
  'text',
  'is',
  'task',
  'due',
  'scheduled',
  'start',
  'done',
  'priority',
  'assignee',
  'has',
  'kind',
  'file',
  'path',
  'in',
  'created',
  'updated',
];

/**
 * Fields written as one `field:value` token rather than `field = value`.
 */
export const QUERY_SHORTHAND_FIELDS: readonly QueryField[] = ['is', 'has', 'in'];

/** Values `is:` accepts. */
export const QUERY_IS_VALUES = [
  'open',
  'done',
  'task',
  'note',
  'overdue',
  'due',
  'blocked',
  'blocking',
  'mine',
  'assigned',
  'unassigned',
] as const;

/** Values `has:` and `no:` accept: a task date, a priority, or an id. */
export const QUERY_HAS_VALUES = [
  'due',
  'scheduled',
  'start',
  'done',
  'priority',
  'id',
  'dependsOn',
] as const;

/** Task date fields. Each also accepts `none`, meaning no date is written. */
export const QUERY_TASK_DATE_FIELDS: readonly QueryField[] = [
  'due',
  'scheduled',
  'start',
  'done',
];

/** Values `priority` accepts, highest first. `none` is a task without one. */
export const QUERY_PRIORITY_VALUES = [
  'highest',
  'high',
  'medium',
  'none',
  'low',
  'lowest',
] as const;

export type QueryOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'notContains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

/**
 * Operators each field accepts, in the order the visual builder offers them.
 *
 * Restricting operators per field keeps the builder's dropdowns honest and
 * lets the parser reject combinations the evaluator cannot answer.
 */
export const QUERY_FIELD_OPERATORS: Readonly<
  Record<QueryField, readonly QueryOperator[]>
> = {
  tag: ['eq', 'neq'],
  text: ['contains', 'notContains', 'eq', 'neq'],
  is: ['eq', 'neq'],
  task: ['eq', 'neq'],
  due: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  scheduled: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  start: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  done: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  priority: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  assignee: ['eq', 'neq'],
  has: ['eq', 'neq'],
  kind: ['eq', 'neq'],
  file: ['eq', 'neq', 'contains', 'notContains'],
  path: ['eq', 'neq', 'contains', 'notContains'],
  in: ['eq', 'neq'],
  created: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  updated: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
};

/**
 * The operator that means the opposite of another.
 *
 * Every operator a field accepts has its opposite in that same field's list,
 * so a negated condition can always be written as one plain condition. That
 * is what lets the visual builder express negation with its operator alone,
 * without a separate negate control that could contradict it.
 */
export const QUERY_OPERATOR_INVERSES: Readonly<
  Record<QueryOperator, QueryOperator>
> = {
  eq: 'neq',
  neq: 'eq',
  contains: 'notContains',
  notContains: 'contains',
  gt: 'lte',
  lte: 'gt',
  gte: 'lt',
  lt: 'gte',
};

/** Values `task:` accepts. */
export const QUERY_TASK_VALUES = ['open', 'done', 'any'] as const;

export type QueryTaskValue = (typeof QUERY_TASK_VALUES)[number];

export interface QueryConditionNode {
  type: 'condition';
  field: QueryField;
  operator: QueryOperator;
  value: string;
  /** Character offset of the condition in the source query text. */
  start: number;
  /** Character offset one past the end of the condition. */
  end: number;
}

export interface QueryLogicalNode {
  type: 'and' | 'or';
  children: QueryNode[];
}

export interface QueryNotNode {
  type: 'not';
  child: QueryNode;
}

export type QueryNode = QueryConditionNode | QueryLogicalNode | QueryNotNode;

export type QueryDiagnosticSeverity = 'error' | 'warning';

export interface QueryDiagnostic {
  message: string;
  severity: QueryDiagnosticSeverity;
  start: number;
  end: number;
}

export interface ParsedQuery {
  /** The query text exactly as it was parsed. */
  text: string;
  /** Undefined for an empty query or one that failed to parse. */
  node?: QueryNode;
  diagnostics: QueryDiagnostic[];
}

/**
 * One AND row in the visual builder.
 *
 * `supported` is false when the underlying AST node cannot be expressed as a
 * flat row, so the builder can show it read-only instead of silently dropping
 * a condition the author wrote by hand.
 */
export interface QueryBuilderRow {
  field: QueryField;
  operator: QueryOperator;
  value: string;
  supported: boolean;
  /** Rendered source text, shown when a row is not editable. */
  text: string;
}

/** One OR group in the visual builder. */
export type QueryBuilderJoin = 'and' | 'or';

/**
 * A group in the builder: rows and groups, joined by AND or by OR, and
 * negated as a whole or not. A query is one of these at the root, so every
 * query the language can write, the builder can edit.
 */
export interface QueryBuilderGroup {
  join: QueryBuilderJoin;
  /** `NOT (…)` around the whole group. */
  negated?: boolean;
  items: QueryBuilderItem[];
}

/** A row, or a nested group: told apart by `items`. */
export type QueryBuilderItem = QueryBuilderRow | QueryBuilderGroup;

/**
 * One term of a query, and the query it leaves behind when removed. A group
 * lists its own terms the same way, so each can be removed alone or the
 * group whole, as the builder shows them.
 */
export interface QueryTermChip {
  text: string;
  /** The term as the condition it runs, such as `text ~ vendor` for a word. */
  label?: string;
  without: string;
  /** For a group: the word between its terms. */
  join?: QueryBuilderJoin;
  /** For a group: whether it matches what it does not say. */
  negated?: boolean;
  /** For a group: its terms, each removable alone. */
  items?: QueryTermChip[];
}

export interface QueryFacetValue {
  label: string;
  /** How many of the current results this value keeps. */
  count: number;
  /** The query text that narrows to this value. */
  clause: string;
  /**
   * How strongly a related tag is associated with the search's tags, from 0
   * to 1, relative to the strongest one listed.
   */
  strength?: number;
  /** Why the value is offered, such as how often two tags are written together. */
  detail?: string;
}

/** One way the current results could be narrowed, with its counts. */
export interface QueryFacet {
  id: 'related' | 'status' | 'due' | 'tags' | 'updated' | 'folder';
  label: string;
  values: QueryFacetValue[];
  /** This facet's clauses the query already has, as written. */
  applied: string[];
}

/**
 * Everything the webview needs to render the query bar and its builder.
 */
export interface QueryViewState {
  /** Canonical query text; the source of truth for both editing surfaces. */
  text: string;
  /** The terms at the top of `text`, each removable alone. */
  terms: QueryTermChip[];
  /** The word between the top-level terms; AND when not said. */
  termsJoin?: QueryBuilderJoin;
  /** Whether a term can be added to `text` as another AND. */
  canAppend: boolean;
  /** What the current results could still be narrowed by. */
  facets: QueryFacet[];
  /**
   * False when the query is a flat intersection of positive tag conditions,
   * which the overview still renders with its original tag chips.
   */
  isAdvanced: boolean;
  /** True when the builder can represent every condition in the query. */
  diagnostics: QueryDiagnostic[];
  /**
   * A search that was typed and does not parse. `text` and the rest describe
   * the last search that did, and `diagnostics` say what is wrong with this.
   */
  pending?: string;
  /** The query as the builder edits it: a tree of rows and groups. */
  builder: QueryBuilderGroup;
  /** Tags named by the query, resolved against the index for display. */
  tags: TagReferenceLike[];
  /** Completions offered in the query bar and in builder value fields. */
  suggestions: QuerySuggestions;
  /** Result totals before the notes/tasks panes apply their own filters. */
  matchCounts: {
    notes: number;
    tasks: number;
  };
}

export interface TagReferenceLike {
  key: string;
  label: string;
}

export interface QuerySuggestion {
  /** Text inserted in place of the token being completed. */
  value: string;
  label: string;
  detail?: string;
}

/**
 * Completions, split by where they can be used.
 *
 * Values are grouped by field so the same list can serve the query bar, once
 * it knows which field the caret sits in, and a builder row's value field,
 * which always knows its own field.
 */
export interface QuerySuggestions {
  /** Field names, inserted with their operator ready for a value. */
  fields: QuerySuggestion[];
  /** Values known to be valid for a field. */
  values: Partial<Record<QueryField, QuerySuggestion[]>>;
  /**
   * The operators each field accepts, in the order the builder offers them,
   * so a page never keeps its own copy of the parser's rules.
   */
  operators: Record<QueryField, readonly QueryOperator[]>;
  /**
   * Whole conditions offered when the author types a value without its field,
   * such as `open` for `is:open` or `#atl` for a tag. `value` is the condition
   * written as query text.
   */
  conditions: QuerySuggestion[];
  /** Queries run recently, newest first, offered when the bar is empty. */
  recent: QuerySuggestion[];
  /**
   * Every spelling that names a field, so the query bar can tell which field
   * the caret sits in without keeping its own copy of the parser's aliases.
   */
  aliases: Record<string, QueryField>;
}
