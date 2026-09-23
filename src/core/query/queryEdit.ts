import { formatQuery } from './queryFormat';
import { parseQuery } from './queryParser';
import {
  ParsedQuery,
  QueryBuilderJoin,
  QueryConditionNode,
  QueryNode,
  QueryTermChip,
} from './queryTypes';

/**
 * Edits query text by the terms a person wrote, rather than by rewriting it.
 *
 * Removing a chip or lifting a tag into the page's title cuts the words out
 * of the text where they stand, so `vendor #atlas is:open` loses `is:open`
 * and keeps the rest exactly as it was typed, instead of coming back in the
 * canonical `text ~ vendor AND tag = #atlas` spelling.
 */
export type QueryTerm = QueryTermChip;

interface TermSpan {
  node: QueryNode;
  start?: number;
  end?: number;
}

/**
 * Lists a query's terms as the search box shows them: the children of its
 * top-level AND or OR, each removable alone, and a group among them with
 * its own children listed the same way, so a condition inside a group can
 * be removed on its own and the group can be removed whole, as the builder
 * has it. `getTopLevelJoin` says which word joins the top level.
 *
 * Removing cuts the term out of the text as written, with the AND or OR
 * that went with it; a term whose place in the text cannot be found is
 * removed from the parsed query and the rest written back.
 */
export function getTopLevelTerms(parsed: ParsedQuery): QueryTerm[] {
  const root = parsed.node;
  if (!root) {
    return [];
  }
  const join = getTopLevelJoin(parsed);
  const children = root.type === 'and' || root.type === 'or' ? root.children : [root];
  return children.map((child) => termOf(parsed, root, child, join));
}

/** The word between a query's top-level terms. */
export function getTopLevelJoin(parsed: ParsedQuery): QueryBuilderJoin {
  return parsed.node?.type === 'or' ? 'or' : 'and';
}

function termOf(
  parsed: ParsedQuery,
  root: QueryNode,
  node: QueryNode,
  join: QueryBuilderJoin,
): QueryTerm {
  const span = spanOf(parsed.text, node);
  const text = span ? parsed.text.slice(span.start, span.end) : formatQuery(node);
  const without = span
    ? cutTerm(parsed.text, span, join)
    : formatQuery(removeNode(root, node));
  const group = node.type === 'not' ? node.child : node;
  if (group.type === 'and' || group.type === 'or') {
    return {
      text,
      without,
      join: group.type,
      ...(node.type === 'not' ? { negated: true } : {}),
      items: group.children.map((child) => termOf(parsed, root, child, group.type)),
    };
  }
  return {
    text,
    ...(isBareWords(node, text) ? { label: formatQuery(node) } : {}),
    without,
    ...(node.type === 'not' ? { negated: true } : {}),
  };
}

interface Span {
  start: number;
  end: number;
}

/**
 * Where a node was written, taking in the parentheses around it and the
 * NOT before it. A group's place runs from its first child's to its last
 * child's; undefined when a child's place is unknown, or the place found
 * would cut a parenthesis in half.
 */
function spanOf(text: string, node: QueryNode): Span | undefined {
  let span: Span | undefined;
  if (node.type === 'condition') {
    span = { start: node.start, end: node.end };
  } else if (node.type === 'not') {
    const inner = spanOf(text, node.child);
    const start = inner && findNegationStart(text, inner.start);
    span = inner && start !== undefined ? { start, end: inner.end } : undefined;
  } else {
    const spans = node.children.map((child) => spanOf(text, child));
    if (spans.every((child): child is Span => child !== undefined)) {
      span = {
        start: Math.min(...spans.map((child) => child.start)),
        end: Math.max(...spans.map((child) => child.end)),
      };
    }
  }
  if (!span) {
    return undefined;
  }
  span = widenOverParentheses(text, span);
  return isBalanced(text.slice(span.start, span.end)) ? span : undefined;
}

/** Takes in each pair of parentheses written directly around a place. */
function widenOverParentheses(text: string, span: Span): Span {
  let { start, end } = span;
  for (;;) {
    const before = /\(\s*$/.exec(text.slice(0, start));
    const after = /^\s*\)/.exec(text.slice(end));
    if (!before || !after) {
      return { start, end };
    }
    start = before.index;
    end += after[0].length;
  }
}

function isBalanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * The text without the term at a place, and without the join that stood
 * beside it: the one before it when there is one, else the one after, so
 * `a OR b` loses ` OR b` or `a OR ` and never keeps a dangling OR.
 */
function cutTerm(text: string, span: Span, join: QueryBuilderJoin): string {
  const words = join === 'or' ? '(?:or|\\|\\|)' : '(?:and|&&)';
  const before = new RegExp('\\s+' + words + '\\s*$', 'i').exec(text.slice(0, span.start));
  const after = new RegExp('^\\s*' + words + '\\s+', 'i').exec(text.slice(span.end));
  const start = before ? before.index : span.start;
  const end = !before && after ? span.end + after[0].length : span.end;
  return tidy(text.slice(0, start) + ' ' + text.slice(end));
}

