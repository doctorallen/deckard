/**
 * Shared shapes for DQL, the Deckard query language used by the entity
 * overview's advanced filter.
 *
 * The parser, the formatter, and the evaluator all agree on this AST so the
 * webview's query text and its visual builder can round-trip through one
 * canonical representation.
 */

import type { FieldKindName } from '../model/noteTypes';
import type { QueryDiagnostic, QueryField, QueryOperator } from '../model/query';

/** Every field a query can name, in the order the query bar suggests them. */
export const QUERY_FIELDS: readonly QueryField[] = [
  'tag',
  'link',
  'text',
  'is',
  'task',
  'status',
  'due',
  'scheduled',
  'start',
  'done',
  'cancelled',
  'priority',
  'assignee',
  'has',
  'kind',
  'type',
  'file',
  'path',
  'in',
  'created',
  'updated',
];

/**
 * Field spellings accepted in a query, mapped to their canonical field.
 */
export const FIELD_ALIASES: Readonly<Record<string, QueryField>> = {
  tag: 'tag',
  tags: 'tag',
  link: 'link',
  links: 'link',
  linksto: 'link',
  text: 'text',
  content: 'text',
  body: 'text',
  task: 'task',
  tasks: 'task',
  status: 'status',
  due: 'due',
  deadline: 'due',
  scheduled: 'scheduled',
  start: 'start',
  starts: 'start',
  done: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  priority: 'priority',
  assignee: 'assignee',
  assigned: 'assignee',
  owner: 'assignee',
  kind: 'kind',
  type: 'kind',
  namespace: 'kind',
  file: 'file',
  note: 'file',
  filename: 'file',
  path: 'path',
  folder: 'path',
  created: 'created',
  updated: 'updated',
  modified: 'updated',
  is: 'is',
  has: 'has',
  no: 'has',
  in: 'in',
};

/**
 * Fields written as one `field:value` token rather than `field = value`.
 */
export const QUERY_SHORTHAND_FIELDS: readonly QueryField[] = ['is', 'has', 'in'];

