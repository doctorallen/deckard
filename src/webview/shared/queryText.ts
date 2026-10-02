/**
 * The search box's reading and writing of query text, with no page in it:
 * where its terms start and end, how a term is added, how the builder's
 * tree is written as text and a typed condition read into a row, and the
 * plain words a page can match before the host answers.
 */
import type { QueryBuilderJoin } from '../../ui/protocol/query';

/** The operators each field takes, when the host has not said. */
export const DEFAULT_OPERATORS: Readonly<Record<string, readonly string[]>> = {
  tag: ['eq', 'neq'], link: ['eq', 'neq'], text: ['contains', 'notContains', 'eq', 'neq'], is: ['eq', 'neq'],
  task: ['eq', 'neq'], due: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], scheduled: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  start: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], done: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  priority: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], has: ['eq', 'neq'], kind: ['eq', 'neq'],
  file: ['eq', 'neq', 'contains', 'notContains'], path: ['eq', 'neq', 'contains', 'notContains'], in: ['eq', 'neq'],
  created: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], updated: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
};

/** The operator each symbol writes. */
export const SYMBOL_OPERATORS: Readonly<Record<string, string>> = {
  '=': 'eq', '!=': 'neq', '~': 'contains', '!~': 'notContains', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte',
};

/** The symbol each operator is written with. */
export const OPERATOR_LABELS: Readonly<Record<string, string>> = {
  eq: '=', neq: '!=', contains: '~', notContains: '!~', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

/** Hover text, since a symbol alone does not say what it compares. */
export const OPERATOR_DESCRIPTIONS: Readonly<Record<string, string>> = {
  eq: 'is', neq: 'is not', contains: 'contains', notContains: 'does not contain', gt: 'after', gte: 'on or after', lt: 'before', lte: 'on or before',
};

/** The text field matches whole words with = and any substring with ~. */
export const TEXT_OPERATOR_DESCRIPTIONS: Readonly<Record<string, string>> = { eq: 'is the whole word', neq: 'does not have the whole word' };

/** Priority compares rank, not time. */
export const PRIORITY_OPERATOR_DESCRIPTIONS: Readonly<Record<string, string>> = { gt: 'above', gte: 'at or above', lt: 'below', lte: 'at or below' };

/** What an empty value field of each field suggests. */
export const FIELD_PLACEHOLDERS: Readonly<Record<string, string>> = {
  tag: '#project/atlas', link: 'Atlas#Decision', text: 'vendor review', is: 'open', task: 'open', due: 'today', scheduled: 'today',
  start: 'today', done: '7d', priority: 'high', has: 'due', kind: 'project', file: '2026-09-*.md',
  path: 'notes/*', in: 'notes/projects', created: '2026-09-13', updated: '30d',
};

/** Fields written as one field:value token. */
export const SHORTHAND_FIELDS: readonly string[] = ['is', 'has', 'in'];

/** One piece of a search's text: what it is, and where it starts and ends. */
export interface QueryPiece {
  readonly kind: 'link' | 'tag' | 'op' | 'paren' | 'word';
  readonly start: number;
  readonly end: number;
  readonly negated?: boolean;
}

/** One word of a search's text as the scanner first splits it. */
interface QueryWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A word without the quotes around it. */
function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

/** The search's words, with where each starts and ends; quoted text and a [[link]] are one word. */
function splitWords(text: string): QueryWord[] {
  const words: QueryWord[] = [];
  const pattern = /-?\[\[[^\]]*(?:\]\]?)?|"(?:[^"\\]|\\.)*"?|'[^']*'?|[()]|[^\s()]+/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    words.push({ text: match[0], start, end: start + match[0].length });
  }
  return words;
}

