/**
 * The fields a query can ask a type's rows about, by the names a query
 * writes them with (docs/implementation/30-databases.md § Query language):
 * each type's own fields, the reverses other types' relations compute on
 * it, and the computed fields; and the schema the query parser reads a
 * workspace's type fields, paths, and types by.
 */
import type { FieldKind, FieldKindName, WorkspaceIndex } from '../model';
import { parseQuery } from '../query/queryParser';
import type { ParsedQuery, QueryFieldSchema, QueryTypeField } from '../query/queryTypes';
import { isWithinDistance } from '../ranking/tagHygiene';
import { isRowKind, reverseNameOf, toFieldQueryName } from './fieldKinds';
import { getTypeIndex, MAX_PATH_SEGMENTS, splitFieldPath } from './typeIndex';
import { isBuiltInFieldName, type TypeDefinition, type TypeRegistry } from './typeRegistry';

/** One field a type's rows can be asked about in a query. */
export interface TypeQueryField {
  /** The name a query writes: `lead`, `owned-by`, `open-tasks`, or `field.status` for one a built-in's name takes. */
  name: string;
  /** The name as the schema writes it, or the reverse's or computed field's: `on-call`, `owned by`. */
  label: string;
  kind: FieldKind;
  /** Where its values come from: the type's table, other types' relations, or the notes. */
  source: 'field' | 'reverse' | 'computed';
  /** The types its values are rows of, by key: a relation's, the people type for a person; empty for any other kind. */
  targets: string[];
}

/** Each registry's fields by type, listed the first time they are asked for. */
const fieldLists = new WeakMap<TypeRegistry, Map<string, TypeQueryField[]>>();

/**
 * Every field a type's rows can be asked about: its table's fields in
 * order, then the reverses other types' relations compute on it that no
 * field of its own takes, then the computed fields. A reverse whose name a
 * built-in takes cannot be named in a query, so it is left out.
 */
export function listTypeQueryFields(registry: TypeRegistry, typeKey: string): TypeQueryField[] {
  const type = registry.get(typeKey);
  if (!type) {
    return [];
  }
  let byType = fieldLists.get(registry);
  if (!byType) {
    byType = new Map();
    fieldLists.set(registry, byType);
  }
  let fields = byType.get(type.key);
  if (!fields) {
    fields = collectTypeQueryFields(registry, type);
    byType.set(type.key, fields);
  }
  return fields;
}

/** The fields of one type, worked out from every type's table. */
function collectTypeQueryFields(registry: TypeRegistry, type: TypeDefinition): TypeQueryField[] {
  const own: TypeQueryField[] = type.fields.map((field) => {
    const queryName = toFieldQueryName(field.name);
    return {
      name: isBuiltInFieldName(field.name) ? `field.${queryName}` : queryName,
      label: field.name,
      kind: field.kind,
      source: 'field',
      targets: targetsOf(registry, field.kind),
    };
  });
  const taken = new Set(type.fields.map((field) => toFieldQueryName(field.name)));
  const reverses = new Map<string, TypeQueryField>();
  registry.types.forEach((other) =>
    other.fields.forEach((field) => {
      if (!isRowKind(field.kind) || !targetsOf(registry, field.kind).includes(type.key)) {
        return;
      }
      const label = reverseNameOf(field);
      const name = toFieldQueryName(label);
      if (!name || taken.has(name) || isBuiltInFieldName(label)) {
        return;
      }
      const reverse = reverses.get(name);
      if (reverse) {
        reverse.targets = [...new Set([...reverse.targets, other.key])];
        return;
      }
      reverses.set(name, {
        name,
        label,
        kind: { name: 'relation', many: true, targets: [other.key] },
        source: 'reverse',
        targets: [other.key],
      });
    }),
  );
  return [...own, ...reverses.values(), ...computedFields(type)];
}

/**
 * The types a kind's values are rows of: a relation's targets, with the
 * people type when it also takes people; the people type for a person;
 * every note type for a Note, whose rows are notes.
 */
function targetsOf(registry: TypeRegistry, kind: FieldKind): string[] {
  const people = registry.tagTypes.filter((type) => type.rows?.kind === 'tags' && type.rows.prefix === '@').map((type) => type.key);
  switch (kind.name) {
    case 'person':
      return people;
    case 'note':
      return registry.noteTypes.map((type) => type.key);
    case 'relation':
      return [...new Set([...(kind.targets ?? []).flatMap((target) => registry.get(target)?.key ?? []), ...(kind.people ? people : [])])];
    case 'text':
    case 'number':
    case 'date':
    case 'checkbox':
    case 'select':
    case 'link':
    case 'email':
    case 'phone':
      return [];
  }
}

/**
 * The computed fields of a type's rows: open tasks, mentions, and when it
 * was last mentioned; the notes that link to a note row; and the parent
 * and children of a nested namespace row.
 */
