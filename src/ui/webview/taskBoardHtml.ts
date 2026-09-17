import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getContentSecurityPolicy,
  getQueryEditorCss,
  getQueryEditorScript,
} from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds the Task Board page: the search box every search page shares, the
 * gear that holds the board's view options and column settings, and the
 * searched tasks as columns or as a list.
 */
export function getTaskBoardHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = getContentSecurityPolicy(webview.cspSource, nonce);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Task Board</title>
<style nonce="${nonce}">${getBaseCss()}
${getQueryEditorCss()}
/* The gear holds the header's top-right corner, as it does on the Dashboard. */
header { align-items: flex-start; }
.board-header-actions { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.board-total { color: var(--muted); font: 12px var(--font-mono); }
.board-view-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin: 4px 0 12px; }
.board-area { margin-top: 12px; }
.board-area [hidden] { display: none; }
.task-list .empty { margin-top: 0; }

/* The status column editor inside the gear's menu. */
.board-settings { display: grid; gap: 6px; width: min(280px, 80vw); text-transform: none; }
.board-settings-note { margin: 0; color: var(--muted); font-size: 11px; }
.board-status-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.board-status { display: flex; align-items: center; gap: 6px; min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); padding: 2px 2px 2px 6px; }
.board-status:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 1px; }
.board-status-grip { color: var(--muted); font-size: 12px; line-height: 1; }
.board-status.drag-ghost { list-style: none; }
.board-status-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; color: var(--text); font: 12px var(--font-mono); }
.board-status button { min-width: 26px; min-height: 26px; padding: 2px 6px; }
.board-settings-row { display: flex; align-items: center; gap: 4px; }
.board-settings-row input { flex: 1 1 auto; min-width: 0; min-height: 26px; }
.board-settings-row button { min-height: 26px; padding: 2px 8px; }
.board-settings-prefix { color: var(--muted); font: 12px var(--font-mono); }
.board-settings-error { margin: 0; color: var(--warning-orange); font-size: 11px; }

