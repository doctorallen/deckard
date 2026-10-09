import { resolveDateRange } from './queryDates';
import { readLinkValue } from './queryLinks';
import { normalizeFolder } from './queryValues';
import {
  ParsedQuery,
  QueryConditionNode,
  QueryFieldConditionNode,
  QueryFieldSchema,
  QueryNode,
  QueryTypeField,
  QUERY_FIELD_OPERATORS,
  QUERY_OPERATOR_INVERSES,
  QUERY_HAS_VALUES,
  QUERY_IS_VALUES,
  QUERY_PRIORITY_VALUES,
  QUERY_TASK_DATE_FIELDS,
  QUERY_TASK_VALUES,
  QUERY_OPERATOR_SYMBOLS,
  describeOperator,
  FIELD_ALIASES,
  THIS_VALUE,
  typeFieldOperators,
} from './queryTypes';
import { readCheckboxValue } from '../types/fieldValues';
import { QueryDiagnostic, QueryField, QueryOperator } from '../model';

export { FIELD_ALIASES };

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
 *
 * `schema` is what the workspace's types add (docs/implementation/
 * 30-databases.md § Query language): a name no built-in field takes is a
 * type field when the schema has it (`lead = @dana`, `team.lead = @dana`,
 * `tier = gold, silver`), `type = team` and `is:team` name a type's rows,
 * and `has:on-call` asks whether a field is filled. A name the schema does
 * not have either is reported with the type fields it could have meant.
 * Without a schema, only the built-in fields are known.
 */
export function parseQuery(text: string, schema?: QueryFieldSchema): ParsedQuery {
  const diagnostics: QueryDiagnostic[] = [];
  const tokens = tokenize(text, diagnostics);
  if (tokens.length === 0) {
    return { text, diagnostics };
  }

  const parser = new Parser(tokens, text, diagnostics, schema);
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

/** The spelling of `has:` that means "has no". */
const NEGATED_HAS = 'no';

/**
 * Values `is:` accepts, mapped to their canonical value.
 */
const IS_VALUE_ALIASES: Readonly<Record<string, string>> = {
  open: 'open',
  todo: 'open',
  active: 'open',
  'in-progress': 'in-progress',
  inprogress: 'in-progress',
  started: 'in-progress',
  done: 'done',
  complete: 'done',
  completed: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  closed: 'closed',
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
  cancelled: 'cancelled',
  canceled: 'cancelled',
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

/** What a token is to the grammar. */
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

/** A piece of query text as the parser reads it, with its offsets in the text. */
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
 * such as `#risk/service-failure` is never mistaken for negation. Each
 * position is offered to TOKEN_READERS in order, and the first that reads
 * something there moves past it.
 */
function tokenize(text: string, diagnostics: QueryDiagnostic[]): Token[] {
  const scan: TokenScan = { text, index: 0, tokens: [], diagnostics };
  while (scan.index < text.length) {
    TOKEN_READERS.some((read) => read(scan));
  }
  return scan.tokens;
}

/** Where tokenizing has got to: the text, the offset reached, and what it has found. */
interface TokenScan {
  readonly text: string;
  index: number;
  readonly tokens: Token[];
  readonly diagnostics: QueryDiagnostic[];
}

/**
 * Reads one kind of token at the scan's offset, and says whether it read
 * one; a reader that reads moves the offset past what it read.
 */
type TokenReader = (scan: TokenScan) => boolean;

/** Whitespace between tokens, skipped one character at a time. */
function skipSpace(scan: TokenScan): boolean {
  if (!/\s/.test(scan.text[scan.index])) {
    return false;
  }
  scan.index += 1;
  return true;
}

/** An opening or closing parenthesis. */
function readParenthesis(scan: TokenScan): boolean {
  const character = scan.text[scan.index];
  if (character !== '(' && character !== ')') {
    return false;
  }
  scan.tokens.push({
    type: character === '(' ? 'lparen' : 'rparen',
    value: character,
    start: scan.index,
    end: scan.index + 1,
  });
  scan.index += 1;
  return true;
}

/**
 * A quoted value, in double or single quotes, where a backslash takes the
 * next character as it is. One that is never closed runs to the end of the
 * text and is reported.
 */
function readQuoted(scan: TokenScan): boolean {
  const { text } = scan;
  const quote = text[scan.index];
  if (quote !== '"' && quote !== "'") {
    return false;
  }
  const start = scan.index;
  let index = start + 1;
  let value = '';
  let closed = false;
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      value += text[index + 1];
      index += 2;
      continue;
    }
    if (text[index] === quote) {
      closed = true;
      index += 1;
      break;
    }
    value += text[index];
    index += 1;
  }
  if (!closed) {
    scan.diagnostics.push({
      message: 'This quoted value is missing its closing quote.',
      severity: 'error',
      start,
      end: index,
    });
  }
  scan.tokens.push({ type: 'string', value, start, end: index });
  scan.index = index;
  return true;
}

