/**
 * A field's kind as a type's table writes it, and the names a field goes by
 * in a query: its own, and its reverse's (docs/implementation/30-databases.md
 * § A type note).
 */
import type { FieldKind, FieldKindName, TypeField } from '../model';

/** The kinds a `Kind` cell names by one word, by that word lowercased. */
const WORD_KINDS: ReadonlyMap<string, FieldKindName> = new Map([
  ['text', 'text'],
  ['number', 'number'],
  ['date', 'date'],
  ['checkbox', 'checkbox'],
  ['person', 'person'],
  ['note', 'note'],
  ['link', 'link'],
  ['email', 'email'],
  ['phone', 'phone'],
]);

/** `, many` at the end of a `Kind` cell, any case. */
const MANY = /,\s*many\s*$/i;

/**
 * A `Kind` cell read: `Text`, `Select: gold, silver`, `Person, many`, or a
 * relation to the types it names (`Area`, `Area or System`), any case. A
 * relation's targets are kept as written; the registry, which knows every
 * type, resolves them, and reads one that names no type as Text.
 * An empty cell is Text too, with `missing` set.
 */
export function parseFieldKind(written: string): { kind: FieldKind; missing?: true } {
  let text = written.trim();
  const many = MANY.test(text);
  if (many) {
    text = text.replace(MANY, '').trim();
  }
  if (!text) {
    return { kind: { name: 'text', many }, missing: true };
  }
  const select = /^select\s*(?::(.*))?$/i.exec(text);
  if (select) {
    const options = (select[1] ?? '')
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);
    return { kind: { name: 'select', many, options: [...new Set(options)] } };
  }
  const word = WORD_KINDS.get(text.toLowerCase());
  if (word) {
    return { kind: { name: word, many } };
  }
  const targets = text
    .split(/\s+or\s+/i)
    .map((target) => target.trim())
    .filter(Boolean);
  return { kind: { name: 'relation', many, targets } };
}

/** Whether a kind's values name rows: a person, a relation, or a note. */
export function isRowKind(kind: FieldKind): boolean {
  return kind.name === 'person' || kind.name === 'relation' || kind.name === 'note';
}

/**
 * A field or reverse name as a query writes it: lowercased, each run of
 * spaces or other punctuation a hyphen. `owned by` is `owned-by`.
 */
export function toFieldQueryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The name of the field a relation computes on the rows it names, as the
 * schema writes it: its `Reverse` cell, or `<field> of`.
 */
export function reverseNameOf(field: Pick<TypeField, 'name' | 'reverse'>): string {
  return field.reverse ?? `${field.name} of`;
}

/** Whether two kinds read a value alike: the same kind, list, options, and targets. */
export function sameKind(left: FieldKind, right: FieldKind): boolean {
  const list = (values: readonly string[] | undefined): string =>
    [...(values ?? [])].map((value) => value.toLowerCase()).sort().join('\u0000');
  return (
    left.name === right.name &&
    left.many === right.many &&
    list(left.options) === list(right.options) &&
    list(left.targets) === list(right.targets) &&
    Boolean(left.people) === Boolean(right.people)
  );
}

/**
 * The fields every row has without its type's table naming them, computed
 * from the notes and never written (docs/implementation/30-databases.md
 * § Computed fields), by their query names.
 */
export const COMPUTED_FIELD_NAMES = [
  'open-tasks',
  'last-mentioned',
  'mentions',
  'linked-from',
  'parent',
  'children',
] as const;

/** A computed field's query name. */
export type ComputedFieldName = (typeof COMPUTED_FIELD_NAMES)[number];

/** Whether a name is a computed field's. */
export function isComputedFieldName(name: string): name is ComputedFieldName {
  return (COMPUTED_FIELD_NAMES as readonly string[]).includes(name);
}