/**
 * The query without one of its nodes: a group left with one child becomes
 * that child, and one left with none goes, as does a NOT of nothing.
 */
function removeNode(root: QueryNode, target: QueryNode): QueryNode | undefined {
  if (root === target) {
    return undefined;
  }
  if (root.type === 'not') {
    const child = removeNode(root.child, target);
    return child ? { type: 'not', child } : undefined;
  }
  if (root.type === 'and' || root.type === 'or') {
    const children = root.children
      .map((child) => removeNode(child, target))
      .filter((child): child is QueryNode => child !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { type: root.type, children };
  }
  return root;
}

/**
 * Whether a term is words written without their `text` field, which runs as
 * a `text ~` condition.
 */
function isBareWords(node: QueryNode, written: string): boolean {
  const condition = node.type === 'not' ? node.child : node;
  return (
    condition.type === 'condition' &&
    condition.field === 'text' &&
    !/^\s*(?:[-!]|not\s+)?\s*text\b/i.test(written)
  );
}

/**
 * Takes whole, positive tag terms out of a query, leaving everything else as
 * it was written. A query whose top level is an OR is left alone.
 *
 * `resolve` returns a tag's canonical key, or undefined for a tag that is
 * not in the index, which stays in the text.
 */
export function extractTagTerms(
  text: string,
  resolve: (tagKey: string) => string | undefined,
): { tagKeys: string[]; rest: string } {
  const parsed = parseQuery(text);
  const spans = getTermSpans(parsed);
  if (!spans) {
    return { tagKeys: [], rest: text.trim() };
  }
  const tagKeys: string[] = [];
  const cuts: Array<{ start: number; end: number }> = [];
  spans.forEach((span) => {
    const node = span.node;
    if (
      node.type !== 'condition' ||
      node.field !== 'tag' ||
      node.operator !== 'eq' ||
      node.value.includes('*') ||
      node.value.includes('?') ||
      span.start === undefined ||
      span.end === undefined
    ) {
      return;
    }
    const tagKey = resolve(node.value);
    if (tagKey) {
      if (!tagKeys.includes(tagKey)) {
        tagKeys.push(tagKey);
      }
      cuts.push({ start: span.start, end: span.end });
    }
  });
  const rest = cuts
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, cut) => current.slice(0, cut.start) + ' ' + current.slice(cut.end),
      text,
    );
  return { tagKeys, rest: tidy(rest) };
}

/**
 * The words of a query made only of plain words, or undefined when it has
 * any other kind of condition.
 */
export function getPlainTextTerms(node: QueryNode | undefined): string[] | undefined {
  if (!node) {
    return undefined;
  }
  const terms: string[] = [];
  const collect = (current: QueryNode): boolean => {
    if (current.type === 'and') {
      return current.children.every(collect);
    }
    if (
      current.type === 'condition' &&
      current.field === 'text' &&
      current.operator === 'contains'
    ) {
      terms.push(current.value);
      return true;
    }
    return false;
  };
  return collect(node) ? terms : undefined;
}

/**
 * Every word a query searches note text for, lowercased and deduplicated.
 *
 * Only a positive `text` condition contributes: a tag, a folder, or a file
 * name is a name rather than prose, and a negated condition names what the
 * reader already knows is not there, so neither is worth correcting.
 */
export function getTextWords(node: QueryNode | undefined): string[] {
  const words = new Set<string>();
  forEachTextCondition(node, (condition) => {
    condition.value
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.forEach((word: string) => words.add(word));
  });
  return [...words];
}

/**
 * Visits every `text` condition a query searches for positively, wherever it
 * sits in the tree.
 */
function forEachTextCondition(
  node: QueryNode | undefined,
  visit: (condition: QueryConditionNode) => void,
): void {
  const walk = (current: QueryNode, negated: boolean): void => {
    switch (current.type) {
      case 'not':
        walk(current.child, !negated);
        return;
      case 'and':
      case 'or':
        current.children.forEach((child) => walk(child, negated));
        return;
      case 'condition':
        if (
          !negated &&
          current.field === 'text' &&
          (current.operator === 'contains' || current.operator === 'eq')
        ) {
          visit(current);
        }
    }
  };
  if (node) {
    walk(node, false);
  }
}

/**
 * Rewrites a query with each misspelled word replaced by `correct`'s answer.
 *
 * Only the text a `text` condition searches for is rewritten, and each
 * condition is rewritten where it stands, so a correction can never reach a
 * tag, a path, or a field name that happens to share the word's spelling.
 * Returns nothing when no word was corrected.
 */
