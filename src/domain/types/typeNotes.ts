/**
 * Reads a type note: a note in `Types/` whose front matter names the type
 * and its rows, and whose first Markdown table with `Field` and `Kind`
 * columns is its schema (docs/implementation/30-databases.md § A type note).
 *
 * ```markdown
 * ---
 * deckard-type: team
 * rows: "#team/*"
 * ---
 * # Team
 *
 * | Field | Kind   | Reverse | Also called |
 * | ----- | ------ | ------- | ----------- |
 * | lead  | Person | lead of | head        |
 * ```
 *
 * The note is read on its own here; what needs the other types too, such
 * as whether a relation names a type, is the registry's (typeRegistry.ts).
 */
import type { FrontmatterProperty, TypeField, TypeNote, TypeProblem, TypeRowsRule } from '../model';
import { formatKeyWords } from '../markdown/tagKeys';
import { parseFieldKind } from './fieldKinds';

/** The name of the folder, under the notes folder, that holds the type notes. */
export const TYPES_FOLDER = 'Types';

/** What a type note is read from: the note's lines, front matter, and first heading. */
export interface TypeNoteSource {
  filePath: string;
  lines: readonly string[];
  /** Zero-based lines that are not the note's text: its front matter and code fences. */
  skippedLines: ReadonlySet<number>;
  /** Its front matter, with lines (`ParsedFile.properties`). */
  properties: readonly FrontmatterProperty[];
  /** The text of its first heading, tags and all. */
  firstHeading?: string;
}

