/**
 * What the type builder's quick picks show
 * (docs/implementation/44-type-builder.md): the type form's rows, a
 * field's menu, the kinds a field can have with an example of each, how
 * many values it holds, and the checks on a new type's or field's name.
 * Pure, so the command (ui/commands/typeBuilder.ts) only drives the picks.
 */
import { isFrontmatterKey, toFrontmatterKey } from '../../domain/markdown/frontmatter';
import type { FieldKindName, TypeField, TypeNote, TypeProblem } from '../../domain/model';
import { parseFieldKind, reverseNameOf, toFieldQueryName } from '../../domain/types/fieldKinds';
import { pluralTypeName, slugTitle } from '../../domain/types/rowNotes';
import { typeNotePath } from '../../domain/types/typeNoteWriter';
import { isBuiltInFieldName } from '../../domain/types/typeRegistry';

/** A type as the builder reads it: its note, and the other types a field can name. */
export interface BuilderType extends Pick<TypeNote, 'key' | 'name' | 'rows' | 'notesFolder' | 'fields'> {
  /** The type note's path in the index: `Types/Org.md`. */
  filePath: string;
}

/** One row of a builder pick: a separator, or a choice with what it does. */
export interface BuilderRow<A> {
  label: string;
  description?: string;
  detail?: string;
  /** What choosing the row does; absent on a separator. */
  action?: A;
  separator?: true;
  /** A codicon for the row, as `$(name)` writes it. */
  icon?: string;
}

/** What a row of the type form does. */
export type TypeFormAction =
  | { kind: 'field'; key: string }
  | { kind: 'add' }
  | { kind: 'rows' }
  | { kind: 'folder' }
  | { kind: 'open' }
  | { kind: 'done' };

/** The icon each kind is drawn with, in the form and the kind list. */
const KIND_ICONS: Readonly<Record<FieldKindName, string>> = {
  text: 'symbol-text',
  number: 'symbol-number',
  date: 'calendar',
  checkbox: 'pass',
  select: 'list-selection',
  person: 'person',
  relation: 'symbol-class',
  note: 'note',
  link: 'link',
  email: 'mail',
  phone: 'device-mobile',
};

/** A field's kind's icon. */
export function kindIcon(kind: FieldKindName): string {
  return KIND_ICONS[kind];
}

/**
 * The type form: its fields in the table's order, each with its kind and
 * what else is set, or the problem its row has; Add field…; the type's
 * rows and folder; Open its note; and Done.
 */
export function createTypeFormRows(type: BuilderType, options: { problems: readonly TypeProblem[]; rowCount: number }): Array<BuilderRow<TypeFormAction>> {
  const fields = type.fields.map((field): BuilderRow<TypeFormAction> => {
    const problem = options.problems.find((each) => each.field === field.key || each.line === field.line);
    const set = [
      field.reverse || isLink(field) ? `Reverse: ${reverseNameOf(field)}` : undefined,
      field.alsoCalled.length ? `Also called: ${field.alsoCalled.join(', ')}` : undefined,
      field.words?.length ? `Words: ${field.words.join(', ')}` : undefined,
    ].filter((part): part is string => part !== undefined);
    const detail = problem ? `$(warning) ${problem.message}` : set.join(' · ');
    return {
      label: field.name,
      description: field.kindText || 'Text',
      ...(detail ? { detail } : {}),
      icon: problem ? 'warning' : kindIcon(field.kind.name),
      action: { kind: 'field', key: field.key },
    };
  });
  const folder = type.rows?.kind === 'tags' && type.rows.prefix !== '@' ? [{
    label: 'New notes go in',
    description: type.notesFolder ?? `${pluralTypeName(type.name)}/`,
    icon: 'folder',
    action: { kind: 'folder' } as const,
  }] : [];
  return [
    { label: 'Fields', separator: true },
    ...fields,
    { label: 'Add field…', icon: 'add', action: { kind: 'add' } },
    { label: 'Type', separator: true },
    { label: 'Rows', description: `${describeRows(type)} · ${plural(options.rowCount, type.name.toLowerCase(), pluralTypeName(type.name).toLowerCase())}`, icon: 'symbol-namespace', action: { kind: 'rows' } },
    ...folder,
    { label: `Open ${type.filePath}`, icon: 'go-to-file', action: { kind: 'open' } },
    { label: 'Done', icon: 'check', action: { kind: 'done' } },
  ];
}

