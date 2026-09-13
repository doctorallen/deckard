import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
} from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds the read-only Stats page from host-projected index and access data.
 */
export function getStatsHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Stats</title>
<style nonce="${nonce}">${getBaseCss()}
.updated, .count { font-family: var(--font-mono); }
.updated { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
.views { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-top: 24px; }
.view-panel { border: 2px solid var(--line); background: var(--panel); }
.view-panel h2 { padding: 12px; border-bottom: 2px solid var(--line); color: var(--cyan); }
.list { margin: 0; padding: 0; list-style: none; }
.row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.row:last-child { border-bottom: 0; }
.label { overflow-wrap: anywhere; }
.detail { margin-top: 3px; color: var(--muted); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.count { color: var(--green); font-size: 16px; }
@media (max-width: 600px) { main { padding: 16px; } }

/* Stats leads with a green rule and lists plain empty states. */
main { max-width: 1100px; border-top: 2px solid var(--green); }
.eyebrow { margin: 0 0 6px; }
.empty { margin-top: 0; border: 0; background: none; padding: 16px 12px; }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading statistics...</div></main>
<script nonce="${nonce}">
(function () {
  let state;
${getComponentScript()}
  function metric(label, value) {
    return '<article class="metric"><span class="metric-label">' + escapeHtml(label) + '</span><strong class="metric-value">' + value + '</strong></article>';
  }
  function accessList(items, empty) {
    if (!items.length) return '<p class="empty">' + escapeHtml(empty) + '</p>';
    return '<ol class="list">' + items.map(function (item) {
      return '<li class="row"><div><div class="label">' + escapeHtml(item.label) + '</div><div class="detail">' + escapeHtml(item.detail) + '</div></div><strong class="count">' + item.count + '</strong></li>';
    }).join('') + '</ol>';
  }
  function render() {
    if (!state) return;
    const updated = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : 'Not indexed yet';
    const metrics = [
      metric('Markdown files', state.fileCount),
      metric('Note entries', state.sectionCount),
      metric('Tasks', state.taskCount),
      metric('Open tasks', state.activeTaskCount),
      metric('All tags', state.tagCount),
      metric('Canonical tags', state.entityCount),
      metric('Wiki links', state.wikiLinkCount)
    ].join('');
    document.getElementById('app').innerHTML = '<header><p class="eyebrow">DECKARD / LOCAL TELEMETRY</p><h1>Workspace Stats</h1><p class="updated">Index last refreshed: ' + escapeHtml(updated) + '</p></header><section class="metrics" aria-label="Index statistics">' + metrics + '</section><section class="views" aria-label="View count statistics"><article class="view-panel"><h2>Most viewed tags</h2>' + accessList(state.tagViews, 'Open a tag overview to record a view.') + '</article><article class="view-panel"><h2>Most viewed canonical tags</h2>' + accessList(state.entityViews, 'Open a canonical tag overview to record a view.') + '</article><article class="view-panel"><h2>Most viewed note entries</h2>' + accessList(state.sectionViews, 'Open a note entry from an overview to record a view.') + '</article></section>';
  }
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; render(); }
  });
}());
</script>
</body>
</html>`;
}

