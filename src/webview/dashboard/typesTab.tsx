/**
 * The Types tab: every type as one row of a table, what its rows are, how
 * many it has, its open tasks and when it was last mentioned, with a way to
 * add a row; a type opened in place lists its rows; and under the table,
 * the hub notes no type's rows cover. Selecting a type opens its rows page.
 */
import type { DashboardOutsideHub, DashboardType, DashboardTypeRow, DashboardTypesTab } from '../../ui/protocol/dashboard';
import { EmptyState } from '../shared/emptyState';
import { Loading } from '../shared/loading';
import { SortHeader } from '../shared/resultTable';
import type { DashboardDraw, TypesSort, TypesSortColumn } from './model';

/** The table's columns that sort, in the order they are drawn, with their headings. */
export const TYPES_COLUMNS: ReadonlyArray<{ readonly id: TypesSortColumn; readonly label: string }> = [
  { id: 'name', label: 'Type' },
  { id: 'rule', label: 'Its rows are' },
  { id: 'rows', label: 'Rows' },
  { id: 'open-tasks', label: 'Open tasks' },
  { id: 'last-mentioned', label: 'Last mentioned' },
];

/** How many cells a row of the table has: its sorted columns, and Add …. */
const COLUMN_COUNT = TYPES_COLUMNS.length + 1;

/** What a type sorts by under a column: text, a number, or nothing for a type never mentioned. */
function sortKey(type: DashboardType, column: TypesSortColumn): string | number | undefined {
  switch (column) {
    case 'rule':
      return type.rule;
    case 'rows':
      return type.rows;
    case 'open-tasks':
      return type.openTasks;
    case 'last-mentioned':
      return type.lastMentioned?.at;
    case 'name':
      return type.plural;
  }
}

/**
 * The types in the order asked for: by a column, a type with nothing in it
 * last either way, ties by name, as a type's rows page sorts its rows.
 */
export function sortTypes(types: readonly DashboardType[], sort: TypesSort): DashboardType[] {
  const sign = sort.direction === 'desc' ? -1 : 1;
  const byName = (left: DashboardType, right: DashboardType): number =>
    left.plural.localeCompare(right.plural, undefined, { sensitivity: 'base' }) || left.key.localeCompare(right.key);
  return [...types].sort((left, right) => {
    const a = sortKey(left, sort.column);
    const b = sortKey(right, sort.column);
    if (a === undefined || b === undefined) {
      return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0) || byName(left, right);
    }
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
    return sign * compared || byName(left, right);
  });
}

/** The id of the row an opened type's rows are listed in, which its disclosure names. */
function listId(type: DashboardType): string {
  return `type-rows-${type.key}`;
}

/** One listed row: a tag row opens its tag's page, a note row its note; a name with no note is muted. */
function ListedRow({ row }: { readonly row: DashboardTypeRow }) {
  if (row.tagKey) {
    return (
      <button type="button" class={row.noNote ? 'types-link is-muted' : 'types-link'} data-action="open-tag" data-tag-key={row.tagKey} data-tip={row.noNote ? `Open ${row.title}'s page; it has no note yet` : `Open ${row.title}'s page`}>
        {row.title}
      </button>
    );
  }
  if (row.filePath) {
    return <button type="button" class="types-link" data-action="open-note" data-file-path={row.filePath} data-tip={`Open ${row.title}`}>{row.title}</button>;
  }
  return <span class="is-muted">{row.title}</span>;
}

/**
 * An opened type's rows, in the row under it: the names, then the way to
 * all of them and what the list is. Until the host has sent them, it says
 * it is loading.
 */
function ListedRows({ type }: { readonly type: DashboardType }) {
  const listed = type.listed;
  const plural = type.plural.toLowerCase();
  let body;
  if (!listed) {
    body = <Loading label={`Loading ${plural}…`} />;
  } else if (listed.rows.length === 0) {
    body = <p class="types-listed-foot">{`No ${plural} yet.`}</p>;
  } else {
    body = (
      <>
        <ul class="types-listed-rows" aria-label={type.plural}>
          {listed.rows.map((row) => <li key={row.tagKey ?? row.filePath ?? row.title}><ListedRow row={row} /></li>)}
        </ul>
        <p class="types-listed-foot">
          <button type="button" class="types-link" data-action="open-search" data-query={type.query}>{`Open all ${type.rows} ${plural}`}</button>
          {listed.note ? <span class="types-listed-note">{listed.note}</span> : null}
        </p>
      </>
    );
  }
  return (
    <tr class="types-listed" id={listId(type)}>
      <td colSpan={COLUMN_COUNT}>{body}</td>
    </tr>
  );
}

/** A type's open tasks, the overdue ones marked as its rows page marks them: "21 · 2 overdue". */
function OpenTasks({ type }: { readonly type: DashboardType }) {
  return (
    <span class="types-figure">
      {String(type.openTasks)}
      {type.overdue ? [' · ', <span class="due-date overdue">{`${type.overdue} overdue`}</span>] : null}
    </span>
  );
}

/**
 * One type: the disclosure of its rows and its name, which opens its rows
 * page; what its rows are; how many, and how many have a note; its open
 * tasks; when it was last mentioned; and Add …, shown while the row is
 * pointed at or holds focus.
 */
