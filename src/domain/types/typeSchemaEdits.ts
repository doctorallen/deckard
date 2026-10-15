/**
 * Edits a type note's schema table (docs/implementation/44-type-builder.md
 * § Writing the table): adds a field's row, sets a field's cells, moves or
 * removes a row, or realigns the table, so the type builder writes the
 * table a reader would and nobody pads pipes by hand.
 *
 * The table is found as parseTypeNote finds it: the first table outside
 * front matter and code fences whose header has Field and Kind columns.
 * It is written back aligned, keeping the columns Deckard does not read,
 * a separator's alignment colons, rows that are not fields, and a Field
 * cell written in backticks. Only the table's lines change.
 */
import { findFrontmatterEnd, isFrontmatterKey, toFrontmatterKey } from '../markdown/frontmatter';
import { findFencedLines } from '../markdown/lineShapes';
import { isSeparatorRow, isTableRow, readColumnRole, splitTableRow, stripCode, type ColumnRole } from './typeNotes';
import { escapeTableCell } from './typeNoteWriter';

/** A field's cells, as an edit writes them. */
export interface SchemaFieldCells {
  /** The Field cell: the field's name, which is its front-matter key. */
  name: string;
  /** The Kind cell: `Person`, `Select: gold, silver`, `Area, many`. */
  kind: string;
  /** The Reverse cell; empty clears it. */
  reverse?: string;
  /** The Also called cell's words; none clears it. */
  alsoCalled?: readonly string[];
  /** The Words cell's phrases; none clears it. */
  words?: readonly string[];
}

/** What to do to the table. A field is named by its name or key, matched as the parser keys it. */
export type SchemaEdit =
  | { kind: 'add'; field: SchemaFieldCells }
  | { kind: 'set'; field: string; cells: Partial<SchemaFieldCells> }
  | { kind: 'move'; field: string; by: -1 | 1 }
  | { kind: 'remove'; field: string }
  | { kind: 'realign' };

/** Why an edit was not made. */
export type SchemaRefusal = 'bad-name' | 'name-taken' | 'no-field' | 'no-table';

/** What an edit comes to: the note's new text and the lines that changed, nothing to do, or why not. */
export type SchemaEditResult =
  | {
      kind: 'edit';
      content: string;
      /** The zero-based first line replaced, how many were, and the lines put in their place. */
      start: number;
      deleted: number;
      lines: string[];
      /** The one-based line of the field's row afterward; undefined once removed. */
      line?: number;
    }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: SchemaRefusal; line: number };

/** The header Deckard writes for a column it reads, in the order it writes them. */
const COLUMN_HEADERS: ReadonlyArray<readonly [ColumnRole, string]> = [
  ['field', 'Field'],
  ['kind', 'Kind'],
  ['reverse', 'Reverse'],
  ['alsoCalled', 'Also called'],
  ['words', 'Words'],
];

/** A schema table as read from the note's lines. */
interface Table {
  /** Zero-based lines of its header and of its last row. */
  start: number;
  end: number;
  header: string[];
  /** Each column's separator cell, trimmed: `---`, `:--`, `:-:`. */
  align: string[];
  /** Each row's cells, `\|` read as `|`. */
  rows: string[][];
  roles: Array<ColumnRole | undefined>;
}

/** The note with its schema table edited; see the module comment for what is kept. */
export function editSchemaTable(content: string, edit: SchemaEdit): SchemaEditResult {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const table = readTable(lines);
  if (!table) {
    return edit.kind === 'add' ? addFirstTable(lines, eol, edit.field) : { kind: 'refused', reason: 'no-table', line: 1 };
  }
  const changed = applyEdit(table, edit);
  if ('reason' in changed) {
    return { kind: 'refused', reason: changed.reason, line: changed.line };
  }
  const next = writeTable(changed.table);
  const old = lines.slice(table.start, table.end + 1);
  if (next.length === old.length && next.every((line, at) => line === old[at])) {
    return { kind: 'unchanged' };
  }
  const written = [...lines.slice(0, table.start), ...next, ...lines.slice(table.end + 1)];
  return {
    kind: 'edit',
    content: written.join(eol),
    start: table.start,
    deleted: old.length,
    lines: next,
    ...(changed.row === undefined ? {} : { line: table.start + 3 + changed.row }),
  };
}

