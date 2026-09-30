import { parseWikiTarget } from '../workspace/backlinks';
import { resolveDateRange } from './queryDates';
import {
  ParsedQuery,
  QueryConditionNode,
  QueryDiagnostic,
  QueryField,
  QueryNode,
  QueryOperator,
  QUERY_FIELD_OPERATORS,
  QUERY_OPERATOR_INVERSES,
  QUERY_TASK_DATE_FIELDS,
} from './queryTypes';

/**
 * Parses DQL, the Deckard query language.
 *
 * The grammar is deliberately small so a query stays readable in one line:
 *
 * ```
 * query      := orExpression
 * orExpression  := andExpression (OR andExpression)*
 * andExpression := notExpression (AND? notExpression)*
 * notExpression := (NOT | '-' | '!')? primary
 * primary    := '(' orExpression ')' | condition
 * condition  := field operator value | tagToken | linkToken | textToken
 * ```
 *
 * Adjacent terms are joined with an implicit AND, so `#project/atlas #urgent`
 * means the same thing as `#project/atlas AND #urgent`. A bare `#tag` or
 * `@person` token is a tag condition and a bare or quoted word is a text
 * condition, which keeps simple searches free of field syntax. A bare
 * `[[Note]]` is a link condition, `link = [[Note]]`.
 *
 * `=` is the equality operator. `:` is still accepted as a synonym so queries
 * written before `=` became canonical keep working.
 *
 * `is:open`, `has:due`, `no:due`, and `in:notes/work` are shorthands. `no:` is
 * `has:` with its meaning reversed, so it needs no field of its own.
 */
export function parseQuery(text: string): ParsedQuery {
  const diagnostics: QueryDiagnostic[] = [];
  const tokens = tokenize(text, diagnostics);
  if (tokens.length === 0) {
    return { text, diagnostics };
  }

  const parser = new Parser(tokens, text, diagnostics);
  const node = parser.parse();
  const hasError = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error',
  );
  return {
    text,
    node: hasError ? undefined : node,
    diagnostics,
  };
}

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
  status: 'task',
  due: 'due',
  deadline: 'due',
  scheduled: 'scheduled',
  start: 'start',
  starts: 'start',
  done: 'done',
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

/** The spelling of `has:` that means "has no". */
const NEGATED_HAS = 'no';

/**
 * Values `is:` accepts, mapped to their canonical value.
 */
const IS_VALUE_ALIASES: Readonly<Record<string, string>> = {
  open: 'open',
  todo: 'open',
  active: 'open',
  done: 'done',
  complete: 'done',
  completed: 'done',
  task: 'task',
  tasks: 'task',
  note: 'note',
  notes: 'note',
  overdue: 'overdue',
  late: 'overdue',
  due: 'due',
  soon: 'due',
  today: 'today',
  'needs-date': 'needs-date',
  needsdate: 'needs-date',
  blocked: 'blocked',
  // Waiting on someone, as the board's Waiting column means. It was once a
  // second spelling of blocked, which is held up by another task.
  waiting: 'waiting',
  available: 'available',
  actionable: 'available',
  blocking: 'blocking',
  blocker: 'blocking',
  mine: 'mine',
  me: 'mine',
  assigned: 'assigned',
  unassigned: 'unassigned',
  anyone: 'unassigned',
  daily: 'daily',
  journal: 'daily',
  periodic: 'periodic',
  dated: 'periodic',
  parked: 'parked',
  step: 'step',
  substep: 'step',
  subtask: 'step',
};

/**
 * Values `has:` and `no:` accept, mapped to their canonical value.
 */
const HAS_VALUE_ALIASES: Readonly<Record<string, string>> = {
  due: 'due',
  deadline: 'due',
  scheduled: 'scheduled',
  start: 'start',
  starts: 'start',
  done: 'done',
  completed: 'done',
  priority: 'priority',
  id: 'id',
  dependson: 'dependsOn',
  dependencies: 'dependsOn',
  blockedby: 'dependsOn',
  steps: 'steps',
  subtasks: 'steps',
};

/**
 * Task states accepted in a query, mapped to their canonical value.
 */