/* The board is wide rather than a reading column, and leads with a cyan rule. */
main { max-width: none; border-top: var(--edge) solid var(--cyan); }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading tasks...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
${getQueryEditorScript()}
  let state;
  /** What is being typed into the gear's fields, kept across redraws. */
  let statusDraft = '';
  let namespaceDraft;
  let settingsError = '';
  const STATUS_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  const NAMESPACE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

  function post(message) { vscode.postMessage(message); }

  /** The Task Board searches tasks alone, with the box every search page uses. */
  const editor = createQueryEditor({
    getState: function () { return state && state.query; },
    render: function () { renderKeepingFocus(); },
    apply: function (text) { post({ type: 'setBoardQuery', query: text }); },
    clear: function () { post({ type: 'setBoardQuery', query: '' }); },
    // Plain words hide the tasks they do not match at once; the rest waits for Enter.
    onDraft: function () { filterTaskEntries(); },
    placeholder: function () { return 'Search tasks: words, #tags, is:open, has:due, due < 7d, priority >= high…'; },
    label: 'Search tasks',
    resultKinds: ['tasks'],
    refineElsewhere: function () { return Boolean(state && state.refineInSidebar); },
    // Saving sits with the search it saves; the saved search reopens here.
    actions: function (hasText) {
      return '<button data-action="save-board-search" data-query-needs-text title="Save this search as a view that opens on the Task Board"' + (hasText ? '' : ' disabled') + '>Save</button>';
    },
  });

  /** Hide the rows and cards that do not have every plain word being typed. */
  function filterTaskEntries() {
    const words = editor.previewWords(editor.currentText());
    document.querySelectorAll('.task-list .task-row, .task-board .board-card').forEach(function (entry) {
      const text = entry.textContent.toLowerCase();
      entry.hidden = !words.every(function (word) { return text.indexOf(word) >= 0; });
    });
  }

  /**
   * Redraw without taking the caret away from a field being typed in, which
   * is found again by its action, as the Dashboard does.
   */
  function renderKeepingFocus() {
    const active = document.activeElement;
    const isField = Boolean(active && active.matches && active.matches('input[type="text"]'));
    const action = isField ? active.dataset.action : undefined;
    const selectionStart = isField ? active.selectionStart : null;
    const selectionEnd = isField ? active.selectionEnd : null;
    render();
    if (!action) return;
    const field = document.querySelector('input[type="text"][data-action="' + action + '"]');
    if (!field) return;
    field.focus();
    if (selectionStart !== null && selectionEnd !== null) field.setSelectionRange(selectionStart, selectionEnd);
  }

  function canRank() {
    return Boolean(state) && state.layout === 'list' && state.taskSortMode === 'rank';
  }

  function listedTaskIds() {
    return (state.tasks || []).map(function (item) { return item.task.id; });
  }

  // A ranked list, and the status columns in the gear, are ordered by
  // dragging their rows, or from their context menu.
  installRankedRows({
    kinds: {
      task: { selector: '.task-list .task-row[data-task-id]', key: 'taskId' },
      status: { selector: '.board-status[data-status]', key: 'status', edgeLabels: ['Move to first column', 'Move to last column'] },
    },
    canRank: function (kind) { return kind === 'status' ? Boolean(state) : canRank(); },
    reorder: function (kind, key, targetKey, before) {
      if (kind === 'status') {
        const statuses = rankKeys(state.settings.statuses, key, targetKey, before);
        if (!statuses) return false;
        setStatuses(statuses);
        return true;
      }
      const ids = rankKeys(listedTaskIds(), key, targetKey, before);
      if (!ids) return false;
      post({ type: 'reorderTasks', taskIds: ids });
      return true;
    },
    move: function (kind, key, toTop) {
      if (kind === 'status') {
        const statuses = moveKeyToEdge(state.settings.statuses, key, toTop);
        if (statuses) setStatuses(statuses);
        return;
      }
      const ids = moveKeyToEdge(listedTaskIds(), key, toTop);
      if (ids) post({ type: 'reorderTasks', taskIds: ids });
    },
  });

  /**
   * The status columns, dragged into order and each removable, and a field
   * to add one.
   */
  function renderStatusSettings() {
    const statuses = state.settings.statuses;
    const rows = statuses.map(function (status, index) {
      return '<li class="board-status is-draggable" tabindex="0" data-status="' + escapeHtml(status) + '" title="Drag to reorder, or right-click to move it first or last">'
        + '<span class="board-status-grip" aria-hidden="true">&#10303;</span>'
        + '<span class="board-status-name">' + escapeHtml(status) + '</span>'
        + '<button type="button" data-action="remove-status" data-index="' + index + '" aria-label="Remove ' + escapeHtml(status) + '" title="Remove column">&#215;</button></li>';
    }).join('');
    const namespace = namespaceDraft === undefined ? state.settings.statusNamespace : namespaceDraft;
    return '<div class="board-settings">'
      + '<p class="board-settings-note">Columns when grouped by Status. Drag to reorder; Done always comes last.</p>'
      + (rows ? '<ul class="board-status-list" aria-label="Status columns">' + rows + '</ul>' : '<p class="board-settings-note">No status columns. Tasks without a status still get one.</p>')
      + '<form class="board-settings-row" data-form="add-status"><input type="text" data-action="status-draft" value="' + escapeHtml(statusDraft) + '" placeholder="Add a status, such as review" aria-label="New status column" autocomplete="off" spellcheck="false"><button type="submit">Add</button></form>'
      + '<span>Status tag</span>'
      + '<form class="board-settings-row" data-form="status-namespace"><span class="board-settings-prefix">#</span><input type="text" data-action="namespace-draft" value="' + escapeHtml(namespace) + '" aria-label="Status tag namespace" autocomplete="off" spellcheck="false"><span class="board-settings-prefix">/doing</span><button type="submit">Save</button></form>'
      + (settingsError ? '<p class="board-settings-error" role="alert">' + escapeHtml(settingsError) + '</p>' : '')
      + '</div>';
  }

  function render() {
    if (!state) return;
    closeRankMenu();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const isList = state.layout === 'list';
    const sortIcon = '<svg class="control-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg>';
    const sortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-task-sort" aria-label="Sort tasks">'
      + [['rank', 'Rank'], ['created', 'Created'], ['updated', 'Updated']].map(function (option) {
        return '<option value="' + option[0] + '"' + (state.taskSortMode === option[0] ? ' selected' : '') + '>' + option[1] + '</option>';
      }).join('') + '</select>' + sortIcon + '</span></label>';
    const viewOptions = renderViewOptions([
      { label: 'Layout', html: renderViewOptionChoices('set-task-layout', [['list', 'List'], ['board', 'Board']], state.layout, 'Task layout') },
      { label: 'Status columns', html: renderStatusSettings(), stacked: true },
    ]);
    const total = state.taskCount + (state.taskCount === 1 ? ' task' : ' tasks');
    const viewRow = '<div class="board-view-row">'
      + (isList ? renderTaskFilterSwitch(state.taskFilter, state.taskCounts, 'set-task-filter') : '<span></span>')
      + '</div>';
    const list = (state.tasks || []).length
      ? state.tasks.map(function (item) {
        return renderTaskListRow(item, { draggable: canRank(), titleDisplay: state.tagTitleDisplayMode });
      }).join('')
      : '<div class="empty">No tasks match this filter.</div>';
    const content = isList
      ? viewRow + '<div class="task-list">' + list + '</div>'
      : renderTaskBoard(state);
    document.getElementById('app').innerHTML =
      '<header><div><p class="eyebrow">DECKARD / TASK BOARD</p><h1>Task Board</h1></div>'
      + '<div class="board-header-actions"><span class="board-total">' + total + '</span>' + viewOptions + '</div></header>'
      + editor.renderBar(isList ? sortControl : renderTaskBoardGroupSwitch(state.groupBy))
      + editor.renderFacets()
      + '<section class="board-area" aria-label="Tasks">' + content + '</section>';
    filterTaskEntries();
    editor.afterRender();
    window.scrollTo(scrollX, scrollY);
  }

  /** Sends a new list of status columns, or says why it cannot be used. */
  function setStatuses(statuses) {
    settingsError = '';
    post({ type: 'setBoardStatuses', statuses: statuses });
  }

  function addStatus() {
    const name = statusDraft.trim().toLowerCase();
    if (!name) return;
    if (!STATUS_NAME.test(name)) {
      settingsError = 'A status is letters, digits, - and _, starting with a letter or digit.';
      renderKeepingFocus();
      return;
    }
    if (state.settings.statuses.indexOf(name) >= 0) {
      settingsError = name + ' is already a column.';
      renderKeepingFocus();
      return;
    }
    statusDraft = '';
    setStatuses(state.settings.statuses.concat([name]));
  }

  function saveNamespace() {
    if (namespaceDraft === undefined) return;
    const name = namespaceDraft.trim().toLowerCase();
    if (!NAMESPACE_NAME.test(name)) {
      settingsError = 'A status tag is letters, digits, - and _, starting with a letter.';
      renderKeepingFocus();
      return;
    }
    settingsError = '';
    namespaceDraft = undefined;
    if (name !== state.settings.statusNamespace) post({ type: 'setBoardStatusNamespace', namespace: name });
    else renderKeepingFocus();
  }

  // The board's cards, their menus, and moving them between columns.
  installTaskBoard(post);
  installViewOptions();

  document.addEventListener('mousedown', function (event) { editor.handleMousedown(event); });
  document.addEventListener('focusin', function (event) { editor.handleFocusIn(event); });

  document.addEventListener('click', function (event) {
    if (editor.handleClick(event)) return;
    const target = event.target.closest('[data-action]');
    if (target) {
      const action = target.dataset.action;
      if (action === 'open-tag') post({ type: 'openTag', tagKey: target.dataset.tagKey });
      if (action === 'save-board-search') post({ type: 'saveBoardSearch' });
      if (action === 'set-task-layout') post({ type: 'setTaskLayout', layout: target.dataset.value });
      if (action === 'set-task-filter') post({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (action === 'remove-status') {
        const statuses = state.settings.statuses.slice();
        statuses.splice(Number(target.dataset.index), 1);
        setStatuses(statuses);
      }
      return;
    }
    const row = event.target.closest('.task-list .task-row');
    if (row && !event.target.closest('button, input, a')) {
      post({ type: 'openSource', filePath: row.dataset.filePath, line: Number(row.dataset.line) });
    }
  });

  document.addEventListener('submit', function (event) {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === 'add-status') addStatus();
    if (form.dataset.form === 'status-namespace') saveNamespace();
  });

  document.addEventListener('keydown', function (event) {
    if (editor.handleKeydown(event)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('.task-list .task-row');
    if (row && !event.target.closest('button, input, a')) {
      event.preventDefault();
      post({ type: 'openSource', filePath: row.dataset.filePath, line: Number(row.dataset.line) });
    }
  });

  document.addEventListener('change', function (event) {
    if (editor.handleChange(event)) return;
    const target = event.target;
    if (target.dataset.action === 'set-task-sort') post({ type: 'setTaskSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') post({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
  });

  document.addEventListener('input', function (event) {
    if (editor.handleInput(event)) return;
    const target = event.target;
    if (target.dataset.action === 'status-draft') statusDraft = target.value;
    if (target.dataset.action === 'namespace-draft') namespaceDraft = target.value;
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') {
      state = event.data.data;
      editor.receive();
      vscode.setState({ query: state.query.text });
      renderKeepingFocus();
    }
  });

  post({ type: 'ready' });
}());
</script>
</body>
</html>`;
}
