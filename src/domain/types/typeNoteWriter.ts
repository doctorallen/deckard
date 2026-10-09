/**
 * Writes a type note, and reads and rewrites the cells of its table, so
 * Create Type from Tags, Create a <Type> type, and Allow A or B write the
 * note a reader would (docs/implementation/30-databases.md § A type note).
 */
import { TYPES_FOLDER } from './typeNotes';

/** One row of a type's table, as it will be written. */
export interface TypeFieldDraft {
  /** The field's name, which is its front-matter key. */
  name: string;
  /** The `Kind` cell: `Person`, `Select: gold, silver`, `Area, many`. */
  kind: string;
  /** The `Reverse` cell, when the field is a relation. */
  reverse?: string;
  /** The `Also called` cell's words. */
  alsoCalled?: readonly string[];
}

/** A type note, as it will be written. */
export interface TypeNoteDraft {
  /** `deckard-type:`, a slug. */
  key: string;
  /** The note's heading, the type's display name. */
  name: string;
  /** `rows:` as written: `"#team/*"`, `"@*"`, or `notes`. */
  rows: string;
  /** `notes:`, the folder new rows go to, when there is one to name. */
  notesFolder?: string;
  fields: readonly TypeFieldDraft[];
}

/** The schema table's header, in the order Deckard writes its columns. */
const COLUMNS = ['Field', 'Kind', 'Reverse', 'Also called'] as const;

/**
 * A type note's text: front matter naming the type, its rows, and where
 * new rows go; the display name as its heading; the schema table, padded
 * so it reads as a table in the editor; and a line saying what its rows
 * are. A type with no fields gets the table's header alone.
 */
export function writeTypeNote(draft: TypeNoteDraft): string {
  const frontmatter = [
    '---',
    `deckard-type: ${draft.key}`,
    `rows: ${quoteRows(draft.rows)}`,
    ...(draft.notesFolder ? [`notes: ${draft.notesFolder}`] : []),
    '---',
  ];
  const rows = draft.fields.map((field) => [
    field.name,
    field.kind,
    field.reverse ?? '',
    (field.alsoCalled ?? []).join(', '),
  ]);
  return [
    ...frontmatter,
    `# ${draft.name}`,
    '',
    ...writeTable([...COLUMNS], rows),
    '',
    describeRows(draft),
    '',
  ].join('\n');
}

/** Where a type's note goes, under the notes folder: `Types/Team.md`. Undefined when the name cannot be a file name. */
export function typeNotePath(name: string): string | undefined {
  const base = name.trim();
  if (!base || /[/\\\u0000-\u001f\u007f<>:"|?*]/.test(base) || /[. ]$/.test(base)) {
    return undefined;
  }
  return `${TYPES_FOLDER}/${base}.md`;
}

/** `rows:` quoted where YAML would read it otherwise: a `#` starts a comment, and `@` and `*` cannot start a plain value. */
function quoteRows(rows: string): string {
  const text = rows.trim();
  return /^[#@*]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

/** The line under the table that says what the type's rows are. */
function describeRows(draft: TypeNoteDraft): string {
  const rows = draft.rows.trim();
  if (rows.toLowerCase() === 'notes') {
    return `Each note whose front matter says type: ${draft.key} is a ${draft.name}, and its fields are written in that front matter.`;
  }
  const where = rows.startsWith('@') ? 'Each person' : `Each tag under ${rows.replace(/\*+$/, '')}`;
  return `${where} is a ${draft.name}, and its fields are written in its hub note's front matter.`;
}

/**
 * A Markdown table, each column as wide as its widest cell, with `|` in a
 * cell escaped.
 */
export function writeTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const escape = (cell: string): string => cell.replace(/\|/g, '\\|');
  const cells = [header, ...rows].map((row) => header.map((_, at) => escape(row[at] ?? '')));
  const widths = header.map((_, at) => Math.max(3, ...cells.map((row) => row[at].length)));
  const line = (row: readonly string[]): string =>
    `| ${row.map((cell, at) => cell.padEnd(widths[at])).join(' | ')} |`;
  return [
    line(cells[0]),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...cells.slice(1).map(line),
  ];
}

/** One cell of a table row, with where its text starts and ends on the line. */
export interface TableCellSpan {
  /** The cell's text, trimmed, `\|` read as written. */
  text: string;
  /** Zero-based columns of the trimmed text; an empty cell's are where text would go. */
  start: number;
  end: number;
}

/**
 * A table row's cells with their columns: split at each `|` that is not
 * escaped, the outer pipes dropped, as splitTableRow reads them.
 */
export function findTableCells(line: string): TableCellSpan[] {
  const bounds = findCellBounds(line);
  const cells: TableCellSpan[] = [];
  for (let at = 0; at + 1 < bounds.length; at += 1) {
    const from = bounds[at] + 1;
    const to = bounds[at + 1];
    const raw = line.slice(from, to);
    const text = raw.trim();
    const start = text ? from + raw.length - raw.trimStart().length : Math.min(from + 1, to);
    cells.push({ text, start, end: start + text.length });
  }
  return cells;
}

/** Which cell of a table row a column is in, by its index, or undefined outside every cell. */
export function findTableCellAt(line: string, column: number): number | undefined {
  const bounds = findCellBounds(line);
  for (let at = 0; at + 1 < bounds.length; at += 1) {
    if (column > bounds[at] && column <= bounds[at + 1]) {
      return at;
    }
  }
  return undefined;
}

/**
 * Where a table row's cells are cut: each `|` that is not escaped, and,
 * where the row leaves out an outer pipe, just before its first character
 * or just after its last.
 */
function findCellBounds(line: string): number[] {
  const pipes: number[] = [];
  for (let at = 0; at < line.length; at += 1) {
    if (line[at] === '\\') {
      at += 1;
    } else if (line[at] === '|') {
      pipes.push(at);
    }
  }
  const first = Math.max(line.search(/\S/), 0);
  const end = line.trimEnd().length;
  if (pipes[0] !== first) {
    pipes.unshift(first - 1);
  }
  if (pipes[pipes.length - 1] !== end - 1) {
    pipes.push(end);
  }
  return pipes;
}

/**
 * A `Kind` cell that also takes another type: `Area` becomes
 * `Area or System`, and `Area, many` becomes `Area or System, many`.
 */
export function allowKindTarget(kindText: string, target: string): string {
  const many = /,\s*many\s*$/i.exec(kindText);
  const base = (many ? kindText.slice(0, many.index) : kindText).trim();
  return `${base} or ${target}${many ? ', many' : ''}`;
}