function TypeRow({ type, open }: { readonly type: DashboardType; readonly open: boolean }) {
  const name = type.name.toLowerCase();
  const plural = type.plural.toLowerCase();
  return (
    <>
      <tr class="result-row types-row" data-query={type.query} data-type-key={type.key} data-reveal-region="" data-zen-region="">
        <td class="types-name">
          <button
            type="button"
            class="types-toggle"
            data-action="toggle-type"
            data-type-key={type.key}
            aria-expanded={open}
            aria-controls={open ? listId(type) : undefined}
            aria-label={`${open ? 'Hide' : 'List'} ${plural}`}
            data-tip={`${open ? 'Hide' : 'List'} ${plural} here`}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
          <button type="button" class="types-link result-title" data-action="open-search" data-query={type.query} data-tip={`Open the ${plural}`}>{type.plural}</button>
        </td>
        <td><code class="types-rule">{type.rule}</code></td>
        <td>
          <span class="types-figure">{type.withNote === undefined ? String(type.rows) : `${type.rows} · ${type.withNote} with a note`}</span>
        </td>
        <td><OpenTasks type={type} /></td>
        <td><span class="types-figure">{type.lastMentioned?.text ?? ''}</span></td>
        <td class="types-add">
          <button type="button" data-action="add-type-row" data-type-key={type.key} data-tip={`Write a new ${name}'s note, with its fields' keys`} data-reveal="" data-zen-reveal="">
            {`Add ${name}…`}
          </button>
        </td>
      </tr>
      {open ? <ListedRows type={type} /> : null}
    </>
  );
}

/** Every type, under headings that sort, by name at first. */
function TypesTable({ types, view }: { readonly types: readonly DashboardType[]; readonly view: DashboardDraw['view'] }) {
  return (
    <div class="types-scroll">
      <table class="result-table types-table" aria-labelledby="types-heading">
        <thead>
          <tr>
            {TYPES_COLUMNS.map((column) => <SortHeader key={column.id} column={column} sort={view.typesSort} action="sort-types" />)}
            <th scope="col"><span class="visually-hidden">Add a row</span></th>
          </tr>
        </thead>
        <tbody>
          {sortTypes(types, view.typesSort).map((type) => <TypeRow key={type.key} type={type} open={view.openTypes.includes(type.key)} />)}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One hub note outside every type, which opens its tag's page; or a
 * namespace of them, which opens a search of its tags and offers Create
 * type from tags….
 */
function OutsideHub({ hub }: { readonly hub: DashboardOutsideHub }) {
  return (
    <li class="types-outside-row">
      {hub.tagKey
        ? <button type="button" class="types-link result-title" data-action="open-tag" data-tag-key={hub.tagKey} data-tip={`Open ${hub.written}'s page`}>{hub.label}</button>
        : <button type="button" class="types-link result-title" data-action="open-search" data-query={hub.query} data-tip={`Search what ${hub.written} tags are on`}>{hub.label}</button>}
      <code class="types-rule">{hub.written}</code>
      {hub.detail ? <span class="types-figure">{`· ${hub.detail}`}</span> : null}
      {hub.lastMentioned ? <span class="types-figure">{hub.lastMentioned.text}</span> : null}
      {hub.canBeType
        ? <button type="button" class="types-outside-action" data-action="create-type-from-tags" data-namespace={hub.namespace} data-tip={`Make a type whose rows are the ${hub.written} tags`}>Create type from tags…</button>
        : null}
    </li>
  );
}

/** The hub notes no type's rows cover, when there are any. */
function OutsideHubs({ outside }: { readonly outside: readonly DashboardOutsideHub[] }) {
  if (!outside.length) {
    return null;
  }
  return (
    <section class="types-outside" aria-labelledby="types-outside-heading">
      <div class="section-heading">
        <h2 id="types-outside-heading">{'Hub notes outside a type '}<span class="tag-count">{outside.length}</span></h2>
      </div>
      <ul class="types-outside-list">
        {outside.map((hub) => <OutsideHub key={hub.tagKey ?? hub.written} hub={hub} />)}
      </ul>
    </section>
  );
}

/** The tab's two lists, or with no type yet what a type is and the two ways to make one. */
function TypesLists({ tab, view }: { readonly tab: DashboardTypesTab; readonly view: DashboardDraw['view'] }) {
  if (!tab.types.length) {
    return (
      <>
        <EmptyState
          as="div"
          class="empty types-empty"
          state="No types yet."
          teach="A type makes a table of one kind of thing in your notes, such as your teams or your projects."
          action={
            <span class="types-empty-actions">
              <button type="button" data-action="create-type-from-tags" data-tip="Make a type whose rows are the tags of a namespace you already write">Create type from tags…</button>
              <button type="button" data-action="new-type" data-tip="Make a type from nothing: its name, its rows, and its fields">New type…</button>
            </span>
          }
        />
        <OutsideHubs outside={tab.outside} />
      </>
    );
  }
  return (
    <>
      <div class="section-heading">
        <h2 id="types-heading">{'Types '}<span class="tag-count">{tab.types.length}</span></h2>
        <button type="button" data-action="new-type" data-tip="Make a type from nothing: its name, its rows, and its fields">New type…</button>
      </div>
      <p class="help-text types-help">Each type is a table of one kind of thing in your notes. Select a type to open its rows.</p>
      <TypesTable types={tab.types} view={view} />
      <OutsideHubs outside={tab.outside} />
    </>
  );
}

/**
 * The Types panel. Its lists are drawn only while the tab is open, and the
 * types arrive once the host knows the tab is showing.
 */
export function TypesPanel({ snapshot, view }: DashboardDraw) {
  const open = view.mode === 'types';
  let body = null;
  if (open) {
    body = snapshot.types ? <TypesLists tab={snapshot.types} view={view} /> : <Loading label="Loading types…" />;
  }
  return (
    <section id="types-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="types-tab" hidden={!open}>
      {body}
    </section>
  );
}
