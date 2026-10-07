/**
 * The Task Board's other two layouts, a ranked list and a table, the
 * controls under its search box and in its gear, and what it draws while it
 * edits what the Tasks view lists.
 */
import { describeBox, statusBoxProps } from '../shared/taskBox';
import { TASK_SORT_LABELS } from '../../domain/model/sortOrders';
import type { TaskBoardSnapshot } from '../../ui/protocol/taskBoard';
import { IconButton } from '../shared/buttons';
import { Inline } from '../shared/inline';
import { EllipsisIcon, SortIcon } from '../shared/strokeIcons';
import { plainTitle, TaskListRow } from '../shared/taskRow';
import { board } from './model';

/** A list or table row's ⋯, which opens the menu a board card has. */
function RowMenuButton({ taskId, title }: { readonly taskId: string; readonly title: string }) {
  return (
    <IconButton
      action="task-row-menu"
      className="board-move row-menu"
      label={`Change ${title}: status, priority, or due date`}
      tip="Change this task"
      icon={<EllipsisIcon />}
      attributes={{ 'data-task-id': taskId, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }}
    />
  );
}

/** Whether the list can be ranked now: it is a list, ordered by rank. */
export function canRank(snapshot: TaskBoardSnapshot | undefined): boolean {
  return Boolean(snapshot) && snapshot?.layout === 'list' && snapshot.taskSortMode === 'rank';
}