/** The first table outside front matter and code fences whose header has Field and Kind, as parseTypeNote reads it. */
function readTable(lines: readonly string[]): Table | undefined {
  const skipped = findFencedLines(lines);
  const frontmatterEnd = findFrontmatterEnd(lines);
  for (let line = 0; line <= (frontmatterEnd ?? -1); line += 1) {
    skipped.add(line);
  }
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (skipped.has(index) || skipped.has(index + 1) || !isTableRow(lines[index]) || !isSeparatorRow(lines[index + 1])) {
      continue;
    }
    const header = splitTableRow(lines[index]);
    const roles = header.map(readColumnRole);
    if (!roles.includes('field') || !roles.includes('kind')) {
      continue;
    }
    const rows: string[][] = [];
    let end = index + 1;
    for (let row = index + 2; row < lines.length && !skipped.has(row) && isTableRow(lines[row]); row += 1) {
      rows.push(splitTableRow(lines[row]));
      end = row;
    }
    const align = splitTableRow(lines[index + 1]).map((cell) => cell.trim());
    const width = Math.max(header.length, ...rows.map((row) => row.length));
    return {
      start: index,
      end,
      header: pad(header, width),
      align: pad(align, width).map((cell) => cell || '---'),
      rows: rows.map((row) => pad(row, width)),
      roles: [...roles, ...Array.from({ length: width - roles.length }, () => undefined)],
    };
  }
  return undefined;
}

/** A row filled out to `width` cells. */
function pad(row: readonly string[], width: number): string[] {
  return [...row, ...Array.from({ length: width - row.length }, () => '')];
}

/** The table after the edit and the zero-based row of the field it was about, or why it cannot be made. */
function applyEdit(table: Table, edit: SchemaEdit): { table: Table; row?: number } | { reason: SchemaRefusal; line: number } {
  if (edit.kind === 'realign') {
    return { table };
  }
  if (edit.kind === 'add') {
    const taken = findRow(table, edit.field.name);
    if (!isFrontmatterKey(edit.field.name.trim())) {
      return { reason: 'bad-name', line: table.start + 1 };
    }
    if (taken !== undefined) {
      return { reason: 'name-taken', line: table.start + 3 + taken };
    }
    const added = { ...table, rows: [...table.rows, table.header.map(() => '')] };
    return { table: setCells(added, added.rows.length - 1, edit.field), row: added.rows.length - 1 };
  }
  const row = findRow(table, edit.field);
  if (row === undefined) {
    return { reason: 'no-field', line: table.start + 1 };
  }
  switch (edit.kind) {
    case 'set': {
      const name = edit.cells.name?.trim();
      if (name !== undefined) {
        if (!isFrontmatterKey(name)) {
          return { reason: 'bad-name', line: table.start + 3 + row };
        }
        const taken = findRow(table, name);
        if (taken !== undefined && taken !== row) {
          return { reason: 'name-taken', line: table.start + 3 + taken };
        }
      }
      return { table: setCells(table, row, edit.cells), row };
    }
    case 'move': {
      const to = row + edit.by;
      if (to < 0 || to >= table.rows.length) {
        return { table, row };
      }
      const rows = [...table.rows];
      [rows[row], rows[to]] = [rows[to], rows[row]];
      return { table: { ...table, rows }, row: to };
    }
    case 'remove':
      return { table: { ...table, rows: table.rows.filter((_, at) => at !== row) } };
  }
}

/** The row whose Field cell names the field, compared as the parser keys it. */
function findRow(table: Table, field: string): number | undefined {
  const column = table.roles.indexOf('field');
  const key = toFrontmatterKey(field);
  const at = table.rows.findIndex((row) => stripCode(row[column] ?? '') !== '' && toFrontmatterKey(stripCode(row[column])) === key);
  return at < 0 ? undefined : at;
}