function computedFields(type: TypeDefinition): TypeQueryField[] {
  const computed = (name: string, kind: FieldKind, targets: string[] = []): TypeQueryField => ({
    name,
    label: name,
    kind,
    source: 'computed',
    targets,
  });
  const nested = type.rows?.kind === 'tags' && type.rows.prefix !== '@';
  return [
    computed('open-tasks', { name: 'number', many: false }),
    computed('last-mentioned', { name: 'date', many: false }),
    computed('mentions', { name: 'number', many: false }),
    ...(type.rows?.kind === 'notes' ? [computed('linked-from', { name: 'note', many: true })] : []),
    ...(nested
      ? [
          computed('parent', { name: 'relation', many: false, targets: [type.key] }, [type.key]),
          computed('children', { name: 'relation', many: true, targets: [type.key] }, [type.key]),
        ]
      : []),
  ];
}

/**
 * The field one segment of a path names among a type's fields: by its
 * query name, or as `field.<name>`, which reaches a table's field whatever
 * its name.
 */
function findField(fields: readonly TypeQueryField[], segment: string): TypeQueryField | undefined {
  return (
    fields.find((field) => field.name === segment) ??
    fields.find((field) => field.source === 'field' && `field.${toFieldQueryName(field.label)}` === segment)
  );
}

/**
 * The fields a name or path reaches, from the rows of `typeKeys` (every
 * type when not given): each segment a field of the types the one before
 * named, at most MAX_PATH_SEGMENTS. Empty for a name no type has.
 */
export function resolveTypeQueryPath(registry: TypeRegistry, path: string, typeKeys?: readonly string[]): TypeQueryField[] {
  const segments = splitFieldPath(path.toLowerCase());
  if (segments.length === 0 || segments.length > MAX_PATH_SEGMENTS) {
    return [];
  }
  let types = typeKeys ? [...typeKeys] : registry.types.map((type) => type.key);
  let found: TypeQueryField[] = [];
  for (let at = 0; at < segments.length; at += 1) {
    found = types.flatMap((typeKey) => findField(listTypeQueryFields(registry, typeKey), segments[at]) ?? []);
    if (at < segments.length - 1) {
      types = [...new Set(found.flatMap((field) => field.targets))];
      if (types.length === 0) {
        return [];
      }
    }
  }
  return found;
}

/** Each registry's query schema, made the first time it is asked for. */
const schemas = new WeakMap<TypeRegistry, QueryFieldSchema>();

/**
 * What the query parser knows of a workspace's types: the fields and
 * paths their rows have, the types by key and name, and the fields a
 * misspelled name was likely meant to be. Undefined for a workspace with
 * no types, whose queries know only the built-in fields.
 */
export function getQueryFieldSchema(index: WorkspaceIndex): QueryFieldSchema | undefined {
  const registry = getTypeIndex(index).registry;
  return registry.size === 0 ? undefined : createQueryFieldSchema(registry);
}

/**
 * Parses a query as the workspace reads it: with its types' fields, paths,
 * and type names known (see parseQuery). What every surface that runs a
 * reader's query parses it with.
 */
export function parseWorkspaceQuery(index: WorkspaceIndex, text: string): ParsedQuery {
  return parseQuery(text, getQueryFieldSchema(index));
}

/** The query schema of a registry's types, made once per registry. */
export function createQueryFieldSchema(registry: TypeRegistry): QueryFieldSchema {
  const cached = schemas.get(registry);
  if (cached) {
    return cached;
  }
  const schema: QueryFieldSchema = {
    field: (name): QueryTypeField | undefined => {
      const found = resolveTypeQueryPath(registry, name);
      return found.length === 0
        ? undefined
        : { name: name.toLowerCase(), kinds: [...new Set<FieldKindName>(found.map((field) => field.kind.name))] };
    },
    type: (value) => registry.get(value)?.key,
    closest: (name) => closestFieldNames(registry, name),
  };
  schemas.set(registry, schema);
  return schema;
}

/** How many names an unknown field's message offers. */
const CLOSEST_LIMIT = 4;

/**
 * The type fields a name no type has could have meant: of the types the
 * path's earlier segments reach, or of every type, those that begin with
 * what was typed, or that it begins with, or that are two edits from it.
 */
function closestFieldNames(registry: TypeRegistry, name: string): string[] {
  const segments = splitFieldPath(name.toLowerCase());
  const last = segments.pop() ?? '';
  const head = segments.join('.');
  const reached = head ? resolveTypeQueryPath(registry, head).flatMap((field) => field.targets) : registry.types.map((type) => type.key);
  const candidates = [...new Set(reached.flatMap((typeKey) => listTypeQueryFields(registry, typeKey).map((field) => field.name)))];
  const close = candidates.filter(
    (candidate) =>
      (last.length >= 2 && (candidate.startsWith(last) || last.startsWith(candidate))) ||
      isWithinDistance(last, candidate, last.length > 4 ? 2 : 1),
  );
  return close.slice(0, CLOSEST_LIMIT).map((candidate) => (head ? `${head}.${candidate}` : candidate));
}
