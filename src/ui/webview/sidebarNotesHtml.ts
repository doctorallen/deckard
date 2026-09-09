import * as vscode from 'vscode';

import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds the compact Related Notes webview from host-provided snapshots.
 *
 * Keeping the view state-driven lets the host choose between active-note and
 * active-tag contexts while this document remains a simple navigation surface.
 */
export function getSidebarNotesHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
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
main { width: 100%; padding: 12px; border-top: 2px solid var(--amber); }
h2, .eyebrow, .source, .match-count, .version { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
h2 { margin: 0; color: var(--cyan); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding-bottom: 8px; border-bottom: 2px solid var(--line-strong); }
.eyebrow { min-width: 0; flex: 1 1 auto; margin: 0; overflow: hidden; color: var(--amber); font-size: 10px; letter-spacing: .15em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.version { flex: 0 0 auto; color: var(--green); font-size: 10px; }
.active-file { margin-top: 12px; padding: 9px; border: 2px solid var(--line); border-left: 4px solid var(--amber); background: var(--panel); overflow-wrap: anywhere; }
.active-label, .section-label { color: var(--muted); font-size: 10px; text-transform: uppercase; }
.active-name { margin-top: 3px; }
.active-filter-tag { color: var(--cyan); font-weight: 700; }
.active-filter-joiner { color: var(--amber); font-weight: 700; }
.sidebar-toolbar { display: flex; flex: 0 0 auto; justify-content: flex-end; gap: 6px; }
.icon-button { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 5px; color: var(--text); }
.icon-button svg { width: 16px; height: 16px; display: block; fill: currentColor; }
.icon-button svg.outline-icon { fill: none; stroke: currentColor; }
.related-notes-sort-control { position: relative; display: block; margin-top: 10px; }
.related-notes-sort { width: 100%; min-height: 30px; margin: 0; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding-left: 29px; font: inherit; }
.related-notes-sort-icon { position: absolute; top: 50%; left: 8px; width: 14px; height: 14px; pointer-events: none; color: currentColor; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; transform: translateY(-50%); }
.related-notes-sort:hover { border-color: var(--amber); color: var(--amber); }
.tag-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
button { border: 2px solid var(--line); background: var(--panel-deep); color: var(--cyan); padding: 4px 6px; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
button:hover { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
button:focus-visible, .note:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.active-name .tag-open { max-width: 100%; min-height: 0; border: 0; background: transparent; color: inherit; padding: 0; text-transform: none; }
.active-name .tag-open:hover, .active-name .tag-open:focus-visible { border-color: transparent; background: transparent; color: var(--cyan-bright); }
.section-label { display: block; margin: 16px 0 7px; padding-left: 6px; border-left: 2px solid var(--amber); }
.note-list { display: grid; gap: 8px; }
.note { border: 2px solid var(--line); background: var(--panel); padding: 9px; cursor: pointer; }
.note:hover { border-color: var(--line-strong); }
.note-header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
.note-title { min-width: 0; overflow-wrap: anywhere; }
.inline-tag { display: inline-block; margin-left: 5px; padding: 1px 5px; border-width: 1px; color: var(--cyan); font-size: .85em; vertical-align: 1px; }
.match-count { flex: 0 0 auto; color: var(--green); font-size: 10px; }
.source { margin-top: 4px; color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.note .tag-list { margin-top: 7px; }
.note .tag-list button { color: var(--text); }
.sidebar-relationships { margin-top: 8px; overflow: hidden; border: 2px solid var(--line); background: var(--panel-deep); }
.sidebar-relationships-header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 7px 8px; border-bottom: 2px solid var(--line); }
.sidebar-relationships-title { color: var(--amber); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.sidebar-relationships-count { color: var(--muted); font: 10px var(--vscode-editor-font-family, ui-monospace, monospace); }
.sidebar-relationship-branch { border-bottom: 1px solid var(--line); background: var(--panel-deep); }
.sidebar-relationship-branch:last-child { border-bottom: 0; }
.sidebar-relationships summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text); cursor: pointer; list-style-position: inside; text-transform: uppercase; }
.sidebar-relationships summary::marker { color: var(--cyan); }
.sidebar-relationships summary:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; }
.sidebar-relationships .sidebar-relationship-branch > summary { padding: 7px 10px; border-left: 4px solid var(--amber); background: var(--panel-raised); color: var(--amber); font-size: 11px; font-weight: 750; letter-spacing: .08em; }
.sidebar-relationships .sidebar-relationship-branch > summary:hover, .sidebar-relationships .sidebar-relationship-branch > summary:focus-visible { background: var(--panel); color: var(--amber-bright); }
.sidebar-relationship-count { color: var(--muted); font: 10px var(--vscode-editor-font-family, ui-monospace, monospace); }
.sidebar-relationship-namespace { border-top: 1px solid var(--line); margin: 3px 0 0 10px; }
.sidebar-relationship-namespace > summary { padding: 5px 8px 5px 10px; border-left: 3px solid var(--cyan); background: var(--panel-deep); color: var(--cyan); font-size: 10px; font-weight: 650; letter-spacing: .06em; }
.sidebar-relationship-namespace > summary:hover, .sidebar-relationship-namespace > summary:focus-visible { background: var(--panel-raised); color: var(--cyan-bright); }
.sidebar-relationship-items { display: grid; gap: 3px; margin: 0 8px 5px 20px; padding: 3px 0 0 14px; border-left: 2px solid var(--cyan); }
.sidebar-relationship-items .tag-open { width: 100%; min-width: 0; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-relationships .tag-open.relationship-tag {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 27px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  border: 0;
  border-left: 3px solid var(--cyan);
  border-radius: 0;
  background: transparent;
  color: var(--text);
  padding: 4px 8px;
  text-align: left;
  transform: none;
  clip-path: none;
}
.sidebar-relationships .sidebar-relationship-items .tag-open.relationship-tag {
  border: 1px solid var(--line);
  border-left: 3px solid var(--cyan);
  background: var(--panel);
}
.sidebar-relationships .tag-open.relationship-tag:hover,
.sidebar-relationships .tag-open.relationship-tag:focus-visible {
  border-left-color: var(--amber);
  background: var(--panel-raised);
  color: var(--text);
  transform: translateX(3px);
  box-shadow: none;
}
.sidebar-relationships .sidebar-relationship-items .tag-open.relationship-tag:hover,
.sidebar-relationships .sidebar-relationship-items .tag-open.relationship-tag:focus-visible {
  border-color: var(--line-strong);
  border-left-color: var(--amber);
  background: var(--panel-raised);
}
.sidebar-relationships .sidebar-relationship-items .tag-open.relationship-tag > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-relationships .sidebar-relationship-items .sidebar-relationship-count { flex: 0 0 auto; }
.empty { margin-top: 12px; border: 2px dashed var(--line); padding: 14px 10px; color: var(--muted); background: var(--panel-deep); line-height: 1.45; }
.tag-context-menu { position: fixed; z-index: 20; min-width: 150px; padding: 4px; border: 2px solid var(--amber); background: var(--panel-raised); box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
.tag-context-menu[hidden] { display: none; }
.tag-context-menu button { display: block; width: 100%; border: 0; padding: 8px 9px; color: var(--text); text-align: left; text-transform: none; }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading related notes...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  let tagContextMenu;
  let tagContextKey;

  /** Escape note paths, titles, and labels before they become markup. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function closeTagContextMenu() {
    if (tagContextMenu) tagContextMenu.hidden = true;
    tagContextKey = undefined;
  }

  function openTagContextMenu(event, target) {
    const tagKey = target.dataset.tagKey;
    if (!tagKey) return;
    event.preventDefault();
    closeTagContextMenu();
    if (!tagContextMenu) {
      tagContextMenu = document.createElement('div');
      tagContextMenu.id = 'tag-context-menu';
      tagContextMenu.className = 'tag-context-menu';
      tagContextMenu.setAttribute('role', 'menu');
      document.body.appendChild(tagContextMenu);
    }
    tagContextKey = tagKey;
    tagContextMenu.innerHTML = '<button type="button" role="menuitem" data-context-action="rename-tag">Rename tag</button>';
    tagContextMenu.hidden = false;
    const bounds = tagContextMenu.getBoundingClientRect();
    tagContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
    tagContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
    tagContextMenu.querySelector('button').focus();
  }

  /** Render tag links through one delegated action shape for every sidebar state. */
  function renderTag(tag, extraClass) {
    return '<button class="' + (extraClass || '') + '" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + escapeHtml(tag.label) + '</button>';
  }

  function renderTags(tags, extraClass) {
    return tags.map(function (tag) {
      return renderTag(tag, extraClass);
    }).join('');
  }

  /** Render one relationship node for the narrow sidebar tree. */
  function renderSidebarRelationshipTag(tag, count, direction, filterTagKey) {
    const countHtml = Number(count) > 1
      ? '<span class="sidebar-relationship-count">x' + escapeHtml(count) + '</span>'
      : '';
    const label = direction === 'parent' ? 'Open parent tag ' : 'Open child tag ';
    const filterAttribute = filterTagKey
      ? ' data-filter-tag-key="' + escapeHtml(filterTagKey) + '"'
      : '';
    return '<button class="tag-open relationship-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '"' + filterAttribute + ' aria-label="' + escapeHtml(label + tag.label) + '"><span>' + escapeHtml(tag.label) + '</span>' + countHtml + '</button>';
  }

  /** Group sidebar relationship nodes by namespace before they are nested. */
  function groupSidebarRelationships(relationships, direction) {
    const groups = new Map();
    (relationships || []).forEach(function (relationship) {
      const tag = direction === 'parent' ? relationship.parent : relationship.child;
      const namespace = String(tag.key || '').replace(/^[@#]/, '').split('/')[0] || 'other';
      if (!groups.has(namespace)) groups.set(namespace, []);
      groups.get(namespace).push({ tag: tag, count: relationship.count });
    });
    return Array.from(groups.entries()).sort(function (left, right) {
      return left[0].localeCompare(right[0], undefined, { sensitivity: 'base' });
    });
  }

  /** Render namespace branches inside one parent or child branch. */
  function renderSidebarRelationshipGroups(relationships, direction, filterTagKey) {
    return groupSidebarRelationships(relationships, direction).map(function (group) {
      const items = group[1].sort(function (left, right) {
        return left.tag.label.localeCompare(right.tag.label, undefined, { sensitivity: 'base' });
      });
      const namespaceLabel = group[0] === 'other' ? 'Other tags' : group[0].replace(/[-_]+/g, ' ');
      return '<details class="sidebar-relationship-namespace"><summary><span>' + escapeHtml(namespaceLabel) + '</span><span class="sidebar-relationship-count">' + items.length + '</span></summary><div class="sidebar-relationship-items">' + items.map(function (item) {
        return renderSidebarRelationshipTag(item.tag, item.count, direction, filterTagKey);
      }).join('') + '</div></details>';
    }).join('');
  }

  /** Render a narrow, nested parent/child tree when a tag overview is active. */
  function renderSidebarRelationships(snapshot) {
    const relationships = snapshot.tagOverviewRelationships;
    if (!relationships || snapshot.tagOverviewFilter) return '';
    const parents = relationships.parentTags || [];
    const children = relationships.childTags || [];
    if (!parents.length && !children.length) return '';
    const branch = function (items, direction, heading) {
      if (!items.length) return '';
      return '<details class="sidebar-relationship-branch"><summary><span>' + heading + '</span><span class="sidebar-relationship-count">' + items.length + '</span></summary>' + renderSidebarRelationshipGroups(items, direction, snapshot.tagOverview.key) + '</details>';
    };
    return '<section class="sidebar-relationships" aria-label="Heading relationship tree"><div class="sidebar-relationships-header"><span class="sidebar-relationships-title">Relationship tree</span><span class="sidebar-relationships-count">' + (parents.length + children.length) + ' direct links</span></div>' + branch(parents, 'parent', 'Parents') + branch(children, 'child', 'Children') + '</section>';
  }

  /** Replace source tag tokens with buttons without changing the title text. */
  function renderInlineTitle(title, tags) {
    const references = tags || [];
    const labels = references.map(function (tag) { return tag.label; }).filter(Boolean).sort(function (left, right) { return right.length - left.length; });
    if (!labels.length) return escapeHtml(title);
    const pattern = new RegExp(labels.map(function (label) {
      return String(label).split('').map(function (character) {
        return '[]{}()|^$+*?.-'.indexOf(character) >= 0 || character === String.fromCharCode(92)
          ? String.fromCharCode(92) + character
          : character;
      }).join('');
    }).join('|'), 'g');
    let rendered = '';
    let offset = 0;
    const matchedKeys = new Set();
    title.replace(pattern, function (match, matchOffset) {
      rendered += escapeHtml(title.slice(offset, matchOffset));
      const tag = references.find(function (candidate) { return candidate.label === match; });
      if (tag) {
        matchedKeys.add(tag.key);
      }
      rendered += tag ? renderTag(tag, 'inline-tag') : escapeHtml(match);
      offset = matchOffset + match.length;
      return match;
    });
    const trailingTags = references
      .filter(function (tag) { return !matchedKeys.has(tag.key); })
      .map(function (tag) { return renderTag(tag, 'inline-tag'); })
      .join('');
    return rendered + escapeHtml(title.slice(offset)) + trailingTags;
  }

  /** Render explicit empty states so the sidebar explains why no notes appear. */
  function render() {
    if (!state) return;
    closeTagContextMenu();
    let content;
    if (state.state === 'noMarkdown') {
      content = '<div class="empty">Open a Markdown note to see related entries.</div>';
    } else if (state.state === 'noTags') {
      content = '<div class="empty">This note has no tags yet.</div>';
    } else if (state.state === 'noMatches') {
      content = state.tagOverview
        ? '<div class="empty">' + (state.tagOverviewFilter ? 'No notes currently carry both tags.' : 'No notes currently carry this tag.') + '</div>'
        : '<div class="empty">No other notes share its tags.</div>';
    } else {
      content = '<div class="note-list">' + state.notes.map(function (note) {
        const title = note.title || note.fileName || note.filePath;
        const titleHtml = state.tagTitleDisplayMode === 'inline'
          ? renderInlineTitle(title, note.titleTags)
          : escapeHtml(title);
        const fileName = note.fileName || note.filePath;
        const tags = state.tagTitleDisplayMode === 'separate'
          ? renderTags(note.matchedTags, 'matched-tag')
          : '';
        const matchCount = note.matchCount ? '<span class="match-count">' + note.matchCount + '/' + note.totalTagCount + '</span>' : '';
        return '<article class="note" tabindex="0" data-file-path="' + escapeHtml(note.filePath) + '" data-line="' + note.sourceLine + '"><div class="note-header"><h2 class="note-title">' + titleHtml + '</h2>' + matchCount + '</div><div class="source">' + escapeHtml(fileName) + ' / line ' + note.sourceLine + '</div><div class="tag-list" aria-label="Matching tags">' + tags + '</div></article>';
      }).join('') + '</div>';
    }
    const activeTags = state.activeTags.length ? '<div class="tag-list" aria-label="Active note tags">' + renderTags(state.activeTags, 'active-tag') + '</div>' : '';
    const tagOverviewName = state.tagOverviewFilter
      ? renderTag(state.tagOverview, 'active-filter-tag') + '<span class="active-filter-joiner"> AND </span>' + renderTag(state.tagOverviewFilter, 'active-filter-tag')
      : renderTag(state.tagOverview, 'active-filter-tag');
    const context = state.tagOverview
      ? '<div class="active-file"><div class="active-label">Tag overview</div><div class="active-name">' + tagOverviewName + '</div></div>'
      : (state.activeFileName ? '<div class="active-file"><div class="active-label">Current note</div><div class="active-name">' + escapeHtml(state.activeFileName) + '</div>' + activeTags + '</div>' : '');
    const relatedNotesSort = !state.tagOverview && state.relatedNotesSortMode
      ? '<span class="related-notes-sort-control"><select class="related-notes-sort" data-action="set-related-notes-sort" aria-label="Sort related notes"><option value="tags" ' + (state.relatedNotesSortMode === 'tags' ? 'selected' : '') + '>Most tags</option><option value="newest" ' + (state.relatedNotesSortMode === 'newest' ? 'selected' : '') + '>Newest</option><option value="oldest" ' + (state.relatedNotesSortMode === 'oldest' ? 'selected' : '') + '>Oldest</option><option value="access" ' + (state.relatedNotesSortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select><svg class="related-notes-sort-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg></span>'
      : '';
    const sectionLabel = state.tagOverview
      ? '<span class="section-label">Current notes</span>'
      : relatedNotesSort + (state.state === 'ready' ? '<span class="section-label">Shared tags</span>' : '');
    const relationshipTree = state.tagOverview ? renderSidebarRelationships(state) : '';
    document.getElementById('app').innerHTML = '<div class="sidebar-header"><p class="eyebrow">DECKARD / RELATED NOTES</p><span class="version">v${escapedExtensionVersion}</span><div class="sidebar-toolbar" role="toolbar" aria-label="Deckard actions"><button class="icon-button" data-action="open-help" aria-label="Open Help" title="Open Help"><svg class="outline-icon" viewBox="0 0 16 16" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M6.5 6.2a1.7 1.7 0 1 1 2.6 1.5c-.8.5-1.1.9-1.1 1.8M8 11.7h.01"/></svg></button><button class="icon-button" data-action="open-dashboard" aria-label="Open Dashboard" title="Open Dashboard"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2h5v5H2zm7 0h5v3H9zm0 5h5v7H9zM2 9h5v5H2z"/></svg></button><button class="icon-button" data-action="create-daily-note" aria-label="Create Daily Note" title="Create Daily Note"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h1v2h8V2h1v2h1v10H2V4h1zm0 4v7h10V6zm4 1h1v2h2v1H8v2H7v-2H5V9h2z"/></svg></button></div></div>' + context + relationshipTree + sectionLabel + content;
  }

  document.addEventListener('click', function (event) {
    const contextAction = event.target.closest('#tag-context-menu [data-context-action]');
    if (contextAction) {
      const tagKey = tagContextKey;
      closeTagContextMenu();
      if (contextAction.dataset.contextAction === 'rename-tag' && tagKey) {
        vscode.postMessage({ type: 'renameTag', tagKey: tagKey });
      }
      return;
    }
    if (tagContextMenu && !event.target.closest('#tag-context-menu')) {
      closeTagContextMenu();
    }
    const target = event.target.closest('[data-action]');
    if (target) {
      if (target.dataset.action === 'open-tag') {
        const message = { type: 'openTag', tagKey: target.dataset.tagKey };
        if (target.dataset.filterTagKey) message.filterTagKey = target.dataset.filterTagKey;
        vscode.postMessage(message);
      }
      if (target.dataset.action === 'open-help') vscode.postMessage({ type: 'openHelp' });
      if (target.dataset.action === 'open-dashboard') vscode.postMessage({ type: 'openDashboard' });
      if (target.dataset.action === 'create-daily-note') vscode.postMessage({ type: 'createDailyNote' });
      return;
    }
    const note = event.target.closest('.note');
    if (note) vscode.postMessage({ type: 'openSource', filePath: note.dataset.filePath, line: Number(note.dataset.line) });
  });
  document.addEventListener('contextmenu', function (event) {
    const target = event.target.closest('[data-action="open-tag"][data-tag-key]');
    if (target) openTagContextMenu(event, target);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && tagContextMenu && !tagContextMenu.hidden) {
      closeTagContextMenu();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-action]')) return;
    const note = event.target.closest('.note');
    if (note) {
      event.preventDefault();
      vscode.postMessage({ type: 'openSource', filePath: note.dataset.filePath, line: Number(note.dataset.line) });
    }
  });
  document.addEventListener('change', function (event) {
    const target = event.target;
    if (target.dataset.action === 'set-related-notes-sort') {
      vscode.postMessage({ type: 'setRelatedNotesSort', mode: target.value });
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