/** The searched tasks as a ranked list, each row with the menu a card has. */
export function TaskList({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const tasks = snapshot.tasks || [];
  const draggable = canRank(snapshot);
  return (
    <div key={`list-${board.generation}`} class="task-list">
      {tasks.length
        ? tasks.map((item) => (
          <TaskListRow
            key={item.task.id}
            item={item}
            draggable={draggable}
            trailing={<RowMenuButton taskId={item.task.id} title={plainTitle(item.titleTokens) || item.task.title} />}
          />
        ))
        : (
          <div class="empty">
            {snapshot.taskCount
              ? 'No tasks match this search.'
              : 'No tasks yet. Write "- [ ] something" in a note, or choose Add task. The character in a task\'s box, as [/] for In progress, puts it in a column.'}
          </div>
        )}
    </div>
  );
}

/**
 * The searched tasks as a table. The host made the rows and cells; the
 * page draws them, with a header that sorts and a checkbox that completes.
 */
export function ResultTable({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const table = snapshot.table;
  if (!table || table.rows.length === 0) {
    return <div key="empty" class="empty">{snapshot.taskCount ? 'No tasks match this search.' : 'No tasks yet. Write "- [ ] something" in a note, or choose Add task.'}</div>;
  }
  const sort = table.sort;
  // The title is the column the reader cannot leave out, wherever the
  // columns put it; the checkbox and the menu are named by it.
  const titleAt = table.columns.findIndex((column) => column.id === 'title');
  return (
    <table key="table" class="result-table" aria-label="Tasks">
      <thead>
        <tr>
          <th class="result-check" />
          {table.columns.map((column) => {
            const sorted = Boolean(sort && sort.column === column.id);
            const descending = sort?.direction === 'desc';
            let arrow = '';
            let order: 'ascending' | 'descending' | undefined;
            if (sorted) {
              arrow = descending ? ' ▼' : ' ▲';
              order = descending ? 'descending' : 'ascending';
            }
            return (
              <th key={column.id} scope="col" class={sorted ? 'is-sorted' : undefined} aria-sort={order}>
                <button type="button" data-action="set-table-sort" data-value={column.id} data-tip={`Sort by ${column.label.toLowerCase()}`}>{column.label + arrow}</button>
              </th>
            );
          })}
          <th class="result-menu"><span class="visually-hidden">Change</span></th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => {
          const title = row.cells[titleAt] ? row.cells[titleAt].text : '';
          return (
            <tr key={row.taskId} class={['result-row', row.completed ? 'completed' : '', row.status?.type === 'cancelled' ? 'cancelled' : ''].filter(Boolean).join(' ')} tabIndex={0} data-task-id={row.taskId} data-file-path={row.filePath} data-line={row.line}>
              <td class="result-check"><input type="checkbox" data-action="toggle-task" data-task-id={row.taskId} {...statusBoxProps(row.completed, row.status)} aria-label={describeBox(title, row.status)} /></td>
              {row.cells.map((cell, at) => {
                const classes = [cell.kind === 'overdue' ? 'is-overdue' : '', cell.kind === 'muted' ? 'is-muted' : '', at === titleAt ? 'result-title' : ''].filter(Boolean).join(' ');
                // A cell's Markdown is drawn from its tokens, as a board
                // card's title is; everything else is data.
                return <td class={classes || undefined}>{cell.tokens ? <Inline tokens={cell.tokens} /> : cell.text}</td>;
              })}
              <td class="result-menu"><RowMenuButton taskId={row.taskId} title={title} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Under the search box while the table is shown: what it is sorted by, and the way back. */
export function TableSortNote({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const sort = snapshot.table && snapshot.table.sort;
  if (!sort) {
    return <span class="control-label">Rank order · choose a column to sort by it</span>;
  }
  const column = snapshot.table?.columns.find((candidate) => candidate.id === sort.column)?.label || sort.column;
  return (
    <>
      <span class="control-label">{`Sorted by ${column.toLowerCase()}${sort.direction === 'desc' ? ', last first' : ''}`}</span>
      <button type="button" data-action="set-table-sort" data-tip="Back to the order you ranked">Sort by rank</button>
    </>
  );
}

/** Under the search box while the list or the board is shown: how tasks are ordered, in a list or within each column. */
export function SortControl({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  return (
    <label class="control-label">
      Sort:
      <span class="control-icon">
        <select data-action="set-task-sort" aria-label="Sort tasks">
          {Object.entries(TASK_SORT_LABELS).map(([value, label]) => (
            <option value={value} selected={snapshot.taskSortMode === value}>{label}</option>
          ))}
        </select>
        <SortIcon />
      </span>
    </label>
  );
}

/**
 * Can start now: one press narrows the search to is:available, what is not
 * blocked, has started, and is not waiting or someday; a second goes back.
 */
export function AvailableToggle({ pressed }: { readonly pressed: boolean }) {
  return (
    <button type="button" class={pressed ? 'board-available active' : 'board-available'} data-action="toggle-available" aria-pressed={pressed} data-tip="Leave out blocked, not-yet-started, and waiting or someday tasks (is:available)">
      Can start now
    </button>
  );
}

/**
 * The gear's switch that makes the Tasks view list this search, and lists
 * every open task again when pressed once more. The Tasks view lists a
 * search of its own; this is where it is edited.
 */
export function AgendaToggle({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const listed = Boolean(snapshot.agendaListsThisSearch);
  const everything = listed && snapshot.agendaQueryIsDefault;
  const tip = listed
    ? 'The Tasks view lists this search. Select to list every open task again.'
    : 'Make the Tasks view list this search';
  return (
    <button
      type="button"
      data-action="use-for-agenda"
      aria-pressed={listed}
      class={listed ? 'active' : undefined}
      data-tip={tip}
      aria-disabled={everything ? 'true' : undefined}
      data-tip-disabled={everything ? 'The Tasks view lists every open task, as this search does.' : undefined}
    >
      List in Tasks view
    </button>
  );
}

/**
 * Above the search box while the board edits what the Tasks view lists,
 * having been opened from the view's search icon: what the board is for
 * now, and Cancel, which makes it a plain board and leaves the view as it is.
 */
export function TasksViewStrip() {
  return (
    <section class="search-notice tasks-view-strip" aria-labelledby="tasks-view-strip-title">
      <span>
        <strong id="tasks-view-strip-title">Editing what the Tasks view lists</strong>
        <span class="tasks-view-strip-note">Change the search, then choose Save to Tasks view.</span>
      </span>
      <button type="button" data-action="leave-tasks-view-mode" data-tip="Back to the plain board. The Tasks view keeps the search it has.">Cancel</button>
    </section>
  );
}

/**
 * The bar's buttons while the board edits what the Tasks view lists: Save
 * to Tasks view, the one the reader came for, then Save as search, the
 * board's Save, named for what it does here. Save to Tasks view takes the
 * box as it is, run or not, and is held while the view lists what the box
 * shows; `syncSaveToTasksView` keeps that as the reader types.
 */
export function TasksViewActions({ listed, hasText }: { readonly listed: boolean; readonly hasText: boolean }) {
  return (
    <>
      <button
        class="query-primary"
        data-action="save-to-tasks-view"
        data-tip="Make the Tasks view list this search"
        data-tip-disabled="The Tasks view lists this search"
        aria-disabled={listed ? 'true' : undefined}
      >
        Save to Tasks view
      </button>
      <SaveSearchButton label="Save as search" hasText={hasText} />
    </>
  );
}

/**
 * Save: names the search in the box and keeps it on Home, to reopen here.
 * Held until there is a search to save.
 */
export function SaveSearchButton({ label, hasText }: { readonly label: string; readonly hasText: boolean }) {
  return (
    <button data-action="save-board-search" data-query-needs-text="" data-tip="Keep this search, named, on Home; it reopens on the Task Board" data-tip-disabled="Type a search to save it" aria-disabled={hasText ? undefined : 'true'}>{label}</button>
  );
}

/**
 * Holds Save to Tasks view, in place, while the view lists what the box
 * shows, and lets it go once the box shows anything else: as the reader
 * types, and after each draw, which may have drawn it from older text.
 */
export function syncSaveToTasksView(listed: boolean): void {
  const button = document.querySelector('[data-action="save-to-tasks-view"]');
  if (!button) {
    return;
  }
  if (listed) {
    button.setAttribute('aria-disabled', 'true');
  } else {
    button.removeAttribute('aria-disabled');
  }
}

/** The gear's list of the table's columns, the title fixed. */
export function ColumnPicker({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const table = snapshot.table;
  if (!table) {
    return null;
  }
  const shown = table.columns.map((column) => column.id);
  return (
    <ul class="table-columns">
      {table.available.map((column) => (
        <li key={column.id}>
          <label>
            <input type="checkbox" data-action="toggle-table-column" data-value={column.id} checked={shown.includes(column.id)} disabled={column.id === 'title'} />
            {column.label}
          </label>
        </li>
      ))}
    </ul>
  );
}
