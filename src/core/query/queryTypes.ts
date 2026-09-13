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
 * text. The remaining fields describe the source unit itself.
 */
export type QueryField =
  | 'tag'
  | 'text'
  | 'task'
  | 'kind'
  | 'file'
  | 'path'
  | 'created'
  | 'updated';

export const QUERY_FIELDS: readonly QueryField[] = [
  'tag',
  'text',
  'task',
  'kind',
  'file',
  'path',
  'created',
  'updated',
];

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
  task: ['eq', 'neq'],
  kind: ['eq', 'neq'],
  file: ['eq', 'neq', 'contains', 'notContains'],
  path: ['eq', 'neq', 'contains', 'notContains'],
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
export interface QueryBuilderGroup {
  rows: QueryBuilderRow[];
}

/**
 * Everything the webview needs to render the query bar and its builder.
 */
export interface QueryViewState {
  /** Canonical query text; the source of truth for both editing surfaces. */
  text: string;
  /**
   * False when the query is a flat intersection of positive tag conditions,
   * which the overview still renders with its original tag chips.
   */
  isAdvanced: boolean;
  /** True when the builder can represent every condition in the query. */
  isBuildable: boolean;
  diagnostics: QueryDiagnostic[];
  groups: QueryBuilderGroup[];
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
   * Every spelling that names a field, so the query bar can tell which field
   * the caret sits in without keeping its own copy of the parser's aliases.
   */
  aliases: Record<string, QueryField>;
}
