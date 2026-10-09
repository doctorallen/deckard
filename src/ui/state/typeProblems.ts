/**
 * The editor's marks on typed notes, apart from VS Code
 * (docs/implementation/30-databases.md § Surfaces 2): where each of a
 * note's type problems sits on its line, and the quick fixes it offers.
 *
 * - A value that names no row: Change to the closest rows, and Create
 *   person "Omar H".
 * - A value no option of a select spells: Change to the closest option.
 * - A Kind cell naming no type: Create a <Type> type.
 * - On a type's table, a relation whose values are tags of a namespace it
 *   does not take: Allow A or B, and Create a <Type> type.
 *
 * The problems are the type index's, read from the saved notes; they are
 * placed on the editor's lines as they are now, and one whose value is no
 * longer on its line is left out until the notes are read again.
 */
import { formatKeyWords, readTagNamespace } from '../../domain/markdown/tagKeys';
import type { FieldKind, TypeField, TypeProblem, TypeProblemCode, WorkspaceIndex } from '../../domain/model';
import { parseFieldKind, isRowKind } from '../../domain/types/fieldKinds';
import { slugTitle } from '../../domain/types/rowNotes';
import type { TypeIndex } from '../../domain/types/typeIndex';
import { allowKindTarget, findTableCells } from '../../domain/types/typeNoteWriter';
import type { TypeDefinition } from '../../domain/types/typeRegistry';
import { isWithinDistance } from '../../domain/ranking/tagHygiene';
import { findClosestRows, listKindRows } from './typeRows';

/** What a mark on a type's table is about, beside the type index's own problems. */
export type TypeDiagnosticCode = TypeProblemCode | 'other-namespace';

/** A fix a type problem offers. */
export type TypeFix =
  /** Rewrites the marked text: Change to a close row or option, or Allow Area or System. */
  | { kind: 'replace'; title: string; line: number; start: number; end: number; text: string; preferred?: boolean }
  /** Writes a row's note: Create person "Omar H". */
  | { kind: 'create-row'; title: string; typeKey: string; rowTitle: string }
  /** Writes a type note: Create a System type. */
  | { kind: 'create-type'; title: string; key: string; name: string; rows: string };

/** One mark on a note: where, what it says, and how to fix it. */
export interface TypeDiagnostic {
  code: TypeDiagnosticCode;
  message: string;
  /** Zero-based line and columns. */
  line: number;
  start: number;
  end: number;
  fixes: TypeFix[];
}

/** The type the people are rows of when no type has them, so a person can still be created. */
const PEOPLE_FALLBACK = 'person';

/**
 * The marks on one note, in line order: its own problems as the type index
 * reads them, each placed on its line as the editor holds it now, and, on
 * a type note, a mark on each relation whose rows' notes write tags of a
 * namespace it does not take.
 */
export function describeTypeDiagnostics(
  types: TypeIndex,
  index: WorkspaceIndex,
  filePath: string,
  lines: readonly string[],
): TypeDiagnostic[] {
  if (types.isEmpty) {
    return [];
  }
  const typeNote = types.registry.ofFile(filePath);
  const marks = types.problemsIn(filePath).flatMap((problem): TypeDiagnostic[] => {
    const at = locateTypeProblem(lines[problem.line - 1] ?? '', problem, typeNote);
    if (!at) {
      return [];
    }
    const line = problem.line - 1;
    return [
      {
        code: problem.code,
        message: problem.message,
        line,
        ...at,
        fixes: findTypeFixes({ types, index, typeNote }, problem, { line, ...at }),
      },
    ];
  });
  if (typeNote) {
    marks.push(...describeOtherNamespaces(types, typeNote, lines));
  }
  return marks.sort((left, right) => left.line - right.line || left.start - right.start);
}

