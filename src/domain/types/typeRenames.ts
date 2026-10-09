/**
 * Renaming a type's field or one of a select's options everywhere it is
 * written (docs/implementation/30-databases.md § Types as searches, § Writes):
 * what a type's search page asks for from a column's menu. Each is planned
 * here from the index, VS Code aside: the row notes to change, and the
 * schema table's cell to rewrite in the type's note. The host applies the
 * plan to the notes as their documents hold them, through the refactor
 * preview, one edit per note.
 */
import type { WorkspaceIndex } from '../model';
import type { FrontmatterFieldWrite } from './frontmatterWriter';
import { getTypeIndex, type TypeIndex } from './typeIndex';
import { escapeTableCell, findTableCells } from './typeNoteWriter';
import type { TypeDefinition } from './typeRegistry';

/** A front-matter key as a field name must be to be written as one. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** One cell of a type's schema table to rewrite: its note, one-based line, cell, and new text. */
export interface SchemaCellEdit {
  filePath: string;
  line: number;
  /** The cell's place in the row, from zero, outer pipes aside. */
  cell: number;
  text: string;
}

/** Rename field everywhere, planned: the notes whose front matter writes the key, and the schema's Field cell. */
export interface FieldRenamePlan {
  /** The field's front-matter key as the parser keys it, and its name as the schema writes it. */
  key: string;
  name: string;
  newName: string;
  /** The row notes that write the key, by path, each once. */
  notes: string[];
  schema: SchemaCellEdit;
}

/** Rename option everywhere, planned: what each row note that holds the option writes, and the schema's Kind cell. */
export interface OptionRenamePlan {
  key: string;
  option: string;
  newOption: string;
  /** Each row note that holds the option, with the field's values as they are to be written. */
  notes: Array<{ filePath: string; write: FrontmatterFieldWrite }>;
  schema: SchemaCellEdit;
}

/** Why a rename cannot be planned, in a sentence the page can show. */
export interface RenameRefusal {
  error: string;
}

/**
 * Plans renaming one of a type's fields to `newName`: every row note that
 * writes its key, and its row of the schema table. Refused for a name a
 * front-matter key cannot be, or one another field of the type has.
 */
export function planFieldRename(
  index: WorkspaceIndex,
  typeKey: string,
  fieldKey: string,
  newName: string,
): FieldRenamePlan | RenameRefusal {
  const types = getTypeIndex(index);
  const found = findSchemaField(types, typeKey, fieldKey);
  if ('error' in found) {
    return found;
  }
  const { type, field } = found;
  const name = newName.trim();
  if (!FIELD_NAME.test(name)) {
    return { error: `"${name}" cannot be a front-matter key: start with a letter and use letters, digits, - and _.` };
  }
  if (name === field.name) {
    return { error: `${field.name} is already called that.` };
  }
  const other = type.fields.find((each) => each !== field && each.key === name.toLowerCase());
  if (other) {
    return { error: `${type.name} already has a field called ${other.name}.` };
  }
  const cell = columnOf(type, 'field');
  if (cell === undefined) {
    return { error: `${type.name}'s table has no Field column to rename it in.` };
  }
  const notes = new Set<string>();
  types.rows(type.key).forEach((row) => {
    // A key written empty is renamed too, so the note keeps its place for a value.
    if (row.filePath && index.files.get(row.filePath)?.properties?.some((property) => property.name === field.key)) {
      notes.add(row.filePath);
    }
  });
  return {
    key: field.key,
    name: field.name,
    newName: name,
    notes: [...notes],
    schema: { filePath: type.filePath, line: field.line, cell, text: name },
  };
}

/**
 * Plans renaming one of a select field's options: each row note whose
 * field holds it, written with the new option in its place and its other
 * values as they were, and the schema's Kind cell. Refused for an option
 * the field does not have, an empty name or one with a comma, or one the
 * field already has.
 */
