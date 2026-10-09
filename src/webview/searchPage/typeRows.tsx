/**
 * A type's rows tab (docs/implementation/30-databases.md § Types as
 * searches): the rows a search for `type = team` finds, as a table drawn
 * the way the Task board draws its own (shared/resultTable.tsx). The host
 * made the rows and cells; the page draws them, with a header that sorts
 * and a menu on each heading, and a ⋯ on each row, revealed on the row's
 * hover or focus.
 *
 * A schema field's heading is its key, in monospace; a computed one, in
 * sentence case and muted, says it is not written in the note. Zen keeps
 * every cell and date drawn, and quiets each row's ⋯ and Create hub note
 * in place, as R11 already does at any step.
 */
import type { ComponentChild } from 'preact';

import type { SearchPageTypeRows, TypeTableCell, TypeTableColumn, TypeTableRow, TypeTableValue } from '../../ui/protocol/searchPage';
import { IconButton } from '../shared/buttons';
import { SortHeader } from '../shared/resultTable';
import { EllipsisIcon } from '../shared/strokeIcons';
import type { ContextMenuEntry } from '../shared/tagMenu';

/** What a computed column's heading says it is. */
export const COMPUTED_TIP = 'Computed: not written in the note';

/** What sorting by a column runs next: ascending, then the other way round, then back to by title. */
export function nextTypeSort(table: SearchPageTypeRows, column: string): { column?: string; direction?: 'asc' | 'desc' } {
  const sort = table.sort;
  if (!sort || sort.column !== column) {
    return { column, direction: 'asc' };
  }
  return { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
}

/** One value: a link to the row's tag page or the note it names, an option the menu can rename, or text. */
function CellValue({ value, field }: { readonly value: TypeTableValue; readonly field?: string }) {
  if (value.tag) {
    return <button type="button" class="field-link" data-action="open-tag" data-tag-key={value.tag.key} data-tip={`Open ${value.tag.label}`}>{value.text}</button>;
  }
  if (value.filePath) {
    return <button type="button" class="field-link" data-action="open-source" data-file-path={value.filePath} data-line="1" data-tip={`Open ${value.filePath}`}>{value.text}</button>;
  }
  if (value.option && field) {
    return <span class="type-option" data-field={field} data-option={value.option}>{value.text}</span>;
  }
  return <>{value.text}</>;
}

/**
 * A cell's values, comma-joined, then `+2`, then the overdue count; or its
 * text, a count or a date, kept to one line so a date is never broken at
 * its hyphens.
 */
function CellBody({ cell, column }: { readonly cell: TypeTableCell; readonly column: TypeTableColumn }) {
  if (!cell.values) {
    return cell.text ? <span class="type-figure">{cell.text}</span> : null;
  }
  const parts: ComponentChild[] = [];
  cell.values.forEach((value, at) => {
    if (at > 0) {
      parts.push(', ');
    }
    parts.push(<CellValue value={value} field={column.select ? column.id : undefined} />);
  });
  if (cell.more) {
    parts.push(<span class="type-more">{` +${cell.more}`}</span>);
  }
  if (cell.overdue) {
    parts.push(' · ', <span class="due-date overdue">{`${cell.overdue} overdue`}</span>);
  }
  return <>{parts}</>;
}

/** The title cell: the row's title as the link that opens it, and, for a row with no hub note, what it lacks and the offer of one. */
function TitleCell({ row }: { readonly row: TypeTableRow }) {
  let title: ComponentChild = row.title;
  if (row.tag) {
    title = <button type="button" class="field-link" data-action="open-tag" data-tag-key={row.tag.key} data-tip={`Open ${row.tag.label}`}>{row.title}</button>;
  } else if (row.filePath) {
    title = <button type="button" class="field-link" data-action="open-source" data-file-path={row.filePath} data-line="1" data-tip={`Open ${row.title}`}>{row.title}</button>;
  }
  return (
    <td class="result-title">
      {title}
      {row.noHub
        ? (
          <span class="type-no-hub">
            {`No hub note · ${row.noHub.entries} ${row.noHub.entries === 1 ? 'entry' : 'entries'}`}
            <button type="button" class="type-create-hub" data-action="create-row-hub" data-row-id={row.id} data-tip={`Create a note whose describes: front matter names ${row.tag ? row.tag.label : row.title}`} data-reveal="" data-zen-reveal="">Create hub note</button>
          </span>
        )
        : null}
    </td>
  );
}

/** One row: its cells, the title's first, then its ⋯. */
function TypeRow({ row, columns }: { readonly row: TypeTableRow; readonly columns: readonly TypeTableColumn[] }) {
  return (
    <tr class="result-row type-row" tabIndex={0} data-reveal-region="" data-row-id={row.id}>
      {row.cells.map((cell, at) => {
        const column = columns[at];
        if (column.source === 'title') {
          return <TitleCell key={column.id} row={row} />;
        }
        return (
          <td key={column.id} class={column.source === 'computed' ? 'is-computed' : undefined} title={cell.text && (cell.more || cell.values?.length !== 1) ? cell.text : undefined}>
            <CellBody cell={cell} column={column} />
          </td>
        );
      })}
      <td class="result-menu">
        <IconButton
          action="type-row-menu"
          className="row-menu"
          label={`More for ${row.title}: open${row.copy ? `, copy ${row.copy.label}` : ''}${row.noHub ? ', create hub note' : ''}`}
          tip={`More for ${row.title}`}
          icon={<EllipsisIcon />}
          attributes={{ 'data-row-id': row.id, 'aria-haspopup': 'menu', 'data-reveal': '', 'data-zen-reveal': '' }}
        />
      </td>
    </tr>
  );
}

/**
 * The rows as a table: the headings, each sorting by its column, then the
 * rows, or the groups, each under a row naming its value and how many rows
 * it holds.
 */
export function TypeRowsTable({ table }: { readonly table: SearchPageTypeRows }) {
  const rowsOf = (rows: readonly TypeTableRow[]) => rows.map((row) => <TypeRow key={row.id} row={row} columns={table.columns} />);
  if (table.count === 0) {
    return <div class="empty">{`No ${table.plural.toLowerCase()} match this search.`}</div>;
  }
  return (
    <div class="type-rows" data-zen-region="">
      <table class="result-table type-table" aria-label={table.plural}>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <SortHeader
                key={column.id}
                column={column}
                sort={table.sort}
                action="set-type-sort"
                className={`type-head is-${column.source}`}
                title={column.source === 'computed' ? COMPUTED_TIP : undefined}
                attributes={{ 'data-context-menu': '', 'data-source': column.source, ...(column.select ? { 'data-select': '' } : {}) }}
              />
            ))}
            <th class="result-menu"><span class="visually-hidden">More</span></th>
          </tr>
        </thead>
        {table.groups
          ? table.groups.map((group) => (
            <tbody key={group.label}>
              <tr class="type-group-row">
                <th scope="rowgroup" colSpan={table.columns.length + 1}>{group.label}<span class="display-count">{` ${group.rows.length}`}</span></th>
              </tr>
              {rowsOf(group.rows)}
            </tbody>
          ))
          : <tbody>{rowsOf(table.rows)}</tbody>}
      </table>
    </div>
  );
}

