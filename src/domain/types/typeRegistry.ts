/**
 * Every type the workspace's type notes define, read together: each
 * relation's types resolved by display name or key, a key or rows written
 * twice, and a field a built-in query field already takes
 * (docs/implementation/30-databases.md § The model, D4).
 */
import type { ParsedFile, TypeField, TypeNote, TypeProblem } from '../model';
import { FIELD_ALIASES } from '../query/queryTypes';
import { COMPUTED_FIELD_NAMES, isRowKind, toFieldQueryName } from './fieldKinds';

/** A type as the registry holds it: its note, read with every other type. */
export interface TypeDefinition extends TypeNote {
  /** The type note's path. */
  filePath: string;
}

/**
 * The names a query already gives a meaning to: its fields and their
 * spellings, a row's title, and the computed fields. A schema field named
 * one of these is reachable in a query as `field.<name>`.
 */
export const BUILT_IN_FIELD_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(FIELD_ALIASES),
  'title',
  ...COMPUTED_FIELD_NAMES,
]);

/** Whether a field's query name is one a built-in takes. */
export function isBuiltInFieldName(name: string): boolean {
  return BUILT_IN_FIELD_NAMES.has(toFieldQueryName(name));
}

/** The words a relation names the people with when no type is named so. */
const PEOPLE_WORDS = new Set(['person', 'people']);

/** The types of a workspace, by key, with what is wrong with their notes. */
export class TypeRegistry {
  private readonly byKey = new Map<string, TypeDefinition>();
  private readonly byName = new Map<string, TypeDefinition>();
  private readonly byFile = new Map<string, TypeDefinition>();

  /**
   * `types` in key order, each key once; `problems` every type note's,
   * by path and line.
   */
  public constructor(
    public readonly types: readonly TypeDefinition[],
    public readonly problems: readonly TypeProblem[],
  ) {
    types.forEach((type) => {
      this.byKey.set(type.key, type);
      this.byFile.set(type.filePath, type);
      const name = type.name.toLowerCase();
      if (!this.byName.has(name)) {
        this.byName.set(name, type);
      }
    });
  }

  /** How many types there are. */
  public get size(): number {
    return this.types.length;
  }

  /** The type with this key or display name, any case. */
  public get(keyOrName: string): TypeDefinition | undefined {
    const text = keyOrName.trim().toLowerCase();
    return this.byKey.get(text) ?? this.byName.get(text);
  }

  /** The type a type note defines, by the note's path. */
  public ofFile(filePath: string): TypeDefinition | undefined {
    return this.byFile.get(filePath);
  }

  /**
   * The type whose rows a tag is: the one whose `rows:` prefix is the
   * longest the key starts with, so `#team/rates/*` takes its tags from
   * `#team/*`. A person, `@dana` or `#person/dana`, is the people type's.
   */
  public forTag(tagKey: string): TypeDefinition | undefined {
    const key = tagKey.toLowerCase();
    let best: TypeDefinition | undefined;
    let bestLength = -1;
    for (const type of this.types) {
      const rows = type.rows;
      if (rows?.kind !== 'tags') {
        continue;
      }
      const matches =
        rows.prefix === '@'
          ? key.startsWith('@') || key.startsWith('#person/')
          : key.startsWith(rows.prefix) && key.length > rows.prefix.length;
      if (matches && rows.prefix.length > bestLength) {
        best = type;
        bestLength = rows.prefix.length;
      }
    }
    return best;
  }

  /** The note type a `type:` value names, by key or display name; undefined for a namespace type or none. */
  public forTypeValue(value: string): TypeDefinition | undefined {
    const type = this.get(value);
    return type?.rows?.kind === 'notes' ? type : undefined;
  }

  /** The types whose rows are tags. */
  public get tagTypes(): TypeDefinition[] {
    return this.types.filter((type) => type.rows?.kind === 'tags');
  }

  /** The types whose rows are notes with a `type:` field. */
  public get noteTypes(): TypeDefinition[] {
    return this.types.filter((type) => type.rows?.kind === 'notes');
  }
}

/** A registry with no types, for a workspace with no `Types/` notes. */
export const EMPTY_TYPE_REGISTRY = new TypeRegistry([], []);

/**
 * Reads the type notes together. A key two notes give is the first's by
 * path; the second is left out with a problem. A relation's types are
 * resolved to keys; one naming no type reads as Text, with a problem.
 */