/** What a type's rows are, in words: `Each #org/… tag`, `Each person`, `Each note that says type: decision`. */
export function describeRows(type: Pick<TypeNote, 'key' | 'rows'>): string {
  const rows = type.rows;
  if (!rows) {
    return 'Not set';
  }
  if (rows.kind === 'notes') {
    return `Each note that says type: ${type.key}`;
  }
  return rows.prefix === '@' ? 'Each person' : `Each ${rows.prefix}… tag`;
}

/** Whether a field's values name rows: a person or another type's. */
function isLink(field: Pick<TypeField, 'kind'>): boolean {
  return field.kind.name === 'person' || field.kind.name === 'relation';
}

/** What a row of a field's menu does. */
export type FieldMenuAction =
  | { kind: 'rename' }
  | { kind: 'kind' }
  | { kind: 'many' }
  | { kind: 'reverse' }
  | { kind: 'alsoCalled' }
  | { kind: 'words' }
  | { kind: 'move'; by: -1 | 1 }
  | { kind: 'remove' };

/**
 * A field's menu: each thing that can change about it with what it is now,
 * the moves its place allows, and Remove, which says how many notes write
 * the field and keep their values.
 */
export function createFieldMenuRows(type: BuilderType, field: TypeField, noteCount: number): Array<BuilderRow<FieldMenuAction>> {
  const at = type.fields.findIndex((each) => each.key === field.key);
  const rows: Array<BuilderRow<FieldMenuAction>> = [
    { label: 'Rename…', description: noteCount ? `rewrites the key in ${plural(noteCount, 'note', 'notes')}` : field.name, icon: 'edit', action: { kind: 'rename' } },
    { label: 'Kind', description: describeKindBase(field.kindText), icon: kindIcon(field.kind.name), action: { kind: 'kind' } },
  ];
  if (field.kind.name !== 'checkbox') {
    rows.push({ label: 'Holds', description: field.kind.many ? 'several' : 'one', icon: field.kind.many ? 'list-flat' : 'circle-small', action: { kind: 'many' } });
  }
  if (isLink(field)) {
    rows.push({ label: 'Reverse', description: reverseNameOf(field), detail: `What the page of a row it names calls the link${field.reverse ? '' : ' (not set, so "of" is added)'}`, icon: 'arrow-swap', action: { kind: 'reverse' } });
  }
  rows.push(
    { label: 'Also called', description: field.alsoCalled.join(', ') || 'not set', detail: 'Other words Find and assistants know the field by', icon: 'symbol-key', action: { kind: 'alsoCalled' } },
    { label: 'Words', description: field.words?.join(', ') || 'not set', detail: `Phrases on a line that set it, such as "now leads"`, icon: 'quote', action: { kind: 'words' } },
  );
  const moves: Array<BuilderRow<FieldMenuAction>> = [
    ...(at > 0 ? [{ label: 'Move up', icon: 'arrow-up', action: { kind: 'move', by: -1 } as const }] : []),
    ...(at >= 0 && at < type.fields.length - 1 ? [{ label: 'Move down', icon: 'arrow-down', action: { kind: 'move', by: 1 } as const }] : []),
  ];
  return [
    ...rows,
    ...(moves.length ? [{ label: 'Order', separator: true } as const, ...moves] : []),
    { label: '', separator: true },
    {
      label: `Remove from ${type.name}`,
      description: noteCount ? `${plural(noteCount, 'note keeps its value', 'notes keep their values')}` : undefined,
      icon: 'trash',
      action: { kind: 'remove' },
    },
  ];
}

/** A Kind cell without its `, many`: `Person`, `Select: gold, silver`, `Team or Area`. */
export function describeKindBase(kindText: string): string {
  return kindText.replace(/,\s*many\s*$/i, '').trim() || 'Text';
}

/** What choosing a kind sets: a kind word, a type, several types, or a select that asks its options next. */
export type KindChoice =
  | { kind: 'word'; word: string }
  | { kind: 'type'; name: string }
  | { kind: 'types' }
  | { kind: 'select' };

