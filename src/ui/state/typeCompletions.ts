/**
 * What the editor completes in typed notes, apart from VS Code
 * (docs/implementation/30-databases.md § Surfaces 2): in a row note's front
 * matter, its types' field names on a new line and, after a field's name,
 * the rows, options, or words its kind takes; in a type note, the kinds in
 * the table's Kind column and the rows `rows:` can name.
 */
import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import { readTagNamespace } from '../../domain/markdown/tagKeys';
import type { TypeNote, WorkspaceIndex } from '../../domain/model';
import type { TypeIndex } from '../../domain/types/typeIndex';
import type { TypeDefinition } from '../../domain/types/typeRegistry';
import { findTableCellAt, findTableCells } from '../../domain/types/typeNoteWriter';
import { listKindRows, matchesRowChoice } from './typeRows';

/** Where a completion in front matter is, and what it completes. */
export type FrontmatterCompletionContext =
  | {
      kind: 'key';
      /** Zero-based columns the key being typed spans. */
      start: number;
      end: number;
      /** The keys the front matter already writes, lowercased. */
      present: ReadonlySet<string>;
    }
  | {
      kind: 'value';
      /** The field's key, lowercased. */
      key: string;
      /** Zero-based columns of the value being typed: from its start, quote and all, to its end. */
      start: number;
      end: number;
      /** What is typed of it before the cursor, without its opening quote. */
      typed: string;
      /** Whether it opens with a quote, which the replaced text then starts with. */
      quoted: boolean;
    };

/** A front-matter key, as the parser keys one. */
const KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** A line that writes a key: `lead: "@dana"`. */
const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:/;

/**
 * What a cursor in a note's front matter completes: a key, on a line with
 * nothing else before the cursor, or a value, after `key:`, the one being
 * typed in an inline `[a, b]` list among them. Undefined outside front
 * matter, or on an indented line.
 */
