import { formatQuery } from './queryFormat';
import { parseQuery } from './queryParser';
import { ParsedQuery, QueryNode } from './queryTypes';

/**
 * Edits query text by the terms a person wrote, rather than by rewriting it.
 *
 * Removing a chip or lifting a tag into the page's title cuts the words out
 * of the text where they stand, so `vendor #atlas is:open` loses `is:open`
 * and keeps the rest exactly as it was typed, instead of coming back in the
 * canonical `text ~ vendor AND tag = #atlas` spelling.
 */
export interface QueryTerm {
  /** The term as it was written. */
  text: string;
  /** The whole query without this term. */
  without: string;
}

interface TermSpan {
  node: QueryNode;
  start?: number;
  end?: number;
}

/**
 * Lists the terms joined by AND at the top of a query. A query whose top
 * level is an OR has no such terms, since removing one branch is not what
 * removing a filter means.
 */
export function getTopLevelTerms(parsed: ParsedQuery): QueryTerm[] {
  const spans = getTermSpans(parsed);
  if (!spans) {
    return [];
  }
  return spans.map((span, index) => {
    const others = spans.filter((_, otherIndex) => otherIndex !== index);
    if (span.start === undefined || span.end === undefined) {
      return {
        text: formatQuery(span.node),
        without: joinTerms(others.map((other) => other.node)),
      };
    }
    return {
      text: parsed.text.slice(span.start, span.end),
      without: tidy(
        parsed.text.slice(0, span.start) + ' ' + parsed.text.slice(span.end),
      ),
    };
  });
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
      .replace(/^(?:and|&&)\s+/i, '')
      .replace(/\s+(?:and|&&)$/i, '')
      .replace(/^(?:and|&&)$/i, '')
      .replace(/\s+(?:and|&&)\s+(?:and|&&)\s+/gi, ' AND ')
      .replace(/\(\s*(?:and|&&)\s+/gi, '(')
      .replace(/\s+(?:and|&&)\s*\)/gi, ')')
      .trim();
  } while (result !== previous);
  return result;
}