const TASK_VALUE_ALIASES: Readonly<Record<string, string>> = {
  open: 'open',
  todo: 'open',
  active: 'open',
  incomplete: 'open',
  unchecked: 'open',
  done: 'done',
  complete: 'done',
  completed: 'done',
  checked: 'done',
  any: 'any',
  all: 'any',
};

/**
 * Priorities accepted in a query. `normal` is Tasks' name for no priority.
 */
const PRIORITY_VALUE_ALIASES: Readonly<Record<string, string>> = {
  highest: 'highest',
  high: 'high',
  medium: 'medium',
  none: 'none',
  normal: 'none',
  low: 'low',
  lowest: 'lowest',
};

type TokenType =
  | 'word'
  | 'link'
  | 'string'
  | 'operator'
  | 'and'
  | 'or'
  | 'not'
  | 'lparen'
  | 'rparen';

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  /** For a link, the whole `[[…]]` as written. */
  raw?: string;
}

/** Characters that terminate a bare word. */
const WORD_BREAK = new Set([
  ':',
  '=',
  '<',
  '>',
  '~',
  '!',
  '(',
  ')',
  '"',
  "'",
]);

/**
 * Splits query text into tokens.
 *
 * `-` and `!` become NOT only in operand position, so a hyphen inside a tag
 * such as `#risk/service-failure` is never mistaken for negation.
 */