export function correctQueryText(
  text: string,
  node: QueryNode | undefined,
  correct: (word: string) => string | undefined,
): string | undefined {
  if (!node) {
    return undefined;
  }
  const spans: { start: number; end: number }[] = [];
  forEachTextCondition(node, (condition) =>
    spans.push({ start: condition.start, end: condition.end }),
  );

  let corrected = text;
  let changed = false;
  // Right to left, so an earlier condition's offsets still point at the same
  // characters after a later one has been rewritten.
  for (const span of spans.sort((left, right) => right.start - left.start)) {
    const source = corrected.slice(span.start, span.end);
    const rewritten = source.replace(/[\p{L}\p{N}]+/gu, (word: string) => {
      const replacement = correct(word.toLowerCase());
      if (!replacement || replacement === word.toLowerCase()) {
        return word;
      }
      changed = true;
      return replacement;
    });
    corrected =
      corrected.slice(0, span.start) + rewritten + corrected.slice(span.end);
  }
  return changed ? corrected : undefined;
}

/**
 * A query narrowed by one facet value, written as the search box's Refine
 * writes it: `and` adds the value with AND, `exclude` adds it negated, and
 * `or` puts it beside `alternativeTo`, the value of the same facet the query
 * already has.
 */
export function refineQueryText(
  text: string,
  clause: string,
  mode: 'and' | 'exclude' | 'or',
  alternativeTo?: string,
): string {
  const current = text.trim();
  if (mode === 'or' && alternativeTo) {
    const merged = mergeAlternative(current, alternativeTo, clause);
    if (merged !== undefined) {
      return merged;
    }
  }
  const term = mode === 'exclude' ? `-${clause}` : clause;
  if (!current) {
    return term;
  }
  return canAppendTerm(parseQuery(current))
    ? `${current} AND ${term}`
    : `(${current}) AND ${term}`;
}

/** Puts a clause beside an existing one as an alternative. */
function mergeAlternative(
  text: string,
  existing: string,
  clause: string,
): string | undefined {
  const escaped = existing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[\\s(])${escaped}(?=$|[\\s)])`, 'i').exec(text);
  if (!match) {
    return undefined;
  }
  const start = match.index + match[1].length;
  const end = start + existing.length;
  let depth = 0;
  for (let position = 0; position < start; position += 1) {
    if (text.charAt(position) === '(') {
      depth += 1;
    }
    if (text.charAt(position) === ')') {
      depth -= 1;
    }
  }
  return depth > 0
    ? `${text.slice(0, end)} OR ${clause}${text.slice(end)}`
    : `${text.slice(0, start)}(${existing} OR ${clause})${text.slice(end)}`;
}

/**
 * Whether a term can be added to the end of a query as another AND, which is
 * true unless the query's top level is an OR.
 */
export function canAppendTerm(parsed: ParsedQuery): boolean {
  return parsed.node?.type !== 'or';
}

function getTermSpans(parsed: ParsedQuery): TermSpan[] | undefined {
  const node = parsed.node;
  if (!node || node.type === 'or') {
    return undefined;
  }
  const children = node.type === 'and' ? node.children : [node];
  return children.map((child) => {
    if (child.type === 'condition') {
      return { node: child, start: child.start, end: child.end };
    }
    if (child.type === 'not' && child.child.type === 'condition') {
      const start = findNegationStart(parsed.text, child.child.start);
      return start === undefined
        ? { node: child }
        : { node: child, start, end: child.child.end };
    }
    return { node: child };
  });
}

/**
 * Finds the `-`, `!`, or `NOT` written just before a negated condition.
 */
function findNegationStart(text: string, conditionStart: number): number | undefined {
  const before = text.slice(0, conditionStart);
  if (before.endsWith('-') || before.endsWith('!')) {
    return conditionStart - 1;
  }
  const match = /(^|[\s(])not\s+$/i.exec(before);
  return match ? match.index + match[1].length : undefined;
}

function joinTerms(nodes: QueryNode[]): string {
  if (nodes.length === 0) {
    return '';
  }
  return formatQuery(
    nodes.length === 1 ? nodes[0] : { type: 'and', children: nodes },
  );
}

/**
 * Removes the spaces and dangling ANDs a cut leaves behind.
 */
function tidy(text: string): string {
  let result = text.replace(/\s+/g, ' ').trim();
  let previous;
  do {
    previous = result;
    result = result
      .replace(/\(\s*\)/g, '')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/^(?:and|&&|or|\|\|)\s+/i, '')
      .replace(/\s+(?:and|&&|or|\|\|)$/i, '')
      .replace(/^(?:and|&&|or|\|\|)$/i, '')
      .replace(/\s+(?:and|&&)\s+(?:and|&&)\s+/gi, ' AND ')
      .replace(/\s+(?:or|\|\|)\s+(?:or|\|\|)\s+/gi, ' OR ')
      .replace(/\(\s*(?:and|&&|or|\|\|)\s+/gi, '(')
      .replace(/\s+(?:and|&&|or|\|\|)\s*\)/gi, ')')
      .replace(/^(?:not|-|!)\s*$/i, '')
      .trim();
  } while (result !== previous);
  return result;
}
