import { describeOperator } from './queryParser';
import {
  QUERY_OPERATOR_INVERSES,
  QUERY_SHORTHAND_FIELDS,
  QueryBuilderGroup,
  QueryBuilderItem,
  QueryBuilderRow,
  QueryConditionNode,
  QueryField,
  QueryNode,
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
 * Projects an AST into the tree the visual builder edits.
 *
 * The tree is the AST with two conveniences: a negated condition folds into
 * its opposite operator, so a row needs no negate control that could disagree
 * with it; and a negated group carries `negated` rather than a NOT node above
 * it. Nothing is left as text: every query the language can write is rows and
 * groups here, and a group's join and negation are the reader's to change.
 */
export function toBuilderTree(node: QueryNode | undefined): QueryBuilderGroup {
  if (!node) {
    return { join: 'and', items: [] };
  }
  const item = toBuilderItem(node);
  return 'items' in item ? item : { join: 'and', items: [item] };
}

function toBuilderItem(node: QueryNode): QueryBuilderItem {
  if (node.type === 'condition') {
    return conditionRow(node, false);
  }
  if (node.type === 'not') {
    const inner = node.child;
    if (inner.type === 'condition') {
      return conditionRow(inner, true);
    }
    if (inner.type === 'not') {
      return toBuilderItem(inner.child);
    }
    return { join: inner.type, negated: true, items: inner.children.map(toBuilderItem) };
  }
  return { join: node.type, items: node.children.map(toBuilderItem) };
}

function conditionRow(node: QueryConditionNode, negated: boolean): QueryBuilderRow {
  return {
    field: node.field,
    operator: negated ? QUERY_OPERATOR_INVERSES[node.operator] : node.operator,
    value: node.value,
    supported: true,
    text: formatNode(negated ? { type: 'not', child: node } : node, 'top'),
  };
}

/**
 * Renders the builder's tree back into query text.
 *
 * A nested group with more than one term is parenthesized, whatever its join,
 * so it reads as the group it is; a negated one is `NOT (…)`. A row with no
 * value yet is left out, so a half-typed row does not change the search.
 */
export function fromBuilderTree(group: QueryBuilderGroup, depth = 0): string {
  const terms = group.items
    .map((item) => ('items' in item ? fromBuilderTree(item, depth + 1) : formatBuilderRow(item)))
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return '';
  }
  const body = terms.join(group.join === 'or' ? ' OR ' : ' AND ');
  if (group.negated) {
    return `NOT ${terms.length > 1 ? `(${body})` : body}`;
  }
  return depth > 0 && terms.length > 1 ? `(${body})` : body;
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

