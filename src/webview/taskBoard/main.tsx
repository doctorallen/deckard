/**
 * The Task Board page: tasks as a Kanban board, a list, or a table,
 * narrowed by the search box every search page shares, with its view
 * options and status columns in the gear. A card moved between columns
 * moves at once and is written by the host, whose next state confirms it
 * or puts the card back.
 */
import type { StateMessage } from '../../ui/protocol/messaging';
import type { SavedToTasksViewMessage, TaskBoardMessage, TaskBoardSnapshot, ToggleRefusedMessage } from '../../ui/protocol/taskBoard';
import { checkNewStatusColumn, checkStatusNamespace } from '../../domain/tasks/taskColumns';
import { type ActionMenuGroup, closeActionMenu, openActionMenu } from '../shared/actionMenu';
import { HelpButton } from '../shared/buttons';
import { Eyebrow } from '../shared/eyebrow';
import { installKeySheet, type KeySection } from '../shared/keySheet';
import { installMenuKeys } from '../shared/menuKeys';
import { openSourceMessage } from '../shared/openSource';
import { onHostMessage, startPage } from '../shared/page';
import { closeRankMenu, installRankedRows, moveKeyToEdge, rankKeys } from '../shared/rankedRows';
import { createQueryEditor } from '../shared/queryEditor';
import { rememberScroll, restoreScroll } from '../shared/scroll';
import { announce } from '../shared/status';
import { taskTitleOf } from '../shared/taskRow';
import { createUndoNotice } from '../shared/undoToast';
import {
  displayLevelOption,
  displayOptions,
  installViewOptions,
  pageWidthOption,
  themeOption,
  ViewOptionChoices,
  ViewOptions,
} from '../shared/viewOptions';
import { keptState, vscodeApi } from '../shared/vscode';
import { GroupSwitch, TaskBoard, taskCardMoves } from './board';
import { type BoardScroll, editRow, followShownCards, installBoardMoves, readBoardScroll, restoreBoardScroll, sendHeldEdits, settleRefusedEdit } from './boardMoves';
import { AgendaToggle, AvailableToggle, canRank, ColumnPicker, ResultTable, SaveSearchButton, SortControl, syncSaveToTasksView, TableSortNote, TaskList, TasksViewActions, TasksViewStrip } from './layouts';
import { board, type BoardPageState, type DrawnBoard, lingerRemaining } from './model';
import { type SettingsDrafts, statusColumnNames, StatusSettings } from './statusSettings';

/**
 * The number of the last move sent. Each move carries the next one, and a
 * refusal carries back the number of the move it refuses.
 */
let lastMoveRequestId = 0;

/** Sends the host one message, numbering each move. */
function post(message: TaskBoardMessage): void {
  let sent = message;
  if (sent.type === 'moveTask') {
    lastMoveRequestId += 1;
    sent = { ...sent, requestId: lastMoveRequestId };
  }
  vscodeApi().postMessage(sent);
}

/** What is being typed into the gear's fields, kept across draws, and what was wrong with the last one saved. */
let drafts: SettingsDrafts = { status: '', namespace: undefined, error: '' };

/** The snapshot the host sent last, which the search box reads as it is told of it. */
let latest: TaskBoardSnapshot | undefined;

/** Where the window was scrolled when a draw began, put back after it. */
let scrolledTo = { x: 0, y: 0 };

/** Where the board and its columns were scrolled when a draw began, put back after it. */
let boardScrolledTo: BoardScroll | undefined;

/** Set by Cancel until the plain board is drawn, which focus then goes to: its Save, in Save to Tasks view's place. */
let focusSaveAfterLeaving = false;

// What every page shares comes first, as the template's component script
// did: the busy mark, the indexing line, tips, and the menu keys.
const store = startPage<BoardPageState>({
  initial: { snapshot: undefined },
  ready: (state) => Boolean(state.snapshot),
  view: (state) => <BoardPage state={state as DrawnBoard} />,
  afterDraw: () => {
    filterTaskEntries();
    editor.afterRender();
    syncSaveToTasksView(tasksViewListsBox());
    window.scrollTo(scrolledTo.x, scrolledTo.y);
    restoreBoardScroll(boardScrolledTo);
    focusSaveOnceLeft();
  },
});
installMenuKeys();

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target && target.closest('[data-action="open-help"]')) {
    post({ type: 'openHelp' });
  }
});