/** The kinds that are written as one word, each with an example of a value. */
const VALUE_KINDS: ReadonlyArray<{ word: string; name: FieldKindName; example: string }> = [
  { word: 'Text', name: 'text', example: 'anything, as typed' },
  { word: 'Number', name: 'number', example: '12 · 1,200 · 1.5' },
  { word: 'Date', name: 'date', example: '2026-03-01, or next friday' },
  { word: 'Checkbox', name: 'checkbox', example: 'true or false' },
  { word: 'Link', name: 'link', example: 'a URL' },
  { word: 'Email', name: 'email', example: 'an email address' },
  { word: 'Phone', name: 'phone', example: 'a phone number' },
];

/**
 * The kinds a field can have: the ones that name rows first (Person, each
 * of the workspace's types, More than one type…, Note), then the values,
 * Select… among them. Each has an example of how a value is written.
 */
export function listKindChoices(types: ReadonlyArray<Pick<TypeNote, 'key' | 'name' | 'rows'>>): Array<BuilderRow<KindChoice>> {
  const named = types.filter((type) => type.rows?.kind !== 'tags' || type.rows.prefix !== '@');
  const example = (type: Pick<TypeNote, 'key' | 'name' | 'rows'>): string =>
    type.rows?.kind === 'tags' ? `a ${type.name} row · "${type.rows.prefix}…"` : `a ${type.name} note · "[[Title]]"`;
  const values = VALUE_KINDS.map(({ word, name, example: shown }): BuilderRow<KindChoice> => ({ label: word, description: shown, icon: kindIcon(name), action: { kind: 'word', word } }));
  return [
    { label: 'Rows', separator: true },
    { label: 'Person', description: '"@dana" · opens their page', icon: kindIcon('person'), action: { kind: 'word', word: 'Person' } },
    ...named.map((type): BuilderRow<KindChoice> => ({ label: type.name, description: example(type), icon: kindIcon('relation'), action: { kind: 'type', name: type.name } })),
    ...(named.length > 1 ? [{ label: 'More than one type…', description: named.slice(0, 2).map((type) => type.name).join(' or '), icon: kindIcon('relation'), action: { kind: 'types' } as const }] : []),
    { label: 'Note', description: '"[[Q3 plan]]" · any note', icon: kindIcon('note'), action: { kind: 'word', word: 'Note' } },
    { label: 'Values', separator: true },
    ...values.slice(0, 3),
    { label: 'Select…', description: 'one of a list you set', icon: kindIcon('select'), action: { kind: 'select' } },
    ...values.slice(3),
  ];
}

/** The kind choice a Kind cell is, so the list opens on it. */
export function findKindChoice(kindText: string, rows: ReadonlyArray<BuilderRow<KindChoice>>): BuilderRow<KindChoice> | undefined {
  const base = describeKindBase(kindText).toLowerCase();
  if (base.startsWith('select')) {
    return rows.find((row) => row.action?.kind === 'select');
  }
  if (/\sor\s/.test(base)) {
    return rows.find((row) => row.action?.kind === 'types');
  }
  return rows.find((row) => {
    const action = row.action;
    return (action?.kind === 'word' && action.word.toLowerCase() === base) || (action?.kind === 'type' && action.name.toLowerCase() === base);
  });
}

/** A Kind cell: its kind, `Select: ` and the options, and `, many` for several values. */
export function writeKindCell(base: string, options: { many?: boolean; selectOptions?: readonly string[] } = {}): string {
  const kind = options.selectOptions ? `Select: ${options.selectOptions.map((option) => option.trim()).filter(Boolean).join(', ')}` : base.trim();
  return options.many ? `${kind}, many` : kind;
}

/** The options a `Select: a, b` cell lists, as typed after it. */
export function readSelectOptions(kindText: string): string[] {
  return parseFieldKind(describeKindBase(kindText)).kind.options ?? [];
}

/** Whether a Kind cell's kind can hold several values: every kind but Checkbox. */
export function canHoldMany(kindText: string): boolean {
  return parseFieldKind(describeKindBase(kindText)).kind.name !== 'checkbox';
}