/**
 * A `[[link]]`, read as one term, spaces and all; links do not nest. One
 * that is never closed runs to the end of the text and is reported.
 */
function readLink(scan: TokenScan): boolean {
  const { text } = scan;
  if (!text.startsWith('[[', scan.index)) {
    return false;
  }
  const start = scan.index;
  const close = text.indexOf(']]', start + 2);
  const end = close < 0 ? text.length : close + 2;
  if (close < 0) {
    scan.diagnostics.push({
      message: 'This link is missing its closing ]].',
      severity: 'error',
      start,
      end,
    });
  }
  scan.tokens.push({
    type: 'link',
    value: text.slice(start + 2, close < 0 ? end : close),
    start,
    end,
    raw: text.slice(start, end),
  });
  scan.index = end;
  return true;
}

/** The two-character operators, and `&&` and `||` for AND and OR. */
function readTwoCharacters(scan: TokenScan): boolean {
  const start = scan.index;
  const twoCharacter = scan.text.slice(start, start + 2);
  if (
    twoCharacter === '!=' ||
    twoCharacter === '!~' ||
    twoCharacter === '>=' ||
    twoCharacter === '<='
  ) {
    scan.tokens.push({ type: 'operator', value: twoCharacter, start, end: start + 2 });
    scan.index += 2;
    return true;
  }
  if (twoCharacter === '&&' || twoCharacter === '||') {
    scan.tokens.push({
      type: twoCharacter === '&&' ? 'and' : 'or',
      value: twoCharacter,
      start,
      end: start + 2,
    });
    scan.index += 2;
    return true;
  }
  return false;
}

/** The one-character operators: `:`, `=`, `~`, `>`, and `<`. */
function readOneCharacterOperator(scan: TokenScan): boolean {
  const character = scan.text[scan.index];
  if (
    character !== ':' &&
    character !== '=' &&
    character !== '~' &&
    character !== '>' &&
    character !== '<'
  ) {
    return false;
  }
  scan.tokens.push({ type: 'operator', value: character, start: scan.index, end: scan.index + 1 });
  scan.index += 1;
  return true;
}

/** A `-` or `!` that negates the term it stands against, in operand position. */
function readNegation(scan: TokenScan): boolean {
  const { text, index } = scan;
  const character = text[index];
  if (
    (character !== '-' && character !== '!') ||
    !isOperandPosition(scan.tokens, text, index) ||
    index + 1 >= text.length ||
    /\s/.test(text[index + 1])
  ) {
    return false;
  }
  scan.tokens.push({ type: 'not', value: character, start: index, end: index + 1 });
  scan.index += 1;
  return true;
}

/** The words that join or negate terms, in any case; any other word is a term. */
const KEYWORD_TYPES: ReadonlyMap<string, TokenType> = new Map<string, TokenType>([
  ['and', 'and'],
  ['or', 'or'],
  ['not', 'not'],
]);

