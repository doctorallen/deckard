/**
 * Edit Task Statuses: the statuses `deckard.tasks.statuses` lists, as rows
 * to edit, checked as they are typed, and saved together. Todo's and Done's
 * characters and types are fixed, as in Obsidian. The characters the notes
 * use that no status names can be added in one go, and a vault's own
 * statuses imported. In the workflow, each row says the status a click
 * moves to, and the page draws where each leads.
 */
import { checkStatusList, type StatusProblem } from '../../domain/tasks/statusChecks';
import type { StateMessage } from '../../ui/protocol/messaging';
import type { EditedStatus, TaskStatusesSnapshot } from '../../ui/protocol/taskStatuses';
import { Eyebrow } from '../shared/eyebrow';
import { listenForActions, onHostMessage, readEmbeddedState, startPage } from '../shared/page';
import { post } from '../shared/vscode';

/** A row as the page holds it: a status, and whether it is Todo or Done, whose character and type are fixed. */
type StatusRowState = EditedStatus & { readonly core?: true };

/** What the page draws from: the host's list, and the rows as edited since. */
interface StatusesState {
  readonly snapshot: TaskStatusesSnapshot | undefined;
  /** The rows as typed; undefined until the first edit, when the snapshot's are drawn. */
  readonly rows: readonly StatusRowState[] | undefined;
}