/** Whether a Kind cell names rows, so its field has a reverse. */
export function namesRows(kindText: string): boolean {
  const name = parseFieldKind(describeKindBase(kindText)).kind.name;
  return name === 'person' || name === 'relation';
}

/** One or several, each with how a row's front matter writes it. */
export function listManyChoices(fieldName: string, kindText: string): Array<BuilderRow<boolean>> {
  const kind = parseFieldKind(describeKindBase(kindText)).kind;
  const [one, two] = sampleValues(kind.name, readSelectOptions(kindText));
  const noun = kind.name === 'person' ? ['One person', 'Several people'] : ['One value', 'Several values'];
  return [
    { label: noun[0], description: describeKindBase(kindText), detail: `${fieldName}: ${one}`, icon: 'circle-small', action: false },
    { label: noun[1], description: `${describeKindBase(kindText)}, many`, detail: `${fieldName}: [${one}, ${two}]`, icon: 'list-flat', action: true },
  ];
}

/** Two values of a kind as front matter writes them, for an example. */
function sampleValues(kind: FieldKindName, options: readonly string[]): [string, string] {
  switch (kind) {
    case 'person':
      return ['"@dana"', '"@omar"'];
    case 'relation':
      return ['"#team/rates"', '"#team/fx"'];
    case 'note':
      return ['"[[Q3 plan]]"', '"[[Q4 plan]]"'];
    case 'number':
      return ['12', '40'];
    case 'date':
      return ['2026-03-01', '2026-04-15'];
    case 'select':
      return [options[0] ?? 'gold', options[1] ?? 'silver'];
    case 'link':
      return ['https://example.com', 'https://example.org'];
    case 'email':
      return ['dana@example.com', 'omar@example.com'];
    case 'phone':
      return ['"+1 555 0100"', '"+1 555 0101"'];
    case 'checkbox':
      return ['true', 'false'];
    case 'text':
      return ['Some text', 'More text'];
  }
}

/** What a name check says: an error that refuses it, or a message under the input. */
export interface NameCheck {
  error?: string;
  message?: string;
}

/**
 * A new field's name, as the type form checks it as it is typed: one that
 * cannot be a key, or that the type already has as a key, is refused; one
 * a search already reads is allowed with a warning; any other says how it
 * is written and searched.
 */
export function checkFieldName(name: string, type: Pick<BuilderType, 'fields'>, current?: string): NameCheck {
  const text = name.trim().replace(/\s+/g, ' ');
  if (!text) {
    return { message: 'Name the field, such as lead, tier, or Distribution List.' };
  }
  if (!isFrontmatterKey(text)) {
    return { error: 'Start with a letter and use letters, digits, spaces, - and _.' };
  }
  const taken = type.fields.find((field) => field.key === toFrontmatterKey(text) && field.key !== current);
  if (taken) {
    return { error: `This type already has ${taken.name}.` };
  }
  const query = toFieldQueryName(text);
  if (isBuiltInFieldName(text)) {
    return { message: `A search already reads ${query}, so this field is searched as field.${query}. A name such as ${query === 'status' ? 'state' : `${query}-of`} avoids that.` };
  }
  return { message: `Written in front matter as ${text}:, searched as ${query}.` };
}

/** A new type's name, as New Type checks it: one a file cannot have, or that a type has, is refused. */
export function checkTypeName(name: string, types: ReadonlyArray<Pick<TypeNote, 'key' | 'name'>>): NameCheck {
  const text = name.trim();
  if (!text) {
    return { message: 'Name the type, such as Org, Vendor, or Incident.' };
  }
  const key = slugTitle(text);
  const path = typeNotePath(text);
  if (!key || !path) {
    return { error: 'Write a name a note can have: no / \\ : * ? " < > |, and no dot or space at the end.' };
  }
  const taken = types.find((type) => type.key === key || type.name.toLowerCase() === text.toLowerCase());
  if (taken) {
    return { error: `There is a ${taken.name} type already.` };
  }
  return { message: `Writes ${path}. Its rows are searched as type = ${key}.` };
}

/** Words typed as a comma list, trimmed, empty ones left out. */
export function readCommaList(text: string): string[] {
  return text.split(',').map((word) => word.trim()).filter(Boolean);
}

/** `1 org`, `3 orgs`. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