export function findFrontmatterCompletionContext(
  lines: readonly string[],
  line: number,
  character: number,
): FrontmatterCompletionContext | undefined {
  if (line <= 0 || lines[0]?.trim() !== '---') {
    return undefined;
  }
  const end = findFrontmatterEnd(lines);
  if (end !== undefined && line >= end) {
    return undefined;
  }
  const text = lines[line] ?? '';
  const before = text.slice(0, character);
  if (before === '' || KEY.test(before)) {
    const after = /^[A-Za-z0-9_-]*/.exec(text.slice(character))?.[0] ?? '';
    if (/^\s*:/.test(text.slice(character + after.length))) {
      return undefined;
    }
    const present = new Set<string>();
    lines.slice(1, end ?? lines.length).forEach((written, at) => {
      const key = at + 1 === line ? undefined : KEY_LINE.exec(written)?.[1];
      if (key) {
        present.add(key.toLowerCase());
      }
    });
    return { kind: 'key', start: 0, end: character + after.length, present };
  }
  const keyed = KEY_LINE.exec(before);
  if (!keyed) {
    return undefined;
  }
  const valueStart = keyed[0].length;
  const tokenStart = findValueStart(before, valueStart);
  const tokenEnd = findValueEnd(text, character);
  return {
    kind: 'value',
    key: keyed[1].toLowerCase(),
    start: tokenStart,
    end: Math.max(tokenEnd, character),
    typed: before.slice(tokenStart).replace(/^["']/, ''),
    quoted: /^["']/.test(before.slice(tokenStart)),
  };
}

/**
 * Where the value being typed starts: after the last `[` or `,` outside a
 * quoted value, or after `key:`, and past any spaces.
 */
function findValueStart(before: string, from: number): number {
  let start = from;
  let quote: string | undefined;
  for (let at = from; at < before.length; at += 1) {
    const character = before[at];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[' || character === ',') {
      start = at + 1;
    }
  }
  while (start < before.length && before[start] === ' ') {
    start += 1;
  }
  return start;
}

/** Where the value at the cursor ends: before the next `,` or `]`, or the line's end, without trailing spaces. */
function findValueEnd(text: string, from: number): number {
  const rest = text.slice(from);
  const stop = rest.search(/[,\]]/);
  const value = stop < 0 ? rest : rest.slice(0, stop);
  return from + value.trimEnd().length;
}

/** One completion offered: what it reads as, says, and writes. */
export interface TypeCompletion {
  label: string;
  /** What it is: `Team · lead Omar Haddad`, `Person field`. */
  detail: string;
  /** What choosing it writes, in a sentence. */
  documentation: string;
  insertText: string;
  /** What VS Code matches the typed text against. */
  filterText: string;
  /** The icon it is drawn with. */
  icon: 'field' | 'row' | 'option' | 'value' | 'kind' | 'rows';
}

/**
 * The fields of a row note's types that its front matter does not write
 * yet, in each type's table order, each written as `key: `.
 */
export function listFieldKeyCompletions(types: readonly TypeDefinition[], present: ReadonlySet<string>): TypeCompletion[] {
  const offered = new Set<string>();
  return types.flatMap((type) =>
    type.fields.flatMap((field) => {
      if (present.has(field.key) || offered.has(field.key)) {
        return [];
      }
      offered.add(field.key);
      return [
        {
          label: field.name,
          detail: `${type.name} field · ${field.kindText || 'Text'}`,
          documentation: `Writes \`${field.key}: \`, a ${type.name}'s ${field.name}.`,
          insertText: `${field.key}: `,
          filterText: field.name,
          icon: 'field' as const,
        },
      ];
    }),
  );
}

/**
 * What a field's value can be, by its kind: the rows a person or relation
 * names that match what is typed, each written as Deckard writes it; a
 * select's options; or `true` and `false`. Nothing for a field no type of
 * the note defines, or a kind with nothing to choose from.
 */
export function listFieldValueCompletions(
  typeIndex: TypeIndex,
  index: WorkspaceIndex,
  types: readonly TypeDefinition[],
  value: { key: string; typed: string; quoted?: boolean },
): TypeCompletion[] {
  const { key, typed } = value;
  // VS Code matches what the range holds, an opening quote and all.
  const quote = value.quoted ? '"' : '';
  const field = types.flatMap((type) => type.fields).find((candidate) => candidate.key === key);
  if (!field) {
    return [];
  }
  const kind = field.kind;
  if (kind.name === 'person' || kind.name === 'relation') {
    return listKindRows(typeIndex, index, kind)
      .filter((choice) => matchesRowChoice(choice, typed))
      .map((choice) => ({
        label: choice.title,
        detail: choice.detail,
        documentation: `Writes ${choice.written}, ${choice.title}.`,
        insertText: choice.written,
        filterText: `${quote}${choice.title} ${choice.written}`,
        icon: 'row' as const,
      }));
  }
  if (kind.name === 'select') {
    return (kind.options ?? []).map((option) => ({
      label: option,
      detail: `${field.name} option`,
      documentation: `Writes ${option}, one of ${field.name}'s options.`,
      insertText: option,
      filterText: `${quote}${option}`,
      icon: 'option' as const,
    }));
  }
  if (kind.name === 'checkbox') {
    return ['true', 'false'].map((word) => ({
      label: word,
      detail: `${field.name} checkbox`,
      documentation: `Writes ${word}.`,
      insertText: word,
      filterText: `${quote}${word}`,
      icon: 'value' as const,
    }));
  }
  return [];
}

/** The kinds a type's Kind cell can name, as the table writes them, with what each holds. */
const KIND_WORDS: ReadonlyArray<{ label: string; insert: string; detail: string }> = [
  { label: 'Text', insert: 'Text', detail: 'Anything, as typed' },
  { label: 'Number', insert: 'Number', detail: '12, 1,200, 1.5' },
  { label: 'Date', insert: 'Date', detail: '2026-03-01, or words such as next friday' },
  { label: 'Checkbox', insert: 'Checkbox', detail: 'true or false' },
  { label: 'Select', insert: 'Select: ', detail: 'One of the options written after it: Select: gold, silver' },
  { label: 'Person', insert: 'Person', detail: 'A person, written "@dana"' },
  { label: 'Note', insert: 'Note', detail: 'A note, written "[[Title]]"' },
  { label: 'Link', insert: 'Link', detail: 'A URL' },
  { label: 'Email', insert: 'Email', detail: 'An email address' },
  { label: 'Phone', insert: 'Phone', detail: 'A phone number' },
];

/**
 * Where a cursor in a type note's schema table completes a kind: in the
 * Kind column of a row below the header. Undefined anywhere else.
 */
export function findKindCellContext(
  typeNote: Pick<TypeNote, 'table' | 'columns'> | undefined,
  lines: readonly string[],
  line: number,
  character: number,
): { start: number; end: number } | undefined {
  const table = typeNote?.table;
  const kindColumn = typeNote?.columns?.findIndex((column) => column.trim().toLowerCase() === 'kind') ?? -1;
  // The table's lines are one-based; its body starts two below the header.
  if (!table || kindColumn < 0 || line + 1 < table.startLine + 2 || line + 1 > table.endLine) {
    return undefined;
  }
  const text = lines[line] ?? '';
  if (findTableCellAt(text, character) !== kindColumn) {
    return undefined;
  }
  const cell = findTableCells(text)[kindColumn];
  return cell ? { start: Math.min(cell.start, character), end: Math.max(cell.end, character) } : undefined;
}

/** The kinds a Kind cell can name, then a relation to each type, by its display name. */
export function listKindCompletions(types: readonly TypeDefinition[]): TypeCompletion[] {
  return [
    ...KIND_WORDS.map(({ label, insert, detail }) => ({
      label,
      detail,
      documentation: `Writes ${insert.trim()}. Add ", many" for a field that holds several.`,
      insertText: insert,
      filterText: label,
      icon: 'kind' as const,
    })),
    ...types.map((type) => ({
      label: type.name,
      detail: `A ${type.name}: a relation to that type's rows`,
      documentation: `Writes ${type.name}. Write "${type.name} or …" for a field that takes two types.`,
      insertText: type.name,
      filterText: type.name,
      icon: 'kind' as const,
    })),
  ];
}

/**
 * What `rows:` can name: each tag namespace in use, the most used first,
 * as `"#team/*"`; the people, `"@*"`; and `notes`, for a type whose rows
 * are notes with a `type:` field.
 */
export function listRowsCompletions(index: WorkspaceIndex): TypeCompletion[] {
  const namespaces = new Map<string, number>();
  index.tags.forEach((tag) => {
    const namespace = readTagNamespace(tag.key.toLowerCase());
    if (namespace && namespace !== 'person') {
      namespaces.set(namespace, (namespaces.get(namespace) ?? 0) + 1);
    }
  });
  return [
    ...[...namespaces]
      .sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName))
      .map(([namespace, count]) => ({
        label: `"#${namespace}/*"`,
        detail: `${count} ${count === 1 ? 'tag' : 'tags'} under #${namespace}/`,
        documentation: `Writes "#${namespace}/*": each tag under #${namespace}/ is a row, its fields in its hub note.`,
        insertText: `"#${namespace}/*"`,
        filterText: `#${namespace}/* ${namespace}`,
        icon: 'rows' as const,
      })),
    {
      label: '"@*"',
      detail: 'People',
      documentation: 'Writes "@*": each person is a row, its fields in its hub note.',
      insertText: '"@*"',
      filterText: '@* people',
      icon: 'rows' as const,
    },
    {
      label: 'notes',
      detail: 'Notes whose type: names this type',
      documentation: 'Writes notes: each note whose front matter has type: and this type\'s key is a row.',
      insertText: 'notes',
      filterText: 'notes',
      icon: 'rows' as const,
    },
  ];
}