/** The table with a row's cells set, adding the column a non-empty cell needs. A Field cell in backticks keeps them. */
function setCells(table: Table, row: number, cells: Partial<SchemaFieldCells>): Table {
  let next = table;
  const write = (role: ColumnRole, text: string | undefined): void => {
    if (text === undefined) {
      return;
    }
    if (!next.roles.includes(role)) {
      if (!text) {
        return;
      }
      next = addColumn(next, role);
    }
    const column = next.roles.indexOf(role);
    const rows = next.rows.map((cellsOf, at) => {
      if (at !== row) {
        return cellsOf;
      }
      const written = [...cellsOf];
      written[column] = role === 'field' && /^`[^`]*`$/.test((cellsOf[column] ?? '').trim()) ? `\`${text}\`` : text;
      return written;
    });
    next = { ...next, rows };
  };
  write('field', cells.name?.trim());
  write('kind', cells.kind?.trim());
  write('reverse', cells.reverse?.trim());
  write('alsoCalled', cells.alsoCalled ? joinList(cells.alsoCalled) : undefined);
  write('words', cells.words ? joinList(cells.words) : undefined);
  return next;
}

/** Words for a cell: trimmed, empty ones left out, comma separated. */
function joinList(words: readonly string[]): string {
  return words.map((word) => word.trim()).filter(Boolean).join(', ');
}

/** The table with a column Deckard reads added after the last such column it has. */
function addColumn(table: Table, role: ColumnRole): Table {
  const order = COLUMN_HEADERS.map(([each]) => each);
  const before = table.roles.reduce((last, each, at) => (each && order.indexOf(each) < order.indexOf(role) ? at : last), -1);
  const at = before + 1;
  const insert = <T>(row: readonly T[], value: T): T[] => [...row.slice(0, at), value, ...row.slice(at)];
  const header = COLUMN_HEADERS.find(([each]) => each === role)?.[1] ?? role;
  return {
    ...table,
    header: insert(table.header, header),
    align: insert(table.align, '---'),
    rows: table.rows.map((row) => insert(row, '')),
    roles: insert(table.roles, role),
  };
}

/** The table's lines, each column as wide as its widest cell, the separator keeping its alignment colons. */
function writeTable(table: Table): string[] {
  const cells = [table.header, ...table.rows].map((row) => row.map(escapeTableCell));
  const widths = table.header.map((_, at) => Math.max(3, ...cells.map((row) => row[at].length)));
  const line = (row: readonly string[]): string => `| ${row.map((cell, at) => cell.padEnd(widths[at])).join(' | ')} |`;
  const separator = table.align.map((cell, at) => {
    const left = cell.startsWith(':');
    const right = cell.length > 1 && cell.endsWith(':');
    return `${left ? ':' : '-'}${'-'.repeat(widths[at] - 2)}${right ? ':' : '-'}`;
  });
  return [line(cells[0]), `| ${separator.join(' | ')} |`, ...cells.slice(1).map(line)];
}

/**
 * A note with no schema table given one holding the field: after its first
 * heading, or after its front matter when it has none, with a blank line
 * before it.
 */
function addFirstTable(lines: readonly string[], eol: string, field: SchemaFieldCells): SchemaEditResult {
  if (!isFrontmatterKey(field.name.trim())) {
    return { kind: 'refused', reason: 'bad-name', line: 1 };
  }
  const frontmatterEnd = findFrontmatterEnd(lines);
  const fenced = findFencedLines(lines);
  const from = frontmatterEnd === undefined ? 0 : frontmatterEnd + 1;
  const heading = lines.findIndex((line, at) => at >= from && !fenced.has(at) && /^#{1,6}\s/.test(line));
  const after = heading >= 0 ? heading + 1 : from;
  const empty: Table = {
    start: 0,
    end: 0,
    header: ['Field', 'Kind', 'Reverse', 'Also called'],
    align: ['---', '---', '---', '---'],
    rows: [],
    roles: ['field', 'kind', 'reverse', 'alsoCalled'],
  };
  const table = writeTable(setCells({ ...empty, rows: [['', '', '', '']] }, 0, field));
  const blankBefore = after > 0 && lines[after - 1]?.trim() !== '' ? [''] : [];
  const blankAfter = lines[after] !== undefined && lines[after].trim() !== '' ? [''] : [];
  const next = [...blankBefore, ...table, ...blankAfter];
  const written = [...lines.slice(0, after), ...next, ...lines.slice(after)];
  return {
    kind: 'edit',
    content: written.join(eol),
    start: after,
    deleted: 0,
    lines: next,
    line: after + blankBefore.length + 3,
  };
}