/**
 * Where a problem sits on its line: the value it is about, quotes and all;
 * on a type's table, the field's cell, or its Kind cell for a kind that
 * names nothing; else the key it is about, or the whole line. Undefined
 * when the value is no longer on the line.
 */
export function locateTypeProblem(
  text: string,
  problem: Pick<TypeProblem, 'code' | 'field' | 'value'>,
  typeNote?: Pick<TypeDefinition, 'columns' | 'table'>,
): { start: number; end: number } | undefined {
  if (problem.value !== undefined) {
    return locateValue(text, problem.value);
  }
  const cells = /^\s*\|/.test(text) ? findTableCells(text) : [];
  if (cells.length > 1 && typeNote?.columns) {
    const role = problem.code === 'unknown-kind' || problem.code === 'missing-kind' ? 'kind' : 'field';
    const cell = cells[typeNote.columns.findIndex((column) => column.trim().toLowerCase() === role)];
    if (cell && cell.end > cell.start) {
      return { start: cell.start, end: cell.end };
    }
  }
  const key = problem.field ? new RegExp(`^(\\s*)(${escape(problem.field)})\\s*:`, 'i').exec(text) : null;
  if (key) {
    return { start: key[1].length, end: key[1].length + key[2].length };
  }
  const start = text.search(/\S/);
  return start < 0 ? { start: 0, end: 0 } : { start, end: text.trimEnd().length };
}

