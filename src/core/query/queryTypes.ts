/**
 * Shared shapes for DQL, the Deckard query language used by the entity
 * overview's advanced filter.
 *
 * The parser, the formatter, and the evaluator all agree on this AST so the
 * webview's query text and its visual builder can round-trip through one
 * canonical representation.
 */

import type { QueryDiagnostic, QueryField, QueryOperator } from '../../domain/model/query';

/**
 * The query shapes a page's snapshot carries live in the domain model, where
 * `ui/protocol` can reach them; they are re-exported so the query modules
 * keep importing everything from here.
 */
export type {
  QueryBuilderGroup,
  QueryBuilderItem,
  QueryBuilderJoin,
  QueryBuilderRow,
  QueryDiagnostic,
  QueryDiagnosticSeverity,
  QueryFacet,
  QueryFacetValue,
  QueryField,
  QueryOperator,
  QuerySuggestion,
  QuerySuggestions,
  QueryTermChip,
  QueryViewState,
  TagReferenceLike,
} from '../../domain/model/query';

export const QUERY_FIELDS: readonly QueryField[] = [
  'tag',
  'link',
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
  'today',
  'needs-date',
  'waiting',
  'available',
  'blocked',
  'blocking',
  'mine',
  'assigned',
  'unassigned',
  'daily',
  'periodic',
  'parked',
  'step',
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
  'steps',
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

/** The operator as a query writes it: `=`, `!=`, `~`, `!~`, `>`, `>=`, `<`, `<=`. */
export function describeOperator(operator: QueryOperator): string {
  switch (operator) {
    case 'eq':
      return '=';
    case 'neq':
      return '!=';
    case 'contains':
      return '~';
    case 'notContains':
      return '!~';
    case 'gt':
      return '>';
    case 'gte':
      return '>=';
    case 'lt':
      return '<';
    case 'lte':
      return '<=';
  }
}

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
  link: ['eq', 'neq'],
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

export interface ParsedQuery {
  /** The query text exactly as it was parsed. */
  text: string;
  /** Undefined for an empty query or one that failed to parse. */
  node?: QueryNode;
  diagnostics: QueryDiagnostic[];
}