/** The types a status may have, in the order the menu lists them, with their words. */
const TYPES: ReadonlyArray<[EditedStatus['type'], string]> = [
  ['todo', 'To do'],
  ['inProgress', 'In progress'],
  ['onHold', 'On hold'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled'],
  ['nonTask', 'Not a task'],
];

/** The icons an open status may add. */
const ICONS: ReadonlyArray<[string, string]> = [
  ['', 'None'],
  ['blocked', '⊘ Blocked'],
  ['question', '? Question'],
  ['alert', '! Alert'],
  ['star', '★ Star'],
  ['flag', '⚑ Flag'],
  ['clock', '◷ Clock'],
];

/** Deckard's own statuses, and Obsidian's core four, for the presets. */
const PRESETS: Readonly<Record<string, readonly EditedStatus[]>> = {
  deckard: [
    { symbol: ' ', name: 'Todo', type: 'todo', next: 'x' },
    { symbol: '/', name: 'In progress', type: 'inProgress', next: 'x' },
    { symbol: 'x', name: 'Done', type: 'done', next: ' ' },
    { symbol: 'X', name: 'Done', type: 'done', next: ' ' },
    { symbol: '-', name: 'Cancelled', type: 'cancelled', next: ' ' },
    { symbol: 'w', name: 'Waiting', type: 'onHold', next: ' ' },
    { symbol: 's', name: 'Someday', type: 'onHold', next: ' ' },
    { symbol: '=', name: 'Blocked', type: 'onHold', icon: 'blocked', next: ' ' },
  ],
  obsidian: [
    { symbol: ' ', name: 'Todo', type: 'todo', next: 'x' },
    { symbol: 'x', name: 'Done', type: 'done', next: ' ' },
    { symbol: '/', name: 'In Progress', type: 'inProgress', next: 'x' },
    { symbol: '-', name: 'Cancelled', type: 'cancelled', next: ' ' },
  ],
};

/**
 * A list's rows, the first Todo (` `) and the first Done (`x`) marked as the
 * two every list has: marked when the list arrives, so typing `x` into
 * another row does not lock it.
 */
function markCore(statuses: readonly EditedStatus[]): StatusRowState[] {
  const seen = new Set<string>();
  return statuses.map((status) => {
    if ((status.symbol === ' ' || status.symbol === 'x') && !seen.has(status.symbol)) {
      seen.add(status.symbol);
      return { ...status, core: true };
    }
    return status;
  });
}

/** The rows the page draws: as edited, or as the settings have them. */
function rowsOf(state: StatusesState): readonly StatusRowState[] {
  return state.rows ?? markCore(state.snapshot?.statuses ?? []);
}

/** The rows as the setting writes them, without the page's own marks. */
function toSettings(rows: readonly StatusRowState[]): EditedStatus[] {
  return rows.map(({ core: _core, ...status }) => status);
}

/** A character as a row writes it: `[ ]` for a space. */
function boxOf(symbol: string | undefined): string {
  return symbol === undefined ? '' : `[${symbol}]`;
}

/** One status's row: its character, name, type, next character in the workflow, icon, and a way to remove it. */
function StatusRow({ status, at, workflow, problems, rows }: {
  readonly status: StatusRowState;
  readonly at: number;
  readonly workflow: boolean;
  /** Every row, whose characters the Next menu offers. */
  readonly rows: readonly StatusRowState[];
  readonly problems: readonly StatusProblem[];
}) {
  const core = status.core === true;
  const field = (name: keyof EditedStatus) => ({ 'data-row': String(at), 'data-field': name });
  const label = status.name || `Row ${at + 1}`;
  return (
    <tr class={problems.some((problem) => problem.severity === 'error') ? 'has-error' : undefined}>
      <td>
        {core
          ? <span class="status-symbol" data-tip="Todo's and Done's characters are fixed, as in Obsidian">{boxOf(status.symbol)}</span>
          : <input type="text" class="status-symbol-input" maxLength={2} value={status.symbol ?? ''} placeholder="none" aria-label={`${label}: character`} {...field('symbol')} />}
      </td>
      <td><input type="text" value={status.name} aria-label={`${label}: name`} {...field('name')} /></td>
      <td>
        {core
          ? <span>{TYPES.find(([type]) => type === status.type)?.[1]}</span>
          : (
            <select aria-label={`${label}: type`} {...field('type')}>
              {TYPES.map(([type, words]) => <option value={type} selected={status.type === type}>{words}</option>)}
            </select>
          )}
      </td>
      {workflow ? <td><NextMenu status={status} rows={rows} label={label} field={field('next')} /></td> : null}
      <td>
        {/* Only an open status adds an icon: a closed box shows its type's. */}
        {status.type === 'done' || status.type === 'cancelled' || status.type === 'nonTask'
          ? <span class="status-no-icon" data-tip="A done or cancelled box shows its type, not an icon">—</span>
          : (
            <select aria-label={`${label}: icon`} {...field('icon')}>
              {ICONS.map(([icon, words]) => <option value={icon} selected={(status.icon ?? '') === icon}>{words}</option>)}
            </select>
          )}
      </td>
      <td>
        {core
          ? null
          : <button type="button" class="status-remove" data-action="remove-status" data-row={String(at)} aria-label={`Remove ${label}`} data-tip="Remove">×</button>}
      </td>
    </tr>
  );
}

/**
 * The status a click moves a row to, chosen from the rows by character and
 * name: a space in a text field could not be told from an empty one.
 */
function NextMenu({ status, rows, label, field }: {
  readonly status: StatusRowState;
  readonly rows: readonly StatusRowState[];
  readonly label: string;
  readonly field: Record<string, string>;
}) {
  const symbols = rows.filter((row) => row.symbol !== undefined);
  const known = status.next === undefined || symbols.some((row) => row.symbol === status.next);
  return (
    <select class="status-next" aria-label={`${label}: the status a click moves it to`} {...field}>
      <option value="" selected={status.next === undefined}>None</option>
      {symbols.map((row) => <option value={row.symbol} selected={status.next === row.symbol}>{`${boxOf(row.symbol)} ${row.name || 'Unnamed'}`}</option>)}
      {known ? null : <option value={status.next} selected={true}>{`${boxOf(status.next)} no status`}</option>}
    </select>
  );
}

/** What each problem says, by row, errors first. */
function Problems({ problems, rows }: { readonly problems: readonly StatusProblem[]; readonly rows: readonly EditedStatus[] }) {
  if (!problems.length) {
    return null;
  }
  const ordered = [...problems].sort((left, right) => Number(left.severity === 'warning') - Number(right.severity === 'warning') || left.row - right.row);
  return (
    <ul class="status-problems" role="alert">
      {ordered.map((problem) => (
        <li class={problem.severity === 'error' ? 'is-error' : 'is-warning'}>
          {`${rows[problem.row]?.name || `Row ${problem.row + 1}`}: ${problem.text}`}
        </li>
      ))}
    </ul>
  );
}

/** Where a click leads from each status, in the workflow: `[ ] Todo → [x] Done`. */
function Workflow({ rows }: { readonly rows: readonly EditedStatus[] }) {
  const steps = rows.filter((status) => status.symbol !== undefined && status.next);
  if (!steps.length) {
    return null;
  }
  return (
    <section class="status-workflow" aria-label="Where a click leads">
      <h2>Where a click leads</h2>
      <ul>
        {steps.map((status) => {
          const next = rows.find((candidate) => candidate.symbol === status.next);
          return <li>{`${boxOf(status.symbol)} ${status.name} → ${boxOf(status.next)} ${next ? next.name : 'no status'}`}</li>;
        })}
      </ul>
    </section>
  );
}

/** The whole page. */
function TaskStatusesPage({ state }: { readonly state: StatusesState }) {
  const snapshot = state.snapshot as TaskStatusesSnapshot;
  const rows = rowsOf(state);
  const workflow = snapshot.checkboxClick === 'workflow';
  const problems = checkStatusList(rows, workflow);
  const errors = problems.some((problem) => problem.severity === 'error');
  const unknown = snapshot.found.filter((found) => !rows.some((status) => status.symbol === found.symbol));
  return (
    <>
      <header>
        <div>
          <Eyebrow trail="TASKS" />
          <h1>Task Statuses</h1>
        </div>
        <p class="status-note">{`What each checkbox character means. Saved to your ${snapshot.target === 'workspace' ? "workspace's" : 'user'} settings.`}</p>
      </header>
      <fieldset class="status-click">
        <legend>Checking a box</legend>
        <label><input type="radio" name="checkbox-click" data-action="set-checkbox-click" value="done" checked={!workflow} /> Marks it done, whatever its status; unchecking reopens it</label>
        <label><input type="radio" name="checkbox-click" data-action="set-checkbox-click" value="workflow" checked={workflow} /> Moves it to its status's next status, as Obsidian Tasks does</label>
      </fieldset>
      <table class="status-table">
        <thead>
          <tr>
            <th>Character</th>
            <th>Name</th>
            <th>Type</th>
            {workflow ? <th>Next</th> : null}
            <th>Icon</th>
            <th><span class="visually-hidden">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((status, at) => (
            <StatusRow key={at} status={status} at={at} workflow={workflow} problems={problems.filter((problem) => problem.row === at)} rows={rows} />
          ))}
        </tbody>
      </table>
      <Problems problems={problems} rows={rows} />
      <div class="status-actions">
        <button type="button" data-action="add-status">Add a status</button>
        {unknown.length
          ? <button type="button" data-action="add-found" data-tip={unknown.map((found) => `[${found.symbol}] ${found.count}`).join(', ')}>{`Add characters found in notes (${unknown.length})`}</button>
          : null}
        <button type="button" data-action="preset" data-preset="deckard">Deckard's own</button>
        <button type="button" data-action="preset" data-preset="obsidian">Obsidian's core</button>
        {snapshot.canImport ? <button type="button" data-action="import">Import from Obsidian Tasks</button> : null}
        <span class="status-actions-gap" />
        <button type="button" data-action="revert" disabled={state.rows === undefined}>Revert</button>
        <button type="button" class="is-primary" data-action="save" disabled={state.rows === undefined || errors}>Save</button>
      </div>
      {workflow ? <Workflow rows={rows} /> : null}
    </>
  );
}

