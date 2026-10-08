/**
 * The gear's status columns: the status list as the board shows it, a row
 * per status, ticked to draw its column and dragged into order, with its
 * box and how many open tasks have it; and the way to the list itself.
 */
import type { BoardStatusColumn, TaskBoardSnapshot } from '../../ui/protocol/taskBoard';
import { board } from './model';

/** The names of the statuses whose columns can be ordered, in the board's order: the open ones. */
export function statusColumnNames(snapshot: TaskBoardSnapshot): string[] {
  return snapshot.settings.columns.filter(isOrdered).map((column) => column.name);
}

/** Whether a status's column is ordered by dragging: an open status's is; Done's and Cancelled's are not. */
function isOrdered(column: BoardStatusColumn): boolean {
  return column.id.startsWith('status:');
}

/** How many open tasks have a status, and whether the board hides them: "9 open, hidden". */
function describeCount(column: BoardStatusColumn): string {
  if (!column.openTasks) {
    return '';
  }
  return `${column.openTasks} open${column.shown ? '' : ', hidden'}`;
}

/** What a row's tip says: how to move it, or why it stays where it is. */
function rowTip(column: BoardStatusColumn): string {
  if (isOrdered(column)) {
    return 'Drag to reorder, or press the menu key (Shift+F10) to move it first or last';
  }
  return column.fixed ? 'Done is always a column, after every open status' : 'Cancelled comes after Done when it is shown';
}

/** One status: its tick, its box and name, its open count, and, for an open status, its grip. */
function StatusRow({ column }: { readonly column: BoardStatusColumn }) {
  const ordered = isOrdered(column);
  const count = describeCount(column);
  return (
    <li
      class={ordered ? 'board-status is-draggable' : 'board-status'}
      tabIndex={ordered ? 0 : undefined}
      data-status={ordered ? column.name : undefined}
      data-tip={rowTip(column)}
    >
      <span class="board-status-grip" aria-hidden="true">{ordered ? '⠿' : ''}</span>
      <label class="board-status-tick">
        <input
          type="checkbox"
          data-action="show-status-column"
          data-name={column.name}
          checked={column.shown}
          disabled={column.fixed === true}
          aria-label={`Show ${column.name} [${column.symbol}] as a column`}
        />
        <span class="board-status-box" aria-hidden="true">{`[${column.symbol}]`}</span>
        <span class="board-status-name">{column.name}</span>
      </label>
      {count ? <span key="count" class="board-status-count" data-tip="Open tasks with this status, in the whole workspace">{count}</span> : null}
    </li>
  );
}

/** The status columns, and the way to the status list. */
export function StatusSettings({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  return (
    <div class="board-settings">
      <p class="board-settings-note help-text">Columns when grouped by Status, one per status in your list. Tick one to show it, drag to set the order. Done is always a column; a character no status names gets one of its own.</p>
      <ul key={`statuses-${board.generation}`} class="board-status-list" aria-label="Status columns">
        {snapshot.settings.columns.map((column) => <StatusRow key={column.id} column={column} />)}
      </ul>
      <div class="board-settings-row">
        <button type="button" data-action="new-task-status" data-tip="Add a status to the list, with its character">New status…</button>
        <button type="button" data-action="edit-task-statuses" data-tip="Open Edit Task Statuses">Edit statuses…</button>
      </div>
    </div>
  );
}