/** Values `is:` accepts. */
export const QUERY_IS_VALUES = [
  'open',
  'in-progress',
  'done',
  'cancelled',
  'closed',
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
  'cancelled',
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
  'cancelled',
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

/**
 * The symbol each operator is written with, which the parser reads, the
 * builder and error messages write, and the formatter writes back.
 */
export const QUERY_OPERATOR_SYMBOLS: Readonly<Record<QueryOperator, string>> = {
  eq: '=',
  neq: '!=',
  contains: '~',
  notContains: '!~',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

/** The operator as a query writes it: `=`, `!=`, `~`, `!~`, `>`, `>=`, `<`, `<=`. */
export function describeOperator(operator: QueryOperator): string {
  return QUERY_OPERATOR_SYMBOLS[operator];
}

/**
 * Compares two ranks as an operator asks, for a field whose values are
 * ordered, such as priority. `contains` and `!~` order nothing, so they
 * never match.
 */
export function compareByOperator(operator: QueryOperator, actual: number, wanted: number): boolean {
  switch (operator) {
    case 'eq':
      return actual === wanted;
    case 'neq':
      return actual !== wanted;
    case 'gt':
      return actual > wanted;
    case 'gte':
      return actual >= wanted;
    case 'lt':
      return actual < wanted;
    case 'lte':
      return actual <= wanted;
    case 'contains':
    case 'notContains':
      return false;
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
  status: ['eq', 'neq'],
  due: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  scheduled: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  start: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  done: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  cancelled: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  priority: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  assignee: ['eq', 'neq'],
  has: ['eq', 'neq'],
  kind: ['eq', 'neq'],
  type: ['eq', 'neq'],
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

/**
 * The values of `status:` that keep `task:`'s meaning rather than naming a
 * status: open, done, and any, whatever the statuses are called.
 */
export const QUERY_RESERVED_STATUS_VALUES: readonly string[] = QUERY_TASK_VALUES;

/** One value `task:` accepts. */
export type QueryTaskValue = (typeof QUERY_TASK_VALUES)[number];

/** One condition: a field compared with a value, as the parser stores it. */
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

/** Conditions joined by AND or OR, two or more. */
export interface QueryLogicalNode {
  type: 'and' | 'or';
  children: QueryNode[];
}

/** A condition or group negated. */
export interface QueryNotNode {
  type: 'not';
  child: QueryNode;
}

/**
 * One condition on a type's field, by the name a query gives it: a field of
 * the type's table (`lead`, `field.status` for one a built-in's name
 * takes), a reverse (`owned-by`), a computed field (`open-tasks`), or a
 * path of up to three of them (`team.lead`). An entry matches when its
 * note is a row whose field matches; a row, when its own does.
 */
export interface QueryFieldConditionNode {
  type: 'field';
  /** The field's query name or path, lowercased: `lead`, `owned-by.lead`, `field.status`. */
  name: string;
  operator: QueryOperator;
  /**
   * The values compared with, as written: one, or several for
   * `tier = gold, silver`, any of which matches. `this` is the note a
   * query block is in.
   */
  values: string[];
  /** Character offset of the condition in the source query text. */
  start: number;
  /** Character offset one past the end of the condition. */
  end: number;
}

/** A parsed query: a condition, a type field's condition, a group of them, or a negation. */
export type QueryNode = QueryConditionNode | QueryFieldConditionNode | QueryLogicalNode | QueryNotNode;

/** The value that names the note a query block is in: `team = this`. */
export const THIS_VALUE = 'this';

/**
 * What a query's parser knows of the workspace's types: which names are
 * type fields, and which values name a type. Without one, a query knows
 * only the built-in fields, as before types.
 */
export interface QueryFieldSchema {
  /**
   * The field a name or path reaches (`lead`, `team.lead`, `field.status`),
   * any case, with the kinds it has among the types that have it;
   * undefined when no type has it.
   */
  field(name: string): QueryTypeField | undefined;
  /** The key of the type a value names, by key or display name, any case. */
  type(value: string): string | undefined;
  /** The type fields a name no type has could have meant, closest first. */
  closest(name: string): string[];
}

/** A type field as the parser knows it. */
export interface QueryTypeField {
  /** Its query name or path, lowercased. */
  name: string;
  /**
   * What it holds, among the types that have it: one kind, unless two
   * types define it differently; empty when that is not known.
   */
  kinds: readonly FieldKindName[];
}

/**
 * Operators a type field takes, by its kind: numbers and dates compare by
 * order; text, links, and rows' titles can also be searched within.
 */
export const TYPE_FIELD_OPERATORS: Readonly<Record<FieldKindName, readonly QueryOperator[]>> = {
  text: ['eq', 'neq', 'contains', 'notContains'],
  link: ['eq', 'neq', 'contains', 'notContains'],
  email: ['eq', 'neq', 'contains', 'notContains'],
  phone: ['eq', 'neq', 'contains', 'notContains'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  checkbox: ['eq', 'neq'],
  select: ['eq', 'neq'],
  person: ['eq', 'neq', 'contains', 'notContains'],
  relation: ['eq', 'neq', 'contains', 'notContains'],
  note: ['eq', 'neq', 'contains', 'notContains'],
};

/** Every operator, for a type field whose kind differs between types. */
const ALL_OPERATORS: readonly QueryOperator[] = ['eq', 'neq', 'contains', 'notContains', 'gt', 'gte', 'lt', 'lte'];

/** The operators a type field takes: its kind's, or every one when its kinds differ or are unknown. */
export function typeFieldOperators(kinds: readonly FieldKindName[]): readonly QueryOperator[] {
  return kinds.length === 1 ? TYPE_FIELD_OPERATORS[kinds[0]] : ALL_OPERATORS;
}

/**
 * What a type field's query name or path looks like: words of letters,
 * digits, `_`, and `-`, joined by dots.
 */
export const TYPE_FIELD_NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*(?:\.[\p{L}\p{N}_][\p{L}\p{N}_-]*)*$/u;

/** What parseQuery returns: the text, its tree when it parsed, and what it reported. */
export interface ParsedQuery {
  /** The query text exactly as it was parsed. */
  text: string;
  /** Undefined for an empty query or one that failed to parse. */
  node?: QueryNode;
  diagnostics: QueryDiagnostic[];
}

/**
 * A schema that takes any name a field could have as a type field, of a
 * kind not known, and any value as a type: for reading a query's shape
 * (its terms, where each was written, its tags) without the workspace's
 * types to hand, never for answering it.
 */
export const ANY_FIELD_SCHEMA: QueryFieldSchema = {
  field: (name) => (TYPE_FIELD_NAME.test(name) ? { name: name.toLowerCase(), kinds: [] } : undefined),
  type: (value) => value.trim().toLowerCase() || undefined,
  closest: () => [],
};