/** The id of the new row the host asked for last that the page has added, so each is added once. */
let addedNewRow: number | undefined;

/**
 * The page's state for a snapshot from the host: the list as the settings
 * have it, edits dropped, unless the host asks for a new row, which is
 * added once, after the list, and kept, with the edits since, until the
 * list is saved.
 */
function receive(snapshot: TaskStatusesSnapshot | undefined, rows: StatusesState['rows']): StatusesState {
  const asked = snapshot?.newRow;
  if (!snapshot || !asked) {
    return { snapshot, rows: undefined };
  }
  if (asked.id === addedNewRow) {
    return { snapshot, rows };
  }
  addedNewRow = asked.id;
  const added = [...markCore(snapshot.statuses), { name: asked.name, type: asked.type }];
  // The new row's character is the first thing to fill in.
  setTimeout(() => document.querySelector<HTMLElement>(`[data-row="${added.length - 1}"][data-field="symbol"]`)?.focus(), 0);
  return { snapshot, rows: added };
}

const store = startPage<StatusesState>({
  initial: receive(readEmbeddedState<TaskStatusesSnapshot>(), undefined),
  ready: (state) => state.snapshot !== undefined,
  view: (state) => <TaskStatusesPage state={state} />,
});

/** Changes the rows, keeping the page's edits apart from the settings until Save. */
function editRows(change: (rows: StatusRowState[]) => StatusRowState[]): void {
  store.update({ rows: change([...rowsOf(store.state)]) });
}

listenForActions(document.getElementById('app') as HTMLElement, {
  'add-status': () => editRows((rows) => [...rows, { name: '', type: 'todo' }]),
  'remove-status': (element) => editRows((rows) => rows.filter((_row, at) => at !== Number(element.dataset.row))),
  'add-found': () =>
    editRows((rows) => [
      ...rows,
      ...(store.state.snapshot?.found ?? [])
        .filter((found) => !rows.some((status) => status.symbol === found.symbol))
        .map((found): StatusRowState => ({ symbol: found.symbol, name: '', type: 'todo' })),
    ]),
  preset: (element) => editRows(() => markCore(PRESETS[String(element.dataset.preset)] ?? [])),
  import: () => post({ type: 'importTaskStatuses' }),
  revert: () => store.update({ rows: undefined }),
  save: () => post({ type: 'saveTaskStatuses', statuses: toSettings(rowsOf(store.state)) }),
});

/** A field's new value, written into its row: an empty one clears it, as the setting leaves it out. */
document.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const row = target.dataset.row;
  const name = target.dataset.field as keyof EditedStatus | undefined;
  if (row === undefined || !name) {
    return;
  }
  editRows((rows) =>
    rows.map((status, at) => {
      if (at !== Number(row)) {
        return status;
      }
      const { [name]: _old, ...rest } = status;
      return (target.value === '' && name !== 'name' ? rest : { ...rest, [name]: target.value }) as StatusRowState;
    }),
  );
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.dataset.action === 'set-checkbox-click' && target.checked) {
    post({ type: 'setCheckboxClick', value: target.value === 'workflow' ? 'workflow' : 'done' });
  }
});

onHostMessage<StateMessage<TaskStatusesSnapshot>>('state', (message) => store.update(receive(message.data, store.state.rows)));
