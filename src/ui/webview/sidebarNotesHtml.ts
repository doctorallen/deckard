import * as vscode from 'vscode';

/**
 * Builds the compact Related Notes webview from host-provided snapshots.
 *
 * Keeping the view state-driven lets the host choose between active-note and
 * active-tag contexts while this document remains a simple navigation surface.
 */
export function getSidebarNotesHtml(
  webview: vscode.Webview,
  extensionVersion: string,
): string {
  const nonce = createNonce();
  const escapedExtensionVersion = extensionVersion
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Related Notes</title>
<style nonce="${nonce}">
:root {
  color-scheme: dark;
  --bg: #050608;
  --panel: #0D1017;
  --panel-raised: #121620;
  --panel-deep: #050608;
  --text: #D9E0E4;
  --muted: #7D8792;
  --line: #212936;
  --line-strong: #34445A;
  --cyan: #00E5FF;
  --green: #33FF33;
  --amber: #FFB000;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 220px; background-color: var(--bg); background-image: linear-gradient(rgba(0, 229, 255, .04) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, .04) 1px, transparent 1px); background-size: 24px 24px; color: var(--text); font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); font-size: 12px; }
main { padding: 12px; border-top: 2px solid var(--amber); }
h2, .eyebrow, .source, .match-count, .version { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
h2 { margin: 0; color: var(--cyan); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding-bottom: 8px; border-bottom: 2px solid var(--line-strong); }
.eyebrow { min-width: 0; flex: 1 1 auto; margin: 0; overflow: hidden; color: var(--amber); font-size: 10px; letter-spacing: .15em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.version { flex: 0 0 auto; color: var(--green); font-size: 10px; }
.active-file { margin-top: 12px; padding: 9px; border: 2px solid var(--line); border-left: 4px solid var(--amber); background: var(--panel); overflow-wrap: anywhere; }
.active-label, .section-label { color: var(--muted); font-size: 10px; text-transform: uppercase; }
.active-name { margin-top: 3px; }
.sidebar-toolbar { display: flex; flex: 0 0 auto; justify-content: flex-end; gap: 6px; }
.icon-button { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 5px; color: var(--text); }
.icon-button svg { width: 16px; height: 16px; display: block; fill: currentColor; }
.tag-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
button { border: 2px solid var(--line); background: var(--panel-deep); color: var(--cyan); padding: 4px 6px; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
button:hover { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
button:focus-visible, .note:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.section-label { display: block; margin: 16px 0 7px; padding-left: 6px; border-left: 2px solid var(--amber); }
.note-list { display: grid; gap: 8px; }
.note { border: 2px solid var(--line); background: var(--panel); padding: 9px; cursor: pointer; }
.note:hover { border-color: var(--line-strong); }
.note-header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
.note-title { min-width: 0; overflow-wrap: anywhere; }
.match-count { flex: 0 0 auto; color: var(--green); font-size: 10px; }
.source { margin-top: 4px; color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.note .tag-list { margin-top: 7px; }
.note .tag-list button { color: var(--text); }
.empty { margin-top: 12px; border: 2px dashed var(--line); padding: 14px 10px; color: var(--muted); background: var(--panel-deep); line-height: 1.45; }
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading related notes...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;

  /** Escape note paths, titles, and labels before they become markup. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /** Render tag links through one delegated action shape for every sidebar state. */
  function renderTags(tags, extraClass) {
    return tags.map(function (tag) {
      return '<button class="' + (extraClass || '') + '" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '">' + escapeHtml(tag.label) + '</button>';
    }).join('');
  }

  /** Render explicit empty states so the sidebar explains why no notes appear. */
  function render() {
    if (!state) return;
    let content;
    if (state.state === 'noMarkdown') {
      content = '<div class="empty">Open a Markdown note to see related entries.</div>';
    } else if (state.state === 'noTags') {
      content = '<div class="empty">This note has no tags yet.</div>';
    } else if (state.state === 'noMatches') {
      content = state.tagOverview
        ? '<div class="empty">No notes currently carry this tag.</div>'
        : '<div class="empty">No other notes share its tags.</div>';
    } else {
      content = '<div class="note-list">' + state.notes.map(function (note) {
        const title = note.title || note.fileName || note.filePath;
        const fileName = note.fileName || note.filePath;
        const tags = renderTags(note.matchedTags, 'matched-tag');
        return '<article class="note" tabindex="0" data-file-path="' + escapeHtml(note.filePath) + '" data-line="' + note.sourceLine + '"><div class="note-header"><h2 class="note-title">' + escapeHtml(title) + '</h2><span class="match-count">' + note.matchCount + '/' + note.totalTagCount + '</span></div><div class="source">' + escapeHtml(fileName) + ' / line ' + note.sourceLine + '</div><div class="tag-list" aria-label="Matching tags">' + tags + '</div></article>';
      }).join('') + '</div>';
    }
    const activeTags = state.activeTags.length ? '<div class="tag-list" aria-label="Active note tags">' + renderTags(state.activeTags, 'active-tag') + '</div>' : '';
    const context = state.tagOverview
      ? '<div class="active-file"><div class="active-label">Tag overview</div><div class="active-name">' + escapeHtml(state.tagOverview.label) + '</div></div>'
      : (state.activeFileName ? '<div class="active-file"><div class="active-label">Current note</div><div class="active-name">' + escapeHtml(state.activeFileName) + '</div>' + activeTags + '</div>' : '');
    const sectionLabel = state.tagOverview
      ? '<span class="section-label">Current notes</span>'
      : (state.state === 'ready' ? '<span class="section-label">Shared tags</span>' : '');
    document.getElementById('app').innerHTML = '<div class="sidebar-header"><p class="eyebrow">DECKARD / RELATED NOTES</p><span class="version">v${escapedExtensionVersion}</span><div class="sidebar-toolbar" role="toolbar" aria-label="Deckard actions"><button class="icon-button" data-action="open-dashboard" aria-label="Open Dashboard" title="Open Dashboard"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2h5v5H2zm7 0h5v3H9zm0 5h5v7H9zM2 9h5v5H2z"/></svg></button><button class="icon-button" data-action="create-daily-note" aria-label="Create Daily Note" title="Create Daily Note"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h1v2h8V2h1v2h1v10H2V4h1zm0 4v7h10V6zm4 1h1v2h2v1H8v2H7v-2H5V9h2z"/></svg></button></div></div>' + context + sectionLabel + content;
  }

  document.addEventListener('click', function (event) {
    const target = event.target.closest('[data-action]');
    if (target) {
      if (target.dataset.action === 'open-tag') vscode.postMessage({ type: 'openTag', tagKey: target.dataset.tagKey });
      if (target.dataset.action === 'open-dashboard') vscode.postMessage({ type: 'openDashboard' });
      if (target.dataset.action === 'create-daily-note') vscode.postMessage({ type: 'createDailyNote' });
      return;
    }
    const note = event.target.closest('.note');
    if (note) vscode.postMessage({ type: 'openSource', filePath: note.dataset.filePath, line: Number(note.dataset.line) });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-action]')) return;
    const note = event.target.closest('.note');
    if (note) {
      event.preventDefault();
      vscode.postMessage({ type: 'openSource', filePath: note.dataset.filePath, line: Number(note.dataset.line) });
    }
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
 * Creates a per-webview CSP nonce for the sidebar's inline style and script.
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