/** Where a value is written after its line's `key:`, with the quotes around it; undefined when it is not there. */
function locateValue(text: string, value: string): { start: number; end: number } | undefined {
  const colon = text.indexOf(':');
  const from = colon < 0 ? 0 : colon + 1;
  const rest = text.slice(from);
  for (const written of [`"${value}"`, `'${value}'`, value]) {
    const at = rest.indexOf(written);
    if (at >= 0) {
      return { start: from + at, end: from + at + written.length };
    }
  }
  const at = rest.toLowerCase().indexOf(value.toLowerCase());
  return at >= 0 ? { start: from + at, end: from + at + value.length } : undefined;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The fixes one problem offers, for its mark at `at`. */
function findTypeFixes(
  { types, index, typeNote }: { types: TypeIndex; index: WorkspaceIndex; typeNote: TypeDefinition | undefined },
  problem: TypeProblem,
  at: { line: number; start: number; end: number },
): TypeFix[] {
  if (problem.code === 'unknown-kind' && typeNote) {
    return createTypeFixes(types, index, typeNote, problem.field);
  }
  if (problem.code !== 'unresolved-value' || problem.field === undefined || problem.value === undefined) {
    return [];
  }
  const field = findRowField(types, problem.filePath, problem.field);
  if (!field) {
    return [];
  }
  const kind = field.kind;
  if (kind.name === 'select') {
    return closestOptions(kind.options ?? [], problem.value).map((option, rank) => ({
      kind: 'replace',
      title: `Change to ${option}`,
      ...at,
      text: option,
      ...(rank === 0 ? { preferred: true } : {}),
    }));
  }
  if (kind.name !== 'person' && kind.name !== 'relation') {
    return [];
  }
  const fixes: TypeFix[] = findClosestRows(listKindRows(types, index, kind), problem.value).map((choice, rank) => ({
    kind: 'replace',
    title: `Change to ${choice.written.replace(/^"|"$/g, '')} (${choice.title})`,
    ...at,
    text: choice.written,
    ...(rank === 0 ? { preferred: true } : {}),
  }));
  const create = createRowFix(types, kind, problem.value);
  return create ? [...fixes, create] : fixes;
}

/** The field a problem in a row's note is about, as the first of its types to define it reads it. */
function findRowField(types: TypeIndex, filePath: string, key: string): TypeField | undefined {
  const keys = [...new Set(types.rowsOfFile(filePath).map((row) => row.typeKey))].sort();
  for (const typeKey of keys) {
    const field = types.registry.get(typeKey)?.fields.find((candidate) => candidate.key === key);
    if (field) {
      return field;
    }
  }
  return undefined;
}

/** A select's options closest to a value no option spells, at most three. */
function closestOptions(options: readonly string[], value: string): string[] {
  const query = value.trim().toLowerCase();
  return options
    .filter((option) => {
      const lower = option.toLowerCase();
      return (query.length >= 2 && (lower.startsWith(query) || query.startsWith(lower))) || isWithinDistance(lower, query, Math.max(1, Math.floor(query.length / 3)));
    })
    .slice(0, 3);
}

/**
 * Create person "Omar H": a new row of the type the field takes first, for
 * a value written loosely or as a tag of that type's namespace. A tag of
 * another namespace is that namespace's, so it is not offered.
 */
function createRowFix(types: TypeIndex, kind: FieldKind, value: string): TypeFix | undefined {
  const { type, typeKey } = findCreatedRowType(types, kind);
  if (!typeKey) {
    return undefined;
  }
  const prefix = type?.rows?.kind === 'tags' ? type.rows.prefix : '@';
  const title = readRowTitle(value, prefix);
  if (!title || !slugTitle(title)) {
    return undefined;
  }
  const name = (type?.name ?? 'Person').toLowerCase();
  return { kind: 'create-row', title: `Create ${name} "${title}"`, typeKey, rowTitle: title };
}

/**
 * The type a new row of a field is made in: the first type the field
 * takes, or, for a person, the type the people are rows of, or the people
 * themselves when no type has them.
 */
function findCreatedRowType(types: TypeIndex, kind: FieldKind): { type?: TypeDefinition; typeKey?: string } {
  const target = kind.targets?.[0] ? types.registry.get(kind.targets[0]) : undefined;
  if (target) {
    return { type: target, typeKey: target.key };
  }
  if (kind.name !== 'person' && !kind.people) {
    return {};
  }
  const people = types.registry.tagTypes.find((candidate) => candidate.rows?.kind === 'tags' && candidate.rows.prefix === '@');
  return people ? { type: people, typeKey: people.key } : { typeKey: PEOPLE_FALLBACK };
}

/**
 * The title a new row would get from a value that names none: a loose
 * value as written; a tag of the row's namespace by its last part worded
 * (`#team/credit-trading` is Credit Trading); undefined for a tag of
 * another namespace, which is that namespace's to have.
 */
function readRowTitle(value: string, prefix: string): string | undefined {
  const text = value.trim().replace(/^\[\[|\]\]$/g, '');
  if (!/^[@#]/.test(text)) {
    return text;
  }
  const key = text.toLowerCase();
  const prefixes = prefix === '@' ? ['@', '#person/'] : [prefix];
  const found = prefixes.find((candidate) => key.startsWith(candidate));
  const bare = found ? key.slice(found.length) : '';
  return bare ? formatKeyWords(bare.split('/').pop() ?? bare) : undefined;
}

/**
 * Create a <Type> type, for each name a field's Kind cell gives that no
 * type has: its rows the tags of the namespace with that name, when any
 * tag is written there, or else notes with a `type:` field.
 */
function createTypeFixes(types: TypeIndex, index: WorkspaceIndex, typeNote: TypeDefinition, key: string | undefined): TypeFix[] {
  const field = typeNote.fields.find((candidate) => candidate.key === key);
  const targets = field ? (parseFieldKind(field.kindText).kind.targets ?? []) : [];
  return targets
    .filter((target) => !types.registry.get(target) && !/^(?:person|people)$/i.test(target))
    .flatMap((target) => {
      const typeKey = slugTitle(target);
      return typeKey ? [createTypeFix(index, typeKey, target)] : [];
    });
}

/** Create a <Type> type: rows of its namespace when tags are written there, else notes. */
function createTypeFix(index: WorkspaceIndex, key: string, name: string): TypeFix {
  const prefix = `#${key}/`;
  const tagged = [...index.tags.keys()].some((tag) => tag.toLowerCase().startsWith(prefix));
  return { kind: 'create-type', title: `Create a ${name} type`, key, name, rows: tagged ? `${prefix}*` : 'notes' };
}

/**
 * On a type's table, a mark on each relation whose rows' notes write tags
 * of a namespace it does not take, as Create Type leaves a field whose
 * values were mostly one namespace's: `2 values of owns are #system/ tags,
 * which Area does not take.`, with Allow Area or System, and Create a
 * System type when no type has those tags.
 */
function describeOtherNamespaces(
  types: TypeIndex,
  typeNote: TypeDefinition,
  lines: readonly string[],
): TypeDiagnostic[] {
  const relations = typeNote.fields.filter((field) => isRowKind(field.kind) && field.kind.name !== 'note');
  if (relations.length === 0) {
    return [];
  }
  const counts = new Map<string, Map<string, number>>();
  types.problems.forEach((problem) => {
    if (problem.code !== 'unresolved-value' || !problem.field || !problem.value) {
      return;
    }
    if (!relations.some((field) => field.key === problem.field)) {
      return;
    }
    if (!types.rowsOfFile(problem.filePath).some((row) => row.typeKey === typeNote.key)) {
      return;
    }
    const namespace = readTagNamespace(problem.value.trim().toLowerCase());
    if (!namespace) {
      return;
    }
    const byNamespace = counts.get(problem.field) ?? new Map<string, number>();
    byNamespace.set(namespace, (byNamespace.get(namespace) ?? 0) + 1);
    counts.set(problem.field, byNamespace);
  });
  const kindColumn = typeNote.columns?.findIndex((column) => column.trim().toLowerCase() === 'kind') ?? -1;
  return relations.flatMap((field) => {
    const byNamespace = counts.get(field.key);
    const text = lines[field.line - 1] ?? '';
    const cell = kindColumn >= 0 ? findTableCells(text)[kindColumn] : undefined;
    if (!byNamespace || !cell || cell.end <= cell.start) {
      return [];
    }
    const line = field.line - 1;
    const takes = cell.text.replace(/,\s*many\s*$/i, '').trim();
    return [...byNamespace].map(([namespace, count]): TypeDiagnostic => {
      const other = types.registry.forTag(`#${namespace}/x`);
      const name = other?.name ?? formatKeyWords(namespace.split('/').pop() ?? namespace);
      const fixes: TypeFix[] = [
        {
          kind: 'replace',
          title: `Allow ${takes} or ${name}`,
          line,
          start: cell.start,
          end: cell.end,
          text: allowKindTarget(cell.text, name),
          preferred: true,
        },
      ];
      if (!other) {
        const key = slugTitle(namespace.split('/').pop() ?? namespace);
        fixes.push({ kind: 'create-type', title: `Create a ${name} type`, key, name, rows: `#${namespace}/*` });
      }
      return {
        code: 'other-namespace',
        message: `${count} ${count === 1 ? 'value' : 'values'} of ${field.name} ${count === 1 ? 'is a' : 'are'} #${namespace}/ ${count === 1 ? 'tag' : 'tags'}, which ${takes} does not take.`,
        line,
        start: cell.start,
        end: cell.end,
        fixes,
      };
    });
  });
}

/** What a note's type problems add to its one problems lens. */
export interface TypeProblemCounts {
  /** Values that name nothing, or do not fit their field's kind. */
  unresolved: number;
  /** Everything else: fields that disagree, built-in names, and what is wrong with a type note. */
  other: number;
}

/** A note's type problems, counted for its problems lens. */
export function countTypeProblems(problems: readonly Pick<TypeProblem, 'code'>[]): TypeProblemCounts {
  const unresolved = problems.filter((problem) => problem.code === 'unresolved-value' || problem.code === 'kind-mismatch').length;
  return { unresolved, other: problems.length - unresolved };
}
