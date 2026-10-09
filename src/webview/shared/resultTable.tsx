/**
 * What every results table draws alike: the Task board's table and a
 * type's rows tab on a search page. A column's heading is a button that
 * sorts by it, marked and named for a screen reader while it does, and
 * ⋯'s list of the columns shown is a checkbox per column, the title fixed.
 */
import type { ComponentChildren } from 'preact';

/** A column as a heading and ⋯'s list name it. */
export interface TableColumn {
  readonly id: string;
  readonly label: string;
}

/** What a table is sorted by, if anything. */
export interface TableSortState {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * One column's heading: a button running `action` with the column's id in
 * `data-value`, an arrow while the table is sorted by it, and `aria-sort`
 * saying which way.
 */
export function SortHeader({ column, sort, action, className, tip, title, attributes, children }: {
  readonly column: TableColumn;
  readonly sort: TableSortState | undefined;
  readonly action: string;
  /** Classes besides `is-sorted`. */
  readonly className?: string;
  /** The button's tip; "Sort by <label>" unless it says. */
  readonly tip?: string;
  /** The heading's own title, such as what a computed column is. */
  readonly title?: string;
  /** Any other attributes the heading carries, by name. */
  readonly attributes?: Readonly<Record<string, string>>;
  /** What the button draws in place of its label, the arrow after it. */
  readonly children?: ComponentChildren;
}) {
  const sorted = Boolean(sort && sort.column === column.id);
  const descending = sort?.direction === 'desc';
  let arrow = '';
  let order: 'ascending' | 'descending' | undefined;
  if (sorted) {
    arrow = descending ? ' ▼' : ' ▲';
    order = descending ? 'descending' : 'ascending';
  }
  const classes = [className, sorted ? 'is-sorted' : ''].filter(Boolean).join(' ');
  return (
    <th scope="col" class={classes || undefined} aria-sort={order} title={title} data-column={column.id} {...attributes}>
      <button type="button" data-action={action} data-value={column.id} data-tip={tip ?? `Sort by ${column.label.toLowerCase()}`}>
        {children === undefined ? column.label + arrow : <>{children}{arrow}</>}
      </button>
    </th>
  );
}

/**
 * ⋯'s list of a table's columns, each a checkbox running `action` with its
 * id in `data-value`, ticked while shown; the title's is fixed.
 */
export function ColumnPicker({ shown, available, action, attributes }: {
  readonly shown: readonly string[];
  readonly available: readonly TableColumn[];
  readonly action: string;
  /** Any other attributes every checkbox carries, by name. */
  readonly attributes?: Readonly<Record<string, string>>;
}) {
  return (
    <ul class="table-columns">
      {available.map((column) => (
        <li key={column.id}>
          <label>
            <input type="checkbox" data-action={action} data-value={column.id} {...attributes} checked={shown.includes(column.id)} disabled={column.id === 'title'} />
            {column.label}
          </label>
        </li>
      ))}
    </ul>
  );
}
