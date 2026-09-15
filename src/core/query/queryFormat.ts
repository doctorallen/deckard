import { describeOperator } from './queryParser';
import {
  QueryBuilderGroup,
  QueryBuilderRow,
  QueryConditionNode,
  QueryField,
  QueryNode,
  QUERY_OPERATOR_INVERSES,
  QUERY_SHORTHAND_FIELDS,
} from './queryTypes';

/**
 * Renders an AST back into canonical DQL text.
 *
 * The query bar and the visual builder both write through this function, so a
 * query edited in one surface reads the same way in the other.
 */
export function formatQuery(node: QueryNode | undefined): string {
  if (!node) {
    return '';
  }
  return formatNode(node, 'top');
}

type FormatContext = 'top' | 'or' | 'and' | 'not';

function formatNode(node: QueryNode, context: FormatContext): string {
  if (node.type === 'condition') {
    return formatCondition(node);
  }
  if (node.type === 'not') {
    const inner = formatNode(node.child, 'not');
    return `NOT ${inner}`;
  }

  const joiner = node.type === 'or' ? ' OR ' : ' AND ';
  const body = node.children
    .map((child) => formatNode(child, node.type))
    .join(joiner);
  const needsParentheses =
    (node.type === 'or' && context !== 'top' && context !== 'or') ||
    (node.type === 'and' && context === 'not');
  return needsParentheses ? `(${body})` : body;
}

/**
 * Writes one condition, quoting values that would otherwise re-tokenize.
 */
export function formatCondition(condition: QueryConditionNode): string {
  const value = quoteValue(condition.value);
  if (QUERY_SHORTHAND_FIELDS.includes(condition.field)) {
    // A shorthand is written the way people type it, so a saved query or a
    // builder row reads `is:open` rather than `is = open`.
    const negated = condition.operator === 'neq';
    if (condition.field === 'has') {
      return `${negated ? 'no' : 'has'}:${value}`;
    }
    return `${negated ? '-' : ''}${condition.field}:${value}`;
  }
  const operator = describeOperator(condition.operator);
  return `${condition.field} ${operator} ${value}`;
}

/**
 * Quotes a value when it contains characters the tokenizer treats specially.
 */