/** The Task Board searches tasks alone, with the box every search page uses. */
const editor = createQueryEditor({
  getState: () => latest?.query,
  render: () => redraw(),
  apply: (text) => post({ type: 'setBoardQuery', query: text }),
  clear: () => post({ type: 'setBoardQuery', query: '' }),
  // Plain words hide the tasks they do not match at once; the rest waits for
  // Enter. Save to Tasks view can act as soon as the box changes.
  onDraft: () => {
    filterTaskEntries();
    syncSaveToTasksView(tasksViewListsBox());
  },
  placeholder: () => 'Search tasks: words, #tags, is:open, has:due, due < 7d, priority >= high…',
  label: 'Search tasks',
  resultKinds: ['tasks'],
  refineElsewhere: () => Boolean(latest && latest.refineInSidebar),
  // Saving sits with the search it saves; the saved search reopens here.
  // Opened to edit what the Tasks view lists, saving to the view comes first.
  actions: (hasText) => (
    <>
      {latest?.tasksViewMode ? <TasksViewActions listed={tasksViewListsBox()} hasText={hasText} /> : <SaveSearchButton label="Save" hasText={hasText} />}
      <button data-action="export-tasks" data-tip="Every task this search found, as a Markdown table, a list, or CSV: copy, or save to a file">Export tasks</button>
    </>
  ),
  ownPrimary: () => Boolean(latest?.tasksViewMode),
});

/**
 * Whether the Tasks view lists what the box shows: the host says it lists
 * the board's search, and nothing has been typed over it since.
 */
function tasksViewListsBox(): boolean {
  const mode = latest?.tasksViewMode;
  return Boolean(mode && mode.listed && editor.currentText().trim() === (latest?.query.text || '').trim());
}

/** After Cancel, puts focus on the plain board's Save once it is drawn, so it is not lost with the strip. */
function focusSaveOnceLeft(): void {
  if (!focusSaveAfterLeaving || shown()?.tasksViewMode) {
    return;
  }
  focusSaveAfterLeaving = false;
  document.querySelector<HTMLElement>('[data-action="save-board-search"]')?.focus();
}

/**
 * Hides the list's rows, the board's cards, and the table's rows that do
 * not have every plain word being typed, by what each shows, file and line
 * included, and keeps the board's counts and its Tab stop with the cards
 * left. One check for every layout, run as the words are typed and after
 * every draw: the board used to be drawn by a check of its own that left
 * out the file's name, so a card the words showed vanished at the next
 * draw, and a column counted cards the words had hidden.
 */
function filterTaskEntries(): void {
  const words = editor.previewWords(editor.currentText());
  document.querySelectorAll<HTMLElement>('.task-list .task-row, .task-board .board-card, .result-table .result-row').forEach((entry) => {
    const text = String(entry.textContent).toLowerCase();
    entry.hidden = !words.every((word) => text.includes(word));
  });
  followShownCards();
}

