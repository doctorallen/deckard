import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getContentSecurityPolicy,
} from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds the Task Board page around the shared task board component. The
 * header and query field are static, so redrawing the board never loses what
 * is being typed.
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
/* The toolbar stretches its items, which would lift this text above the buttons' centre. */
.board-total { align-self: center; color: var(--muted); font: 12px var(--font-mono); }
.board-query { margin-top: 16px; }
.board-query input { flex: 1; min-width: 220px; }
.board-error { margin: 8px 0 0; color: var(--warning-orange); }
.board-area { margin-top: 16px; }

/* The board is wide rather than a reading column, and leads with a cyan rule. */
main { max-width: none; border-top: var(--edge) solid var(--cyan); }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <p class="eyebrow">DECKARD / TASK BOARD</p>
      <h1>Task Board</h1>
    </div>
    <div class="toolbar">
      <span class="board-total" id="board-total"></span>
      <div id="board-group"></div>
    </div>
  </header>
  <form class="control-row board-query" id="board-query">
    <input type="search" id="board-query-input" aria-label="Filter tasks with a Deckard query" placeholder="Filter with a query, such as tag = #project/atlas">
    <button type="submit">Filter</button>
    <button type="button" id="board-query-clear">Clear</button>
  </form>
  <p class="board-error" id="board-error" role="alert" hidden></p>
  <section class="board-area" id="board-area" aria-live="polite"><div class="empty">Loading tasks...</div></section>
</main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  let draftQuery = (vscode.getState() || {}).query || '';
${getComponentScript()}
  const queryInput = document.getElementById('board-query-input');
  queryInput.value = draftQuery;

  function post(message) { vscode.postMessage(message); }

  function render() {
    if (!state) return;
    document.getElementById('board-group').innerHTML = renderTaskBoardGroupSwitch(state.groupBy);
    document.getElementById('board-total').textContent = state.taskCount + (state.taskCount === 1 ? ' task' : ' tasks');
    const error = document.getElementById('board-error');
    error.hidden = !state.queryError;
    error.textContent = state.queryError || '';
    document.getElementById('board-area').innerHTML = renderTaskBoard(state);
  }

  function applyQuery(text) {
    draftQuery = text;
    vscode.setState({ query: draftQuery, groupBy: state && state.groupBy });
    post({ type: 'setBoardQuery', query: draftQuery });
  }

  installTaskBoard(post);

  document.addEventListener('click', function (event) {
    const tag = event.target.closest('[data-action="open-tag"]');
    if (tag) post({ type: 'openTag', tagKey: tag.dataset.tagKey });
  });

  document.getElementById('board-query').addEventListener('submit', function (event) {
    event.preventDefault();
    applyQuery(queryInput.value);
  });

  document.getElementById('board-query-clear').addEventListener('click', function () {
    queryInput.value = '';
    applyQuery('');
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') {
      state = event.data.data;
      vscode.setState({ query: draftQuery, groupBy: state.groupBy });
      render();
    }
  });

  post({ type: 'ready' });
}());
</script>
</body>
</html>`;
}
