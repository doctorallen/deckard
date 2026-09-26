import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getPageTailCss,
  zenBodyAttribute,
} from './components';

/**
 * Builds the Stats page from host-projected index and access data. Each
 * most-viewed row posts the message the host projected for it, which opens
 * the tag overview or note entry that row counts.
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
.updated { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; color: var(--muted); font-size: var(--text-xs); }
.reindex { min-height: 22px; padding: 2px 8px; font-size: var(--text-xs); }
.views { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-top: 24px; }
.view-panel { border: 2px solid var(--line); background: var(--panel); }
.view-panel h2 { padding: 12px; border-bottom: 2px solid var(--line); color: var(--cyan); }
.list { display: grid; gap: 6px; margin: 0; padding: 8px; list-style: none; }
.stat-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 10px 12px; }
.label { overflow-wrap: anywhere; }
.detail { margin-top: 3px; color: var(--muted); font: var(--text-xs) var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.count { color: var(--green); font-size: 16px; }
/* A pair that looks alike: both tags on one line, with what to do about it. */
.pair { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.pair-tag { padding: 2px 6px; font-size: var(--text-sm); }
.pair-arrow { color: var(--muted); }
.merge { min-height: 22px; padding: 2px 8px; font-size: var(--text-xs); white-space: nowrap; }
@media (max-width: 600px) { main { padding: 16px; } }

/* Stats leads with a green rule and lists plain empty states. */
main { max-width: 1100px; border-top: 2px solid var(--green); }
/* Eight tiles in two rows of four, not seven and one left over. */
.metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 720px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.eyebrow { margin: 0 0 6px; }
.empty { margin-top: 0; border: 0; background: none; padding: 16px 12px; }
${getPageTailCss()}
</style>
</head>
<body${zenBodyAttribute()}>
<main id="app"><div class="empty">Loading statistics...</div></main>
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
${getComponentScript()}
  /**
   * One number. Given a search, it becomes a button that opens the notes and
   * tasks behind it: the totals were a dead end, even where a page existed
   * that listed exactly what was being counted.
   */
  function metric(label, value, query, hint) {
    const body = '<span class="metric-label">' + escapeHtml(label) + '</span><strong class="metric-value">' + value + '</strong>';
    if (!query) return '<article class="metric">' + body + '</article>';
    return '<button type="button" class="metric metric-open" data-action="open-search" data-query="' + escapeHtml(query) + '" title="' + escapeHtml(hint) + '" aria-label="' + escapeHtml(label + ', ' + value + '. ' + hint) + '">' + body + '</button>';
  }
  // isTag draws the label as a tag, with its namespace dimmed as everywhere
  // else a tag is shown.
  function accessList(listName, empty, hint, isTag) {
    const items = state[listName];
    if (!items.length) return '<p class="empty">' + escapeHtml(empty) + '</p>';
    return '<ol class="list">' + items.map(function (item, index) {
      const label = isTag ? renderTagLabel(item.label) : escapeHtml(item.label);
      return '<li><div class="row stat-row" role="button" tabindex="0" title="' + escapeHtml(hint) + '" data-list="' + listName + '" data-index="' + index + '"><div><div class="label">' + label + '</div><div class="detail">' + escapeHtml(item.detail) + '</div></div>' + (item.count === undefined ? '' : '<strong class="count">' + item.count + '</strong>') + '</div></li>';
    }).join('') + '</ol>';
  }
  /**
   * Two tags that look like one idea spelled twice, pointing from the rarer
   * spelling to the one the workspace already uses. Merge hands both keys to
   * the host, which confirms the merge the way the tag list does.
   */
  function lookalikeList() {
    const pairs = state.lookalikeTags;
    if (!pairs.length) return '<p class="empty">No two tags look like one idea spelled twice.</p>';
    return '<ol class="list">' + pairs.map(function (pair, index) {
      const source = '<button type="button" class="tag-open pair-tag" data-action="open-lookalike" data-index="' + index + '" data-side="source" title="Open this tag in a search page">' + renderTagLabel(pair.sourceLabel) + '</button>';
      const target = '<button type="button" class="tag-open pair-tag" data-action="open-lookalike" data-index="' + index + '" data-side="target" title="Open this tag in a search page">' + renderTagLabel(pair.targetLabel) + '</button>';
      const merge = '<button type="button" class="merge" data-action="merge-lookalike" data-index="' + index + '" title="Merge ' + escapeHtml(pair.sourceLabel) + ' into ' + escapeHtml(pair.targetLabel) + '" aria-label="Merge ' + escapeHtml(pair.sourceLabel) + ' into ' + escapeHtml(pair.targetLabel) + '">Merge</button>';
      return '<li><div class="row stat-row"><div><div class="label pair">' + source + '<span class="pair-arrow" aria-hidden="true">&rarr;</span>' + target + '</div><div class="detail">' + escapeHtml(pair.detail) + '</div></div>' + merge + '</div></li>';
    }).join('') + '</ol>';
  }
  // A row posts the message the host projected for it, so the page never
  // decides what a tag or a line opens.
  function openRow(row) {
    const items = state && state[row.getAttribute('data-list')];
    const item = items && items[Number(row.getAttribute('data-index'))];
    if (item && item.open) vscode.postMessage(item.open);
  }
  function findRow(event) {
    return event.target && event.target.closest ? event.target.closest('.stat-row') : null;
  }
  document.addEventListener('click', function (event) {
    const action = event.target.closest ? event.target.closest('[data-action]') : null;
    if (action && action.dataset.action === 'open-search') {
      vscode.postMessage({ type: 'openSearch', query: action.dataset.query });
      return;
    }
    if (action && action.dataset.action === 'reindex') {
      vscode.postMessage({ type: 'reindexWorkspace' });
      return;
    }
    if (action && action.dataset.action === 'open-lookalike') {
      const pair = state && state.lookalikeTags[Number(action.dataset.index)];
      if (pair) vscode.postMessage({ type: 'openTag', tagKey: action.dataset.side === 'target' ? pair.targetKey : pair.sourceKey });
      return;
    }
    if (action && action.dataset.action === 'merge-lookalike') {
      const pair = state && state.lookalikeTags[Number(action.dataset.index)];
      if (pair) vscode.postMessage({ type: 'mergeTags', sourceKey: pair.sourceKey, targetKey: pair.targetKey });
      return;
    }
    const row = findRow(event);
    if (row) openRow(row);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = findRow(event);
    if (!row) return;
    event.preventDefault();
    openRow(row);
  });
  /** A moment ago, in words. */
  function describeAge(milliseconds) {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }
  function render() {
    if (!state) return;
    // How long ago, in words, as due dates are; the exact time is on hover.
    // "9/20/2026, 7:58:24 PM" asked a reader to subtract it from now.
    const updated = state.updatedAt
      ? '<span title="' + escapeHtml(new Date(state.updatedAt).toLocaleString()) + '">' + escapeHtml(describeAge(Date.now() - state.updatedAt)) + '</span>'
      : 'Not indexed yet';
    const metrics = [
      metric('Files', state.fileCount),
      metric('Notes', state.sectionCount, '', ''),
      metric('Tasks', state.taskCount, 'has:task', 'Open a search for every task'),
      metric('Open tasks', state.activeTaskCount, 'is:open', 'Open a search for every open task'),
      metric('Tags', state.tagCount),
      metric('Namespaced tags', state.entityCount),
      metric('Wiki links', state.wikiLinkCount),
      metric('Unlinked notes', state.orphanNoteCount)
    ].join('');
    const unlisted = state.orphanNoteCount - state.orphanNotes.length;
    const unlistedPairs = state.lookalikeTagCount - state.lookalikeTags.length;
    // A note the index does not have looks, from a search, like a note that
    // was never written. Say so here, with why, where a reader will look.
    const unreadable = state.unreadable || [];
    const unread = unreadable.length
      ? '<section class="views" aria-label="Notes that could not be read"><article class="view-panel unreadable"><h2>Notes Deckard could not read</h2><p class="detail">' + unreadable.length + (unreadable.length === 1 ? ' note is' : ' notes are') + ' in the workspace but not in the index, so no search finds ' + (unreadable.length === 1 ? 'it' : 'them') + '. Fix the cause, then reindex.</p><ol class="list">' + unreadable.map(function (note, index) {
          return '<li><div class="row stat-row" role="button" tabindex="0" title="Open this note" data-list="unreadable" data-index="' + index + '"><div><div class="label">' + escapeHtml(note.filePath) + '</div><div class="detail">' + escapeHtml(note.reason) + '</div></div></div></li>';
        }).join('') + '</ol></article></section>'
      : '';
    const orphans = unread + '<section class="views" aria-label="Link and tag hygiene"><article class="view-panel"><h2>Notes nothing links to</h2>' + accessList('orphanNotes', 'Every note is linked from another note.', 'Open note') + (unlisted > 0 ? '<p class="empty">And ' + unlisted + ' more.</p>' : '') + '</article><article class="view-panel"><h2>Tags that look alike</h2>' + lookalikeList() + (unlistedPairs > 0 ? '<p class="empty">And ' + unlistedPairs + ' more.</p>' : '') + '</article></section>';
    document.getElementById('app').innerHTML = '<header><p class="eyebrow">DECKARD / LOCAL TELEMETRY</p><h1>Workspace Stats</h1><p class="updated">Index last refreshed: ' + updated + ' <button type="button" class="reindex" data-action="reindex" title="Read every note again">Reindex</button></p></header><section class="metrics" aria-label="Index statistics">' + metrics + '</section><section class="views" aria-label="View count statistics"><article class="view-panel"><h2>Most viewed tags</h2>' + accessList('tagViews', 'Open a tag overview to record a view.', 'Open tag overview', true) + '</article><article class="view-panel"><h2>Most viewed canonical tags</h2>' + accessList('entityViews', 'Open a canonical tag overview to record a view.', 'Open tag overview') + '</article><article class="view-panel"><h2>Most viewed note entries</h2>' + accessList('sectionViews', 'Open a note entry from an overview to record a view.', 'Open note entry') + '</article></section>' + orphans;
  }
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; renderKeepingPlace(render); }
  });
}());
</script>
</body>
</html>`;
}

