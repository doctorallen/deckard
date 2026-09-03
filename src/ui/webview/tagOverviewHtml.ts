import * as vscode from 'vscode';

/**
 * Builds the tag-overview webview and its source/rendered view controls.
 *
 * The host supplies already-projected card data, while this layer only escapes
 * source text and posts user intent back across the webview boundary.
 */
export function getTagOverviewHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Tag Overview</title>
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
body { margin: 0; min-width: 280px; background-color: var(--bg); background-image: linear-gradient(rgba(0, 229, 255, .04) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, .04) 1px, transparent 1px); background-size: 24px 24px; color: var(--text); font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); font-size: 13px; }
main { position: relative; max-width: 1000px; margin: 0 auto; padding: 24px; border-top: 2px solid var(--amber); }
header { display: flex; justify-content: space-between; align-items: end; gap: 18px; border-bottom: 2px solid var(--line-strong); padding-bottom: 16px; }
h1, h2, .eyebrow, .source { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
h1 { margin: 0; color: var(--text); font-size: 22px; font-weight: 700; overflow-wrap: anywhere; text-transform: uppercase; }
h2 { margin: 0; font-size: 14px; font-weight: 650; }
.eyebrow { margin: 0 0 6px; color: var(--amber); font-size: 11px; letter-spacing: .15em; text-transform: uppercase; }
.toolbar { display: flex; gap: 6px; flex-wrap: wrap; }
button, select { min-height: 30px; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: inherit; cursor: pointer; }
button:hover, button.active, select:hover { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.tag-list { display: inline-flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0 8px; vertical-align: middle; }
.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); text-align: left; }
.cards { display: grid; gap: 12px; margin-top: 20px; }
.card { border: 2px solid var(--line); background: var(--panel); padding: 14px; cursor: pointer; }
.card:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }
.card-header { display: block; }
.card-title { margin: 0; color: var(--cyan); font-size: 16px; overflow-wrap: anywhere; }
.source { color: var(--muted); font-size: 11px; margin-top: 5px; overflow-wrap: anywhere; }
.markdown { margin: 14px 0 0; padding: 12px; overflow-x: auto; border: 2px solid var(--line); border-left: 4px solid var(--amber); background: var(--panel-deep); color: var(--text); white-space: pre-wrap; font: 12px/1.55 var(--vscode-editor-font-family, ui-monospace, monospace); }
.rendered { margin-top: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.rendered :first-child { margin-top: 0; }
.rendered :last-child { margin-bottom: 0; }
.rendered code, .rendered pre { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.rendered pre { overflow-x: auto; padding: 10px; border: 2px solid var(--line); background: var(--panel-deep); }
.rendered a { color: var(--cyan); }
.empty { border: 2px dashed var(--line); padding: 20px; color: var(--muted); background: var(--panel-deep); margin-top: 20px; }
@media (max-width: 600px) { main { padding: 16px; } header { align-items: start; flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading tag...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;

  /** Escape headings and source paths before inserting snapshot data as HTML. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /** Rebuild the cards from the latest host snapshot without local duplication. */
  function render() {
    if (!state) return;
    const cards = state.sections.length ? state.sections.map(function (section) {
      const fileName = section.filePath.split('/').pop() || section.filePath;
      const content = section.rawContent ? (state.renderMode === 'html' ? '<div class="rendered">' + section.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(section.rawContent) + '</pre>') : '';
      const tags = section.tags.map(function (tag) {
        return '<button class="tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '">' + escapeHtml(tag.label) + '</button>';
      }).join('');
      return '<article class="card" tabindex="0" data-file-path="' + escapeHtml(section.filePath) + '" data-line="' + section.startLine + '"><div class="card-header"><h2 class="card-title">' + escapeHtml(section.heading) + (tags ? '<span class="tag-list" aria-label="Section tags">' + tags + '</span>' : '') + '</h2><div class="source">' + escapeHtml(fileName) + ' / line ' + section.startLine + '</div></div>' + content + '</article>';
    }).join('') : '<div class="empty">No sections currently carry this tag.</div>';
    document.getElementById('app').innerHTML = '<header><div><p class="eyebrow">DECKARD / TAG OVERVIEW</p><h1>' + escapeHtml(state.tag.label) + ' Overview</h1></div><div class="toolbar" role="group" aria-label="Tag entry view controls"><select data-action="set-sort" aria-label="Sort tag entries"><option value="alphabetical" ' + (state.sortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="created" ' + (state.sortMode === 'created' ? 'selected' : '') + '>Newest created</option><option value="updated" ' + (state.sortMode === 'updated' ? 'selected' : '') + '>Recently updated</option><option value="access" ' + (state.sortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select><button class="' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown">Source</button><button class="' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html">Rendered</button></div></header><div class="cards">' + cards + '</div>';
  }

  document.addEventListener('click', function (event) {
    const target = event.target.closest('[data-action]');
    if (target) {
      if (target.dataset.action === 'set-mode') vscode.postMessage({ type: 'setRenderMode', mode: target.dataset.mode });
      if (target.dataset.action === 'open-source') vscode.postMessage({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      if (target.dataset.action === 'open-tag') vscode.postMessage({ type: 'openTag', tagKey: target.dataset.tagKey });
      return;
    }
    const card = event.target.closest('.card');
    if (card) vscode.postMessage({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-action]')) return;
    const card = event.target.closest('.card');
    if (card) {
      event.preventDefault();
      vscode.postMessage({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
    }
  });
  document.addEventListener('change', function (event) {
    const target = event.target;
    if (target.dataset.action === 'set-sort') vscode.postMessage({ type: 'setTagOverviewSort', mode: target.value });
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; vscode.setState({ tagKey: state.tag.key }); render(); }
  });
}());
</script>
</body>
</html>`;
}

/**
 * Creates a per-webview CSP nonce for the overview's inline style and script.
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