function tokenize(text: string, diagnostics: QueryDiagnostic[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '(') {
      tokens.push({ type: 'lparen', value: '(', start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (character === ')') {
      tokens.push({ type: 'rparen', value: ')', start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      const start = index;
      index += 1;
      let value = '';
      let closed = false;
      while (index < text.length) {
        if (text[index] === '\\' && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        if (text[index] === character) {
          closed = true;
          index += 1;
          break;
        }
        value += text[index];
        index += 1;
      }
      if (!closed) {
        diagnostics.push({
          message: 'This quoted value is missing its closing quote.',
          severity: 'error',
          start,
          end: index,
        });
      }
      tokens.push({ type: 'string', value, start, end: index });
      continue;
    }

    if (text.startsWith('[[', index)) {
      // `[[Atlas plan]]` is one term, spaces and all; links do not nest.
      const start = index;
      const close = text.indexOf(']]', index + 2);
      const end = close < 0 ? text.length : close + 2;
      if (close < 0) {
        diagnostics.push({
          message: 'This link is missing its closing ]].',
          severity: 'error',
          start,
          end,
        });
      }
      tokens.push({
        type: 'link',
        value: text.slice(start + 2, close < 0 ? end : close),
        start,
        end,
        raw: text.slice(start, end),
      });
      index = end;
      continue;
    }

    const twoCharacter = text.slice(index, index + 2);
    if (
      twoCharacter === '!=' ||
      twoCharacter === '!~' ||
      twoCharacter === '>=' ||
      twoCharacter === '<='
    ) {
      tokens.push({
        type: 'operator',
        value: twoCharacter,
        start: index,
        end: index + 2,
      });
      index += 2;
      continue;
    }
    if (twoCharacter === '&&' || twoCharacter === '||') {
      tokens.push({
        type: twoCharacter === '&&' ? 'and' : 'or',
        value: twoCharacter,
        start: index,
        end: index + 2,
      });
      index += 2;
      continue;
    }

    if (
      character === ':' ||
      character === '=' ||
      character === '~' ||
      character === '>' ||
      character === '<'
    ) {
      tokens.push({
        type: 'operator',
        value: character,
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }

    if (
      (character === '-' || character === '!') &&
      isOperandPosition(tokens, text, index) &&
      index + 1 < text.length &&
      !/\s/.test(text[index + 1])
    ) {
      tokens.push({
        type: 'not',
        value: character,
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }

    const start = index;
    while (
      index < text.length &&
      !/\s/.test(text[index]) &&
      !WORD_BREAK.has(text[index])
    ) {
      index += 1;
    }
    if (index === start) {
      // Defensive: an unexpected character would otherwise loop forever.
      diagnostics.push({
        message: `Deckard does not understand "${character}" here.`,
        severity: 'error',
        start,
        end: start + 1,
      });
      index += 1;
      continue;
    }
    const value = text.slice(start, index);
    const keyword = value.toLowerCase();
    if (keyword === 'and') {
      tokens.push({ type: 'and', value, start, end: index });
    } else if (keyword === 'or') {
      tokens.push({ type: 'or', value, start, end: index });
    } else if (keyword === 'not') {
      tokens.push({ type: 'not', value, start, end: index });
    } else {
      tokens.push({ type: 'word', value, start, end: index });
    }
  }

  return tokens;
}

/**
 * Reports whether `-` or `!` at this offset begins a negated term.
 *
 * Negation is only recognized at the start of a term — the start of the query,
 * or after whitespace or an opening parenthesis — so the hyphen inside
 * `#risk/service-failure` is never read as an operator. A `-` that follows a
 * comparison operator belongs to that condition's value instead.
 */
function isOperandPosition(
  tokens: Token[],
  text: string,
  index: number,
): boolean {
  const previous = tokens[tokens.length - 1];
  if (previous?.type === 'operator') {
    return false;
  }
  return index === 0 || /[\s(]/.test(text[index - 1]);
}

class Parser {
  private position = 0;

  public constructor(
    private readonly tokens: Token[],
    private readonly text: string,
    private readonly diagnostics: QueryDiagnostic[],
  ) {}

  public parse(): QueryNode | undefined {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing) {
      this.diagnostics.push({
        message: `Deckard could not read "${trailing.value}" here.`,
        severity: 'error',
        start: trailing.start,
        end: trailing.end,
      });
    }
    return node;
  }

  private parseOr(): QueryNode | undefined {
    const children: QueryNode[] = [];
    const first = this.parseAnd();
    if (first) {
      children.push(first);
    }
    while (this.peek()?.type === 'or') {
      this.next();
      const right = this.parseAnd();
      if (right) {
        children.push(right);
      }
    }
    if (children.length === 0) {
      return undefined;
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  private parseAnd(): QueryNode | undefined {
    const first = this.parseNot();
    if (!first) {
      return undefined;
    }

    const children: QueryNode[] = [first];
    for (;;) {
      const explicit = this.peek()?.type === 'and';
      if (explicit) {
        this.next();
      } else if (!this.startsPrimary()) {
        break;
      }
      const child = this.parseNot();
      if (!child) {
        break;
      }
      children.push(child);
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  private parseNot(): QueryNode | undefined {
    if (this.peek()?.type === 'not') {
      const token = this.next();
      const child = this.parseNot();
      if (!child) {
        this.diagnostics.push({
          message: 'NOT needs a condition after it.',
          severity: 'error',
          start: token.start,
          end: token.end,
        });
        return undefined;
      }
      return { type: 'not', child };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode | undefined {
    const token = this.peek();
    if (!token) {
      return undefined;
    }

    if (token.type === 'lparen') {
      this.next();
      const node = this.parseOr();
      const closing = this.peek();
      if (closing?.type === 'rparen') {
        this.next();
      } else {
        this.diagnostics.push({
          message: 'This group is missing its closing parenthesis.',
          severity: 'error',
          start: token.start,
          end: closing?.end ?? this.text.length,
        });
      }
      if (!node) {
        this.diagnostics.push({
          message: 'This group is empty.',
          severity: 'error',
          start: token.start,
          end: closing?.end ?? this.text.length,
        });
      }
      return node;
    }

    if (token.type === 'string') {
      this.next();
      return this.createCondition(
        'text',
        'contains',
        token.value,
        token.start,
        token.end,
      );
    }

    if (token.type === 'word') {
      return this.parseWordCondition();
    }

    if (token.type === 'link') {
      this.next();
      return this.createCondition('link', 'eq', token.value, token.start, token.end);
    }

    if (token.type === 'operator') {
      this.next();
      this.diagnostics.push({
        message: `"${token.value}" needs a field name before it.`,
        severity: 'error',
        start: token.start,
        end: token.end,
      });
      return undefined;
    }

    return undefined;
  }

  /**
   * Reads a bare word as a field condition, a tag, or free text.
   */
  private parseWordCondition(): QueryNode | undefined {
    const word = this.next();
    const operatorToken =
      this.peek()?.type === 'operator' ? this.peek() : undefined;

    if (!operatorToken) {
      if (word.value.startsWith('#') || word.value.startsWith('@')) {
        return this.createCondition(
          'tag',
          'eq',
          word.value,
          word.start,
          word.end,
        );
      }
      return this.createCondition(
        'text',
        'contains',
        word.value,
        word.start,
        word.end,
      );
    }

    const field = FIELD_ALIASES[word.value.toLowerCase()];
    if (!field) {
      this.diagnostics.push({
        message: `"${word.value}" is not a Deckard query field. Use one of: ${Object.keys(
          FIELD_ALIASES,
        )
          .slice(0, 8)
          .join(', ')}.`,
        severity: 'error',
        start: word.start,
        end: operatorToken.end,
      });
      this.next();
      this.consumeValueToken();
      return undefined;
    }

    this.next();
    let operator = readOperator(operatorToken.value, field);
    // `created:>2026-01-01` reads the comparison that follows a plain colon.
    const chained = this.peek();
    if (
      (operatorToken.value === ':' || operatorToken.value === '=') &&
      chained?.type === 'operator' &&
      ['>', '>=', '<', '<=', '~'].includes(chained.value)
    ) {
      this.next();
      operator = readOperator(chained.value, field);
    }
    if (word.value.toLowerCase() === NEGATED_HAS) {
      operator = QUERY_OPERATOR_INVERSES[operator];
    }

    const valueToken = this.consumeValueToken(field);
    if (!valueToken) {
      this.diagnostics.push({
        message: `${field} needs a value after "${operatorToken.value}".`,
        severity: 'error',
        start: word.start,
        end: operatorToken.end,
      });
      return undefined;
    }

    if (!QUERY_FIELD_OPERATORS[field].includes(operator)) {
      this.diagnostics.push({
        message: `${field} does not support "${operatorToken.value}". Try: ${QUERY_FIELD_OPERATORS[
          field
        ]
          .map(describeOperator)
          .join(', ')}.`,
        severity: 'error',
        start: word.start,
        end: valueToken.end,
      });
      return undefined;
    }

    return this.createCondition(
      field,
      operator,
      valueToken.value,
      word.start,
      valueToken.end,
    );
  }

  /**
   * Takes the token that supplies a condition's value, if one is present.
   */
  private consumeValueToken(field?: QueryField): Token | undefined {
    const token = this.peek();
    if (
      !token ||
      (token.type !== 'word' && token.type !== 'string' && token.type !== 'link')
    ) {
      return undefined;
    }
    this.next();
    // `text ~ [[x]]` still means the characters; only `link` reads the name.
    return token.type === 'link' && field !== 'link'
      ? { ...token, type: 'word', value: token.raw ?? token.value }
      : token;
  }

  /**
   * Validates a condition's value before it reaches the evaluator.
   */
  private createCondition(
    field: QueryField,
    operator: QueryOperator,
    rawValue: string,
    start: number,
    end: number,
  ): QueryConditionNode | undefined {
    const value = rawValue.trim();
    if (field === 'link') {
      const target = readLinkValue(value);
      if (!target) {
        this.diagnostics.push({
          message: "link needs a note's name, such as [[Atlas]] or [[Atlas#Decision]].",
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return { type: 'condition', field, operator, value: target, start, end };
    }
    if (!value) {
      this.diagnostics.push({
        message: `${field} needs a value.`,
        severity: 'error',
        start,
        end,
      });
      return undefined;
    }

    if (field === 'is') {
      const normalized = IS_VALUE_ALIASES[value.toLowerCase()];
      if (!normalized) {
        this.diagnostics.push({
          message: `is: accepts open, done, task, note, overdue, due, today, needs-date, waiting, available, blocked, blocking, mine, assigned, unassigned, daily, periodic, parked, or step — not "${value}".`,
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return { type: 'condition', field, operator, value: normalized, start, end };
    }

    if (field === 'has') {
      const normalized = HAS_VALUE_ALIASES[value.toLowerCase()];
      if (!normalized) {
        this.diagnostics.push({
          message: `has: and no: accept due, scheduled, start, done, priority, id, dependsOn, or steps — not "${value}".`,
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return { type: 'condition', field, operator, value: normalized, start, end };
    }

    if (field === 'in') {
      const folder = value.replace(/^\.\//, '').replace(/\/+$/, '');
      if (!folder) {
        this.diagnostics.push({
          message: 'in: needs a folder, such as in:notes/projects.',
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return { type: 'condition', field, operator, value: folder, start, end };
    }

    if (field === 'task') {
      const normalized = TASK_VALUE_ALIASES[value.toLowerCase()];
      if (!normalized) {
        this.diagnostics.push({
          message: `task accepts open, done, or any — not "${value}".`,
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return { type: 'condition', field, operator, value: normalized, start, end };
    }

    if (QUERY_TASK_DATE_FIELDS.includes(field)) {
      const normalized = value.toLowerCase();
      if (normalized === 'none' && operator !== 'eq' && operator !== 'neq') {
        this.diagnostics.push({
          message: `${field} compares with none only using = or !=.`,
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      if (normalized !== 'none' && !isDateValue(normalized)) {
        this.diagnostics.push({
          message: `${field} accepts a date such as 2026-09-13, friday, "oct 3", this-week, next-month, a window such as 7d, or none.`,
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return { type: 'condition', field, operator, value: normalized, start, end };
    }

    if (field === 'priority') {
      const normalized = PRIORITY_VALUE_ALIASES[value.toLowerCase()];
      if (!normalized) {
        this.diagnostics.push({
          message: `priority accepts highest, high, medium, none, low, or lowest — not "${value}".`,
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return { type: 'condition', field, operator, value: normalized, start, end };
    }

    if (field === 'created' || field === 'updated') {
      if (!isDateValue(value)) {
        this.diagnostics.push({
          message: `${field} accepts a date such as 2026-09-13, friday, this-week, last-month, 2026-08, or a window such as 30d.`,
          severity: 'error',
          start,
          end,
        });
        return undefined;
      }
      return {
        type: 'condition',
        field,
        operator,
        value: value.toLowerCase(),
        start,
        end,
      };
    }

    return { type: 'condition', field, operator, value, start, end };
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    this.position += 1;
    return token;
  }

  /**
   * Reports whether the next token could begin another AND operand.
   */
  private startsPrimary(): boolean {
    const type = this.peek()?.type;
    return (
      type === 'word' ||
      type === 'link' ||
      type === 'string' ||
      type === 'lparen' ||
      type === 'not'
    );
  }
}

/**
 * The note a `link` value names, as the AST keeps it: without brackets or an
 * alias after `|`, such as `Atlas`, `Atlas#Decision`, or `Atlas#^q3`. Empty
 * when no note is named, as in `[[#Decision]]`.
 */
export function readLinkValue(value: string): string {
  let inner = value.trim();
  if (inner.startsWith('[[')) {
    inner = inner.slice(2);
  }
  if (inner.endsWith(']]')) {
    inner = inner.slice(0, -2);
  }
  const bar = inner.indexOf('|');
  if (bar >= 0) {
    inner = inner.slice(0, bar);
  }
  const target = parseWikiTarget(inner);
  if (!target.note) {
    return '';
  }
  if (target.block) {
    return `${target.note}#^${target.block}`;
  }
  return target.heading ? `${target.note}#${target.heading}` : target.note;
}

/**
 * Maps written operators onto the evaluator's operator set.
 */
function readOperator(value: string, field: QueryField): QueryOperator {
  switch (value) {
    case '~':
      return 'contains';
    case '!~':
      return 'notContains';
    case '!=':
      return 'neq';
    case '>':
      return 'gt';
    case '>=':
      return 'gte';
    case '<':
      return 'lt';
    case '<=':
      return 'lte';
    default:
      return field === 'text' ? 'contains' : 'eq';
  }
}

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
 * Accepts absolute dates, relative windows such as `30d`, and named days.
 */
export function isDateValue(value: string): boolean {
  // Whether a value reads does not depend on the day, so any fixed day will do.
  return (
    resolveDateRange(value, DATE_CHECK_DAY, 'past') !== undefined &&
    resolveDateRange(value, DATE_CHECK_DAY, 'future') !== undefined
  );
}

const DATE_CHECK_DAY = new Date(2026, 0, 15, 12).getTime();
