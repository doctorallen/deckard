import * as vscode from 'vscode';

import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds the tag-overview webview and its source/rendered view controls.
 *
 * The host supplies already-projected card data, while this layer only escapes
 * source text and posts user intent back across the webview boundary.
 */
export function getTagOverviewHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
): string {
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
.overview-title-filter { color: var(--text); }
.overview-title-joiner { color: var(--amber); font-size: .72em; font-weight: 400; }
.overview-tag-link.overview-tag-link {
  min-height: 0;
  margin: 0;
  border: 0;
  border-bottom: 1px dotted currentColor;
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-align: inherit;
  text-decoration: none;
  vertical-align: baseline;
  cursor: pointer;
  clip-path: none;
}
.overview-tag-link.overview-tag-link:hover, .overview-tag-link.overview-tag-link:focus-visible {
  border-color: var(--cyan);
  background: transparent;
  color: var(--cyan);
  transform: none;
  box-shadow: none;
}
h2 { margin: 0; font-size: 14px; font-weight: 650; }
.eyebrow { margin: 0 0 6px; color: var(--amber); font-size: 11px; letter-spacing: .15em; text-transform: uppercase; }
.toolbar { display: flex; gap: 6px; flex-wrap: wrap; }
button, select { min-height: 30px; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: inherit; cursor: pointer; }
button:hover, button.active, select:hover { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.toolbar-toggle { display: inline-grid; width: 30px; min-height: 30px; place-items: center; padding: 5px; }
.toolbar-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.toolbar-toggle-group { display: inline-flex; }
.toolbar-toggle-group .toolbar-toggle + .toolbar-toggle { margin-left: -2px; }
.toolbar-toggle-group .toolbar-toggle:first-child { border-radius: 2px 0 0 2px; }
.toolbar-toggle-group .toolbar-toggle:last-child { border-radius: 0 2px 2px 0; }
.toolbar-toggle-group .toolbar-toggle.active { position: relative; z-index: 1; }
.overview-tabs { display: flex; gap: 6px; margin-top: 20px; border-bottom: 2px solid var(--line); padding-bottom: 8px; }
.overview-tabs button { border-bottom-color: var(--line); }
.overview-tab-panel { margin-top: 12px; }
.overview-tab-panel[hidden] { display: none; }
.overview-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; margin-top: 20px; }
.overview-pane { min-width: 0; }
.overview-pane-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.overview-pane-heading { margin: 0; color: var(--text); font-size: 14px; font-weight: 650; text-transform: uppercase; }
.overview-pane .cards, .overview-pane .task-summary { margin-top: 12px; }
.task-filter-toggle { display: inline-flex; }
.task-filter-toggle button + button { margin-left: -2px; }
.task-filter-toggle button:first-child { border-radius: 2px 0 0 2px; }
.task-filter-toggle button:last-child { border-radius: 0 2px 2px 0; }
.task-filter-toggle button.active { position: relative; z-index: 1; }
.task-filter-toggle button { display: inline-grid; width: 30px; place-items: center; padding: 5px; }
.task-filter-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.tag-list { display: inline-flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0 8px; vertical-align: middle; }
.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); font-size: 11px; text-align: left; }
.inline-tag { min-height: 24px; margin-left: 6px; padding: 2px 6px; font-size: .78em; vertical-align: 1px; }
.relationship-workspace { margin-top: 16px; overflow: hidden; border: 2px solid var(--line); background: var(--panel-deep); }
.relationship-workspace-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px; border-bottom: 2px solid var(--line); }
.relationship-workspace-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.relationship-heading { margin: 0; color: var(--amber); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.relationship-summary { color: var(--muted); font-size: 11px; }
.relationship-view-switch { display: inline-flex; }
.relationship-view-switch button + button { margin-left: -2px; }
.relationship-view-switch button:first-child { border-radius: 2px 0 0 2px; }
.relationship-view-switch button:last-child { border-radius: 0 2px 2px 0; }
.relationship-view-switch button.active { position: relative; z-index: 1; }
.relationship-view-panel { padding: 12px; }
.relationship-view-panel[hidden] { display: none; }
.relationship-tree { display: grid; gap: 12px; }
.relationship-tree-root { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; border: 2px solid var(--cyan); background: var(--panel); padding: 10px; }
.relationship-tree-root-label { color: var(--muted); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.relationship-tree-root .tag-open { border-color: var(--cyan); color: var(--text); }
.relationship-tree-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.relationship-tree-column { min-width: 0; border: 2px solid var(--line); background: var(--panel); padding: 10px; }
.relationship-tree-column-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 0 8px; color: var(--amber); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.relationship-tree-column-count { color: var(--muted); font-size: 10px; letter-spacing: normal; }
.relationship-tree-group { border-top: 1px solid var(--line); }
.relationship-tree-group:first-child { border-top: 0; }
.relationship-tree-group summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 2px; color: var(--text); cursor: pointer; font-size: 11px; font-weight: 650; list-style-position: inside; text-transform: uppercase; }
.relationship-tree-group summary::marker { color: var(--cyan); }
.relationship-tree-group summary:hover { color: var(--cyan); }
.relationship-tree-group-count { color: var(--muted); font-size: 10px; font-weight: 400; }
.relationship-tree-items { display: grid; gap: 6px; padding: 0 0 8px 18px; }
.relationship-tree-item { min-width: 0; }
.relationship-tree-item .tag-open { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relationship-tree-root .tag-open.relationship-tag, .relationship-tree-item .tag-open.relationship-tag {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  border: 0;
  border-left: 3px solid var(--cyan);
  border-radius: 0;
  background: transparent;
  color: var(--text);
  padding: 6px 8px;
  text-align: left;
  transform: none;
  clip-path: none;
}
.relationship-tree-root .tag-open.relationship-tag {
  width: auto;
  max-width: 100%;
  border: 2px solid var(--amber);
  border-left-width: 4px;
  background: var(--panel-deep);
}
.relationship-tree-root .tag-open.relationship-tag:hover, .relationship-tree-root .tag-open.relationship-tag:focus-visible, .relationship-tree-item .tag-open.relationship-tag:hover, .relationship-tree-item .tag-open.relationship-tag:focus-visible {
  border-color: var(--amber);
  background: var(--panel-raised);
  color: var(--text);
  transform: translateX(3px);
  box-shadow: none;
}
.relationship-empty { padding: 12px 2px 4px; color: var(--muted); font-size: 11px; }
.relationship-graph-shell { overflow: auto; border: 2px solid var(--line); background: var(--panel); }
.relationship-graph { display: block; min-width: 760px; }
.relationship-edge { stroke: var(--line-strong); stroke-width: 1.5; opacity: .75; }
.relationship-node { cursor: pointer; outline: none; }
.relationship-node rect { fill: var(--panel-deep); stroke: var(--cyan); stroke-width: 1.5; }
.relationship-node text { fill: var(--text); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); pointer-events: none; }
.relationship-node:hover rect, .relationship-node:focus rect { fill: var(--panel-raised); stroke: var(--amber); stroke-width: 2; }
.relationship-node:hover text, .relationship-node:focus text { fill: var(--amber); }
.relationship-root-node rect { fill: var(--panel-raised); stroke: var(--amber); stroke-width: 2; }
.relationship-root-node text { fill: var(--text); font-weight: 700; }
.relationship-graph-label { fill: var(--muted); font: 10px var(--vscode-editor-font-family, ui-monospace, monospace); letter-spacing: .12em; text-transform: uppercase; }
.relationship-graph-caption { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
.relationship-tag { display: inline-flex; align-items: center; gap: 6px; }
.tag-open.relationship-tag, .tag-open.relationship-tag:hover, .tag-open.relationship-tag:focus-visible { color: var(--text); }
.relationship-count { color: var(--muted); font-size: 10px; }
.tag-context-menu { position: fixed; z-index: 20; min-width: 150px; padding: 4px; border: 2px solid var(--amber); background: var(--panel-raised); box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
.tag-context-menu[hidden] { display: none; }
.tag-context-menu button { display: block; width: 100%; border: 0; padding: 8px 9px; text-align: left; text-transform: none; }
.cards { display: grid; gap: 12px; margin-top: 20px; }
.title-filter-clear { min-height: 24px; margin-top: 8px; padding: 2px 6px; font-size: 10px; }
.card { border: 2px solid var(--line); background: var(--panel); padding: 14px; cursor: pointer; }
.card:hover { border-color: var(--amber); }
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
.entity-meta { margin-top: 8px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.task-summary { display: grid; gap: 7px; }
.task { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: start; border: 2px solid var(--line); background: var(--panel); padding: 10px; cursor: pointer; }
.task:hover { border-color: var(--amber); }
.task input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--green); }
.task-title { color: var(--cyan); overflow-wrap: anywhere; }
.task-title a { color: var(--cyan); }
.task.completed .task-title { color: var(--muted); text-decoration: line-through; }
.empty { border: 2px dashed var(--line); padding: 20px; color: var(--muted); background: var(--panel-deep); margin-top: 20px; }
@media (max-width: 900px) { .relationship-tree-columns { grid-template-columns: 1fr; } }
@media (max-width: 700px) { main { padding: 16px; } header { align-items: start; flex-direction: column; } .overview-split { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading tag...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  let activeTab = 'notes';
  let relationshipView = 'tree';
  let tagContextMenu;
  let tagContextKey;

  /** Escape headings and source paths before inserting snapshot data as HTML. */
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /** Use familiar list and checkbox icons without losing accessible labels. */
  function taskFilterIcon(filter) {
    if (filter === 'all') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 4h8M5 8h8M5 12h8"/><circle cx="2.5" cy="4" r=".5"/><circle cx="2.5" cy="8" r=".5"/><circle cx="2.5" cy="12" r=".5"/></svg>';
    if (filter === 'active') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';
    return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/><path d="m5.5 8 1.7 1.7 3.3-3.3"/></svg>';
  }

  /** Give built-in and user-created namespaces the same readable title form. */
  function formatEntityTitle(kind, name) {
    function formatPart(value) {
      return String(value).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, function (character) { return character.toUpperCase(); });
    }
    return formatPart(kind) + ': ' + formatPart(name);
  }

  /** Formats a filtered tag like the entity title shown beside it. */
  function formatTagReferenceTitle(tag) {
    const key = String(tag.key || '').replace(/^[@#]/, '');
    const separator = key.indexOf('/');
    if (separator > 0) {
      return formatEntityTitle(key.slice(0, separator), key.slice(separator + 1));
    }
    return String(tag.label || key);
  }

  /** Render a title or metadata tag as a direct overview link. */
  function renderOverviewTagLink(tag, text) {
    return '<button class="overview-tag-link" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + escapeHtml(text) + '</button>';
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

  /** Replace source tag tokens with buttons while preserving their position. */
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
      rendered += tag
        ? '<button class="tag-open inline-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + escapeHtml(tag.label) + '</button>'
        : escapeHtml(match);
      offset = matchOffset + match.length;
      return match;
    });
    const trailingTags = references
      .filter(function (tag) { return !matchedKeys.has(tag.key); })
      .map(function (tag) {
        return '<button class="tag-open inline-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + escapeHtml(tag.label) + '</button>';
      })
      .join('');
    return rendered + escapeHtml(title.slice(offset)) + trailingTags;
  }

  /** Render one relationship as a keyboard-accessible tag navigation control. */
  function renderRelationshipTag(tag, count, direction, filterTagKey) {
    const countHtml = Number(count) > 1
      ? '<span class="relationship-count">x' + escapeHtml(count) + '</span>'
      : '';
    const label = direction === 'parent'
      ? 'Open parent tag '
      : direction === 'child'
        ? 'Open child tag '
        : direction === 'sibling'
          ? 'Open sibling tag '
          : 'Current tag ';
    const filterAttribute = filterTagKey
      ? ' data-filter-tag-key="' + escapeHtml(filterTagKey) + '"'
      : '';
    return '<button class="tag-open relationship-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '"' + filterAttribute + ' aria-label="' + escapeHtml(label + tag.label) + '"><span>' + escapeHtml(tag.label) + '</span>' + countHtml + '</button>';
  }

  /** Group relationship nodes by namespace so large trees remain scannable. */
  function groupRelationships(relationships, direction) {
    const groups = new Map();
    (relationships || []).forEach(function (relationship) {
      const tag = direction === 'parent'
        ? relationship.parent
        : direction === 'child'
          ? relationship.child
          : relationship.sibling;
      const key = String(tag.key || '').replace(/^[@#]/, '').split('/')[0] || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ tag: tag, count: relationship.count });
    });
    return Array.from(groups.entries()).sort(function (left, right) {
      return left[0].localeCompare(right[0], undefined, { sensitivity: 'base' });
    });
  }

  /** Render one collapsible namespace branch in the relationship tree. */
  function renderRelationshipTreeGroups(relationships, direction, filterTagKey) {
    const groups = groupRelationships(relationships, direction);
    if (!groups.length) {
      const heading = direction === 'parent'
        ? 'parent'
        : direction === 'child'
          ? 'child'
          : 'sibling';
      return '<div class="relationship-empty">No direct ' + heading + ' headings.</div>';
    }
    return groups.map(function (group) {
      const items = group[1].sort(function (left, right) {
        return left.tag.label.localeCompare(right.tag.label, undefined, { sensitivity: 'base' });
      });
      const namespaceLabel = group[0] === 'other' ? 'Other tags' : group[0].replace(/[-_]+/g, ' ');
      return '<details class="relationship-tree-group"><summary><span>' + escapeHtml(namespaceLabel) + '</span><span class="relationship-tree-group-count">' + items.length + '</span></summary><div class="relationship-tree-items">' + items.map(function (item) {
        return '<div class="relationship-tree-item">' + renderRelationshipTag(item.tag, item.count, direction, filterTagKey) + '</div>';
      }).join('') + '</div></details>';
    }).join('');
  }

  /** Render the compact, namespace-collapsible relationship tree. */
  function renderRelationshipTree(parentRelationships, childRelationships, siblingRelationships, rootTag) {
    return '<div class="relationship-tree"><div class="relationship-tree-root"><span class="relationship-tree-root-label">Focus</span>' + renderRelationshipTag(rootTag, 0, 'focus') + '</div><div class="relationship-tree-columns"><section class="relationship-tree-column" aria-labelledby="tree-parents-heading"><h3 id="tree-parents-heading" class="relationship-tree-column-heading"><span>Parents</span><span class="relationship-tree-column-count">' + parentRelationships.length + '</span></h3>' + renderRelationshipTreeGroups(parentRelationships, 'parent', rootTag.key) + '</section><section class="relationship-tree-column" aria-labelledby="tree-siblings-heading"><h3 id="tree-siblings-heading" class="relationship-tree-column-heading"><span>Siblings</span><span class="relationship-tree-column-count">' + siblingRelationships.length + '</span></h3>' + renderRelationshipTreeGroups(siblingRelationships, 'sibling', rootTag.key) + '</section><section class="relationship-tree-column" aria-labelledby="tree-children-heading"><h3 id="tree-children-heading" class="relationship-tree-column-heading"><span>Children</span><span class="relationship-tree-column-count">' + childRelationships.length + '</span></h3>' + renderRelationshipTreeGroups(childRelationships, 'child', rootTag.key) + '</section></div></div>';
  }

  /** Keep graph labels readable while the full value remains available to assistive text. */
  function shortenGraphLabel(label) {
    const value = String(label);
    return value.length > 24 ? value.slice(0, 21) + '...' : value;
  }

  /** Render one SVG node and its edge to the selected tag. */
  function renderGraphNode(item, direction, column, row, startX, rootX, rootY, nodeWidth, nodeHeight, columnGap, filterTagKey, nodeStartY) {
    const x = startX + column * (nodeWidth + columnGap);
    const y = (nodeStartY || 62) + row * 42;
    const node = item.tag;
    const centerX = x + nodeWidth / 2;
    const centerY = y + nodeHeight / 2;
    const edgeX = direction === 'parent'
      ? x + nodeWidth
      : direction === 'child'
        ? x
        : centerX;
    const rootEdgeX = direction === 'parent'
      ? rootX - 112
      : direction === 'child'
        ? rootX + 112
        : rootX;
    const rootEdgeY = direction === 'sibling' ? rootY + 15 : rootY;
    const edgeY = direction === 'sibling' ? y : centerY;
    const edge = '<line class="relationship-edge" x1="' + rootEdgeX + '" y1="' + rootEdgeY + '" x2="' + edgeX + '" y2="' + edgeY + '"></line>';
    const count = Number(item.count) > 1 ? ' x' + item.count : '';
    const label = shortenGraphLabel(node.label) + count;
    const ariaLabel = (direction === 'parent'
      ? 'Open parent tag '
      : direction === 'child'
        ? 'Open child tag '
        : 'Open sibling tag ') + node.label + (count ? ', ' + item.count + ' relationships' : '');
    const filterAttribute = filterTagKey
      ? ' data-filter-tag-key="' + escapeHtml(filterTagKey) + '"'
      : '';
    const graphNode = '<g class="relationship-node" data-action="open-tag" data-tag-key="' + escapeHtml(node.key) + '"' + filterAttribute + ' role="button" tabindex="0" aria-label="' + escapeHtml(ariaLabel) + '"><title>' + escapeHtml(ariaLabel) + '</title><rect x="' + x + '" y="' + y + '" width="' + nodeWidth + '" height="' + nodeHeight + '" rx="2"></rect><text x="' + centerX + '" y="' + (centerY + 4) + '" text-anchor="middle">' + escapeHtml(label) + '</text></g>';
    return { edge: edge, node: graphNode };
  }

  /** Render a layered SVG graph with parents on the left and children on the right. */
  function renderRelationshipGraph(parentRelationships, childRelationships, siblingRelationships, rootTag) {
    const nodeWidth = 190;
    const nodeHeight = 30;
    const columnGap = 20;
    const maxRows = 12;
    const parentColumns = Math.max(1, Math.ceil(parentRelationships.length / maxRows));
    const childColumns = Math.max(1, Math.ceil(childRelationships.length / maxRows));
    const parentWidth = parentColumns * nodeWidth + (parentColumns - 1) * columnGap;
    const childWidth = childColumns * nodeWidth + (childColumns - 1) * columnGap;
    const rootWidth = 224;
    const sideGap = 72;
    const leftPadding = 36;
    const siblingColumns = Math.min(4, Math.max(1, siblingRelationships.length));
    const siblingWidth = siblingRelationships.length
      ? siblingColumns * nodeWidth + (siblingColumns - 1) * columnGap
      : 0;
    const width = Math.max(
      leftPadding * 2 + parentWidth + sideGap + rootWidth + sideGap + childWidth,
      leftPadding * 2 + siblingWidth,
    );
    const parentRows = parentRelationships.length ? Math.min(maxRows, Math.ceil(parentRelationships.length / parentColumns)) : 1;
    const childRows = childRelationships.length ? Math.min(maxRows, Math.ceil(childRelationships.length / childColumns)) : 1;
    const siblingRows = siblingRelationships.length ? Math.ceil(siblingRelationships.length / siblingColumns) : 0;
    const rowCount = Math.max(parentRows, childRows);
    const height = Math.max(260, 124 + rowCount * 42 + (siblingRows ? siblingRows * 42 + 48 : 0));
    const rootX = leftPadding + parentWidth + sideGap + rootWidth / 2;
    const rootY = siblingRows ? 62 + rowCount * 21 : height / 2;
    const childStartX = leftPadding + parentWidth + sideGap + rootWidth + sideGap;
    const siblingStartX = Math.max(leftPadding, rootX - siblingWidth / 2);
    const siblingStartY = rootY + 72;
    const parents = [];
    const children = [];
    parentRelationships.forEach(function (relationship, index) {
      const column = Math.floor(index / maxRows);
      const row = index % maxRows;
      parents.push(renderGraphNode({ tag: relationship.parent, count: relationship.count }, 'parent', column, row, leftPadding, rootX, rootY, nodeWidth, nodeHeight, columnGap, rootTag.key));
    });
    childRelationships.forEach(function (relationship, index) {
      const column = Math.floor(index / maxRows);
      const row = index % maxRows;
      children.push(renderGraphNode({ tag: relationship.child, count: relationship.count }, 'child', column, row, childStartX, rootX, rootY, nodeWidth, nodeHeight, columnGap, rootTag.key));
    });
    const siblings = [];
    siblingRelationships.forEach(function (relationship, index) {
      const column = index % siblingColumns;
      const row = Math.floor(index / siblingColumns);
      siblings.push(renderGraphNode({ tag: relationship.sibling, count: relationship.count }, 'sibling', column, row, siblingStartX, rootX, rootY, nodeWidth, nodeHeight, columnGap, rootTag.key, siblingStartY));
    });
    const edges = parents.concat(children, siblings).map(function (item) { return item.edge; }).join('');
    const nodes = parents.concat(children, siblings).map(function (item) { return item.node; }).join('');
    const rootLeft = rootX - rootWidth / 2;
    const rootTop = rootY - nodeHeight / 2;
    return '<div class="relationship-graph-shell"><svg class="relationship-graph" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Layered relationship graph for ' + escapeHtml(rootTag.label) + '"><text class="relationship-graph-label" x="' + (leftPadding + parentWidth / 2) + '" y="24" text-anchor="middle">Parents</text><text class="relationship-graph-label" x="' + rootX + '" y="24" text-anchor="middle">Focus</text><text class="relationship-graph-label" x="' + (childStartX + childWidth / 2) + '" y="24" text-anchor="middle">Children</text>' + (siblingRelationships.length ? '<text class="relationship-graph-label" x="' + (siblingStartX + siblingWidth / 2) + '" y="' + (siblingStartY - 28) + '" text-anchor="middle">Siblings</text>' : '') + edges + '<g class="relationship-root-node" data-tag-key="' + escapeHtml(rootTag.key) + '"><rect x="' + rootLeft + '" y="' + rootTop + '" width="' + rootWidth + '" height="' + nodeHeight + '" rx="2"></rect><text x="' + rootX + '" y="' + (rootY + 4) + '" text-anchor="middle">' + escapeHtml(shortenGraphLabel(rootTag.label)) + '</text></g>' + nodes + '</svg></div><p class="relationship-graph-caption">Select a node to open its overview. Scroll horizontally when a namespace has many relationships.</p>';
  }

  /** Render both relationship modes behind a local view switch. */
  function renderRelationshipViews(parentRelationships, childRelationships, siblingRelationships, rootTag) {
    if (!parentRelationships.length && !childRelationships.length && !siblingRelationships.length) return '';
    const treeActive = relationshipView === 'tree';
    return '<section class="relationship-workspace" aria-labelledby="relationships-heading"><div class="relationship-workspace-header"><div class="relationship-workspace-title"><h2 id="relationships-heading" class="relationship-heading">Heading relationships</h2><span class="relationship-summary">' + (parentRelationships.length + childRelationships.length + siblingRelationships.length) + ' direct links</span></div><div class="relationship-view-switch" role="tablist" aria-label="Relationship view"><button class="' + (treeActive ? 'active' : '') + '" data-action="set-relationship-view" data-view="tree" role="tab" aria-selected="' + treeActive + '">Tree</button><button class="' + (!treeActive ? 'active' : '') + '" data-action="set-relationship-view" data-view="graph" role="tab" aria-selected="' + (!treeActive) + '">Graph</button></div></div><div class="relationship-view-panel"' + (treeActive ? '' : ' hidden') + ' role="tabpanel">' + renderRelationshipTree(parentRelationships, childRelationships, siblingRelationships, rootTag) + '</div><div class="relationship-view-panel"' + (!treeActive ? '' : ' hidden') + ' role="tabpanel">' + renderRelationshipGraph(parentRelationships, childRelationships, siblingRelationships, rootTag) + '</div></section>';
  }

  /** Rebuild the cards from the latest host snapshot without local duplication. */
  function render() {
    if (!state) return;
    closeTagContextMenu();
    const baseTitle = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : state.tag.label + ' Overview';
    const filterTitle = state.filterTag
      ? formatTagReferenceTitle(state.filterTag)
      : '';
    const focusReference = state.entity
      ? { key: state.entity.key, label: state.entity.label }
      : state.tag;
    const focusTitle = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : state.tag.label;
    const focusTitleHtml = renderOverviewTagLink(focusReference, focusTitle)
      + (state.entity ? '' : ' Overview');
    const titleHtml = filterTitle
      ? '<span class="overview-title-filter">' + renderOverviewTagLink(state.filterTag, filterTitle) + '</span><span class="overview-title-joiner"> AND </span>' + focusTitleHtml
      : focusTitleHtml;
    const titleAriaLabel = filterTitle
      ? filterTitle + ' and ' + baseTitle
      : baseTitle;
    const entityMeta = state.entity
      ? '<div class="entity-meta">' + (state.filterTag ? renderOverviewTagLink(state.filterTag, state.filterTag.label) + ' · ' : '') + renderOverviewTagLink(focusReference, state.entity.label) + ' · ' + (state.filterTag ? state.sections.length : state.entity.sectionIds.length + state.entity.filePaths.length) + ' note entries · ' + (state.filterTag ? state.tasks.length : state.entity.taskIds.length) + ' tasks</div>'
      : '';
    const filterContext = state.filterTag
      ? '<button class="tag-open title-filter-clear" data-action="open-tag" data-tag-key="' + escapeHtml(state.tag.key) + '" aria-label="Clear relationship filter">Clear filter</button>'
      : '';
    const cards = state.sections.length ? state.sections.map(function (section) {
      const fileName = section.filePath.split('/').pop() || section.filePath;
      const content = section.rawContent ? (state.renderMode === 'html' ? '<div class="rendered">' + section.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(section.rawContent) + '</pre>') : '';
      const titleHtml = state.tagTitleDisplayMode === 'inline'
        ? renderInlineTitle(section.heading, section.titleTags)
        : escapeHtml(section.heading);
      const tags = state.tagTitleDisplayMode === 'separate' ? section.tags.map(function (tag) {
        return '<button class="tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + escapeHtml(tag.label) + '</button>';
      }).join('') : '';
      return '<article class="card" tabindex="0" data-file-path="' + escapeHtml(section.filePath) + '" data-line="' + section.startLine + '"><div class="card-header"><h2 class="card-title">' + titleHtml + (tags ? '<span class="tag-list" aria-label="Section tags">' + tags + '</span>' : '') + '</h2><div class="source">' + escapeHtml(fileName) + ' / line ' + section.startLine + '</div></div>' + content + '</article>';
    }).join('') : '<div class="empty">' + (state.filterTag ? 'No sections currently carry both tags.' : 'No sections currently carry this tag.') + '</div>';
    const tasks = state.tasks.length ? '<div class="task-summary">' + state.tasks.map(function (item) {
      const task = item.task;
      return '<article class="task ' + (task.completed ? 'completed' : '') + '" tabindex="0" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '"><input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '"><div><div class="task-title">' + item.renderedTitle + '</div><div class="source">' + escapeHtml(item.fileName) + ' / line ' + task.lineNumber + '</div></div></article>';
    }).join('') + '</div>' : '<div class="empty">No tasks match this filter.</div>';
    const taskFilters = ['all', 'active', 'completed'].map(function (filter) {
      const label = filter === 'all' ? 'All tasks' : filter === 'active' ? 'Active tasks' : 'Completed tasks';
      return '<button class="' + (state.taskFilter === filter ? 'active' : '') + '" data-action="set-task-filter" data-filter="' + filter + '" aria-label="' + label + '" aria-pressed="' + (state.taskFilter === filter) + '" title="' + label + '">' + taskFilterIcon(filter) + '</button>';
    }).join('');
    const notesPane = '<section class="overview-pane" aria-labelledby="notes-heading"><h2 id="notes-heading" class="overview-pane-heading">Notes (' + state.sections.length + ')</h2><div class="cards">' + cards + '</div></section>';
    const tasksPane = '<section class="overview-pane" aria-labelledby="tasks-heading"><div class="overview-pane-header"><h2 id="tasks-heading" class="overview-pane-heading">Tasks (' + state.tasks.length + ')</h2><div class="task-filter-toggle" role="group" aria-label="Task status filter">' + taskFilters + '</div></div>' + tasks + '</section>';
    const layoutContent = state.layout === 'split'
      ? '<div class="overview-split">' + notesPane + tasksPane + '</div>'
      : '<div class="overview-tabs" role="tablist" aria-label="Tag overview content"><button class="' + (activeTab === 'notes' ? 'active' : '') + '" data-action="set-tab" data-tab="notes" role="tab" aria-selected="' + (activeTab === 'notes') + '">Notes (' + state.sections.length + ')</button><button class="' + (activeTab === 'tasks' ? 'active' : '') + '" data-action="set-tab" data-tab="tasks" role="tab" aria-selected="' + (activeTab === 'tasks') + '">Tasks (' + state.tasks.length + ')</button></div><div class="overview-tab-panel"' + (activeTab === 'notes' ? '' : ' hidden') + '>' + notesPane + '</div><div class="overview-tab-panel"' + (activeTab === 'tasks' ? '' : ' hidden') + '>' + tasksPane + '</div>';
    const relationships = state.entity
      ? ''
      : renderRelationshipViews(
        state.parentTags,
        state.childTags,
        state.siblingTags,
        state.tag,
      );
    document.getElementById('app').innerHTML = '<header><div><p class="eyebrow">DECKARD / ' + (state.entity ? 'ENTITY' : 'TAG') + ' OVERVIEW</p><h1 aria-label="' + escapeHtml(titleAriaLabel) + '">' + titleHtml + '</h1>' + entityMeta + filterContext + '</div><div class="toolbar" role="group" aria-label="Tag entry view controls"><div class="toolbar-toggle-group" role="group" aria-label="Content layout"><button class="toolbar-toggle ' + (state.layout === 'tabs' ? 'active' : '') + '" data-action="set-layout" data-layout="tabs" aria-label="Tabs layout" aria-pressed="' + (state.layout === 'tabs') + '" title="Tabs: switch between Notes and Tasks"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M5 2.5V6"/></svg></button><button class="toolbar-toggle ' + (state.layout === 'split' ? 'active' : '') + '" data-action="set-layout" data-layout="split" aria-label="Side-by-side layout" aria-pressed="' + (state.layout === 'split') + '" title="Side by side: Notes 60%, Tasks 40%"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M9 2v12"/></svg></button></div><select data-action="set-sort" aria-label="Sort tag entries"><option value="alphabetical" ' + (state.sortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="created" ' + (state.sortMode === 'created' ? 'selected' : '') + '>Newest created</option><option value="updated" ' + (state.sortMode === 'updated' ? 'selected' : '') + '>Recently updated</option><option value="access" ' + (state.sortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select><div class="toolbar-toggle-group" role="group" aria-label="Content format"><button class="toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 4-4 4 4 4M10 4l4 4-4 4"/></svg></button><button class="toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button></div></div></header>' + relationships + layoutContent;
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
      if (target.dataset.action === 'set-mode') vscode.postMessage({ type: 'setRenderMode', mode: target.dataset.mode });
      if (target.dataset.action === 'set-layout') vscode.postMessage({ type: 'setTagOverviewLayout', layout: target.dataset.layout });
      if (target.dataset.action === 'set-task-filter') vscode.postMessage({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (target.dataset.action === 'set-relationship-view') {
        relationshipView = target.dataset.view === 'graph' ? 'graph' : 'tree';
        render();
      }
      if (target.dataset.action === 'set-tab') {
        activeTab = target.dataset.tab;
        render();
      }
      if (target.dataset.action === 'open-source') vscode.postMessage({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      if (target.dataset.action === 'open-tag') {
        const message = { type: 'openTag', tagKey: target.dataset.tagKey };
        if (target.dataset.filterTagKey) message.filterTagKey = target.dataset.filterTagKey;
        vscode.postMessage(message);
      }
      return;
    }
    const card = event.target.closest('.card, .task');
    if (card) vscode.postMessage({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
  });
  document.addEventListener('contextmenu', function (event) {
    const target = event.target.closest('[data-tag-key]');
    if (target) openTagContextMenu(event, target);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && tagContextMenu && !tagContextMenu.hidden) {
      closeTagContextMenu();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const relationshipNode = event.target.closest('.relationship-node');
    if (relationshipNode) {
      event.preventDefault();
      const message = { type: 'openTag', tagKey: relationshipNode.dataset.tagKey };
      if (relationshipNode.dataset.filterTagKey) message.filterTagKey = relationshipNode.dataset.filterTagKey;
      vscode.postMessage(message);
      return;
    }
    if (event.target.closest('[data-action]')) return;
    const card = event.target.closest('.card, .task');
    if (card) {
      event.preventDefault();
      vscode.postMessage({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
    }
  });
  document.addEventListener('change', function (event) {
    const target = event.target;
    if (target.dataset.action === 'set-sort') vscode.postMessage({ type: 'setTagOverviewSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') vscode.postMessage({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; vscode.setState({ tagKey: state.tag.key, filterTagKey: state.filterTag && state.filterTag.key }); render(); }
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
