/**
 * The gear's status columns: dragged into order and each removable, a
 * field to add one, and the tag namespace whose tags they are.
 */
import type { TaskBoardSnapshot } from '../../ui/protocol/taskBoard';
import { board } from './model';

/** `spellcheck="false"`, written as an attribute in every browser: Chrome's property would read the string as true. */
const NO_SPELLCHECK: Readonly<Record<string, string>> = { spellCheck: 'false' };

/** What is being typed into the gear's fields, and what was wrong with the last thing saved. */
export interface SettingsDrafts {
  readonly status: string;
  /** The namespace being typed; undefined shows the one in use. */
  readonly namespace: string | undefined;
  readonly error: string;
}

/**
 * Every status column the board draws, listed or not, in its order. Ordering
 * them saves the whole order, so a status the tasks carry keeps its place.
 */
export function statusColumnNames(snapshot: TaskBoardSnapshot): string[] {
  const columns = snapshot.settings.columns;
  return columns ? columns.map((column) => column.status) : snapshot.settings.statuses.slice();
}

/** One status column, dragged into order; one no open task carries can be removed. */
function StatusRow({ status, openTasks, label }: { readonly status: string; readonly openTasks: number; readonly label?: string }) {
  return (
    <li class="board-status is-draggable" tabIndex={0} data-status={status} data-tip="Drag to reorder, or press the menu key (Shift+F10) to move it first or last">
      <span class="board-status-grip" aria-hidden="true">⠿</span>
      <span class="board-status-name">{label || status}</span>
      {/* A status open tasks carry is a column whether it is listed or not, so there is nothing to remove: it would come straight back. */}
      {openTasks === 0
        ? <button key="remove" type="button" data-action="remove-status" data-status={status} aria-label={`Remove ${label || status}`} data-tip="Remove column">×</button>
        : <span key="count" class="board-status-count" data-tip="Open tasks with this status; a column while any have it">{openTasks}</span>}
    </li>
  );
}

/** The status columns, a field to add one, and the status tag. */
export function StatusSettings({ snapshot, drafts }: { readonly snapshot: TaskBoardSnapshot; readonly drafts: SettingsDrafts }) {
  const columns: { status: string; openTasks: number; label?: string }[] = snapshot.settings.columns || snapshot.settings.statuses.map((status) => ({ status, openTasks: 0 }));
  const namespace = drafts.namespace === undefined ? snapshot.settings.statusNamespace : drafts.namespace;
  return (
    <div class="board-settings">
      <p class="board-settings-note">Columns when grouped by Status. Every status your open tasks carry is a column, listed here or not; drag to set their order. No status comes first and Done last. Saved in your settings, so the order applies to every workspace unless this one sets its own.</p>
      {columns.length
        ? (
          <ul key={`statuses-${board.generation}`} class="board-status-list" aria-label="Status columns">
            {columns.map((column) => <StatusRow key={column.status} status={column.status} openTasks={column.openTasks} label={column.label} />)}
          </ul>
        )
        : <p key="none" class="board-settings-note">No task has a status yet, so the board has only No status and Done.</p>}
      <p class="board-settings-note">Add a status for an empty column to drop cards into. One no open task has can be removed.</p>
      <form class="board-settings-row" data-form="add-status">
        <input type="text" data-action="status-draft" value={drafts.status} placeholder="Add a status, such as review" aria-label="New status column" autocomplete="off" {...NO_SPELLCHECK} />
        <button type="submit">Add</button>
      </form>
      <span>Status tag</span>
      <form class="board-settings-row" data-form="status-namespace">
        <span class="board-settings-prefix">#</span>
        <input type="text" data-action="namespace-draft" value={namespace} aria-label="Status tag namespace" autocomplete="off" {...NO_SPELLCHECK} />
        <span class="board-settings-prefix">/doing</span>
        <button type="submit">Save</button>
      </form>
      <label class="board-settings-row">
        <input type="checkbox" data-action="show-cancelled" checked={snapshot.settings.showCancelled === true} />
        <span>Show a Cancelled column after Done</span>
      </label>
      {drafts.error ? <p key="error" class="board-settings-error" role="alert">{drafts.error}</p> : null}
    </div>
  );
}
