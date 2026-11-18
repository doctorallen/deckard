/**
 * A cell of a type's rows table, as the search page's rows tab and the
 * Types tab's child tables both draw it: its values as links to the rows
 * and notes they name, an option the column's menu can rename, or text.
 */
import type { ComponentChild } from 'preact';

import type { TypeTableCell, TypeTableColumn, TypeTableValue } from '../../ui/protocol/searchPage';

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
export function CellBody({ cell, column }: { readonly cell: TypeTableCell; readonly column: TypeTableColumn }) {
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