/** A word that is a tag on its own, written #tag, -#tag, or tag:#tag, as a piece. */
function tagWord(word: QueryWord): QueryPiece | undefined {
  const bare = /^(-|!)?([#@][^\s()"']+)$/.exec(stripQuotes(word.text));
  if (bare) {
    return { kind: 'tag', start: word.start, end: word.end, negated: Boolean(bare[1]) };
  }
  const field = /^(-)?tags?(:|!?=)(.+)$/i.exec(word.text);
  if (field && /^[#@]/.test(stripQuotes(field[3]))) {
    return { kind: 'tag', start: word.start, end: word.end, negated: Boolean(field[1]) || field[2] === '!=' };
  }
  return undefined;
}

/**
 * The search's words, with where each starts and ends: a tag, written as
 * #tag, -#tag, tag:#tag, or tag = #tag; an operator; a parenthesis; or
 * anything else. Quoted text is one word.
 */
export function scanQuery(text: string): QueryPiece[] {
  const words = splitWords(text);
  const pieces: QueryPiece[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (/^-?\[\[/.test(word.text)) {
      // [[Atlas plan]] is one term, spaces and all.
      pieces.push({ kind: 'link', start: word.start, end: word.end, negated: word.text.charAt(0) === '-' });
      continue;
    }
    const tag = tagWord(word);
    if (tag) {
      pieces.push(tag);
      continue;
    }
    const operator = words[index + 1];
    const value = words[index + 2];
    if (/^tags?$/i.test(word.text) && operator && value && /^!?=$/.test(operator.text) && /^[#@]/.test(stripQuotes(value.text))) {
      pieces.push({ kind: 'tag', start: word.start, end: value.end, negated: operator.text === '!=' });
      index += 2;
      continue;
    }
    if (/^(and|or|not|&&|\|\|)$/i.test(word.text)) {
      pieces.push({ kind: 'op', start: word.start, end: word.end });
      continue;
    }
    pieces.push({ kind: word.text === '(' || word.text === ')' ? 'paren' : 'word', start: word.start, end: word.end });
  }
  return pieces;
}

/**
 * Writes AND between two tags that stand side by side, so a search of
 * several tags reads as what it does.
 */
export function joinTags(text: string): string {
  const value = String(text);
  const pieces = scanQuery(value);
  let result = '';
  let offset = 0;
  pieces.forEach((piece, index) => {
    const previous = pieces[index - 1];
    if (piece.kind !== 'tag' || !previous || previous.kind !== 'tag' || value.slice(previous.end, piece.start).trim()) {
      return;
    }
    result += `${value.slice(offset, previous.end)} AND `;
    offset = piece.start;
  });
  return result + value.slice(offset);
}

/**
 * The applied search with a new term added by AND. A term whose top level
 * is an OR is wrapped, so it adds one condition; a search that cannot be
 * added to (`canAppend` false) is wrapped too.
 */
export function combineQuery(applied: string, extra: string, canAppend: boolean): string {
  const text = String(applied || '').trim();
  const addition = joinTags(String(extra || '').trim());
  if (!addition) {
    return text;
  }
  if (!text) {
    return addition;
  }
  const wrapped = /(^|\s)(or|\|\|)(\s|$)/i.test(addition) && !/^\(.*\)$/.test(addition) ? `(${addition})` : addition;
  return `${canAppend ? text : `(${text})`} AND ${wrapped}`;
}

/** A link's note, as typed with or without its brackets and alias. */
export function stripLinkBrackets(value: string): string {
  return String(value).trim().replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/\|.*$/, '').trim();
}

/** A value as a condition writes it: quoted when it holds a space, an operator, a quote, or a [[. */
export function quoteQueryValue(value: string): string {
  // [[x]] unquoted would read back as a link rather than the characters.
  return /[\s:=<>~!()"']/.test(value) || value.includes('[[') || !value
    ? `"${value.replace(/(["\\])/g, '\\$1')}"`
    : value;
}

/** A value without the quotes around the whole of it. */
export function unquote(value: string): string {
  const text = String(value).trim();
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text;
}

/** One builder row as the editor keeps it: a row of the host's tree, or one still being typed. */
export interface EditorRow {
  field: string;
  operator: string;
  value: string;
  supported: boolean;
  text: string;
  /** A new row, waiting for a value that then decides its field. */
  pending?: boolean;
}

/** One group of the builder as the editor keeps it. */
export interface EditorGroup {
  join: QueryBuilderJoin;
  negated?: boolean;
  items: EditorItem[];
}

/** A row or a group of the builder, told apart by `items`. */
export type EditorItem = EditorRow | EditorGroup;

/** Whether a builder item is a group. */
export function isGroup(item: EditorItem | undefined): item is EditorGroup {
  return Boolean(item && (item as EditorGroup).items);
}

/** A row waiting for a value, which then decides its field. */
export function pendingRow(): EditorRow {
  return { pending: true, field: 'text', operator: 'contains', value: '', supported: true, text: '' };
}

/** One row as text, with shorthands written the way they are typed. */
export function formatBuilderCondition(row: EditorRow): string {
  if (row.field === 'link') {
    return `link ${OPERATOR_LABELS[row.operator] || '='} [[${stripLinkBrackets(row.value)}]]`;
  }
  const value = quoteQueryValue(String(row.value).trim());
  if (row.field === 'has') {
    return `${row.operator === 'neq' ? 'no' : 'has'}:${value}`;
  }
  if (SHORTHAND_FIELDS.includes(row.field)) {
    return `${row.operator === 'neq' ? '-' : ''}${row.field}:${value}`;
  }
  return `${row.field} ${OPERATOR_LABELS[row.operator] || '='} ${value}`;
}

/**
 * Write the tree as search text, skipping rows with no value yet. This
 * mirrors fromBuilderTree on the host: a nested group with more than one
 * term is parenthesized, and a negated one is NOT (...).
 */
export function buildQueryFromTree(group: EditorGroup, depth: number): string {
  const terms = group.items.map((item) => {
    if (isGroup(item)) {
      return buildQueryFromTree(item, depth + 1);
    }
    if (item.pending) {
      return '';
    }
    if (!item.supported) {
      return item.text.trim();
    }
    if (!String(item.value).trim()) {
      return '';
    }
    return formatBuilderCondition(item);
  }).filter(Boolean);
  if (!terms.length) {
    return '';
  }
  const body = terms.join(group.join === 'or' ? ' OR ' : ' AND ');
  if (group.negated) {
    return `NOT ${terms.length > 1 ? `(${body})` : body}`;
  }
  return depth > 0 && terms.length > 1 ? `(${body})` : body;
}

/** The field a word names, from the host's spellings or the built-in names. */
export function fieldFor(word: string, aliases: Readonly<Record<string, string>>): string | undefined {
  const name = String(word).toLowerCase();
  if (aliases[name]) {
    return aliases[name];
  }
  if (name === 'no') {
    return 'has';
  }
  return DEFAULT_OPERATORS[name] ? name : undefined;
}

/** A row the builder can edit. */
function editableRow(field: string, operator: string, value: string): EditorRow {
  return { field, operator, value, supported: true, text: '' };
}

/** A condition written field:value, such as is:open or due:>=today, as a row. */
function shorthandRow(value: string, aliases: Readonly<Record<string, string>>): EditorRow | undefined {
  const match = /^(-?)([A-Za-z]+):(.+)$/.exec(value);
  const field = match ? fieldFor(match[2], aliases) : undefined;
  if (!match || !field) {
    return undefined;
  }
  const word = match[2].toLowerCase();
  const negated = (match[1] === '-') !== (word === 'no');
  const rest = unquote(match[3]);
  const comparison = /^(>=|<=|!=|!~|>|<|~)/.exec(rest);
  if (comparison && !SHORTHAND_FIELDS.includes(field)) {
    return editableRow(field, SYMBOL_OPERATORS[comparison[1]], unquote(rest.slice(comparison[1].length)));
  }
  let operator = field === 'text' ? 'contains' : 'eq';
  if (negated) {
    operator = 'neq';
  }
  return editableRow(field, operator, rest);
}

/**
 * Read one condition as it would be typed, such as is:open,
 * priority >= high, #project/atlas, or a plain word, into a builder row.
 */
export function parseConditionText(text: string, aliases: Readonly<Record<string, string>>): EditorRow {
  const value = String(text).trim();
  const shorthand = shorthandRow(value, aliases);
  if (shorthand) {
    return shorthand;
  }
  let match = /^([A-Za-z]+)\s*(!=|!~|>=|<=|=|~|>|<)\s*(.+)$/.exec(value);
  const field = match ? fieldFor(match[1], aliases) : undefined;
  if (match && field) {
    return editableRow(field, SYMBOL_OPERATORS[match[2]], unquote(match[3]));
  }
  match = /^(-?)\[\[(.+?)\]\]$/.exec(value);
  if (match) {
    return editableRow('link', match[1] ? 'neq' : 'eq', stripLinkBrackets(match[2]));
  }
  if (/^-?[#@]/.test(value)) {
    return editableRow('tag', value.charAt(0) === '-' ? 'neq' : 'eq', value.replace(/^-/, ''));
  }
  return editableRow('text', 'contains', unquote(value));
}

/** Put a clause beside an existing one as an alternative, or undefined when the existing one is not found. */
export function mergeAlternative(text: string, existing: string, clause: string): string | undefined {
  const escaped = existing.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
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

/** A caret in the value of a field condition, such as is:ov: the field and what is typed of the value. */
export function valueContext(prefix: string, aliases: Readonly<Record<string, string>>): { field: string; token: string } | undefined {
  const match = /([A-Za-z]+)\s*(!=|!~|>=|<=|[:=~<>])\s*([^\s()]*)$/.exec(prefix);
  if (!match) {
    return undefined;
  }
  const field = aliases[match[1].toLowerCase()];
  return field ? { field, token: match[3] } : undefined;
}

/**
 * The plain words of a search, which a page can match at once because
 * every one of them must appear. A field, its operator, and its value
 * are a condition rather than words, and a search with OR, NOT, or
 * parentheses is not only words, so it waits for the host.
 */
export function previewWords(text: string): string[] {
  const value = String(text || '');
  if (/(^|\s)(or|not)(\s|$)|\|\||[()]/i.test(value)) {
    return [];
  }
  const tokens = value.split(/\s+/).filter(Boolean);
  const words: string[] = [];
  let lastWordIndex = -2;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const operator = /^(!=|!~|>=|<=|=|~|>|<)/.exec(token);
    if (operator) {
      if (lastWordIndex === index - 1) {
        words.pop();
      }
      if (token === operator[1]) {
        index += 1;
      }
      continue;
    }
    if (!/^[-!#@"']/.test(token) && !/[:=<>~]/.test(token) && !/^(and|&&)$/i.test(token)) {
      words.push(token.toLowerCase());
      lastWordIndex = index;
    }
  }
  return words;
}

/** The path a builder row or group carries, as indices into items. */
export function pathOf(element: Element | null | undefined): number[] {
  const text = String((element as HTMLElement | null)?.dataset?.path || '');
  return text ? text.split('.').map(Number) : [];
}

/** A path as its `data-path` writes it. */
export function pathText(path: readonly number[]): string {
  return path.join('.');
}

/** The group at a path, walking down from the root; undefined if a row is met. */
export function groupAt(tree: EditorGroup, path: readonly number[]): EditorGroup | undefined {
  let group = tree;
  for (const step of path) {
    const item = group.items[step];
    if (!isGroup(item)) {
      return undefined;
    }
    group = item;
  }
  return group;
}

/** The row or group at a path. */
export function itemAt(tree: EditorGroup, path: readonly number[]): EditorItem | undefined {
  if (!path.length) {
    return undefined;
  }
  const parent = groupAt(tree, path.slice(0, -1));
  return parent ? parent.items[path[path.length - 1]] : undefined;
}

/** A copy of a tree the caller may change. */
export function cloneTree<T>(tree: T): T {
  return JSON.parse(JSON.stringify(tree)) as T;
}

/**
 * Takes the row or group at path out of the tree. A group left with
 * nothing in it goes too, and so on upward, so an emptied group never
 * lingers as a box with only a head; the root is the one group that
 * stays. Returns the path that was finally removed, or null.
 */
export function removeItem(tree: EditorGroup, path: readonly number[]): { path: number[] } | null {
  if (!path.length) {
    return null;
  }
  let at = path.slice();
  for (;;) {
    const parent = groupAt(tree, at.slice(0, -1));
    if (!parent) {
      return null;
    }
    parent.items.splice(at[at.length - 1], 1);
    if (parent.items.length || at.length === 1) {
      return { path: at };
    }
    at = at.slice(0, -1);
  }
}