/**
 * A bare word, up to whitespace or a character that ends one. It always
 * reads: a character no other reader takes is reported and passed over,
 * since it would otherwise stop the scan forever.
 */
function readWord(scan: TokenScan): boolean {
  const { text } = scan;
  const start = scan.index;
  let index = start;
  while (
    index < text.length &&
    !/\s/.test(text[index]) &&
    !WORD_BREAK.has(text[index])
  ) {
    index += 1;
  }
  if (index === start) {
    scan.diagnostics.push({
      message: `Deckard does not understand "${text[start]}" here.`,
      severity: 'error',
      start,
      end: start + 1,
    });
    scan.index = start + 1;
    return true;
  }
  const value = text.slice(start, index);
  scan.tokens.push({
    type: KEYWORD_TYPES.get(value.toLowerCase()) ?? 'word',
    value,
    start,
    end: index,
  });
  scan.index = index;
  return true;
}

/**
 * A status's character in its box, `[=]` or `[ ]`, as `status:` takes it:
 * one word, though the character is one that would end a word or none at
 * all. A box holding any other character reads as a word anyway.
 */
function readStatusBox(scan: TokenScan): boolean {
  const { text, index } = scan;
  const box = /^\[(.)\](?=$|[\s)])/u.exec(text.slice(index));
  if (!box || !(WORD_BREAK.has(box[1]) || /\s/u.test(box[1])) || (text[index - 1] !== ':' && text[index - 1] !== '=')) {
    return false;
  }
  scan.tokens.push({ type: 'word', value: box[0], start: index, end: index + box[0].length });
  scan.index = index + box[0].length;
  return true;
}

/** The token readers, in the order each position is offered to them. */
const TOKEN_READERS: readonly TokenReader[] = [
  skipSpace,
  readParenthesis,
  readQuoted,
  readLink,
  readStatusBox,
  readTwoCharacters,
  readOneCharacterOperator,
  readNegation,
  readWord,
];

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

/**
 * A recursive-descent parser over the tokens of one query, for the grammar
 * parseQuery states: OR binds loosest, then AND, written or implied, then
 * NOT. It reports what it cannot read in `diagnostics` and reads on, so one
 * pass names every problem.
 */
class Parser {
  private position = 0;

  /** Starts at the first token; `text` is the query, for the end of a group left open. */
  public constructor(
    private readonly tokens: Token[],
    private readonly text: string,
    private readonly diagnostics: QueryDiagnostic[],
    private readonly schema?: QueryFieldSchema,
  ) {}

  /** The whole query, and a diagnostic for anything left after it. */
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

  /** `orExpression := andExpression (OR andExpression)*`; undefined when no operand reads. */
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

  /**
   * `andExpression := notExpression (AND? notExpression)*`: an operand that
   * follows another with no AND between them is joined to it all the same.
   */
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

  /** `notExpression := (NOT | '-' | '!')? primary`, where a NOT may stand before another. */
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