/**
 * Beside the rows tab while it is sorted by a column: what by, and Sort
 * A-Z, the way back to by title. Kept drawn under Zen, as the Task board's
 * is, since it says the rows are not in their usual order.
 */
export function TypeSortNote({ table }: { readonly table: SearchPageTypeRows }) {
  const sort = table.sort;
  if (!sort) {
    return null;
  }
  const column = table.columns.find((candidate) => candidate.id === sort.column)?.label ?? sort.column;
  return (
    <span class="type-sort-note">
      <span class="control-label" data-zen-reveal="" data-reveal-keep="">{`Sorted by ${column}${sort.direction === 'desc' ? ', Z-A' : ''}`}</span>
      <button type="button" data-action="clear-type-sort" data-tip={`Back to by ${table.name.toLowerCase()}, A-Z`} data-zen-reveal="" data-reveal-keep="">Sort A-Z</button>
    </span>
  );
}

/** The menu a column's heading opens: Sort A-Z and Z-A, Hide column, and, for a schema field, its renames and its row in the type's note. */
export function columnMenu(table: SearchPageTypeRows, column: TypeTableColumn): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [
    { action: 'type-sort-asc', label: 'Sort A-Z' },
    { action: 'type-sort-desc', label: 'Sort Z-A' },
  ];
  if (column.source !== 'title') {
    entries.push({ action: 'type-hide-column', label: 'Hide column' });
  }
  if (column.source === 'field') {
    entries.push(
      'separator',
      { action: 'type-rename-field', label: 'Rename field everywhere…' },
      { action: 'type-edit-field', label: `Edit in ${typeNoteName(table)}` },
    );
  }
  return entries;
}

/** The menu a row's ⋯ opens: Open, its hub note or the offer of one, and Copy its email. */
export function rowMenu(row: TypeTableRow): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [{ action: 'type-open-row', label: 'Open' }];
  if (row.tag && row.filePath) {
    entries.push({ action: 'type-open-hub', label: 'Open hub note' });
  }
  if (row.noHub) {
    entries.push({ action: 'type-create-hub', label: 'Create hub note' });
  }
  if (row.copy) {
    entries.push({ action: 'type-copy', label: `Copy ${row.copy.label}` });
  }
  return entries;
}

/** The type's note as ⋯ and a heading's menu name it: `Types/Team.md`. */
export function typeNoteName(table: SearchPageTypeRows): string {
  const parts = table.filePath.split('/');
  return parts.slice(-2).join('/');
}

/** A row of the table by id, wherever the groups put it. */
export function findTypeRow(table: SearchPageTypeRows, rowId: string): TypeTableRow | undefined {
  return [...table.rows, ...(table.groups ?? []).flatMap((group) => group.rows)].find((row) => row.id === rowId);
}