export function planOptionRename(
  index: WorkspaceIndex,
  { typeKey, field: fieldKey, option }: { typeKey: string; field: string; option: string },
  newOption: string,
): OptionRenamePlan | RenameRefusal {
  const types = getTypeIndex(index);
  const found = findSchemaField(types, typeKey, fieldKey);
  if ('error' in found) {
    return found;
  }
  const { type, field } = found;
  const options = field.kind.options ?? [];
  const current = options.find((each) => each.toLowerCase() === option.trim().toLowerCase());
  if (field.kind.name !== 'select' || !current) {
    return { error: `${field.name} has no option called ${option}.` };
  }
  const renamed = newOption.trim();
  if (!renamed || renamed.includes(',') || renamed.includes('|')) {
    return { error: 'An option needs a name, without a comma or a |.' };
  }
  if (renamed === current) {
    return { error: `${current} is already called that.` };
  }
  const clash = options.find((each) => each !== current && each.toLowerCase() === renamed.toLowerCase());
  if (clash) {
    return { error: `${field.name} already has an option called ${clash}.` };
  }
  const cell = columnOf(type, 'kind');
  if (cell === undefined) {
    return { error: `${type.name}'s table has no Kind column to rename it in.` };
  }
  const notes: OptionRenamePlan['notes'] = [];
  types.rows(type.key).forEach((row) => {
    const values = (types.field(row.id, `field.${field.name}`)?.values ?? []).filter((value) => value.filePath === row.filePath);
    if (!row.filePath || !values.some((value) => value.option === current)) {
      return;
    }
    notes.push({
      filePath: row.filePath,
      write: {
        values: values.map((value) => ({ text: value.option === current ? renamed : value.text })),
        ...(field.kind.many ? { list: true } : {}),
      },
    });
  });
  return {
    key: field.key,
    option: current,
    newOption: renamed,
    notes,
    schema: { filePath: type.filePath, line: field.line, cell, text: renameKindOption(field.kindText, current, renamed) },
  };
}

/**
 * A `Kind` cell with one of its select's options renamed, the rest as
 * written: `Select: gold, silver` becomes `Select: platinum, silver`.
 * `, many` stays. A cell that names no such option is returned as it is.
 */
export function renameKindOption(kindText: string, option: string, renamed: string): string {
  const select = /^(\s*select\s*:)(.*?)(,\s*many\s*)?$/i.exec(kindText);
  if (!select) {
    return kindText;
  }
  const parts = select[2].split(',');
  const at = parts.findIndex((part) => part.trim().toLowerCase() === option.toLowerCase());
  if (at < 0) {
    return kindText;
  }
  parts[at] = parts[at].replace(parts[at].trim(), renamed);
  return `${select[1]}${parts.join(',')}${select[3] ?? ''}`;
}

/**
 * A table row with one cell's text replaced, the pipes and the spaces
 * around it kept, and padded to the cell's old width when it is shorter,
 * so an aligned table stays aligned. A row with no such cell is returned
 * as it is.
 */
export function rewriteTableCell(line: string, cell: number, text: string): string {
  const span = findTableCells(line)[cell];
  if (!span) {
    return line;
  }
  const escaped = escapeTableCell(text);
  const after = line.slice(span.end);
  const surplus = escaped.length - (span.end - span.start);
  // Longer text takes the spaces after it, leaving one; shorter is padded.
  const spaces = /^ */.exec(after)?.[0].length ?? 0;
  const rest = surplus > 0 ? after.slice(Math.min(surplus, Math.max(spaces - 1, 0))) : after;
  const pad = surplus < 0 ? ' '.repeat(-surplus) : '';
  return `${line.slice(0, span.start)}${escaped}${pad}${rest}`;
}

/** A type and one of its schema fields, by the field's key, or why they cannot be found. */
function findSchemaField(
  types: TypeIndex,
  typeKey: string,
  fieldKey: string,
): { type: TypeDefinition; field: TypeDefinition['fields'][number] } | RenameRefusal {
  const type = types.registry.get(typeKey);
  if (!type) {
    return { error: `No type is called ${typeKey}.` };
  }
  const field = type.fields.find((each) => each.key === fieldKey.toLowerCase());
  return field ? { type, field } : { error: `${type.name} has no field called ${fieldKey}.` };
}

/** Which cell of a schema table's rows holds a column, by its header, any case. */
function columnOf(type: TypeDefinition, header: 'field' | 'kind'): number | undefined {
  const at = (type.columns ?? []).findIndex((column) => column.trim().toLowerCase() === header);
  return at < 0 ? undefined : at;
}
