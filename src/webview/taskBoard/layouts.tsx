/**
 * The Task Board's other two layouts, a ranked list and a table, and the
 * controls under its search box and in its gear.
 */
import type { TaskBoardSnapshot } from '../../ui/protocol/taskBoard';
import { IconButton } from '../shared/buttons';
import { Inline } from '../shared/inline';
import { EllipsisIcon, SortIcon } from '../shared/strokeIcons';
import { TaskListRow } from '../shared/taskRow';
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
            titleDisplay={snapshot.tagTitleDisplayMode}
            trailing={<RowMenuButton taskId={item.task.id} title={item.task.title} />}
          />
        ))
        : (
          <div class="empty">
            {snapshot.taskCount
              ? 'No tasks match this search.'
              : `No tasks yet. Write "- [ ] something" in a note, or use Deckard: Capture. A #${snapshot.settings.statusNamespace}/… tag on a task puts it in a column.`}
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
    return <div key="empty" class="empty">{snapshot.taskCount ? 'No tasks match this search.' : 'No tasks yet. Write "- [ ] something" in a note, or use Deckard: Capture.'}</div>;
  }
  const sort = table.sort;
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
          const title = row.cells[0] ? row.cells[0].text : '';
          return (
            <tr key={row.taskId} class={row.completed ? 'result-row completed' : 'result-row'} tabIndex={0} data-task-id={row.taskId} data-file-path={row.filePath} data-line={row.line}>
              <td class="result-check"><input type="checkbox" data-action="toggle-task" data-task-id={row.taskId} checked={row.completed} aria-label={`Toggle ${title}`} /></td>
              {row.cells.map((cell, at) => {
                const classes = [cell.kind === 'overdue' ? 'is-overdue' : '', cell.kind === 'muted' ? 'is-muted' : '', at === 0 ? 'result-title' : ''].filter(Boolean).join(' ');
                // A cell's Markdown is drawn from its tokens, as a board
                // card's title is; everything else is data.
                return <td class={classes || undefined}>{cell.html && cell.tokens ? <Inline tokens={cell.tokens} /> : cell.text}</td>;
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

/** Under the search box while the list is shown: how it is ordered. */
export function SortControl({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  return (
    <label class="control-label">
      Sort:
      <span class="control-icon">
        <select data-action="set-task-sort" aria-label="Sort tasks">
          {([['rank', 'Rank'], ['created', 'Created'], ['updated', 'Updated']] as const).map(([value, label]) => (
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