export function quoteValue(value: string): string {
  if (value.length > 0 && !/[\s:=<>~!()"']/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * Builds the canonical query for an intersection of tags.
 *
 * The overview's existing tag chips are expressed with this function, so
 * opening a tag or adding one from the sidebar produces a query the advanced
 * editor can pick up without changing what the page shows.
 */
export function buildTagIntersectionQuery(
  tagKeys: readonly string[],
): string {
  return tagKeys
    .filter((tagKey) => tagKey.trim().length > 0)
    .map((tagKey) => `tag = ${quoteValue(tagKey.trim())}`)
    .join(' AND ');
}

/**
 * Returns the tag keys of a query that is a flat intersection of positive tag
 * conditions, or undefined when the query needs the advanced evaluator.
 *
 * This is what lets the overview keep its original chip UI and its original,
 * association-aware result path for every query the old page could express.
 */
export function getQueryTagIntersection(
  node: QueryNode | undefined,
): string[] | undefined {
  if (!node) {
    return undefined;
  }
  const conditions =
    node.type === 'and'
      ? node.children
      : node.type === 'condition'
        ? [node]
        : undefined;
  if (!conditions) {
    return undefined;
  }

  const tagKeys: string[] = [];
  for (const condition of conditions) {
    if (
      condition.type !== 'condition' ||
      condition.field !== 'tag' ||
      condition.operator !== 'eq' ||
      isWildcard(condition.value)
    ) {
      return undefined;
    }
    tagKeys.push(condition.value);
  }
  return tagKeys;
}

export function isWildcard(value: string): boolean {
  return value.includes('*') || value.includes('?');
}

/**
 * Projects an AST into the OR-of-AND rows the visual builder edits.
 *
 * A query that does not fit that shape — nested groups deeper than two levels,
 * for example — still round-trips, but its rows are marked unsupported so the
 * builder shows them read-only rather than rewriting the author's query.
 */
export function toBuilderGroups(
  node: QueryNode | undefined,
): QueryBuilderGroup[] {
  if (!node) {
    return [{ rows: [] }];
  }
  const orBranches = node.type === 'or' ? node.children : [node];
  return orBranches.map((branch) => ({ rows: toBuilderRows(branch) }));
}

function toBuilderRows(node: QueryNode): QueryBuilderRow[] {
  const andTerms = node.type === 'and' ? node.children : [node];
  return andTerms.map((term) => toBuilderRow(term));
}

/**
 * Projects one AND term into an editable row.
 *
 * A negated condition folds into its opposite operator — `NOT tag = #a` becomes
 * "tag is not #a" — so the builder needs no negate control of its own, and a
 * row can never disagree with a separate toggle about what it means.
 */
function toBuilderRow(node: QueryNode): QueryBuilderRow {
  const negated = node.type === 'not';
  const inner = node.type === 'not' ? node.child : node;
  if (inner.type !== 'condition') {
    return {
      field: 'text',
      operator: 'contains',
      value: '',
      supported: false,
      text: formatNode(node, 'top'),
    };
  }
  return {
    field: inner.field,
    operator: negated
      ? QUERY_OPERATOR_INVERSES[inner.operator]
      : inner.operator,
    value: inner.value,
    supported: true,
    text: formatNode(node, 'top'),
  };
}

/**
 * Renders builder rows back into query text.
 *
 * Unsupported rows are re-emitted from their captured source text so editing a
 * neighbouring row never destroys a hand-written condition.
 */
export function fromBuilderGroups(groups: QueryBuilderGroup[]): string {
  const branches = groups
    .map((group) => {
      const terms = group.rows
        .map((row) => formatBuilderRow(row))
        .filter((term) => term.length > 0);
      return terms.join(' AND ');
    })
    .filter((branch) => branch.length > 0);

  if (branches.length <= 1) {
    return branches[0] ?? '';
  }
  return branches
    .map((branch) => (branch.includes(' AND ') ? `(${branch})` : branch))
    .join(' OR ');
}

function formatBuilderRow(row: QueryBuilderRow): string {
  if (!row.supported) {
    return row.text.trim();
  }
  if (!row.value.trim()) {
    return '';
  }
  const condition: QueryConditionNode = {
    type: 'condition',
    field: row.field,
    operator: row.operator,
    value: row.value.trim(),
    start: 0,
    end: 0,
  };
  return formatCondition(condition);
}

/**
 * Collects every tag key a query names, for chip and title rendering.
 */
export function collectQueryTagKeys(node: QueryNode | undefined): string[] {
  const keys: string[] = [];
  visitConditions(node, (condition) => {
    if (condition.field === 'tag' && !isWildcard(condition.value)) {
      keys.push(condition.value);
    }
  });
  return [...new Set(keys)];
}

/**
 * Walks every condition in a query, ignoring the shape of the logic above it.
 */
export function visitConditions(
  node: QueryNode | undefined,
  visit: (condition: QueryConditionNode) => void,
): void {
  if (!node) {
    return;
  }
  if (node.type === 'condition') {
    visit(node);
    return;
  }
  if (node.type === 'not') {
    visitConditions(node.child, visit);
    return;
  }
  node.children.forEach((child) => visitConditions(child, visit));
}

/**
 * Reports whether a query can only be answered by the notes pane, the tasks
 * pane, or both, so empty panes can explain themselves accurately.
 */
export function getQueryFields(node: QueryNode | undefined): Set<QueryField> {
  const fields = new Set<QueryField>();
  visitConditions(node, (condition) => fields.add(condition.field));
  return fields;
}

