import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getPageTailCss,
  loadingHtml,
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
.parked-line { margin: var(--space-3) 0 0; color: var(--muted); font-size: var(--text-xs); }
.parked-line .text-button { padding: 0; border: 0; background: none; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
.reindex { min-height: 22px; padding: 2px 8px; font-size: var(--text-xs); }
.views { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-top: 24px; }
.view-panel { border: 2px solid var(--line); background: var(--panel); }
.view-panel h3 { margin: 0; padding: 12px; border-bottom: 2px solid var(--line); color: var(--cyan); font-size: var(--text-md); font-weight: 650; }
.stats-section { margin-top: 24px; }
.stats-section > h2 { margin: 0; }
.stats-section > .views { margin-top: 12px; align-items: start; }
.view-panel > p.detail { margin: 0; padding: 10px 12px 0; }
.attention-clear, .views-empty { margin: 8px 0 0; color: var(--muted); font-size: var(--text-sm); }
.orphan-list:not(.show-all) .is-more { display: none; }
.show-more { margin: 0 12px 12px; min-height: 22px; padding: 2px 8px; font-size: var(--text-xs); }
.list { display: grid; gap: 6px; margin: 0; padding: 8px; list-style: none; }
.stat-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 10px 12px; }
.label { overflow-wrap: anywhere; }
.detail { margin-top: 3px; color: var(--muted); font: var(--text-xs) var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.count { color: var(--green); font-size: 16px; }
/* A pair that looks alike: both tags on one line, with what to do about it. */
.pair { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.pair-tag { padding: 2px 6px; font-size: var(--text-sm); }
.pair-arrow { color: var(--muted); }
.view-panel h3.with-action { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
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
${loadingHtml('Loading statistics…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  /** Notes nothing links to shows ten, then the rest of what was sent on request. */
  const ORPHANS_SHOWN = 10;
  let showAllOrphans = false;
${getComponentScript()}
  /**
   * One number. Given a search, it becomes a button that opens the notes and
   * tasks behind it: the totals were a dead end, even where a page existed
   * that listed exactly what was being counted.
   */
  /** How much is parked, as a search for it; nothing when nothing is. */
  function parkedLine() {
    const parked = state.parked;
    if (!parked) return '';
    const words = 'Parked: ' + parked.notes + ' ' + (parked.notes === 1 ? 'note' : 'notes') + ', ' + parked.openTasks + ' open ' + (parked.openTasks === 1 ? 'task' : 'tasks');
    return '<p class="parked-line"><button type="button" class="text-button" data-action="open-search" data-query="is:parked" data-tip="Search everything that is parked">' + escapeHtml(words) + '</button></p>';
  }

  /**
   * One tile. A tile that opens what it counts is a button: a search, a tag
   * to choose, the graph, or the list further down the page.
   */
  function metric(label, value, query, hint, trend) {
    return renderMetric(label, value, query, hint, undefined, trend);
  }
  /** A total's twelve weeks, with what its line counts by, for its tip. */
  function trendOf(name, noun) {
    const trend = state.trends && state.trends[name];
    return trend ? { points: trend.points, change: trend.change, note: 'The line counts ' + noun + ' by the date each note was written, over the last 12 weeks.' } : undefined;
  }
  function actionMetric(label, value, action, hint, attributes) {
    if (!value) return renderMetric(label, value);
    return '<button type="button" class="metric metric-open" data-action="' + action + '"' + (attributes || '') + ' data-tip="' + escapeHtml(hint) + '" aria-label="' + escapeHtml(label + ', ' + value + '. ' + hint) + '"><span class="metric-label">' + escapeHtml(label) + '</span><strong class="metric-value">' + value + '</strong></button>';
  }
  // isTag draws the label as a tag, with its namespace dimmed as everywhere
  // else a tag is shown.
  function accessList(listName, empty, hint, isTag, shown) {
    const items = state[listName];
    if (!items.length) return '<p class="empty">' + escapeHtml(empty) + '</p>';
    return '<ol class="list' + (shown ? ' orphan-list' + (showAllOrphans ? ' show-all' : '') : '') + '">' + items.map(function (item, index) {
      const label = isTag ? renderTagLabel(item.label) : escapeHtml(item.label);
      return '<li' + (shown && index >= shown ? ' class="is-more"' : '') + '><div class="row stat-row" role="button" tabindex="0" data-tip="' + escapeHtml(hint) + '" data-list="' + listName + '" data-index="' + index + '"><div><div class="label">' + label + '</div><div class="detail">' + escapeHtml(item.detail) + '</div></div>' + (item.count === undefined ? '' : '<strong class="count">' + item.count + '</strong>') + '</div></li>';
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
      const source = '<button type="button" class="tag-open pair-tag" data-action="open-lookalike" data-index="' + index + '" data-side="source" data-tip="Open this tag in a search page">' + renderTagLabel(pair.sourceLabel) + '</button>';
      const target = '<button type="button" class="tag-open pair-tag" data-action="open-lookalike" data-index="' + index + '" data-side="target" data-tip="Open this tag in a search page">' + renderTagLabel(pair.targetLabel) + '</button>';
      const merge = '<button type="button" class="merge" data-action="merge-lookalike" data-index="' + index + '" data-tip="Merge ' + escapeHtml(pair.sourceLabel) + ' into ' + escapeHtml(pair.targetLabel) + '" aria-label="Merge ' + escapeHtml(pair.sourceLabel) + ' into ' + escapeHtml(pair.targetLabel) + '">Merge</button>';
      return '<li><div class="row stat-row"><div><div class="label pair">' + source + '<span class="pair-arrow" aria-hidden="true">&rarr;</span>' + target + '</div><div class="detail">' + escapeHtml(pair.detail) + '</div></div>' + merge + '</div></li>';
    }).join('') + '</ol>';
  }
  /** The notes a missing name's links are in, in words. */
  function describeSources(target) {
    const names = target.sources.slice();
    const more = target.sourceCount - names.length;
    if (more > 0) names.push(more + ' more ' + (more === 1 ? 'note' : 'notes'));
    const list = names.length <= 1
      ? names.join('')
      : names.length === 2
        ? names[0] + ' and ' + names[1]
        : names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
    return target.count + ' ' + (target.count === 1 ? 'link' : 'links') + ' from ' + list;
  }
  /**
   * Names links write that no note carries. A row opens the search for the
   * links; Create makes the note, and Create all makes every one.
   */
  function missingLinkList() {
    const targets = state.missingLinkTargets || [];
    if (!targets.length) return '<p class="empty">Every link opens a note.</p>';
    return '<ol class="list">' + targets.map(function (target, index) {
      const create = target.creatable
        ? '<button type="button" class="merge" data-action="create-missing-note" data-index="' + index + '" aria-label="Create ' + escapeHtml(target.name) + '" data-tip="Create an empty note named ' + escapeHtml(target.name) + ' in the notes folder">Create</button>'
        : '';
      const detail = describeSources(target) + (target.creatable ? '' : ' · cannot be a file name');
      return '<li><div class="row stat-row" role="button" tabindex="0" data-missing-index="' + index + '" data-tip="Search for the links to it"><div><div class="label">' + escapeHtml(target.name) + '</div><div class="detail">' + escapeHtml(detail) + '</div></div>' + create + '</div></li>';
    }).join('') + '</ol>';
  }
  // A row posts the message the host projected for it, so the page never
  // decides what a tag or a line opens.
  function openRow(row) {
    const missing = row.getAttribute('data-missing-index');
    if (missing !== null && missing !== undefined) {
      const target = state && (state.missingLinkTargets || [])[Number(missing)];
      if (target) vscode.postMessage({ type: 'openSearch', query: 'link = [[' + target.name + ']]' });
      return;
    }
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
    if (action && action.dataset.action === 'open-tag-list') {
      vscode.postMessage({ type: 'openTagList', namespaced: action.dataset.namespaced === 'true' });
      return;
    }
    if (action && action.dataset.action === 'open-graph') {
      vscode.postMessage({ type: 'openNotesGraph', onlyWrittenLinks: true });
      return;
    }
    if (action && action.dataset.action === 'jump') {
      const target = document.getElementById(action.dataset.target);
      if (target) {
        target.focus();
        if (target.scrollIntoView) target.scrollIntoView({ block: 'start' });
      }
      return;
    }
    if (action && action.dataset.action === 'show-more-orphans') {
      showAllOrphans = true;
      renderKeepingPlace(render);
      const list = document.querySelector('.orphan-list .is-more .stat-row');
      if (list) list.focus();
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
    if (action && action.dataset.action === 'create-missing-note') {
      const target = state && (state.missingLinkTargets || [])[Number(action.dataset.index)];
      if (target) vscode.postMessage({ type: 'createMissingNotes', names: [target.name] });
      return;
    }
    if (action && action.dataset.action === 'create-all-missing-notes') {
      vscode.postMessage({ type: 'createMissingNotes', names: [] });
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
      metric('Notes', state.sectionCount, 'is:note', 'Open a search for every note', trendOf('notes', 'notes')),
      metric('Tasks', state.taskCount, 'is:task', 'Open a search for every task', trendOf('tasks', 'tasks')),
      metric('Open tasks', state.activeTaskCount, 'is:open', 'Open a search for every open task', trendOf('openTasks', 'open tasks')),
      actionMetric('Tags', state.tagCount, 'open-tag-list', 'Choose a tag to open', ' data-namespaced="false"'),
      actionMetric('Namespaced tags', state.entityCount, 'open-tag-list', 'Choose a namespaced tag to open', ' data-namespaced="true"'),
      actionMetric('Wiki links', state.wikiLinkCount, 'open-graph', 'Open the Notes Graph showing only the links you wrote'),
      actionMetric('Unlinked notes', state.orphanNoteCount, 'jump', 'Go to the list of notes nothing links to', ' data-target="orphans-heading"')
    ].join('');
    document.getElementById('app').innerHTML = '<header><p class="eyebrow">DECKARD / LOCAL TELEMETRY</p><h1>Workspace Stats</h1><p class="updated">Index last refreshed: ' + updated + ' <button type="button" class="reindex" data-action="reindex" data-tip="Read every note again">Reindex</button></p></header>'
      + attentionSection()
      + '<section class="metrics stats-section" aria-label="Index statistics">' + metrics + '</section>' + parkedLine()
      + viewsSection();
  }
  /** A panel's heading, with how many it holds. */
  function panelHeading(title, count, id, action) {
    const text = escapeHtml(title) + ' (' + count + ')';
    const attributes = id ? ' id="' + id + '" tabindex="-1"' : '';
    return action
      ? '<h3 class="with-action"' + attributes + '><span>' + text + '</span>' + action + '</h3>'
      : '<h3' + attributes + '>' + text + '</h3>';
  }
  /**
   * What needs doing, first, and only what has rows: notes that could not be
   * read, links that open no note, tags that look alike, notes nothing links
   * to. With none, one line says the workspace is in order.
   */
  function attentionSection() {
    const panels = [];
    const unreadable = state.unreadable || [];
    if (unreadable.length) {
      // A note the index does not have looks, from a search, like a note that
      // was never written. Say so here, with why, where a reader will look.
      panels.push('<article class="view-panel unreadable">' + panelHeading('Notes Deckard could not read', unreadable.length) + '<p class="detail">' + unreadable.length + (unreadable.length === 1 ? ' note is' : ' notes are') + ' in the workspace but not in the index, so no search finds ' + (unreadable.length === 1 ? 'it' : 'them') + '. Fix the cause, then reindex.</p><ol class="list">' + unreadable.map(function (note, index) {
        return '<li><div class="row stat-row" role="button" tabindex="0" data-tip="Open this note" data-list="unreadable" data-index="' + index + '"><div><div class="label">' + escapeHtml(note.filePath) + '</div><div class="detail">' + escapeHtml(note.reason) + '</div></div></div></li>';
      }).join('') + '</ol></article>');
    }
    const missing = state.missingLinkTargets || [];
    if (missing.length) {
      const unlistedMissing = (state.missingLinkTargetCount || 0) - missing.length;
      const createAll = missing.some(function (target) { return target.creatable; })
        ? '<button type="button" class="merge" data-action="create-all-missing-notes" data-tip="Create a note for every name links write that no note carries">Create all</button>'
        : '';
      panels.push('<article class="view-panel">' + panelHeading('Links that open no note', state.missingLinkTargetCount || missing.length, '', createAll) + missingLinkList() + (unlistedMissing > 0 ? '<p class="empty">And ' + unlistedMissing + ' more.</p>' : '') + '</article>');
    }
    if (state.lookalikeTags.length) {
      const unlistedPairs = state.lookalikeTagCount - state.lookalikeTags.length;
      panels.push('<article class="view-panel">' + panelHeading('Tags that look alike', state.lookalikeTagCount) + lookalikeList() + (unlistedPairs > 0 ? '<p class="empty">And ' + unlistedPairs + ' more.</p>' : '') + '</article>');
    }
    if (state.orphanNotes.length) {
      const unlisted = state.orphanNoteCount - state.orphanNotes.length;
      const hidden = state.orphanNotes.length - ORPHANS_SHOWN;
      const more = hidden > 0 && !showAllOrphans
        ? '<button type="button" class="show-more" data-action="show-more-orphans">Show ' + hidden + ' more</button>'
        : '';
      panels.push('<article class="view-panel">' + panelHeading('Notes nothing links to', state.orphanNoteCount, 'orphans-heading') + accessList('orphanNotes', '', 'Open note', false, ORPHANS_SHOWN) + more + (unlisted > 0 && (showAllOrphans || hidden <= 0) ? '<p class="empty">And ' + unlisted + ' more.</p>' : '') + '</article>');
    }
    const body = panels.length
      ? '<div class="views">' + panels.join('') + '</div>'
      : '<p class="attention-clear">Nothing needs attention: every note was read, every link opens a note, no two tags look alike, and every note is linked from another.</p>';
    return '<section class="stats-section attention" aria-labelledby="attention-heading"><h2 id="attention-heading">Needs attention</h2>' + body + '</section>';
  }
  /**
   * The most viewed tags, canonical tags, and note entries. A list with
   * nothing in it folds into one line naming what has no views yet.
   */
  function viewsSection() {
    const lists = [
      ['tagViews', 'Most viewed tags', 'tags', 'Open tag overview', true],
      ['entityViews', 'Most viewed canonical tags', 'canonical tags', 'Open tag overview', false],
      ['sectionViews', 'Most viewed note entries', 'note entries', 'Open note entry', false]
    ];
    const panels = [];
    const empty = [];
    lists.forEach(function (list) {
      if (!state[list[0]].length) { empty.push(list[2]); return; }
      panels.push('<article class="view-panel"><h3>' + escapeHtml(list[1]) + '</h3>' + accessList(list[0], '', list[3], list[4]) + '</article>');
    });
    const reason = 'Views are counted when you open a tag\\'s page or a note entry from a search page.';
    const emptyLine = empty.length === lists.length
      ? 'Nothing viewed yet. ' + reason
      : empty.length
        ? 'Nothing viewed yet among ' + (empty.length === 2 ? empty[0] + ' and ' + empty[1] : empty[0]) + '. ' + reason
        : '';
    return '<section class="stats-section" aria-labelledby="views-heading"><h2 id="views-heading">Most viewed</h2>'
      + (panels.length ? '<div class="views">' + panels.join('') + '</div>' : '')
      + (emptyLine ? '<p class="views-empty">' + escapeHtml(emptyLine) + '</p>' : '')
      + '</section>';
  }
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; renderKeepingPlace(render); }
  });
}());
</script>
</body>
</html>`;
}