/** A front-matter key, as a field name must be to be written as one. */
const FRONTMATTER_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** A tag namespace path, as `rows:` names one: `team`, `org/acme`. */
const NAMESPACE_PATH = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*(?:\/[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*)*$/u;
/** A table's separator row: `| --- | :-: |`. */
const SEPARATOR_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** The columns of a schema table Deckard reads, by their header lowercased. */
const KNOWN_COLUMNS: ReadonlyMap<string, ColumnRole> = new Map([
  ['field', 'field'],
  ['kind', 'kind'],
  ['reverse', 'reverse'],
  ['also called', 'alsoCalled'],
]);

/** Records a problem on the note being read. */
type ReportProblem = (code: TypeProblem['code'], line: number, message: string, field?: string) => void;

/** Reads a type note. Never throws: what it cannot read is a problem on the note. */
export function parseTypeNote(source: TypeNoteSource): TypeNote {
  const problems: TypeProblem[] = [];
  const problem: ReportProblem = (code, line, message, field) => {
    problems.push({ code, message, filePath: source.filePath, line, ...(field ? { field } : {}) });
  };
  const property = (name: string): FrontmatterProperty | undefined =>
    source.properties.find((candidate) => candidate.name === name);

  const keyProperty = property('deckard-type');
  const key = readTypeKey(source.filePath, keyProperty, problem);
  const rowsProperty = property('rows');
  const rows = readRows(rowsProperty, problem);
  const notesFolder = property('notes')?.values[0]?.text.trim();
  const table = readSchemaTable(source, problem);
  if (!table) {
    problem('no-table', 1, 'This type has no table with Field and Kind columns, so it has no fields.');
  }

  return {
    key,
    name: source.firstHeading?.trim() || formatKeyWords(key),
    ...(rows ? { rows } : {}),
    ...(notesFolder ? { notesFolder } : {}),
    fields: table?.fields ?? [],
    ...(table ? { columns: table.columns, table: { startLine: table.startLine, endLine: table.endLine } } : {}),
    ...(keyProperty?.line ? { keyLine: keyProperty.line } : {}),
    ...(rowsProperty?.line ? { rowsLine: rowsProperty.line } : {}),
    problems,
  };
}

/** The type's key from `deckard-type:`, or, with a problem, from the file's name. */
function readTypeKey(filePath: string, written: FrontmatterProperty | undefined, problem: ReportProblem): string {
  const writtenKey = slugKey(written?.values[0]?.text ?? '');
  if (writtenKey) {
    return writtenKey;
  }
  const key = slugKey(fileTitle(filePath)) ?? 'type';
  problem('no-key', written?.line ?? 1, `This type has no deckard-type: key, so it is read as "${key}", from its file name.`);
  return key;
}

/** The type's rows from `rows:`, or undefined, with a problem, when it is missing or names none. */
function readRows(written: FrontmatterProperty | undefined, problem: ReportProblem): TypeRowsRule | undefined {
  const text = written?.values[0]?.text.trim() ?? '';
  const rows = readRowsRule(text);
  if (!rows) {
    problem(
      'bad-rows',
      written?.line ?? 1,
      text
        ? `rows: "${text}" names no rows. Write a namespace such as "#team/*", "@*" for people, or notes.`
        : 'This type has no rows: line. Write a namespace such as "#team/*", "@*" for people, or notes.',
    );
  }
  return rows;
}

/**
 * A `rows:` value read: `notes`, people (`@*`, `#person/*`), or a namespace
 * (`#team/*`, `team/*`, `#team`). Undefined when it names none. The
 * namespace is as written, lowercased; the parser resolves its alias.
 */
export function readRowsRule(written: string): TypeRowsRule | undefined {
  const text = written.trim();
  if (text.toLowerCase() === 'notes') {
    return { kind: 'notes', written: text };
  }
  if (/^@(?:\/?\*{1,2})?$/.test(text)) {
    return { kind: 'tags', prefix: '@', written: text };
  }
  const namespace = text
    .replace(/^#/, '')
    .replace(/\/\*{1,2}$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
  if (!NAMESPACE_PATH.test(namespace)) {
    return undefined;
  }
  return namespace === 'person'
    ? { kind: 'tags', prefix: '@', written: text }
    : { kind: 'tags', prefix: `#${namespace}/`, written: text };
}

/** A type's key as a slug: lowercased, each run of other characters a hyphen. */
function slugKey(value: string): string | undefined {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || undefined;
}

/** A path's file name without `.md`. */
function fileTitle(filePath: string): string {
  return (filePath.split('/').pop() ?? filePath).replace(/\.md$/i, '');
}

/** The schema table as read: its fields, its header as written, and its lines. */
interface SchemaTable {
  fields: TypeField[];
  columns: string[];
  startLine: number;
  endLine: number;
}

/**
 * The note's first table whose header has `Field` and `Kind` columns, any
 * case, read row by row. A row with no field, or a field that cannot be a
 * front-matter key or repeats one above it, is left out with a problem.
 */
function readSchemaTable(source: TypeNoteSource, problem: ReportProblem): SchemaTable | undefined {
  const { lines, skippedLines } = source;
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (skippedLines.has(index) || skippedLines.has(index + 1)) {
      continue;
    }
    if (!isTableRow(lines[index]) || !SEPARATOR_ROW.test(lines[index + 1])) {
      continue;
    }
    const columns = splitTableRow(lines[index]);
    const roles = columns.map((header) => KNOWN_COLUMNS.get(header.trim().toLowerCase().replace(/\s+/g, ' ')));
    if (!roles.includes('field') || !roles.includes('kind')) {
      continue;
    }
    const fields: TypeField[] = [];
    const seen = new Set<string>();
    let end = index + 1;
    for (let row = index + 2; row < lines.length && !skippedLines.has(row) && isTableRow(lines[row]); row += 1) {
      end = row;
      const field = readFieldRow(splitTableRow(lines[row]), { columns, roles, problem }, row + 1);
      if (!field) {
        continue;
      }
      if (seen.has(field.key)) {
        problem('duplicate-field', field.line, `The field ${field.name} is already in this table; this row is left out.`, field.key);
        continue;
      }
      seen.add(field.key);
      fields.push(field);
    }
    return { fields, columns, startLine: index + 1, endLine: end + 1 };
  }
  return undefined;
}

/** The role Deckard reads a schema table's column in. */
type ColumnRole = 'field' | 'kind' | 'reverse' | 'alsoCalled';

/** What reading a schema table's rows takes: its header as written, each column's role, and where problems go. */
interface TableHeader {
  columns: readonly string[];
  roles: ReadonlyArray<ColumnRole | undefined>;
  problem: ReportProblem;
}

/** One body row of the schema table as a field, or undefined, with a problem, when it cannot be one. */
function readFieldRow(cells: readonly string[], header: TableHeader, line: number): TypeField | undefined {
  const { columns, roles, problem } = header;
  const cell = (role: ColumnRole): string =>
    stripCode(cells[roles.indexOf(role)] ?? '');
  const name = cell('field');
  if (!name) {
    if (cells.some((text) => text.trim())) {
      problem('missing-field', line, 'This row has no field name, so it is left out.');
    }
    return undefined;
  }
  if (!FRONTMATTER_KEY.test(name)) {
    problem(
      'bad-field-name',
      line,
      `"${name}" cannot be a front-matter key: start with a letter and use letters, digits, - and _.`,
    );
    return undefined;
  }
  const key = name.toLowerCase();
  const kindText = cell('kind');
  const { kind, missing } = parseFieldKind(kindText);
  if (missing) {
    problem('missing-kind', line, `${name} has no kind, so it is read as Text.`, key);
  }
  const reverse = cell('reverse');
  const alsoCalled = cell('alsoCalled')
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);
  const extra: Record<string, string> = {};
  roles.forEach((role, at) => {
    if (!role && columns[at].trim()) {
      extra[columns[at].trim()] = (cells[at] ?? '').trim();
    }
  });
  return {
    name,
    key,
    kindText,
    kind,
    ...(reverse ? { reverse } : {}),
    alsoCalled,
    line,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/** Whether a line can be a table's row: it holds a `|` that is not escaped. */
function isTableRow(line: string): boolean {
  return /(^|[^\\])\|/.test(line) && line.trim().length > 0;
}

/**
 * A table row's cells, trimmed: split at each `|` that is not escaped, the
 * outer pipes dropped, and `\|` read as `|`.
 */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) {
    text = text.slice(1);
  }
  if (text.endsWith('|') && !text.endsWith('\\|')) {
    text = text.slice(0, -1);
  }
  const cells: string[] = [];
  let current = '';
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (character === '\\' && text[at + 1] === '|') {
      current += '|';
      at += 1;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** A cell's text without the backticks of a code span around all of it. */
function stripCode(cell: string): string {
  const text = cell.trim();
  return /^`[^`]*`$/.test(text) ? text.slice(1, -1).trim() : text;
}
