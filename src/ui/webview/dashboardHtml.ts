import * as vscode from 'vscode';

/**
 * Builds the dashboard document and its self-contained interaction layer.
 *
 * The webview receives state snapshots rather than querying VS Code directly,
 * keeping rendering deterministic and leaving validation to the extension host.
 */
export function getDashboardHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Dashboard</title>
<style nonce="${nonce}">
:root {
  color-scheme: dark;
  --bg-dark: #050608;
  --panel-bg: #0D1017;
  --panel-raised: #121620;
  --panel-deep: #080A0E;
  --amber-bright: #FFB000;
  --amber-dim: #7A5400;
  --toxic-green: #33FF33;
  --cyan-bright: #00E5FF;
  --slate-border: #212936;
  --slate-olive: #3E4A42;
  --warning-orange: #FF5500;
  --text: #D9E0E4;
  --muted: #7D8792;
  --font-mono: var(--vscode-editor-font-family, 'Share Tech Mono', 'JetBrains Mono', 'Space Mono', 'IBM Plex Mono', 'Courier New', monospace);
  --font-display: var(--vscode-font-family, 'DIN Alternate', 'Arial Narrow', sans-serif);
  --grid-line: rgba(255, 176, 0, 0.075);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-width: 280px;
  background-color: var(--bg-dark);
  background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 13px;
}
main { position: relative; max-width: 1180px; margin: 0 auto; padding: 24px; border: 1px solid var(--slate-border); border-top: 2px solid var(--amber-bright); }
header { display: flex; justify-content: space-between; gap: 20px; align-items: end; border-bottom: 1px dashed var(--slate-border); padding-bottom: 16px; }
h1, h2, h3, .eyebrow, .metric-value, .tag-name, .task-meta, .telemetry-line, .section-readout { font-family: var(--font-mono); }
h1 { margin: 0; color: var(--text); font-size: 22px; font-weight: 700; text-transform: uppercase; }
h2 { margin: 0 0 4px; color: var(--cyan-bright); font-size: 14px; font-weight: 650; text-transform: uppercase; }
.eyebrow { margin: 0 0 6px; color: var(--amber-bright); font-size: 11px; }
.telemetry-line { display: flex; flex-wrap: wrap; gap: 12px; color: var(--muted); font-size: 10px; text-transform: uppercase; }
.telemetry-line span:first-child { color: var(--cyan-bright); }
.telemetry-line span:last-child { color: var(--toxic-green); }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(90px, 1fr)); gap: 8px; min-width: min(380px, 48%); }
.metric { position: relative; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); padding: 10px 12px; background: var(--panel-bg); }
.metric::before { content: attr(data-code); display: block; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--slate-border); color: var(--amber-dim); font: 9px var(--font-mono); text-transform: uppercase; }
.metric-value { display: block; color: var(--toxic-green); font-size: 20px; }
.metric-label { display: block; color: var(--muted); font-size: 11px; margin-top: 3px; }
.layout { display: grid; grid-template-columns: minmax(220px, .72fr) minmax(0, 1.5fr); gap: 16px; margin-top: 18px; }
section { min-width: 0; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.control-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
button, select { min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: 11px var(--font-mono); text-transform: uppercase; }
button { cursor: pointer; }
button:hover, button.active, select:hover { border-color: var(--amber-bright); color: var(--amber-bright); background: var(--panel-raised); }
button:focus-visible, select:focus-visible, input:focus-visible, .tag-row.is-draggable:focus-visible, .task-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.tag-list, .task-list { display: grid; gap: 7px; }
.tag-group + .tag-group { margin-top: 14px; }
.tag-group h3 { margin: 0 0 7px; color: var(--amber-bright); font-size: 11px; font-weight: 500; text-transform: uppercase; }
.section-readout { color: var(--muted); font-size: 9px; text-transform: uppercase; }
.tag-row, .task-row { position: relative; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); background: var(--panel-bg); }
.tag-row { display: grid; grid-template-columns: 1fr auto; gap: 7px; padding: 8px; }
.tag-row.is-draggable { cursor: grab; touch-action: none; }
.tag-row.is-draggable:active, .task-row.is-draggable:active { cursor: grabbing; }
.tag-row.is-dragging, .task-row.is-dragging { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
.drag-ghost { position: fixed; z-index: 10; top: -10000px; left: -10000px; pointer-events: none; opacity: .95; border: 1px solid var(--amber-bright); background: var(--panel-raised); }
.drag-placeholder { border: 1px dashed var(--toxic-green); background: transparent; opacity: .9; pointer-events: none; }
.tag-main { min-width: 0; display: flex; align-items: center; gap: 8px; }
.tag-open { min-height: 26px; padding: 3px 7px; border-color: var(--slate-border); color: var(--cyan-bright); text-align: left; }
.tag-name { overflow-wrap: anywhere; color: var(--cyan-bright); }
.tag-count { color: var(--muted); font-family: var(--font-mono); }
.tag-actions { display: flex; gap: 5px; }
.tag-actions button { min-height: 26px; padding-inline: 7px; }
.favorite { color: var(--amber-bright); }
.task-toolbar { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.tag-filter { position: relative; }
.tag-filter summary { min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px 9px; cursor: pointer; list-style: none; font: 11px var(--font-mono); text-transform: uppercase; }
.tag-filter summary::-webkit-details-marker { display: none; }
.tag-filter summary:hover { border-color: var(--amber-bright); color: var(--amber-bright); }
.tag-filter-menu { position: absolute; z-index: 2; top: calc(100% + 5px); right: 0; min-width: 210px; max-width: min(300px, 80vw); padding: 9px; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); background: var(--panel-raised); }
.tag-filter-search { width: 100%; min-height: 30px; border: 1px solid var(--slate-border); background: var(--panel-deep); color: var(--text); padding: 5px 7px; font: 11px var(--font-mono); }
.tag-filter-options { display: grid; gap: 7px; max-height: 220px; overflow-y: auto; }
.tag-filter-option { display: flex; align-items: center; gap: 7px; overflow-wrap: anywhere; }
.tag-filter-option input { flex: 0 0 auto; accent-color: var(--toxic-green); }
.tag-filter-no-results { display: block; margin-top: 8px; color: var(--muted); }
.tag-filter-clear { margin-top: 9px; color: var(--amber-bright); }
.task-row { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: start; padding: 10px; }
.task-row.is-draggable { cursor: grab; touch-action: none; }
.task-row input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--toxic-green); }
.task-title { overflow-wrap: anywhere; line-height: 1.45; }
.task-title a { color: var(--cyan-bright); }
.task-row.completed .task-title { color: var(--muted); text-decoration: line-through; }
.task-meta { display: flex; gap: 8px; flex-wrap: wrap; color: #3d4145; font-size: 11px; margin-top: 5px; }
.rank-context-menu { position: fixed; z-index: 20; min-width: 170px; padding: 4px; border: 1px solid var(--amber-bright); background: var(--panel-raised); box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
.rank-context-menu[hidden] { display: none; }
.rank-context-menu button { display: block; width: 100%; border: 0; padding: 8px 9px; text-align: left; text-transform: none; }
.empty { border: 1px dashed var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); padding: 18px; color: var(--muted); background: var(--panel-deep); }
.error { color: var(--warning-orange); }
@media (max-width: 720px) {
  main { padding: 16px; }
  header { align-items: start; flex-direction: column; }
  .metrics { width: 100%; min-width: 0; }
  .layout { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading index...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  let draggedTask;
  let draggedTag;
  let dragGhost;
  let dragPlaceholder;
  let dropTarget;
  let dropBefore = true;
  let pointerDrag;
  let suppressDragClick = false;
  let taskTagQuery = '';
  let taskTagFilterOpen = false;
  let rankContextMenu;
  let rankContextKind;
  let rankContextKey;

  /** Escape state values before inserting them into the generated DOM. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function send(message) { vscode.postMessage(message); }

  /** Ranked modes alone have a meaningful user-controlled display order. */
  function canRank(kind) {
    return Boolean(state) && (kind === 'tag' ? state.tagSortMode === 'custom' : state.taskSortMode === 'rank');
  }

  /** Keep the transient context menu from surviving a state refresh. */
  function closeRankContextMenu() {
    if (rankContextMenu) rankContextMenu.hidden = true;
    rankContextKind = undefined;
    rankContextKey = undefined;
  }

  /** Provide a keyboard/mouse alternative to drag reordering. */
  function openRankContextMenu(event, row) {
    const kind = row.dataset.tagKey ? 'tag' : 'task';
    const key = row.dataset.tagKey || row.dataset.taskId;
    if (!key || !canRank(kind)) return;
    event.preventDefault();
    closeRankContextMenu();
    if (!rankContextMenu) {
      rankContextMenu = document.createElement('div');
      rankContextMenu.id = 'rank-context-menu';
      rankContextMenu.className = 'rank-context-menu';
      rankContextMenu.setAttribute('role', 'menu');
      document.body.appendChild(rankContextMenu);
    }
    rankContextKind = kind;
    rankContextKey = key;
    rankContextMenu.innerHTML = '<button type="button" role="menuitem" data-context-action="top">Move to top</button><button type="button" role="menuitem" data-context-action="bottom">Move to bottom</button>';
    rankContextMenu.hidden = false;
    const bounds = rankContextMenu.getBoundingClientRect();
    rankContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
    rankContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
    rankContextMenu.querySelector('button').focus();
  }

  /** Rebuild a complete order from the current visible group before sending it. */
  function moveContextItem(toTop) {
    if (!state || !rankContextKind || !rankContextKey || !canRank(rankContextKind)) return;
    const contextKey = rankContextKey;
    if (rankContextKind === 'task') {
      const ids = state.tasks.map(function (item) { return item.task.id; });
      const index = ids.indexOf(contextKey);
      if (index < 0) return;
      ids.splice(index, 1);
      ids.splice(toTop ? 0 : ids.length, 0, contextKey);
      closeRankContextMenu();
      send({ type: 'reorderTasks', taskIds: ids });
      return;
    }

    const selectedTag = state.tags.find(function (tag) { return tag.key === contextKey; });
    if (!selectedTag) return;
    const groupKeys = state.tags.filter(function (tag) { return tag.isFavorite === selectedTag.isFavorite; }).map(function (tag) { return tag.key; });
    const groupIndex = groupKeys.indexOf(contextKey);
    if (groupIndex < 0) return;
    groupKeys.splice(groupIndex, 1);
    groupKeys.splice(toTop ? 0 : groupKeys.length, 0, contextKey);
    let groupPosition = 0;
    const keys = state.tags.map(function (tag) {
      return tag.isFavorite === selectedTag.isFavorite ? groupKeys[groupPosition++] : tag.key;
    });
    closeRankContextMenu();
    send({ type: 'reorderTags', tagKeys: keys, tagKey: contextKey, isFavorite: selectedTag.isFavorite });
  }

  /** Remove the insertion marker before a drag starts or ends. */
  function clearDropTarget() {
    if (!dropTarget) return;
    dropTarget.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    dropTarget = undefined;
  }

  /** Restore all temporary drag DOM state on every completion path. */
  function clearDragPreview() {
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = undefined;
    }
    if (dragPlaceholder) {
      dragPlaceholder.remove();
      dragPlaceholder = undefined;
    }
    clearDropTarget();
    document.querySelectorAll('.tag-row.is-dragging, .task-row.is-dragging').forEach(function (row) {
      row.classList.remove('is-dragging');
    });
  }

  /** Keep the dragged row's dimensions while the original row is hidden. */
  function createDragGhost(row) {
    const ghost = row.cloneNode(true);
    ghost.classList.remove('is-dragging', 'is-drop-target', 'is-drop-before', 'is-drop-after');
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('data-tag-key');
    ghost.removeAttribute('data-task-id');
    ghost.removeAttribute('data-file-path');
    ghost.removeAttribute('data-line');
    ghost.removeAttribute('draggable');
    ghost.setAttribute('aria-hidden', 'true');
    const bounds = row.getBoundingClientRect();
    ghost.style.width = bounds.width + 'px';
    ghost.style.height = bounds.height + 'px';
    document.body.appendChild(ghost);
    dragGhost = ghost;
  }

  /** Follow the pointer without reflowing the source list. */
  function moveDragGhost(clientX, clientY) {
    if (!dragGhost) return;
    dragGhost.style.left = clientX + 12 + 'px';
    dragGhost.style.top = clientY + 12 + 'px';
  }

  /** Reserve the row's space so the list does not jump during reordering. */
  function createDragPlaceholder(row) {
    const placeholder = row.cloneNode(true);
    placeholder.classList.remove('is-dragging', 'is-drop-target', 'is-drop-before', 'is-drop-after');
    placeholder.classList.add('drag-placeholder');
    placeholder.removeAttribute('data-tag-key');
    placeholder.removeAttribute('data-task-id');
    placeholder.removeAttribute('data-file-path');
    placeholder.removeAttribute('data-line');
    placeholder.removeAttribute('draggable');
    placeholder.removeAttribute('tabindex');
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.querySelectorAll('[data-action], [data-tag-key], [data-task-id], button, input').forEach(function (element) {
      element.removeAttribute('data-action');
      element.removeAttribute('data-tag-key');
      element.removeAttribute('data-task-id');
      element.setAttribute('tabindex', '-1');
    });
    dragPlaceholder = placeholder;
  }

  /** Move the reserved space to show the exact before/after insertion point. */
  function moveDragPlaceholder(row, before) {
    if (!dragPlaceholder || !row.parentElement) return;
    const insertionPoint = before ? row : row.nextSibling;
    if (insertionPoint === dragPlaceholder) return;
    row.parentElement.insertBefore(dragPlaceholder, insertionPoint);
  }

  /** Convert the pointer's vertical position into a stable insertion side. */
  function updateDropTarget(row, event) {
    const bounds = row.getBoundingClientRect();
    const before = event.clientY < bounds.top + bounds.height / 2;
    if (dropTarget === row && dropBefore === before) return;
    clearDropTarget();
    dropTarget = row;
    dropBefore = before;
    moveDragPlaceholder(row, before);
  }

  /** Resolve the row under the pointer even when the document owns the listener. */
  function updateDropTargetAtPoint(clientX, clientY) {
    if (!pointerDrag) return;
    const element = document.elementFromPoint(clientX, clientY);
    const selector = pointerDrag.kind === 'tag' ? '.tag-row[data-tag-key]' : '.task-row[data-task-id]';
    const row = element ? element.closest(selector) : undefined;
    const keyAttribute = pointerDrag.kind === 'tag' ? 'tagKey' : 'taskId';
    const draggedKey = pointerDrag.kind === 'tag' ? draggedTag : draggedTask;
    if (!row || !draggedKey || row.dataset[keyAttribute] === draggedKey) return;
    updateDropTarget(row, { clientY: clientY });
  }

  /** Send tag order only in custom mode, preserving favorite-group semantics. */
  function reorderDraggedTag() {
    if (!draggedTag || !dropTarget || state.tagSortMode !== 'custom') return false;
    const targetTag = dropTarget.dataset.tagKey;
    if (!targetTag || draggedTag === targetTag) return false;
    const keys = state.tags.map(function (tag) { return tag.key; });
    const from = keys.indexOf(draggedTag);
    const to = keys.indexOf(targetTag);
    const insertionIndex = to + (dropBefore ? 0 : 1);
    const adjustedIndex = insertionIndex > from ? insertionIndex - 1 : insertionIndex;
    if (from >= 0 && to >= 0) {
      keys.splice(from, 1);
      keys.splice(adjustedIndex, 0, draggedTag);
      const group = dragPlaceholder ? dragPlaceholder.closest('.tag-group') : undefined;
      const isFavorite = Boolean(group && group.dataset.tagGroup === 'favorites');
      send({ type: 'reorderTags', tagKeys: keys, tagKey: draggedTag, isFavorite: isFavorite });
      return true;
    }
    return false;
  }

  /** Send task order only in rank mode; date modes remain intentionally fixed. */
  function reorderDraggedTask() {
    if (!draggedTask || !dropTarget || !state || state.taskSortMode !== 'rank') return false;
    const targetTask = dropTarget.dataset.taskId;
    if (!targetTask || draggedTask === targetTask) return false;
    const ids = state.tasks.map(function (item) { return item.task.id; });
    const from = ids.indexOf(draggedTask);
    const to = ids.indexOf(targetTask);
    const insertionIndex = to + (dropBefore ? 0 : 1);
    const adjustedIndex = insertionIndex > from ? insertionIndex - 1 : insertionIndex;
    if (from >= 0 && to >= 0) {
      ids.splice(from, 1);
      ids.splice(adjustedIndex, 0, draggedTask);
      send({ type: 'reorderTasks', taskIds: ids });
      return true;
    }
    return false;
  }

  /** Dispatch the appropriate reorder algorithm for the active row type. */
  function reorderDraggedItem() {
    return pointerDrag && pointerDrag.kind === 'tag' ? reorderDraggedTag() : reorderDraggedTask();
  }

  /** Put the real row back where the placeholder was before cleanup. */
  function settleDragAtDrop(row) {
    if (!dragPlaceholder || !dragPlaceholder.parentElement) return;
    dragPlaceholder.parentElement.insertBefore(row, dragPlaceholder);
    dragPlaceholder.remove();
    dragPlaceholder = undefined;
    row.classList.remove('is-dragging');
  }

  /** Delay drag activation until movement passes a threshold so clicks survive. */
  function beginPointerDrag(drag, event) {
    clearDragPreview();
    draggedTask = drag.kind === 'task' ? drag.row.dataset.taskId : undefined;
    draggedTag = drag.kind === 'tag' ? drag.row.dataset.tagKey : undefined;
    createDragGhost(drag.row);
    createDragPlaceholder(drag.row);
    if (drag.row.parentElement && dragPlaceholder) {
      drag.row.parentElement.insertBefore(dragPlaceholder, drag.row);
    }
    drag.row.classList.add('is-dragging');
    drag.active = true;
    moveDragGhost(event.clientX, event.clientY);
    updateDropTargetAtPoint(event.clientX, event.clientY);
  }

  /** Release pointer capture and suppress the synthetic click after a drag. */
  function finishPointerDrag(event, cancelled) {
    const drag = pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.row.hasPointerCapture(event.pointerId)) {
      drag.row.releasePointerCapture(event.pointerId);
    }
    if (!drag.active) {
      pointerDrag = undefined;
      return;
    }
    let dropped = false;
    if (!cancelled) {
      updateDropTargetAtPoint(event.clientX, event.clientY);
      dropped = reorderDraggedItem();
      suppressDragClick = true;
    }
    if (dropped) settleDragAtDrop(drag.row);
    clearDragPreview();
    draggedTask = undefined;
    draggedTag = undefined;
    pointerDrag = undefined;
  }

  /** Re-render from a snapshot while preserving scroll and filter affordances. */
  function render() {
    if (!state) return;
    closeRankContextMenu();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const currentTagFilter = document.querySelector('.tag-filter');
    const currentTagOptions = document.querySelector('.tag-filter-options');
    const hasRenderedTagFilter = Boolean(currentTagFilter);
    if (currentTagFilter) taskTagFilterOpen = currentTagFilter.open;
    const tagOptionsScrollTop = currentTagOptions ? currentTagOptions.scrollTop : 0;
    /* Tag markup is grouped here so favorite and non-favorite rows share one shape. */
    const renderTag = function (tag) {
      const favoriteLabel = tag.isFavorite ? 'Unfavorite' : 'Favorite';
      const draggable = state.tagSortMode === 'custom';
      return '<div class="tag-row ' + (draggable ? 'is-draggable' : '') + '" draggable="false" tabindex="0" data-tag-key="' + escapeHtml(tag.key) + '">' +
        '<div class="tag-main"><button class="tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '"><span class="tag-name">' + escapeHtml(tag.label) + '</span></button><span class="tag-count">' + tag.count + '</span></div>' +
        '<div class="tag-actions"><button class="' + (tag.isFavorite ? 'favorite' : '') + '" data-action="favorite-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="' + favoriteLabel + ' ' + escapeHtml(tag.label) + '">' + (tag.isFavorite ? '[fav]' : '[ ]') + '</button></div>' +
        '</div>';
    };
    const favoriteTags = state.tags.filter(function (tag) { return tag.isFavorite; }).map(renderTag).join('');
    const otherTags = state.tags.filter(function (tag) { return !tag.isFavorite; }).map(renderTag).join('');
    const tags = state.tags.length ? (favoriteTags ? '<div class="tag-group" data-tag-group="favorites"><h3>Favorites</h3><div class="tag-list">' + favoriteTags + '</div></div>' : '') + (otherTags ? '<div class="tag-group" data-tag-group="all"><h3>All tags</h3><div class="tag-list">' + otherTags + '</div></div>' : '') : '<div class="empty">No tags indexed.</div>';
    const tasks = state.tasks.length ? state.tasks.map(function (item) {
      const task = item.task;
      const draggable = state.taskSortMode === 'rank';
      return '<div class="task-row ' + (task.completed ? 'completed ' : '') + (draggable ? 'is-draggable' : '') + '" draggable="false" tabindex="0" data-task-id="' + escapeHtml(task.id) + '" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '">' +
        '<input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '">' +
        '<div><div class="task-title">' + item.renderedTitle + '</div><div class="task-meta"><span>' + escapeHtml(item.fileName) + '</span>' + (item.sectionHeading ? '<span>' + escapeHtml(item.sectionHeading) + '</span>' : '') + '<span>line ' + task.lineNumber + '</span></div></div>' +
        '</div>';
    }).join('') : '<div class="empty">No tasks match this filter.</div>';
    const filters = ['all', 'active', 'completed'].map(function (filter) {
      return '<button class="' + (state.taskFilter === filter ? 'active' : '') + '" data-action="set-filter" data-filter="' + filter + '">' + filter + '</button>';
    }).join('');
    const normalizedTagQuery = taskTagQuery.trim().toLowerCase();
    const filteredTaskTags = state.availableTaskTags.filter(function (tag) {
      return !normalizedTagQuery || (tag.label + ' ' + tag.key).toLowerCase().indexOf(normalizedTagQuery) >= 0;
    });
    const tagOptions = state.availableTaskTags.length ? filteredTaskTags.map(function (tag) {
      return '<label class="tag-filter-option" data-filter-text="' + escapeHtml((tag.label + ' ' + tag.key).toLowerCase()) + '"><input type="checkbox" data-action="set-task-tag" data-tag-key="' + escapeHtml(tag.key) + '" ' + (state.selectedTaskTags.indexOf(tag.key) >= 0 ? 'checked' : '') + '><span>' + escapeHtml(tag.label) + '</span></label>';
    }).join('') : '<span class="empty">No task tags.</span>';
    const noMatchingTags = state.availableTaskTags.length ? '<span class="tag-filter-no-results"' + (filteredTaskTags.length ? ' hidden' : '') + '>No matching tags.</span>' : '';
    const selectedTagSummary = state.selectedTaskTags.length ? state.selectedTaskTags.length + ' selected' : 'all tags';
    const taskTagFilter = '<details class="tag-filter" ' + (taskTagFilterOpen || (!hasRenderedTagFilter && state.selectedTaskTags.length) ? 'open' : '') + '><summary>Tags: ' + selectedTagSummary + '</summary><div class="tag-filter-menu"><input class="tag-filter-search" type="search" data-action="filter-task-tags" value="' + escapeHtml(taskTagQuery) + '" placeholder="Filter tags" aria-label="Filter task tags" autocomplete="off"><div class="tag-filter-options">' + tagOptions + '</div>' + noMatchingTags + '<button class="tag-filter-clear" data-action="clear-task-tags">Clear</button></div></details>';

    document.getElementById('app').innerHTML =
      '<header><div><p class="eyebrow">DECKARD / WORKSPACE INDEX</p><h1>Dashboard</h1></div><div class="metrics" aria-label="Workspace totals">' +
        '<div class="metric" data-code="SYS.REC // 1982-AZ"><span class="metric-value">' + state.tags.length + '</span><span class="metric-label">tags</span></div>' +
        '<div class="metric" data-code="IDX.SEC // 01"><span class="metric-value">' + state.totalSectionCount + '</span><span class="metric-label">sections</span></div>' +
        '<div class="metric" data-code="IDX.TSK // 02"><span class="metric-value">' + state.totalTaskCount + '</span><span class="metric-label">tasks</span></div>' +
      '</div></header>' +
      '<div class="layout"><section aria-labelledby="tags-heading"><div class="section-heading"><h2 id="tags-heading">Tags</h2><select data-action="set-sort" aria-label="Sort tags"><option value="alphabetical" ' + (state.tagSortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="count" ' + (state.tagSortMode === 'count' ? 'selected' : '') + '>Note Count</option><option value="access" ' + (state.tagSortMode === 'access' ? 'selected' : '') + '>Most accessed</option><option value="custom" ' + (state.tagSortMode === 'custom' ? 'selected' : '') + '>Rank</option></select></div><div class="tag-list">' + tags + '</div></section>' +
      '<section aria-labelledby="tasks-heading"><div class="section-heading"><h2 id="tasks-heading">Tasks <span class="tag-count">' + state.activeTaskCount + ' active</span></h2><select data-action="set-task-sort" aria-label="Sort tasks"><option value="rank" ' + (state.taskSortMode === 'rank' ? 'selected' : '') + '>Rank</option><option value="created" ' + (state.taskSortMode === 'created' ? 'selected' : '') + '>Created</option><option value="updated" ' + (state.taskSortMode === 'updated' ? 'selected' : '') + '>Updated</option></select></div><div class="task-toolbar"><div class="control-row" role="group" aria-label="Task status filter">' + filters + '</div>' + taskTagFilter + '</div><div class="task-list">' + tasks + '</div></section></div>';
    const nextTagFilter = document.querySelector('.tag-filter');
    const nextTagOptions = document.querySelector('.tag-filter-options');
    if (nextTagFilter) {
      nextTagFilter.addEventListener('toggle', function () {
        taskTagFilterOpen = nextTagFilter.open;
      });
    }
    if (nextTagOptions) nextTagOptions.scrollTop = tagOptionsScrollTop;
    window.scrollTo(scrollX, scrollY);
  }

  document.addEventListener('click', function (event) {
    const contextAction = event.target.closest('#rank-context-menu [data-context-action]');
    if (contextAction) {
      moveContextItem(contextAction.dataset.contextAction === 'top');
      return;
    }
    if (rankContextMenu && !event.target.closest('#rank-context-menu')) closeRankContextMenu();
    if (suppressDragClick) {
      suppressDragClick = false;
      if (event.target.closest('.tag-row[data-tag-key], .task-row[data-task-id]')) {
        event.preventDefault();
        return;
      }
    }
    const tagFilter = document.querySelector('.tag-filter');
    if (tagFilter && tagFilter.open && !event.target.closest('.tag-filter')) {
      tagFilter.open = false;
      taskTagFilterOpen = false;
    }
    const target = event.target.closest('[data-action]');
    if (target) {
      const action = target.dataset.action;
      if (action === 'open-tag') send({ type: 'openTag', tagKey: target.dataset.tagKey });
      if (action === 'favorite-tag') send({ type: 'toggleFavorite', tagKey: target.dataset.tagKey });
      if (action === 'set-filter') send({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (action === 'clear-task-tags') {
        taskTagQuery = '';
        taskTagFilterOpen = false;
        const tagFilter = document.querySelector('.tag-filter');
        if (tagFilter) tagFilter.open = false;
        send({ type: 'setTaskTags', tagKeys: [] });
      }
      if (action === 'open-source') send({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      return;
    }
    const taskRow = event.target.closest('.task-row');
    if (taskRow && !event.target.closest('button, input, a')) send({ type: 'openSource', filePath: taskRow.dataset.filePath, line: Number(taskRow.dataset.line) });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && rankContextMenu && !rankContextMenu.hidden) {
      closeRankContextMenu();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const taskRow = event.target.closest('.task-row');
    if (taskRow && !event.target.closest('button, input, a')) {
      event.preventDefault();
      send({ type: 'openSource', filePath: taskRow.dataset.filePath, line: Number(taskRow.dataset.line) });
    }
  });

  document.addEventListener('change', function (event) {
    const target = event.target;
    if (target.dataset.action === 'set-sort') send({ type: 'setTagSort', mode: target.value });
    if (target.dataset.action === 'set-task-sort') send({ type: 'setTaskSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') send({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
    if (target.dataset.action === 'set-task-tag') {
      const selectedTags = Array.from(document.querySelectorAll('input[data-action="set-task-tag"]:checked')).map(function (input) { return input.dataset.tagKey; });
      send({ type: 'setTaskTags', tagKeys: selectedTags });
    }
  });

  document.addEventListener('input', function (event) {
    const target = event.target;
    if (target.dataset.action !== 'filter-task-tags') return;
    taskTagQuery = target.value;
    const query = taskTagQuery.trim().toLowerCase();
    let visibleCount = 0;
    document.querySelectorAll('.tag-filter-option').forEach(function (option) {
      const visible = !query || option.dataset.filterText.indexOf(query) >= 0;
      option.hidden = !visible;
      option.style.display = visible ? 'flex' : 'none';
      if (visible) visibleCount += 1;
    });
    const noResults = document.querySelector('.tag-filter-no-results');
    if (noResults) noResults.hidden = visibleCount > 0;
  });

  document.addEventListener('contextmenu', function (event) {
    const row = event.target.closest('.tag-row[data-tag-key], .task-row[data-task-id]');
    if (row) openRankContextMenu(event, row);
  });

  document.addEventListener('pointerdown', function (event) {
    suppressDragClick = false;
    const row = event.target.closest('.tag-row[data-tag-key], .task-row[data-task-id]');
    if (!row || !state || event.button !== 0 || pointerDrag) return;
    if (event.target.closest('button, input, select, textarea, a, [data-action]')) return;
    const kind = row.dataset.tagKey ? 'tag' : 'task';
    if (!canRank(kind)) return;
    pointerDrag = {
      row: row,
      kind: kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    row.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', function (event) {
    const drag = pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 5) return;
      event.preventDefault();
      beginPointerDrag(drag, event);
    }
    if (!drag.active) return;
    event.preventDefault();
    moveDragGhost(event.clientX, event.clientY);
    updateDropTargetAtPoint(event.clientX, event.clientY);
  });
  document.addEventListener('pointerup', function (event) {
    finishPointerDrag(event, false);
  });
  document.addEventListener('pointercancel', function (event) {
    finishPointerDrag(event, true);
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; render(); }
  });
}());
</script>
</body>
</html>`;
}

/**
 * Creates a per-webview CSP nonce so inline styles/scripts are allowed only for
 * this generated document.
 */
function createNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