export function buildTypeRegistry(typeNotes: Iterable<ParsedFile>): TypeRegistry {
  const notes = [...typeNotes]
    .filter((file): file is ParsedFile & { typeNote: TypeNote } => file.typeNote !== undefined)
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  if (notes.length === 0) {
    return EMPTY_TYPE_REGISTRY;
  }
  const problems: TypeProblem[] = [];
  const kept = new Map<string, ParsedFile & { typeNote: TypeNote }>();
  notes.forEach((file) => {
    problems.push(...file.typeNote.problems);
    const earlier = kept.get(file.typeNote.key);
    if (earlier) {
      problems.push({
        code: 'duplicate-type',
        message: `${earlier.filePath} already defines the type ${file.typeNote.key}, so this note is not read.`,
        filePath: file.filePath,
        line: file.typeNote.keyLine ?? 1,
      });
      return;
    }
    kept.set(file.typeNote.key, file);
  });

  const ordered = [...kept.values()].sort((left, right) => left.typeNote.key.localeCompare(right.typeNote.key));
  const lookup = new Map<string, string>();
  ordered.forEach((file) => {
    lookup.set(file.typeNote.key, file.typeNote.key);
    const name = file.typeNote.name.toLowerCase();
    if (!lookup.has(name)) {
      lookup.set(name, file.typeNote.key);
    }
  });

  const rowPrefixes = new Map<string, string>();
  const types = ordered.map((file): TypeDefinition => {
    const note = file.typeNote;
    const report = (problem: Omit<TypeProblem, 'filePath'>): void => {
      problems.push({ ...problem, filePath: file.filePath });
    };
    const rows = note.rows;
    if (rows?.kind === 'tags') {
      const other = rowPrefixes.get(rows.prefix);
      if (other) {
        report({
          code: 'duplicate-rows',
          message: `The ${other} type's rows are ${rows.written} already, so its rows are read as ${other}.`,
          line: note.rowsLine ?? 1,
        });
      } else {
        rowPrefixes.set(rows.prefix, note.key);
      }
    }
    return {
      ...note,
      filePath: file.filePath,
      fields: note.fields.map((field) => resolveField(field, lookup, ordered, report)),
    };
  });
  return new TypeRegistry(
    types,
    problems.sort((left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line),
  );
}

/**
 * A field read with every type known: a relation's types as keys, or Text
 * when one names no type; and the problems a field can have only beside
 * the others, a built-in's name and a reverse on a field that is no
 * relation.
 */
function resolveField(
  field: TypeField,
  lookup: ReadonlyMap<string, string>,
  notes: ReadonlyArray<{ typeNote: TypeNote }>,
  report: (problem: Omit<TypeProblem, 'filePath'>) => void,
): TypeField {
  if (BUILT_IN_FIELD_NAMES.has(toFieldQueryName(field.name))) {
    report({
      code: 'built-in-name',
      message: `${field.name} is a built-in query field, so a query reaches this one as field.${field.name}.`,
      line: field.line,
      field: field.key,
    });
  }
  let kind = field.kind;
  if (kind.name === 'relation') {
    const keys: string[] = [];
    let people = false;
    const unknown: string[] = [];
    (kind.targets ?? []).forEach((target) => {
      const key = lookup.get(target.toLowerCase());
      if (key) {
        keys.push(key);
        const rows = notes.find((note) => note.typeNote.key === key)?.typeNote.rows;
        people ||= rows?.kind === 'tags' && rows.prefix === '@';
      } else if (PEOPLE_WORDS.has(target.toLowerCase())) {
        people = true;
      } else {
        unknown.push(target);
      }
    });
    if (unknown.length > 0) {
      report({
        code: 'unknown-kind',
        message: `"${unknown.join('" and "')}" is not a kind or a type, so ${field.name} is read as Text.`,
        line: field.line,
        field: field.key,
      });
      kind = { name: 'text', many: kind.many };
    } else if (keys.length === 0 && people) {
      kind = { name: 'person', many: kind.many };
    } else {
      kind = { ...kind, targets: [...new Set(keys)], ...(people ? { people } : {}) };
    }
  }
  // A relation naming no type has its own problem; its reverse needs none.
  if (field.reverse && !isRowKind(field.kind)) {
    report({
      code: 'reverse-on-non-relation',
      message: `${field.name} is not a relation, so its reverse, ${field.reverse}, is not used.`,
      line: field.line,
      field: field.key,
    });
  }
  return kind === field.kind ? field : { ...field, kind };
}