/** The gear: layout, the Tasks view, the table's columns, the status columns, theme, and zen. */
function BoardViewOptions({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const isTable = snapshot.layout === 'table';
  return (
    <ViewOptions
      groups={[
        { label: 'Layout', content: <ViewOptionChoices action="set-task-layout" choices={[['list', 'List'], ['board', 'Board'], ['table', 'Table']]} selected={snapshot.layout} label="Task layout" /> },
        { label: 'Tasks view', content: <AgendaToggle snapshot={snapshot} /> },
        ...(isTable ? [{ label: 'Columns', content: <ColumnPicker snapshot={snapshot} />, stacked: true }] : []),
        { label: 'Status columns', content: <StatusSettings snapshot={snapshot} drafts={drafts} />, stacked: true },
        themeOption(),
        pageWidthOption(),
        displayLevelOption(),
        ...displayOptions(),
      ]}
    />
  );
}

/** What the search box's status line holds: the list's sort, the table's, or the board's grouping, then Can start now. */
function StatusControls({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  let control;
  if (snapshot.layout === 'list') {
    control = <SortControl snapshot={snapshot} />;
  } else if (snapshot.layout === 'table') {
    control = <TableSortNote snapshot={snapshot} />;
  } else {
    control = <GroupSwitch snapshot={snapshot} />;
  }
  return <>{control}<AvailableToggle pressed={Boolean(snapshot.availableOnly)} /></>;
}

/** The searched tasks, as the layout shows them. */
function BoardContent({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  if (snapshot.layout === 'list') {
    return <TaskList snapshot={snapshot} />;
  }
  if (snapshot.layout === 'table') {
    return <ResultTable snapshot={snapshot} />;
  }
  return <TaskBoard snapshot={snapshot} />;
}

/** The whole page: its header, the search box with its Refine row, and the tasks. */
function BoardPage({ state }: { readonly state: DrawnBoard }) {
  const snapshot = state.snapshot;
  const shown = snapshot.taskCount;
  return (
    <>
      <header>
        <div><Eyebrow trail="TASK BOARD" /><h1>Task Board</h1></div>
        <div class="board-header-actions">
          <span class="board-total">{`${shown}${shown === 1 ? ' task' : ' tasks'}`}</span>
          <HelpButton anchor="task-views" />
          <BoardViewOptions snapshot={snapshot} />
        </div>
      </header>
      {snapshot.tasksViewMode ? <TasksViewStrip /> : null}
      {editor.bar(<StatusControls snapshot={snapshot} />)}
      {editor.facets()}
      <section key="tasks" class="board-area" aria-label="Tasks"><BoardContent snapshot={snapshot} /></section>
    </>
  );
}


/**
 * Draws the page again without taking the reader's place: the caret in a
 * field being typed in, or the card or row that had focus, or the one after
 * it. The draw closes the menus, as each of the template's draws did.
 */
function redraw(change: Partial<BoardPageState> = {}): void {
  if (store.state.snapshot || change.snapshot) {
    // The draw is about to change the search box.
    editor.beforeRender();
    closeRankMenu();
    closeActionMenu();
    scrolledTo = { x: window.scrollX, y: window.scrollY };
    boardScrolledTo = readBoardScroll();
  }
  store.update(change);
}

/** The snapshot the page shows, if it has one yet. */
function shown(): TaskBoardSnapshot | undefined {
  return store.state.snapshot;
}

/** The ids of the tasks the list shows, in order. */
function listedTaskIds(): string[] {
  return (shown()?.tasks || []).map((item) => item.task.id);
}

/** Sends a new list of status columns. */
function setStatuses(statuses: string[]): void {
  drafts = { ...drafts, error: '' };
  post({ type: 'setBoardStatuses', statuses });
}

// A ranked list, and the status columns in the gear, are ordered by
// dragging their rows, or from their context menu.
installRankedRows({
  kinds: {
    task: { selector: '.task-list .task-row[data-task-id]', key: 'taskId' },
    status: { selector: '.board-status[data-status]', key: 'status', edgeLabels: ['Move to first column', 'Move to last column'] },
  },
  canRank: (kind) => (kind === 'status' ? Boolean(shown()) : canRank(shown())),
  reorder: ({ kind, key, targetKey, before }) => {
    const snapshot = shown();
    if (!snapshot) {
      return false;
    }
    if (kind === 'status') {
      const statuses = rankKeys(statusColumnNames(snapshot), key, targetKey, before);
      if (!statuses) {
        return false;
      }
      setStatuses(statuses);
      return true;
    }
    const ids = rankKeys(listedTaskIds(), key, targetKey, before);
    if (!ids) {
      return false;
    }
    post({ type: 'reorderTasks', taskIds: ids });
    return true;
  },
  move: (kind, key, toTop) => {
    const snapshot = shown();
    if (kind === 'status' && snapshot) {
      const statuses = moveKeyToEdge(statusColumnNames(snapshot), key, toTop);
      if (statuses) {
        setStatuses(statuses);
      }
      return;
    }
    const ids = moveKeyToEdge(listedTaskIds(), key, toTop);
    if (ids) {
      post({ type: 'reorderTasks', taskIds: ids });
    }
  },
  onListChanged: () => {
    board.generation += 1;
  },
});

// The board's cards, their menus, and moving them between columns.
installBoardMoves({
  post,
  namespaces: () => {
    const snapshot = shown();
    return {
      offered: snapshot?.tagNamespaces || [],
      current: snapshot?.groupBy === 'tag' ? snapshot.groupNamespace : undefined,
    };
  },
});
installViewOptions();

/** A list or table row's menu groups, from what the host says its task has now, or undefined with none. */
function rowMoves(row: HTMLElement): ActionMenuGroup[] | undefined {
  const snapshot = shown();
  const menu = snapshot && snapshot.taskMenus && snapshot.taskMenus[String(row.dataset.taskId)];
  return menu && snapshot
    ? taskCardMoves({ current: menu.current, completed: row.classList.contains('completed'), steps: menu.steps }, '', [], snapshot.settings)
    : undefined;
}

/** Whether a row's menu says its task already has the move `value` makes. */
function rowAlreadyHas(row: HTMLElement, value: string): boolean {
  return Boolean(rowMoves(row)?.some((group) => group.items.some((item) => item.value === value && item.checked)));
}

/**
 * A list or table row's menu: the board card's status, priority, due,
 * steps, done, and Move to…, from what the host says the task has now. The
 * row is drawn again when the note is written, so nothing moves at once,
 * and a choice made before then waits for it, by which time the task may
 * have what was chosen.
 */
function openRowMenu(opener: HTMLElement): boolean {
  const row = opener.closest<HTMLElement>('.task-row, .result-row');
  const groups = row ? rowMoves(row) : undefined;
  if (!row || !groups) {
    return false;
  }
  openActionMenu(opener, groups, (value) => {
    if (value === 'pick-date' || value === 'pick-assignee' || value === 'move-to' || value === 'break-steps') {
      const types = { 'pick-date': 'pickTaskDate', 'pick-assignee': 'pickTaskAssignee', 'move-to': 'moveTaskTo', 'break-steps': 'breakIntoSteps' } as const;
      editRow(row, (drawn) => ({ type: types[value], taskId: String(drawn.dataset.taskId) }), post);
      return;
    }
    const group = groups.find((candidate) => candidate.items.some((item) => item.value === value));
    const chosen = group ? group.items.find((item) => item.value === value) : undefined;
    if (chosen && chosen.checked) {
      announce(`${taskTitleOf(row)}: ${(group && group.label) || 'It'} is already ${chosen.label}.`);
      return;
    }
    editRow(row, (drawn) => (rowAlreadyHas(drawn, value) ? undefined : { type: 'moveTask', taskId: String(drawn.dataset.taskId), column: value }), post);
    announce(`${taskTitleOf(row)}: ${group && group.label ? `${group.label}, ` : ''}${chosen ? chosen.label : value}.`);
  });
  return true;
}

/**
 * Completes or reopens a list or table row's task from its checkbox. Held
 * behind the task's last edit, the task may be so already by the time it
 * goes; otherwise its box, which the host's draw set, shows it again.
 */
function toggleRow(box: HTMLInputElement): void {
  const row = box.closest<HTMLElement>('.task-row, .result-row');
  const completed = box.checked;
  announce(`${completed ? 'Completed ' : 'Reopened '}${taskTitleOf(box)}.`);
  if (!row) {
    post({ type: 'toggleTask', taskId: String(box.dataset.taskId), completed });
    return;
  }
  editRow(row, (drawn) => {
    if (drawn.classList.contains('completed') === completed) {
      return undefined;
    }
    const drawnBox = drawn.querySelector<HTMLInputElement>('input[data-action="toggle-task"]');
    if (drawnBox) {
      drawnBox.checked = completed;
    }
    return { type: 'toggleTask', taskId: String(drawn.dataset.taskId), completed };
  }, post);
}

/** Adds or removes one of the table's columns, keeping the order the picker lists them in. */
function toggleColumn(id: string, on: boolean): void {
  const table = shown()?.table;
  if (!table) {
    return;
  }
  const columns = table.columns.map((column) => column.id);
  const next = table.available.map((column) => column.id).filter((candidate) => (candidate === id ? on : columns.includes(candidate)));
  post({ type: 'setTableColumns', columns: next });
}

/**
 * Undo for a status column removed from the gear. Taken or withdrawn with
 * focus on it, focus goes back to the removed column's ×, or, when the
 * column has gone, to the column now where it was, or to the gear when it
 * has closed.
 */
const statusUndo = createUndoNotice<{ status: string; index: number; after: string[] }>(() => redraw(), (removed) => {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.board-status'));
  const row = rows[Math.min(removed.index, rows.length - 1)];
  return row && !row.closest('details:not([open])') ? row : document.querySelector<HTMLElement>('.view-options > summary');
});

/** Adds the status typed in the gear as a column, or says why it cannot be one. */
function addStatus(snapshot: TaskBoardSnapshot): void {
  const names = statusColumnNames(snapshot);
  const checked = checkNewStatusColumn(drafts.status, names);
  if (!checked) {
    return;
  }
  if (checked.error !== undefined) {
    drafts = { ...drafts, error: checked.error };
    redraw();
    return;
  }
  drafts = { ...drafts, status: '' };
  setStatuses([...names, checked.value]);
}

/** Saves the status tag typed in the gear, or says why it cannot be one. */
function saveNamespace(snapshot: TaskBoardSnapshot): void {
  if (drafts.namespace === undefined) {
    return;
  }
  const checked = checkStatusNamespace(drafts.namespace);
  if (checked.error !== undefined) {
    drafts = { ...drafts, error: checked.error };
    redraw();
    return;
  }
  drafts = { ...drafts, error: '', namespace: undefined };
  if (checked.value === snapshot.settings.statusNamespace) {
    redraw();
  } else {
    post({ type: 'setBoardStatusNamespace', namespace: checked.value });
  }
}

/** Removes a status column from the gear, offering Undo. */
function removeStatus(snapshot: TaskBoardSnapshot, status: string | undefined): void {
  const statuses = statusColumnNames(snapshot);
  const index = statuses.indexOf(String(status));
  const removed = index >= 0 ? statuses.splice(index, 1)[0] : undefined;
  if (!(removed !== undefined)) {
    return;
  }

  setStatuses(statuses);
  statusUndo.show(`Removed the ${removed} column.`, 'undo-remove-status', { status: removed, index, after: statuses });
}

/** Puts back the status column removed last, where it was. */
function undoRemoveStatus(snapshot: TaskBoardSnapshot): void {
  const undone = statusUndo.take();
  if (undone) {
    // The columns as last sent, if the host has not answered yet.
    const names = statusColumnNames(snapshot);
    const current = names.includes(undone.status) ? undone.after : names;
    const statuses = current.slice();
    statuses.splice(Math.min(undone.index, statuses.length), 0, undone.status);
    setStatuses(statuses);
  }
  redraw();
}

/** What each of the page's own controls does on a click, given the snapshot it shows. */
const ACTIONS: Readonly<Record<string, (target: HTMLElement, snapshot: TaskBoardSnapshot) => void>> = {
  'open-tag': (target) => post({ type: 'openTag', tagKey: String(target.dataset.tagKey) }),
  // What the box shows is what Save keeps, whether or not Enter ran it.
  'save-board-search': () => post({ type: 'saveBoardSearch', query: editor.currentText() }),
  // And what Save to Tasks view keeps; the host runs it, or shows its error.
  'save-to-tasks-view': () => post({ type: 'saveToTasksView', query: editor.currentText() }),
  'leave-tasks-view-mode': () => {
    focusSaveAfterLeaving = true;
    post({ type: 'leaveTasksViewMode' });
  },
  'set-table-sort': (target) => post(target.dataset.value ? { type: 'setTableSort', column: target.dataset.value as never } : { type: 'setTableSort' }),
  'use-for-agenda': () => post({ type: 'useSearchForAgenda' }),
  'toggle-available': (_target, snapshot) => post({ type: 'setBoardQuery', query: snapshot.availableToggleQuery || 'is:available' }),
  'export-tasks': () => post({ type: 'exportResults', kind: 'tasks' }),
  'set-task-layout': (target) => post({ type: 'setTaskLayout', layout: target.dataset.value as never }),
  'remove-status': (target, snapshot) => removeStatus(snapshot, target.dataset.status),
  'undo-remove-status': (_target, snapshot) => undoRemoveStatus(snapshot),
};

/** The row an event happened in, in the list or the table. */
function rowOf(target: Element | null): HTMLElement | null {
  return target ? target.closest<HTMLElement>('.task-list .task-row, .result-table .result-row') : null;
}

document.addEventListener('mousedown', (event) => {
  editor.handleMousedown(event);
});
document.addEventListener('focusin', (event) => editor.handleFocusIn(event));

document.addEventListener('click', (event) => {
  if (editor.handleClick(event)) {
    return;
  }
  const element = event.target instanceof Element ? event.target : null;
  const target = element ? element.closest<HTMLElement>('[data-action]') : null;
  if (target) {
    const action = String(target.dataset.action);
    if (action === 'task-row-menu') {
      openRowMenu(target);
      return;
    }
    const snapshot = shown();
    if (snapshot && Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
      ACTIONS[action](target, snapshot);
    }
    return;
  }
  const row = rowOf(element);
  if (row && !(element && element.closest('button, input, a'))) {
    post(openSourceMessage(row, event));
  }
});

// A right-click on a list or table row opens its ⋯ menu, as on a card. On
// a ranked list the row's Move to top and Move to bottom menu answered it
// first, and one menu opens, not two over each other; ⋯ is still its button.
document.addEventListener('contextmenu', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  const row = rowOf(element);
  if (!row || event.defaultPrevented || (element && element.closest('[data-tag-key], a, input'))) {
    return;
  }
  const button = row.querySelector<HTMLElement>('[data-action="task-row-menu"]');
  if (button && openRowMenu(button)) {
    event.preventDefault();
  }
});

document.addEventListener('submit', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  const form = element ? element.closest<HTMLElement>('[data-form]') : null;
  const snapshot = shown();
  if (!form) {
    return;
  }
  event.preventDefault();
  if (snapshot && form.dataset.form === 'add-status') {
    addStatus(snapshot);
  }
  if (snapshot && form.dataset.form === 'status-namespace') {
    saveNamespace(snapshot);
  }
});

document.addEventListener('keydown', (event) => {
  if (editor.handleKeydown(event)) {
    return;
  }
  // Alt+Enter asks for the row's menu, which the menu keys opened already;
  // it does not open the note as well.
  if ((event.key !== 'Enter' && event.key !== ' ') || event.altKey || event.defaultPrevented) {
    return;
  }
  const element = event.target instanceof Element ? event.target : null;
  const row = rowOf(element);
  if (!(row && !(element && element.closest('button, input, a')))) {
    return;
  }

  event.preventDefault();
  post(openSourceMessage(row, event));
});

document.addEventListener('change', (event) => {
  if (editor.handleChange(event)) {
    return;
  }
  const target = event.target as HTMLInputElement;
  if (target.dataset.action === 'set-task-sort') {
    post({ type: 'setTaskSort', mode: target.value as never });
  }
  if (target.dataset.action === 'toggle-task') {
    toggleRow(target);
  }
  if (target.dataset.action === 'toggle-table-column') {
    toggleColumn(String(target.dataset.value), target.checked);
  }
});

document.addEventListener('input', (event) => {
  if (editor.handleInput(event)) {
    return;
  }
  const target = event.target as HTMLInputElement;
  if (target.dataset.action === 'status-draft') {
    drafts = { ...drafts, status: target.value };
  }
  if (target.dataset.action === 'namespace-draft') {
    drafts = { ...drafts, namespace: target.value };
  }
});

/**
 * Takes the host's next snapshot: the search box is told first, the search
 * is kept for a reload (with where the page was scrolled, while the search
 * is the same), and the page is drawn. The first snapshot drawn goes back to
 * where the reader left the page.
 */
function receiveState(next: TaskBoardSnapshot): void {
  const first = !store.state.snapshot;
  latest = next;
  editor.receive();
  const previous = keptState();
  vscodeApi().setState({
    query: next.query.text,
    ...(previous.query === next.query.text && typeof previous.scrollY === 'number' ? { scrollY: previous.scrollY } : {}),
    // The host reopens a board kept across a reload as the Tasks view's
    // search editor only when it was one.
    ...(next.tasksViewMode ? { tasksViewMode: true } : {}),
  });
  redraw({ snapshot: next });
  if (first) {
    restoreScroll(previous);
  }
  // A card's edits made before the host answered its last go now, with
  // the id this state gives its task.
  sendHeldEdits();
}

rememberScroll(keptState, (value) => vscodeApi().setState(value));

/** The latest state waiting on a completed card to finish leaving. */
let pendingState: TaskBoardSnapshot | undefined;

// A card moved at once that the host could not write: its next state puts
// the card back, and this says so. The refusal names the task as well as
// the move's number, and the task is what finds the card.
onHostMessage<{ type: 'moveRefused'; taskId: string }>('moveRefused', (message) => {
  const card = Array.from(document.querySelectorAll<HTMLElement>('.board-card')).find((candidate) => candidate.dataset.taskId === String(message.taskId));
  settleRefusedEdit(String(message.taskId));
  announce(`${card ? taskTitleOf(card) : 'The task'} was not moved.`);
});
// So is a completion or reopening it could not write, from a card, a row,
// or the table.
onHostMessage<ToggleRefusedMessage>('toggleRefused', (message) => {
  const entry = Array.from(document.querySelectorAll<HTMLElement>('.board-card, .task-row, .result-row')).find((candidate) => candidate.dataset.taskId === String(message.taskId));
  settleRefusedEdit(String(message.taskId));
  announce(`${entry ? taskTitleOf(entry) : 'The task'} was not ${message.completed ? 'completed' : 'reopened'}.`);
});
// A search Save to Tasks view saved: the host says what the view lists
// now, and the page says it, as the host's notice does.
onHostMessage<SavedToTasksViewMessage>('savedToTasksView', (message) => {
  announce(message.query ? `The Tasks view lists "${message.query}" now.` : 'The Tasks view lists every open task now.');
});
onHostMessage<StateMessage<TaskBoardSnapshot>>('state', (message) => {
  const wait = lingerRemaining();
  if (!wait) {
    receiveState(message.data);
    return;
  }
  const waiting = pendingState === undefined;
  pendingState = message.data;
  if (waiting) {
    setTimeout(() => {
      const next = pendingState as TaskBoardSnapshot;
      pendingState = undefined;
      receiveState(next);
    }, wait);
  }
});

/** The keys a focused card answers, or a ranked list's, which the ? sheet lists. */
const BOARD_KEYS: KeySection = {
  title: 'A focused card',
  keys: [
    ['↑ ↓', 'The card above or below'],
    ['← →', 'The next column over'],
    ['Home, End', 'The first or last card in the column'],
    ['Enter', 'Open the task in its note'],
    ['x', 'Complete it, or reopen it'],
    ['t, m', 'Due today, due tomorrow'],
    ['d', 'Due on a date you type'],
    ['f', 'For someone: who it is for'],
    ['1 to 5, 0', 'Priority, highest to lowest; 0 clears it'],
    ['[ ]', 'Move it to the column on the left or right'],
    ['e', 'Edit the whole task'],
    ['s', 'Break it into steps'],
  ],
};
const LIST_KEYS: KeySection = { title: 'Ranked list', keys: [['Alt+↑, Alt+↓', 'Move a ranked task up or down']] };
installKeySheet(() => (shown()?.layout === 'list' ? [LIST_KEYS] : [BOARD_KEYS]));

post({ type: 'ready' });