  /**
   * `primary := '(' orExpression ')' | condition`: a group, a quoted text
   * condition, a word, or a bare `[[link]]`. An operator with no field
   * before it is reported.
   */
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
      return this.createCondition({
        field: 'text',
        operator: 'contains',
        value: token.value,
        start: token.start,
        end: token.end,
      });
    }

    if (token.type === 'word') {
      return this.parseWordCondition();
    }

    if (token.type === 'link') {
      this.next();
      return this.createCondition({
        field: 'link',
        operator: 'eq',
        value: token.value,
        start: token.start,
        end: token.end,
      });
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
   * Reads a word as a field condition, or, with no operator after it, as a
   * tag or free text. A built-in field's name wins; a name the schema has is
   * a type field. A field Deckard does not know, a missing value, and an
   * operator the field does not take are each reported.
   */
  private parseWordCondition(): QueryNode | undefined {
    const word = this.next();
    const operatorToken =
      this.peek()?.type === 'operator' ? this.peek() : undefined;
    if (!operatorToken) {
      return this.parseBareWord(word);
    }

    const field = lookupAlias(FIELD_ALIASES, word.value);
    if (!field) {
      const typeField = this.schema?.field(word.value);
      if (typeField) {
        this.next();
        return this.parseFieldCondition(word, operatorToken, typeField);
      }
      this.diagnostics.push({
        message: this.describeUnknownField(word.value),
        severity: 'error',
        start: word.start,
        end: operatorToken.end,
      });
      this.next();
      this.consumeValueToken();
      return undefined;
    }

    this.next();
    const operator = this.readConditionOperator(word, operatorToken, field === 'text' ? 'contains' : 'eq');
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

    // `type = team` names a type's rows when a type is called that; any
    // other value keeps the older meaning, a namespace.
    const typeKey = field === 'kind' && word.value.toLowerCase() === 'type' ? this.schema?.type(valueToken.value.trim()) : undefined;
    return this.createCondition({
      field: typeKey ? 'type' : field,
      operator,
      value: typeKey ?? valueToken.value,
      start: word.start,
      end: valueToken.end,
    });
  }

  /**
   * The sentence for a field no built-in or type has: the type fields it
   * could have meant, when there are some, else the built-in fields.
   */
  private describeUnknownField(name: string): string {
    const close = this.schema?.closest(name) ?? [];
    if (close.length > 0) {
      return `"${name}" is not a Deckard query field. Did you mean ${listAlternatives(close)}?`;
    }
    return `"${name}" is not a Deckard query field. Use one of: ${Object.keys(FIELD_ALIASES).slice(0, 8).join(', ')}.`;
  }

  /**
   * Reads the rest of a type field's condition, its operator already taken:
   * the operator its kind takes, and one value or several, written
   * `gold, silver`, any of which matches.
   */
  private parseFieldCondition(word: Token, operatorToken: Token, typeField: QueryTypeField): QueryNode | undefined {
    const operator = this.readConditionOperator(word, operatorToken, 'eq');
    const { values, end, unfinished } = this.readFieldValues(operatorToken.end);
    const name = typeField.name;
    if (values.length === 0 || unfinished) {
      this.diagnostics.push({
        message: values.length === 0 ? `${name} needs a value after "${operatorToken.value}".` : `${name} needs another value after the comma.`,
        severity: 'error',
        start: word.start,
        end,
      });
      return undefined;
    }
    const allowed = typeFieldOperators(typeField.kinds);
    if (!allowed.includes(operator)) {
      this.diagnostics.push({
        message: `${name} does not support "${operatorToken.value}". Try: ${allowed.map(describeOperator).join(', ')}.`,
        severity: 'error',
        start: word.start,
        end,
      });
      return undefined;
    }
    const refusal = values.map((value) => checkTypeFieldValue(name, typeField, operator, value)).find(Boolean);
    if (refusal) {
      this.diagnostics.push({ message: refusal, severity: 'error', start: word.start, end });
      return undefined;
    }
    const node: QueryFieldConditionNode = { type: 'field', name, operator, values, start: word.start, end };
    return node;
  }

  /**
   * A type field's values: a word, a quoted value, or a link, and more after
   * a comma, as `gold, silver` or `"Bond trading", rates` writes them.
   * `unfinished` is set when the last comma has nothing after it.
   */
  private readFieldValues(from: number): { values: string[]; end: number; unfinished: boolean } {
    const values: string[] = [];
    let end = from;
    let expecting = true;
    for (;;) {
      const token = this.peek();
      if (!token) {
        break;
      }
      if (token.type === 'word' && (expecting || token.value.startsWith(','))) {
        this.next();
        const parts = token.value.split(',');
        parts.map((part) => part.trim()).filter(Boolean).forEach((part) => values.push(part));
        expecting = parts.length > 1 ? parts[parts.length - 1].trim() === '' : false;
        end = token.end;
        continue;
      }
      if (expecting && (token.type === 'string' || token.type === 'link')) {
        this.next();
        const value = token.type === 'link' ? token.raw ?? `[[${token.value}]]` : token.value.trim();
        if (value) {
          values.push(value);
        }
        expecting = false;
        end = token.end;
        continue;
      }
      break;
    }
    return { values, end, unfinished: expecting && values.length > 0 };
  }

  /** A word with no operator after it: a tag when it starts with `#` or `@`, else text. */
  private parseBareWord(word: Token): QueryNode | undefined {
    const isTag = word.value.startsWith('#') || word.value.startsWith('@');
    return this.createCondition({
      field: isTag ? 'tag' : 'text',
      operator: isTag ? 'eq' : 'contains',
      value: word.value,
      start: word.start,
      end: word.end,
    });
  }

  /**
   * The operator a condition compares with, once its field is known: a
   * plain `:` is `fallback`, the field's own. A comparison after a plain
   * `:` or `=` is the one meant, as in `created:>2026-01-01`, and `no:`
   * turns the operator into its opposite.
   */
  private readConditionOperator(word: Token, operatorToken: Token, fallback: QueryOperator): QueryOperator {
    let operator = readOperator(operatorToken.value, fallback);
    const chained = this.peek();
    if (
      (operatorToken.value === ':' || operatorToken.value === '=') &&
      chained?.type === 'operator' &&
      ['>', '>=', '<', '<=', '~'].includes(chained.value)
    ) {
      this.next();
      operator = readOperator(chained.value, fallback);
    }
    if (word.value.toLowerCase() === NEGATED_HAS) {
      operator = QUERY_OPERATOR_INVERSES[operator];
    }
    return operator;
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
   * Validates a condition's value before it reaches the evaluator, and
   * builds the condition with the value as the field stores it. A value the
   * field cannot take is reported over the condition's span.
   */
  private createCondition(input: ConditionInput): QueryConditionNode | undefined {
    const { operator, start, end } = input;
    let field = input.field;
    const value = input.value.trim();
    const typed = this.readTypedShorthand(field, value);
    if (typed) {
      field = typed.field;
    }
    const read = typed ?? (field === 'link' ? readLinkCondition(value) : readFieldValue(field, operator, value));
    if ('message' in read) {
      this.diagnostics.push({ message: read.message, severity: 'error', start, end });
      return undefined;
    }
    return { type: 'condition', field, operator, value: read.value, start, end };
  }

  /**
   * What a shorthand names among the types when it names no built-in:
   * `is:team` the rows of a type, `has:on-call` whether a type field is
   * filled. Undefined when a built-in takes the value, or no type does.
   */
  private readTypedShorthand(field: QueryField, value: string): { field: QueryField; value: string } | undefined {
    if (!this.schema || (field !== 'is' && field !== 'has')) {
      return undefined;
    }
    if (field === 'is') {
      const typeKey = lookupAlias(IS_VALUE_ALIASES, value) ? undefined : this.schema.type(value);
      return typeKey ? { field: 'type', value: typeKey } : undefined;
    }
    const typeField = lookupAlias(HAS_VALUE_ALIASES, value) ? undefined : this.schema.field(value);
    return typeField ? { field: 'has', value: typeField.name } : undefined;
  }

  /** The token under the reader, if any, without moving past it. */
  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  /** The token under the reader, moving past it. Called only where one is known to be there. */
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

/** A condition as the parser has read it, before its value is checked. */
interface ConditionInput {
  field: QueryField;
  operator: QueryOperator;
  /** The value as written, before it is trimmed. */
  value: string;
  /** The condition's span in the query text, for a diagnostic. */
  start: number;
  end: number;
}

/** A value as the field stores it, or the sentence that says why the field cannot take it. */
type ValueReading = { value: string } | { message: string };

/** A link's note, and its heading or block, as `link` stores them. */
function readLinkCondition(value: string): ValueReading {
  const target = readLinkValue(value);
  return target
    ? { value: target }
    : { message: "link needs a note's name, such as [[Atlas]] or [[Atlas#Decision]]." };
}

/**
 * A trimmed value as its field stores it: refused when empty, read by the
 * field's VALUE_READERS entry when it has one, and kept as written when it
 * has none.
 */
function readFieldValue(field: QueryField, operator: QueryOperator, value: string): ValueReading {
  if (!value) {
    return { message: `${field} needs a value.` };
  }
  const read = VALUE_READERS[field];
  return read ? read(value, operator, field) : { value };
}

/** A value read through one of the alias tables, or the message listing what the field accepts. */
function readAlias(
  aliases: Readonly<Record<string, string>>,
  value: string,
  refusal: string,
): ValueReading {
  const normalized = lookupAlias(aliases, value);
  return normalized ? { value: normalized } : { message: `${refusal} — not "${value}".` };
}

/**
 * What a word, in any case, names in one of the alias tables, or undefined
 * when the table does not list it. Only the table's own keys count: the
 * word is the user's, and `constructor` or `__proto__` read through plain
 * indexing would find what every object inherits.
 */
function lookupAlias<Value>(aliases: Readonly<Record<string, Value>>, word: string): Value | undefined {
  const key = word.toLowerCase();
  return Object.hasOwn(aliases, key) ? aliases[key] : undefined;
}

/**
 * A task date: a date value, lowercased, or `none`, which asks whether the
 * date is written at all and so compares only with `=` and `!=`.
 */
function readTaskDateValue(value: string, operator: QueryOperator, field: QueryField): ValueReading {
  const normalized = value.toLowerCase();
  if (normalized === 'none' && operator !== 'eq' && operator !== 'neq') {
    return { message: `${field} compares with none only using = or !=.` };
  }
  if (normalized !== 'none' && !isDateValue(normalized)) {
    return {
      message: `${field} accepts a date such as 2026-09-13, friday, "oct 3", this-week, next-month, a window such as 7d, or none.`,
    };
  }
  return { value: normalized };
}

/**
 * A `status:` value: `open`, `done`, or `any` (and their other spellings,
 * but `todo`, which names the Todo status), as `task:` reads them; a
 * character in brackets, `[/]`, kept as written, since `x` and `X` may be
 * different statuses; or a status's name, lowercased, which the evaluator
 * matches against the workspace's statuses.
 */
function readStatusValue(value: string): ValueReading {
  const lowered = value.toLowerCase();
  if (lowered !== 'todo' && Object.hasOwn(TASK_VALUE_ALIASES, lowered)) {
    return { value: TASK_VALUE_ALIASES[lowered] };
  }
  if (/^\[.\]$/u.test(value)) {
    return { value };
  }
  return value.trim() ? { value: lowered } : { message: 'status needs a status, such as status:in-progress, status:[/], or status:open.' };
}

/** A note's `created` or `updated` date: any date value, lowercased. */
function readNoteDateValue(value: string, _operator: QueryOperator, field: QueryField): ValueReading {
  if (!isDateValue(value)) {
    return {
      message: `${field} accepts a date such as 2026-09-13, friday, this-week, last-month, 2026-08, or a window such as 30d.`,
    };
  }
  return { value: value.toLowerCase() };
}

/**
 * How each field that checks its value reads it. A field with no entry,
 * such as `tag` or `text`, keeps the value as written.
 */
const VALUE_READERS: Partial<
  Record<QueryField, (value: string, operator: QueryOperator, field: QueryField) => ValueReading>
> = {
  is: (value) => readAlias(IS_VALUE_ALIASES, value, `is: accepts ${listAlternatives(QUERY_IS_VALUES)}`),
  has: (value) =>
    readAlias(HAS_VALUE_ALIASES, value, `has: and no: accept ${listAlternatives(QUERY_HAS_VALUES)}`),
  in: (value) => {
    const folder = normalizeFolder(value);
    return folder ? { value: folder } : { message: 'in: needs a folder, such as in:notes/projects.' };
  },
  task: (value) => readAlias(TASK_VALUE_ALIASES, value, `task accepts ${listAlternatives(QUERY_TASK_VALUES)}`),
  status: readStatusValue,
  ...Object.fromEntries(QUERY_TASK_DATE_FIELDS.map((field) => [field, readTaskDateValue])),
  priority: (value) =>
    readAlias(PRIORITY_VALUE_ALIASES, value, `priority accepts ${listAlternatives(QUERY_PRIORITY_VALUES)}`),
  created: readNoteDateValue,
  updated: readNoteDateValue,
};

/**
 * Maps written operators onto the evaluator's operator set: each symbol
 * QUERY_OPERATOR_SYMBOLS writes reads as its operator, so `text = plan` is
 * the whole word, as the guide, Help, and the builder say. `:`, which
 * names no operator of its own, reads as `fallback`, the field's default:
 * `contains` for `text`, so `text:plan` matches as a bare word does, and
 * `eq` for every other field.
 */
function readOperator(value: string, fallback: QueryOperator): QueryOperator {
  return WRITTEN_OPERATORS.get(value) ?? fallback;
}

/** The operator each written symbol names. */
const WRITTEN_OPERATORS: ReadonlyMap<string, QueryOperator> = new Map(
  (Object.entries(QUERY_OPERATOR_SYMBOLS) as [QueryOperator, string][]).map(
    ([operator, symbol]) => [symbol, operator],
  ),
);

/**
 * The values a field accepts, as an error message lists them: `a, b, or c`,
 * or `a or b` for two. Built from the QUERY_*_VALUES lists, so a value its
 * list gains is named in its message too.
 */
function listAlternatives(values: readonly string[]): string {
  if (values.length <= 2) {
    return values.join(' or ');
  }
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

/**
 * Why a type field cannot take a value, or undefined when it can: a number
 * field compared by order needs a number, a date field a date, and a
 * checkbox true or false. A field whose kind differs between types takes
 * anything, as does `this`.
 */
function checkTypeFieldValue(name: string, field: QueryTypeField, operator: QueryOperator, value: string): string | undefined {
  if (field.kinds.length !== 1 || value.toLowerCase() === THIS_VALUE) {
    return undefined;
  }
  switch (field.kinds[0]) {
    case 'number':
      return operator !== 'eq' && operator !== 'neq' && Number.isNaN(Number(value.replace(/,/g, '')))
        ? `${name} compares with a number, such as 12 — not "${value}".`
        : undefined;
    case 'date':
      return isDateValue(value) ? undefined : `${name} accepts a date such as 2026-09-13, today, this-week, or a window such as 30d — not "${value}".`;
    case 'checkbox':
      return readCheckboxValue(value) === undefined ? `${name} accepts true or false — not "${value}".` : undefined;
    case 'text':
    case 'link':
    case 'email':
    case 'phone':
    case 'select':
    case 'person':
    case 'relation':
    case 'note':
      return undefined;
  }
}

/**
 * Accepts absolute dates, relative windows such as `30d`, and named days.
 * A day in words is accepted when some year has it, so `"feb 29"` is a
 * date: the evaluator finds the leap day nearest the moment it is asked.
 */
export function isDateValue(value: string): boolean {
  // Whether a value reads does not depend on the day, or on the day a week
  // starts, so any fixed day and Sunday will do.
  return (
    resolveDateRange(value, DATE_CHECK_DAY, 'past', 0) !== undefined &&
    resolveDateRange(value, DATE_CHECK_DAY, 'future', 0) !== undefined
  );
}

/** The day a value is read on to check that it is a date. */
const DATE_CHECK_DAY = new Date(2026, 0, 15, 12).getTime();
