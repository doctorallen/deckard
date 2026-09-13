import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
} from './components';
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
<style nonce="${nonce}">${getBaseCss()}
header > .toolbar { padding-right: 36px; }
header > .toolbar .view-options { position: absolute; top: 0; right: 0; }
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
.overview-eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.saved-view-name { margin: 0 0 8px; color: var(--cyan); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.saved-view-name-label { color: var(--muted); letter-spacing: .12em; text-transform: uppercase; }
.overview-search { width: min(250px, 44vw); border-color: var(--line-strong); }
.save-filter { border-color: var(--amber); color: var(--amber); }
.overview-tabs-row { margin-top: 20px; padding-bottom: 8px; border-bottom: 2px solid var(--line); }
.overview-tabs button { border-bottom-color: var(--line); }
.overview-tab-panel { margin-top: 12px; }
.overview-tab-panel[hidden] { display: none; }
.overview-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; margin-top: 20px; }
.overview-pane { min-width: 0; }
.overview-pane-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.overview-pane-controls { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.overview-pane-controls .overview-search { min-width: 0; flex: 1 1 160px; }
.overview-pane-heading { margin: 0; color: var(--text); font-size: 14px; font-weight: 650; text-transform: uppercase; }
.overview-pane .cards, .overview-pane .task-summary { margin-top: 12px; }
.relationship-workspace { margin-top: 16px; overflow: hidden; border: 2px solid var(--line); background: var(--panel-deep); }
.relationship-workspace-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px; border-bottom: 2px solid var(--line); }
.relationship-workspace-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.relationship-heading { margin: 0; color: var(--amber); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.relationship-summary { color: var(--muted); font-size: 11px; }
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
.query-workspace { margin-top: 16px; border: 2px solid var(--line); background: var(--panel-deep); }
.query-workspace[hidden] { display: none; }
.query-bar-row { display: flex; align-items: stretch; gap: 6px; padding: 10px; }
.query-input { flex: 1 1 auto; min-width: 0; min-height: 32px; border: 2px solid var(--line-strong); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: 12px var(--vscode-editor-font-family, ui-monospace, monospace); }
.query-input:focus { border-color: var(--amber); outline: none; }
.query-input:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.query-input.invalid { border-color: #FF5555; }
.query-input-shell { position: relative; flex: 1 1 auto; min-width: 0; display: flex; }
.query-suggestions { position: absolute; z-index: 12; top: calc(100% + 2px); left: 0; right: 0; max-height: 220px; overflow-y: auto; border: 2px solid var(--amber); background: var(--panel-raised); }
.query-suggestions[hidden] { display: none; }
.query-suggestion { display: flex; width: 100%; align-items: baseline; justify-content: space-between; gap: 10px; border: 0; background: transparent; padding: 6px 9px; text-align: left; font: 12px var(--vscode-editor-font-family, ui-monospace, monospace); }
.query-suggestion:hover, .query-suggestion.active { background: var(--panel-deep); color: var(--amber); }
.query-suggestion-detail { color: var(--muted); font-size: 10px; }
.query-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 0 10px 10px; color: var(--muted); font-size: 11px; }
.query-error { color: #FF8080; font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); }
.query-hint { color: var(--muted); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); }
.query-builder { border-top: 2px solid var(--line); padding: 10px; }
.query-builder[hidden] { display: none; }
.query-builder-group { border: 2px solid var(--line); background: var(--panel); padding: 10px; }
.query-builder-group + .query-builder-or { display: block; margin: 8px 0; color: var(--amber); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); letter-spacing: .12em; text-align: center; text-transform: uppercase; }
.query-builder-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.query-builder-row + .query-builder-row { margin-top: 6px; }
.query-builder-row select, .query-builder-row input { min-height: 28px; font-size: 12px; }
.query-builder-row .query-builder-operator { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.query-builder-row .query-builder-value-shell { flex: 1 1 160px; min-width: 0; }
.query-builder-row .query-builder-value { width: 100%; min-width: 0; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding: 4px 8px; font: 12px var(--vscode-editor-font-family, ui-monospace, monospace); }
.query-builder-row .query-builder-value:focus { border-color: var(--amber); outline: none; }
.query-builder-and { color: var(--muted); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; min-width: 30px; }
.query-builder-remove { min-height: 28px; padding: 4px 8px; }
.query-builder-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.query-builder-actions button { font-size: 11px; }
.query-builder-readonly { flex: 1 1 auto; color: var(--muted); font: 12px var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.query-builder-note { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
.query-summary { color: var(--cyan); font: 12px var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.overview-filter-tag { display: inline-flex; align-items: baseline; gap: 5px; }
.title-filter-remove { min-height: 18px; border: 1px solid var(--line-strong); border-radius: 50%; background: transparent; color: var(--muted); padding: 0 4px; font-size: 12px; line-height: 16px; vertical-align: middle; }
.title-filter-remove:hover, .title-filter-remove:focus-visible { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
.card-header { display: block; }
.entity-meta { margin-top: 8px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.hub { margin-top: 20px; padding: 14px; border: var(--edge) solid var(--line); border-left: 4px solid var(--amber); background: var(--panel); }
.hub-header, .hub-empty { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hub > summary { cursor: pointer; list-style: none; }
.hub > summary::-webkit-details-marker { display: none; }
.hub > summary:focus-visible { outline: var(--edge) solid var(--cyan); outline-offset: 2px; }
.hub-title { display: inline-flex; align-items: center; gap: 8px; }
.hub-toggle { width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 6px solid var(--amber); transition: transform 120ms ease; }
.hub[open] .hub-toggle { transform: rotate(90deg); }
.hub-empty { color: var(--muted); }
.hub-properties { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; margin: 10px 0 0; }
.hub-properties div { display: flex; align-items: baseline; gap: 6px; }
.hub-properties dt { color: var(--muted); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; }
.hub-properties dd { margin: 0; }
.hub .markdown, .hub .rendered { margin: 12px 0 0; }
.hub-note { margin: 10px 0 0; color: var(--muted); }
@media (max-width: 900px) { .relationship-tree-columns { grid-template-columns: 1fr; } }
@media (max-width: 700px) { main { padding: 16px; } header { align-items: start; flex-direction: column; } header > .toolbar { width: 100%; padding-right: 0; } .overview-split { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }

/* The amber rule above the page, and the containing block the gear is
   positioned against. */
main { border-top: 2px solid var(--amber); }
header { position: relative; }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app" aria-live="polite"><div class="empty">Loading tag...</div></main>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
  let state;
  let activeTab = 'notes';
  let relationshipView = 'tree';
  let noteSearchQuery = '';
  let taskSearchQuery = '';
  /** Local edit buffer for the query bar; the host owns the applied query. */
  let queryDraft;
  let queryPanelOpen = false;
  let builderOpen = false;
  let suggestionItems = [];
  let suggestionIndex = -1;
  /** Which input the completion list is attached to, if any. */
  let suggestionHostKey;
  /** The partial text the completion list is filtering on. */
  let suggestionToken = '';
  let restoreQueryFocus = false;
  /**
   * Local builder rows.
   *
   * The builder needs to hold a row the author has not finished writing, and
   * an incomplete row contributes nothing to the query text, so the rows
   * cannot come straight from the host's parse. The draft owns them until
   * they turn into text the host can parse.
   */
  let builderDraft;
  /** Applied query the draft was last reconciled with. */
  let builderSourceText;
  /** Value input to focus once the next render settles. */
  let pendingBuilderFocus;

  const QUERY_FIELD_OPERATORS = {
    tag: ['eq', 'neq'],
    text: ['contains', 'notContains', 'eq', 'neq'],
    task: ['eq', 'neq'],
    due: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    scheduled: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    start: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    done: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    priority: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    kind: ['eq', 'neq'],
    file: ['eq', 'neq', 'contains', 'notContains'],
    path: ['eq', 'neq', 'contains', 'notContains'],
    created: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    updated: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  };
  const QUERY_FIELDS = Object.keys(QUERY_FIELD_OPERATORS);
  const OPERATOR_LABELS = {
    eq: '=',
    neq: '!=',
    contains: '~',
    notContains: '!~',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };
  /** Hover text, since a symbol alone does not say what it compares. */
  const OPERATOR_DESCRIPTIONS = {
    eq: 'is',
    neq: 'is not',
    contains: 'contains',
    notContains: 'does not contain',
    gt: 'after',
    gte: 'on or after',
    lt: 'before',
    lte: 'on or before',
  };
  /** The text field matches whole words with = and any substring with ~. */
  const TEXT_OPERATOR_DESCRIPTIONS = {
    eq: 'is the whole word',
    neq: 'does not have the whole word',
  };
  /** Priority compares rank, not time. */
  const PRIORITY_OPERATOR_DESCRIPTIONS = {
    gt: 'above',
    gte: 'at or above',
    lt: 'below',
    lte: 'at or below',
  };
  const FIELD_PLACEHOLDERS = {
    tag: '#project/atlas',
    text: 'vendor review',
    task: 'open',
    due: 'today',
    scheduled: 'today',
    start: 'today',
    done: '7d',
    priority: 'high',
    kind: 'project',
    file: '2026-09-*.md',
    path: 'notes/*',
    created: '2026-09-13',
    updated: '30d',
  };





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
    return '<button class="overview-tag-link" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(text) + '</button>';
  }

  /** Render a combined-overview tag with a control that removes only that tag. */
  function renderFilteredOverviewTag(tag, text, nextTagKey, nextFilterTagKeys) {
    return '<span class="overview-filter-tag">' + renderOverviewTagLink(tag, text) + '<button class="title-filter-remove" data-action="open-tag" data-tag-key="' + escapeHtml(nextTagKey) + '" data-filter-tag-keys="' + escapeHtml(JSON.stringify(nextFilterTagKeys)) + '" aria-label="Remove ' + escapeHtml(tag.label) + ' from this overview" title="Remove ' + escapeHtml(tag.label) + '">&#215;</button></span>';
  }





  /** Render one relationship as a keyboard-accessible tag navigation control. */
  function renderRelationshipTag(tag, count, weight, direction, filterTagKey, detail) {
    const countHtml = Number(count) > 1
      ? '<span class="relationship-count">x' + escapeHtml(count) + '</span>'
      : '';
    const scoreHtml = direction === 'associated'
      ? '<span class="relationship-count">' + Math.round(Number(weight) * 100) + '%</span>'
      : '';
    const label = direction === 'parent'
      ? 'Open parent tag '
      : direction === 'child'
        ? 'Open child tag '
        : direction === 'associated'
          ? 'Open associated tag '
          : 'Current tag ';
    const filterAttribute = filterTagKey
      ? ' data-filter-tag-key="' + escapeHtml(filterTagKey) + '"'
      : '';
    const title = detail ? ' title="' + escapeHtml(detail) + '"' : '';
    return '<button class="tag-open relationship-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '"' + filterAttribute + title + ' aria-label="' + escapeHtml(label + tag.label) + '">' + renderTagLabel(tag.label) + scoreHtml + countHtml + '</button>';
  }

  /** Group relationship nodes by namespace so large trees remain scannable. */
  function groupRelationships(relationships, direction) {
    const groups = new Map();
    (relationships || []).forEach(function (relationship) {
      const tag = direction === 'parent'
        ? relationship.parent
        : direction === 'child'
          ? relationship.child
          : relationship.associatedTag;
      const key = String(tag.key || '').replace(/^[@#]/, '').split('/')[0] || 'other';
      if (!groups.has(key)) groups.set(key, []);
      const detail = relationship.coOccurrenceCount
        ? 'Written together ' + relationship.coOccurrenceCount + ' time' + (relationship.coOccurrenceCount === 1 ? '' : 's') + (relationship.headingRelationshipCount ? '; heading context ' + relationship.headingRelationshipCount + ' time' + (relationship.headingRelationshipCount === 1 ? '' : 's') : '')
        : 'Heading context ' + relationship.headingRelationshipCount + ' time' + (relationship.headingRelationshipCount === 1 ? '' : 's');
      groups.get(key).push({ tag: tag, count: relationship.count, weight: relationship.weight || 0, coOccurrenceCount: relationship.coOccurrenceCount || 0, detail: detail });
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
          : 'associated';
      return '<div class="relationship-empty">No ' + heading + ' tags.</div>';
    }
    return groups.map(function (group) {
      const items = group[1].sort(function (left, right) {
        return right.coOccurrenceCount - left.coOccurrenceCount || right.weight - left.weight || left.tag.label.localeCompare(right.tag.label, undefined, { sensitivity: 'base' });
      });
      const namespaceLabel = group[0] === 'other' ? 'Other tags' : group[0].replace(/[-_]+/g, ' ');
      return '<details class="relationship-tree-group"><summary><span>' + escapeHtml(namespaceLabel) + '</span><span class="relationship-tree-group-count">' + items.length + '</span></summary><div class="relationship-tree-items">' + items.map(function (item) {
        return '<div class="relationship-tree-item">' + renderRelationshipTag(item.tag, item.count, item.weight, direction, filterTagKey, item.detail) + '</div>';
      }).join('') + '</div></details>';
    }).join('');
  }

  /** Render the compact, namespace-collapsible relationship tree. */
  function renderRelationshipTree(associations, rootTag) {
    return '<div class="relationship-tree"><div class="relationship-tree-root"><span class="relationship-tree-root-label">Focus</span>' + renderRelationshipTag(rootTag, 0, 0, 'focus') + '</div><div class="relationship-tree-columns"><section class="relationship-tree-column" aria-labelledby="tree-associated-heading"><h3 id="tree-associated-heading" class="relationship-tree-column-heading"><span>Associated tags</span><span class="relationship-tree-column-count">' + associations.length + '</span></h3>' + renderRelationshipTreeGroups(associations, 'associated', rootTag.key) + '</section></div></div>';
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
    const rootEdgeY = direction === 'associated' ? rootY + 15 : rootY;
    const edgeY = direction === 'associated' ? y : centerY;
    const edge = '<line class="relationship-edge" x1="' + rootEdgeX + '" y1="' + rootEdgeY + '" x2="' + edgeX + '" y2="' + edgeY + '"></line>';
    const count = Number(item.count) > 1 ? ' x' + item.count : '';
    const label = shortenGraphLabel(node.label);
    const ariaLabel = (direction === 'parent'
      ? 'Open parent tag '
      : direction === 'child'
        ? 'Open child tag '
        : 'Open associated tag ') + node.label + (count ? ', ' + item.count + ' references' : '');
    const filterAttribute = filterTagKey
      ? ' data-filter-tag-key="' + escapeHtml(filterTagKey) + '"'
      : '';
    const graphNode = '<g class="relationship-node" data-action="open-tag" data-tag-key="' + escapeHtml(node.key) + '"' + filterAttribute + ' role="button" tabindex="0" aria-label="' + escapeHtml(ariaLabel) + '"><title>' + escapeHtml(ariaLabel) + '</title><rect x="' + x + '" y="' + y + '" width="' + nodeWidth + '" height="' + nodeHeight + '" rx="2"></rect><text x="' + centerX + '" y="' + (centerY + 4) + '" text-anchor="middle">' + renderTagLabel(label, true) + escapeHtml(count) + '</text></g>';
    return { edge: edge, node: graphNode };
  }

  /** Render a layered SVG graph with parents on the left and children on the right. */
  function renderRelationshipGraph(associations, rootTag) {
    const nodeWidth = 190;
    const nodeHeight = 30;
    const columnGap = 20;
    const maxRows = 12;
    const parentWidth = 0;
    const childWidth = 0;
    const rootWidth = 224;
    const sideGap = 72;
    const leftPadding = 36;
    const siblingColumns = Math.min(4, Math.max(1, associations.length));
    const siblingWidth = associations.length
      ? siblingColumns * nodeWidth + (siblingColumns - 1) * columnGap
      : 0;
    const width = Math.max(
      leftPadding * 2 + rootWidth,
      leftPadding * 2 + siblingWidth,
    );
    const siblingRows = associations.length ? Math.ceil(associations.length / siblingColumns) : 0;
    const rowCount = 1;
    const height = Math.max(260, 124 + rowCount * 42 + (siblingRows ? siblingRows * 42 + 48 : 0));
    const rootX = Math.max(leftPadding + rootWidth / 2, siblingWidth / 2 + leftPadding);
    const rootY = siblingRows ? 62 + rowCount * 21 : height / 2;
    const siblingStartX = Math.max(leftPadding, rootX - siblingWidth / 2);
    const siblingStartY = rootY + 72;
    const siblings = [];
    associations.forEach(function (relationship, index) {
      const column = index % siblingColumns;
      const row = Math.floor(index / siblingColumns);
      siblings.push(renderGraphNode({ tag: relationship.associatedTag, count: relationship.count }, 'associated', column, row, siblingStartX, rootX, rootY, nodeWidth, nodeHeight, columnGap, rootTag.key, siblingStartY));
    });
    const edges = siblings.map(function (item) { return item.edge; }).join('');
    const nodes = siblings.map(function (item) { return item.node; }).join('');
    const rootLeft = rootX - rootWidth / 2;
    const rootTop = rootY - nodeHeight / 2;
    return '<div class="relationship-graph-shell"><svg class="relationship-graph" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Tag association graph for ' + escapeHtml(rootTag.label) + '"><text class="relationship-graph-label" x="' + rootX + '" y="24" text-anchor="middle">Focus</text>' + (associations.length ? '<text class="relationship-graph-label" x="' + (siblingStartX + siblingWidth / 2) + '" y="' + (siblingStartY - 28) + '" text-anchor="middle">Associated tags</text>' : '') + edges + '<g class="relationship-root-node" data-tag-key="' + escapeHtml(rootTag.key) + '"><rect x="' + rootLeft + '" y="' + rootTop + '" width="' + rootWidth + '" height="' + nodeHeight + '" rx="2"></rect><text x="' + rootX + '" y="' + (rootY + 4) + '" text-anchor="middle">' + renderTagLabel(shortenGraphLabel(rootTag.label), true) + '</text></g>' + nodes + '</svg></div><p class="relationship-graph-caption">Select a node to open its overview. Scroll horizontally when there are many associations.</p>';
  }

  /** Render both relationship modes behind a local view switch. */
  function renderRelationshipViews(associations, rootTag) {
    if (!associations.length) return '';
    const treeActive = relationshipView === 'tree';
    return '<section class="relationship-workspace" aria-labelledby="relationships-heading"><div class="relationship-workspace-header"><div class="relationship-workspace-title"><h2 id="relationships-heading" class="relationship-heading">Tag associations</h2><span class="relationship-summary">' + associations.length + ' related tags</span></div><div class="segmented relationship-view-switch" role="tablist" aria-label="Relationship view"><button class="' + (treeActive ? 'active' : '') + '" data-action="set-relationship-view" data-view="tree" role="tab" aria-selected="' + treeActive + '">Tree</button><button class="' + (!treeActive ? 'active' : '') + '" data-action="set-relationship-view" data-view="graph" role="tab" aria-selected="' + (!treeActive) + '">Graph</button></div></div><div class="relationship-view-panel"' + (treeActive ? '' : ' hidden') + ' role="tabpanel">' + renderRelationshipTree(associations, rootTag) + '</div><div class="relationship-view-panel"' + (!treeActive ? '' : ' hidden') + ' role="tabpanel">' + renderRelationshipGraph(associations, rootTag) + '</div></section>';
  }

  /** Read the query the host most recently applied. */
  function appliedQuery() {
    return (state && state.query && state.query.text) || '';
  }

  /** Read the draft in the bar, falling back to the applied query. */
  function currentQuery() {
    return queryDraft === undefined ? appliedQuery() : queryDraft;
  }

  function queryErrors() {
    const diagnostics = (state && state.query && state.query.diagnostics) || [];
    return diagnostics.filter(function (diagnostic) { return diagnostic.severity === 'error'; });
  }

  /** Render the query bar, its completion list, and the optional builder. */
  function renderQueryWorkspace() {
    if (!queryPanelOpen) return '';
    const value = currentQuery();
    const errors = queryErrors();
    const errorHtml = errors.length
      ? '<span class="query-error" role="alert">' + escapeHtml(errors[0].message) + '</span>'
      : '<span class="query-hint">Enter applies. Combine terms with AND, OR, NOT and parentheses.</span>';
    const counts = (state.query && state.query.matchCounts) || { notes: 0, tasks: 0 };
    const summary = '<span>' + counts.notes + ' ' + (counts.notes === 1 ? 'note' : 'notes') + ' &middot; ' + counts.tasks + ' ' + (counts.tasks === 1 ? 'task' : 'tasks') + '</span>';
    const builderToggle = '<button data-action="toggle-builder" aria-expanded="' + builderOpen + '" title="Build the query with dropdowns">' + (builderOpen ? 'Hide builder' : 'Builder') + '</button>';
    const applyButton = '<button data-action="apply-query" title="Apply this query">Apply</button>';
    const clearButton = value ? '<button data-action="clear-query" title="Clear this query">Clear</button>' : '';
    return '<section class="query-workspace" aria-label="Advanced filter">'
      + '<div class="query-bar-row">'
      + '<span class="query-input-shell"><input class="query-input' + (errors.length ? ' invalid' : '') + '" type="text" data-action="query-input" data-suggest-key="query" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Deckard query" placeholder="tag = #project/atlas AND task = open" value="' + escapeHtml(value) + '"><div class="query-suggestions" data-suggestions="query" hidden role="listbox"></div></span>'
      + applyButton + builderToggle + clearButton
      + '</div>'
      + '<div class="query-status">' + errorHtml + summary + '</div>'
      + renderQueryBuilder()
      + '</section>';
  }

  /** Render OR groups of AND rows over the host's parse of the query. */
  function renderQueryBuilder() {
    if (!builderOpen) return '';
    const query = state.query || {};
    const draft = builderGroups();
    const groups = draft.length ? draft : [{ rows: [] }];
    const groupsHtml = groups.map(function (group, groupIndex) {
      const rows = group.rows.length
        ? group.rows.map(function (row, rowIndex) { return renderBuilderRow(row, groupIndex, rowIndex); }).join('')
        : '<p class="query-builder-note">This group is empty. Add a condition to start it.</p>';
      return (groupIndex > 0 ? '<span class="query-builder-or">or</span>' : '')
        + '<div class="query-builder-group" data-group-index="' + groupIndex + '">' + rows
        + '<div class="query-builder-actions"><button data-action="builder-add-row" data-group-index="' + groupIndex + '">Add condition</button>'
        + (groups.length > 1 ? '<button data-action="builder-remove-group" data-group-index="' + groupIndex + '">Remove group</button>' : '')
        + '</div></div>';
    }).join('');
    const note = query.isBuildable === false
      ? '<p class="query-builder-note">Some conditions were written by hand and are shown as text. Editing them in the query bar keeps them exactly as written.</p>'
      : '';
    return '<div class="query-builder">' + groupsHtml
      + '<div class="query-builder-actions"><button data-action="builder-add-group">Add OR group</button></div>'
      + note + '</div>';
  }

  function renderBuilderRow(row, groupIndex, rowIndex) {
    const position = ' data-group-index="' + groupIndex + '" data-row-index="' + rowIndex + '"';
    const suggestKey = 'g' + groupIndex + 'r' + rowIndex;
    const joiner = '<span class="query-builder-and">' + (rowIndex === 0 ? 'where' : 'and') + '</span>';
    if (!row.supported) {
      return '<div class="query-builder-row">' + joiner
        + '<code class="query-builder-readonly">' + escapeHtml(row.text) + '</code>'
        + '<button class="query-builder-remove" data-action="builder-remove-row"' + position + ' aria-label="Remove this condition">Remove</button></div>';
    }
    const fields = QUERY_FIELDS.map(function (field) {
      return '<option value="' + field + '"' + (field === row.field ? ' selected' : '') + '>' + field + '</option>';
    }).join('');
    const descriptions = row.field === 'text'
      ? Object.assign({}, OPERATOR_DESCRIPTIONS, TEXT_OPERATOR_DESCRIPTIONS)
      : row.field === 'priority'
        ? Object.assign({}, OPERATOR_DESCRIPTIONS, PRIORITY_OPERATOR_DESCRIPTIONS)
        : OPERATOR_DESCRIPTIONS;
    const operators = (QUERY_FIELD_OPERATORS[row.field] || ['eq']).map(function (operator) {
      return '<option value="' + operator + '" title="' + escapeHtml(descriptions[operator] || '') + '"' + (operator === row.operator ? ' selected' : '') + '>' + escapeHtml(OPERATOR_LABELS[operator] || operator) + '</option>';
    }).join('');
    const operatorTitle = descriptions[row.operator] || 'Operator';
    return '<div class="query-builder-row">' + joiner
      + '<select data-action="builder-set-field"' + position + ' aria-label="Field">' + fields + '</select>'
      + '<select class="query-builder-operator" data-action="builder-set-operator"' + position + ' aria-label="Operator: ' + escapeHtml(operatorTitle) + '" title="' + escapeHtml(operatorTitle) + '">' + operators + '</select>'
      + '<span class="query-input-shell query-builder-value-shell"><input class="query-builder-value" data-action="builder-set-value" data-suggest-key="' + suggestKey + '" data-field="' + escapeHtml(row.field) + '"' + position + ' value="' + escapeHtml(row.value) + '" placeholder="' + escapeHtml(FIELD_PLACEHOLDERS[row.field] || '') + '" aria-label="Value" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false"><div class="query-suggestions" data-suggestions="' + suggestKey + '" hidden role="listbox"></div></span>'
      + '<button class="query-builder-remove" data-action="builder-remove-row"' + position + ' aria-label="Remove this condition">Remove</button></div>';
  }

  /**
   * Adopt edited builder rows, then send the query they describe.
   *
   * A row that is still empty changes the rows without changing the query, so
   * that case re-renders locally instead of making a round trip that would
   * drop the row on the way back.
   */
  function applyBuilderGroups(groups) {
    builderDraft = groups;
    const text = buildQueryFromGroups(groups);
    if (text === appliedQuery()) {
      render();
      return;
    }
    builderSourceText = text;
    queryDraft = text;
    sendQuery(text);
  }

  /** Render builder rows as query text, skipping rows with no value yet. */
  function buildQueryFromGroups(groups) {
    const branches = groups.map(function (group) {
      return group.rows.map(function (row) {
        if (!row.supported) return row.text.trim();
        if (!String(row.value).trim()) return '';
        return formatBuilderCondition(row);
      }).filter(Boolean).join(' AND ');
    }).filter(Boolean);
    return branches.length <= 1
      ? (branches[0] || '')
      : branches.map(function (branch) {
        return branch.indexOf(' AND ') >= 0 ? '(' + branch + ')' : branch;
      }).join(' OR ');
  }

  function formatBuilderCondition(row) {
    const value = quoteQueryValue(String(row.value).trim());
    const symbols = { eq: '=', neq: '!=', contains: '~', notContains: '!~', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    return row.field + ' ' + (symbols[row.operator] || '=') + ' ' + value;
  }

  function quoteQueryValue(value) {
    return /[\\s:=<>~!()"']/.test(value) || !value
      ? '"' + value.replace(/(["\\\\])/g, '\\\\$1') + '"'
      : value;
  }

  /**
   * Read the builder's rows, seeding them from the host's parse on first use.
   *
   * Returns a copy so a caller can mutate rows freely and hand the result
   * back through applyBuilderGroups.
   */
  function builderGroups() {
    if (!builderDraft) {
      builderDraft = ((state.query && state.query.groups) || []).map(function (group) {
        return { rows: group.rows.map(function (row) { return Object.assign({}, row); }) };
      });
      builderSourceText = appliedQuery();
    }
    return builderDraft.map(function (group) {
      return { rows: group.rows.map(function (row) { return Object.assign({}, row); }) };
    });
  }

  function emptyBuilderRow() {
    return { field: 'tag', operator: 'eq', value: '', supported: true, text: '' };
  }

  function sendQuery(text) {
    vscode.postMessage({ type: 'setOverviewQuery', query: text });
  }

  /**
   * Completions for the token under the caret in the query bar.
   *
   * When the caret sits after a field and its operator the list narrows to
   * values that field accepts; otherwise it offers field names and tags,
   * which are complete conditions on their own.
   */
  function queryBarSuggestions(input) {
    const caret = caretPosition(input);
    const prefix = input.value.slice(0, caret);
    const suggestions = (state.query && state.query.suggestions) || {};
    const context = valueContext(prefix, suggestions.aliases || {});
    if (context) {
      const values = (suggestions.values || {})[context.field] || [];
      return {
        token: context.token,
        items: values.map(function (item) {
          return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ' };
        }),
      };
    }
    const token = (prefix.match(/[^\\s()]*$/) || [''])[0];
    const fields = (suggestions.fields || []).map(function (item) {
      return { value: item.value, label: item.label + ' =', detail: item.detail, insert: item.value + ' = ' };
    });
    const tags = ((suggestions.values || {}).tag || []).map(function (item) {
      return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ' };
    });
    return { token: token, items: fields.concat(tags) };
  }

  /** Where the caret sits, defaulting to the end of the value. */
  function caretPosition(input) {
    return typeof input.selectionStart === 'number'
      ? input.selectionStart
      : input.value.length;
  }

  /** Detect a caret sitting in the value of a field condition. */
  function valueContext(prefix, aliases) {
    const match = prefix.match(/([A-Za-z]+)\\s*(!=|!~|>=|<=|[:=~<>])\\s*([^\\s()]*)$/);
    if (!match) return undefined;
    const field = aliases[match[1].toLowerCase()];
    return field ? { field: field, token: match[3] } : undefined;
  }

  /** Completions for one builder row's value field. */
  function builderValueSuggestions(field, token) {
    const suggestions = (state.query && state.query.suggestions) || {};
    const values = (suggestions.values || {})[field] || [];
    return {
      token: token,
      items: values.map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, insert: item.value };
      }),
    };
  }

  /** Populate and show the list attached to an input. */
  function openSuggestions(input) {
    const key = input.dataset.suggestKey;
    if (!key) return;
    const source = key === 'query'
      ? queryBarSuggestions(input)
      : builderValueSuggestions(input.dataset.field, input.value);
    const token = String(source.token || '');
    suggestionItems = !token
      ? []
      : source.items.filter(function (item) {
        return item.value.toLowerCase().indexOf(token.toLowerCase()) >= 0
          || String(item.label).toLowerCase().indexOf(token.toLowerCase()) >= 0;
      }).slice(0, 12);
    suggestionToken = token;
    suggestionHostKey = key;
    // Nothing is highlighted until the author arrows into the list, so Enter
    // runs the query they typed instead of silently accepting a completion.
    suggestionIndex = -1;
    renderSuggestions(input);
  }

  function suggestionContainer(key) {
    return document.querySelector('[data-suggestions="' + key + '"]');
  }

  function renderSuggestions(input) {
    const container = suggestionContainer(suggestionHostKey);
    if (!container) return;
    if (!suggestionItems.length) {
      container.hidden = true;
      container.innerHTML = '';
      if (input) input.setAttribute('aria-expanded', 'false');
      return;
    }
    container.innerHTML = suggestionItems.map(function (item, index) {
      return '<button type="button" role="option" aria-selected="' + (index === suggestionIndex) + '" class="query-suggestion' + (index === suggestionIndex ? ' active' : '') + '" data-action="query-suggestion" data-suggestion-index="' + index + '"><span>' + escapeHtml(item.label) + '</span>' + (item.detail ? '<span class="query-suggestion-detail">' + escapeHtml(item.detail) + '</span>' : '') + '</button>';
    }).join('');
    container.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
  }

  /** Replace the token being completed with the chosen suggestion. */
  function acceptSuggestion(index) {
    const item = suggestionItems[index];
    if (!item) return;
    const key = suggestionHostKey;
    const input = document.querySelector('[data-suggest-key="' + key + '"]');
    if (!input) return;

    if (key === 'query') {
      const caret = caretPosition(input);
      const start = caret - suggestionToken.length;
      input.value = input.value.slice(0, start) + item.insert + input.value.slice(caret);
      const nextCaret = start + item.insert.length;
      closeSuggestions();
      input.setSelectionRange(nextCaret, nextCaret);
      queryDraft = input.value;
      input.focus();
      return;
    }

    // A builder value is committed as soon as it is chosen, so the results
    // update without waiting for the field to lose focus.
    input.value = item.insert;
    closeSuggestions();
    commitBuilderValue(input);
  }

  function commitBuilderValue(input) {
    const groups = builderGroups();
    const group = groups[Number(input.dataset.groupIndex)];
    const row = group && group.rows[Number(input.dataset.rowIndex)];
    if (!row) return;
    row.value = input.value;
    pendingBuilderFocus = {
      groupIndex: Number(input.dataset.groupIndex),
      rowIndex: Number(input.dataset.rowIndex),
    };
    applyBuilderGroups(groups);
  }

  function closeSuggestions() {
    suggestionItems = [];
    suggestionIndex = -1;
    const container = suggestionContainer(suggestionHostKey);
    if (container) {
      container.hidden = true;
      container.innerHTML = '';
    }
    suggestionHostKey = undefined;
  }

  function filterOverviewEntries(kind, query, total) {
    const normalizedQuery = query.trim().toLowerCase();
    let visibleCount = 0;
    document.querySelectorAll('[data-search-entry="' + kind + '"]').forEach(function (entry) {
      const visible = !normalizedQuery || entry.dataset.searchText.indexOf(normalizedQuery) >= 0;
      entry.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    document.querySelectorAll('[data-search-count="' + kind + '"]').forEach(function (count) {
      count.textContent = visibleCount + (normalizedQuery ? ' / ' + total : '');
    });
    const empty = document.querySelector('[data-search-empty="' + kind + '"]');
    if (empty) empty.hidden = !normalizedQuery || visibleCount > 0;
    if (kind === 'tasks') updateTaskFilterCounts(normalizedQuery);
  }

  function updateTaskFilterCounts(query) {
    const counts = query
      ? { all: 0, active: 0, completed: 0 }
      : (state && state.taskCounts
        ? state.taskCounts
        : { all: 0, active: 0, completed: 0 });
    if (query) {
      document.querySelectorAll('[data-search-entry="tasks"]').forEach(function (entry) {
        if (entry.hidden) return;
        counts.all += 1;
        counts[entry.classList.contains('completed') ? 'completed' : 'active'] += 1;
      });
    }
    document.querySelectorAll('.task-filter-toggle button[data-filter]').forEach(function (button) {
      const filter = button.dataset.filter;
      if (!filter || counts[filter] === undefined) return;
      const count = counts[filter];
      const label = filter === 'all' ? 'All' : filter === 'active' ? 'Open' : 'Done';
      const description = label + ' tasks, ' + count;
      const countElement = button.querySelector('.filter-count');
      if (countElement) countElement.textContent = String(count);
      button.setAttribute('aria-label', description);
      button.title = description;
    });
  }

  /** Set once the reader opens or closes the hub, which then outlasts refreshes. */
  let hubOpen;
  document.addEventListener('toggle', function (event) {
    if (event.target.classList && event.target.classList.contains('hub')) hubOpen = event.target.open;
  }, true);

  /** The note that describes this tag, or an offer to create one. */
  function renderHub(isQueryView, filterTags) {
    if (isQueryView || filterTags.length || !state.tag) return '';
    const hub = state.hub;
    if (!hub) {
      return '<section class="hub hub-empty" aria-label="Hub note"><span>No note describes ' + escapeHtml(state.tag.label) + ' yet.</span><button data-action="create-hub" title="Create a note whose describes: front matter names this tag">Create hub note</button></section>';
    }
    const properties = hub.properties.length
      ? '<dl class="hub-properties">' + hub.properties.map(function (property) {
        return '<div><dt>' + escapeHtml(property.name) + '</dt><dd>' + property.values.map(function (value) {
          return value.tag ? renderTagButton(value.tag, 'inline-tag') : escapeHtml(value.text);
        }).join(', ') + '</dd></div>';
      }).join('') + '</dl>'
      : '';
    const body = hub.rawContent.trim()
      ? (state.renderMode === 'html' ? '<div class="rendered">' + hub.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(hub.rawContent) + '</pre>')
      : '';
    const others = hub.otherFilePaths.length
      ? '<p class="hub-note">Also described by ' + hub.otherFilePaths.map(function (filePath) {
        return '<button data-action="open-source" data-file-path="' + escapeHtml(filePath) + '" data-line="1">' + escapeHtml(filePath.split('/').pop() || filePath) + '</button>';
      }).join(' ') + '. The first by path is shown.</p>'
      : '';
    // deckard.tagOverview.hubNoteExpanded sets how the hub starts.
    const open = hubOpen === undefined ? hub.expanded !== false : hubOpen;
    return '<details class="hub"' + (open ? ' open' : '') + '><summary class="hub-header"><span class="hub-title"><span class="hub-toggle" aria-hidden="true"></span><span class="eyebrow">Hub note</span></span><button data-action="open-source" data-file-path="' + escapeHtml(hub.filePath) + '" data-line="1" title="' + escapeHtml(hub.filePath) + '">Open ' + escapeHtml(hub.fileName) + '</button></summary>' + properties + body + others + '</details>';
  }

  /** Rebuild the cards from the latest host snapshot without local duplication. */
  function render() {
    if (!state) return;
    closeTagContextMenu();
    const queryState = state.query || {};
    // A query the tag chips cannot express takes over the title; every other
    // view keeps the original chip presentation exactly as it was.
    const isQueryView = queryState.isAdvanced === true;
    const filterTags = isQueryView
      ? []
      : (state.filterTags || (state.filterTag ? [state.filterTag] : []));
    const baseTitle = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : (state.tag ? state.tag.label : 'Search');
    const focusReference = state.entity
      ? { key: state.entity.key, label: state.entity.label }
      : state.tag;
    const focusTitle = state.entity
      ? formatEntityTitle(state.entity.kind, state.entity.name)
      : (state.tag ? state.tag.label : 'Search');
    const activeTitleTags = filterTags.map(function (tag) {
      return { tag: tag, text: formatTagReferenceTitle(tag) };
    }).concat(focusReference ? [{ tag: focusReference, text: focusTitle }] : []);
    const titleHtml = isQueryView || !focusReference
      ? '<span class="query-summary">' + escapeHtml(queryState.text || 'Search') + '</span>'
      : filterTags.length
        ? activeTitleTags.map(function (item) {
          const removingFocus = item.tag.key === focusReference.key;
          const remainingFilterTags = removingFocus
            ? filterTags.slice(1)
            : filterTags.filter(function (tag) { return tag.key !== item.tag.key; });
          const nextTagKey = removingFocus ? filterTags[0].key : focusReference.key;
          return renderFilteredOverviewTag(item.tag, item.text, nextTagKey, remainingFilterTags.map(function (tag) { return tag.key; }));
        }).join('<span class="overview-title-joiner"> AND </span>')
        : renderOverviewTagLink(focusReference, focusTitle);
    const titleAriaLabel = isQueryView || !focusReference
      ? 'Query: ' + (queryState.text || '')
      : filterTags.length
        ? activeTitleTags.map(function (item) { return item.text; }).join(' and ') + (state.entity ? '' : ' overview')
        : baseTitle;
    const entityMeta = state.entity && !isQueryView
      ? '<div class="entity-meta">' + (filterTags.length ? filterTags.map(function (tag) { return renderOverviewTagLink(tag, tag.label); }).join(' · ') + ' · ' : '') + renderOverviewTagLink(focusReference, state.entity.label) + '</div>'
      : isQueryView
        ? '<div class="entity-meta">' + (queryState.tags || []).map(function (tag) { return renderOverviewTagLink(tag, tag.label); }).join(' · ') + '</div>'
        : '';
    const cards = state.sections.length ? state.sections.map(function (section) {
      const fileName = section.filePath.split('/').pop() || section.filePath;
      const content = section.rawContent ? (state.renderMode === 'html' ? '<div class="rendered">' + section.renderedHtml + '</div>' : '<pre class="markdown">' + escapeHtml(section.rawContent) + '</pre>') : '';
      const titleHtml = state.tagTitleDisplayMode === 'inline'
        ? renderInlineTitle(section.heading, section.titleTags)
        : escapeHtml(section.heading);
      const tags = state.tagTitleDisplayMode === 'separate' ? section.tags.map(function (tag) {
        return '<button class="tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(tag.label) + '</button>';
      }).join('') : '';
      const searchText = [section.heading, section.filePath, section.rawContent].join(' ').toLowerCase();
      return '<article class="card" tabindex="0" data-search-entry="notes" data-search-text="' + escapeHtml(searchText) + '" data-file-path="' + escapeHtml(section.filePath) + '" data-line="' + section.startLine + '"><div class="card-header"><h2 class="card-title">' + titleHtml + (tags ? '<span class="tag-list" aria-label="Section tags">' + tags + '</span>' : '') + '</h2><div class="source">' + escapeHtml(fileName) + ' / line ' + section.startLine + '</div></div>' + content + '</article>';
    }).join('') : '<div class="empty">' + (isQueryView ? 'No notes match this query.' : filterTags.length ? 'No sections currently carry all selected tags.' : 'No sections currently carry this tag.') + '</div>';
    const tasks = state.tasks.length ? '<div class="task-summary">' + state.tasks.map(function (item) {
      const task = item.task;
      const searchText = [task.title, item.fileName, item.sectionHeading || ''].join(' ').toLowerCase();
      return '<article class="task ' + (task.completed ? 'completed' : '') + '" tabindex="0" data-search-entry="tasks" data-search-text="' + escapeHtml(searchText) + '" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '"><input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '"><div><div class="task-title">' + (state.tagTitleDisplayMode === 'inline' ? renderTaskTitle(item.renderedTitle, item.titleTags) : item.renderedTitle) + '</div><div class="source">' + escapeHtml(item.fileName) + ' / line ' + task.lineNumber + '</div></div></article>';
    }).join('') + '</div>' : '<div class="empty">No tasks match this filter.</div>';
    const taskCounts = state.taskCounts || {
      all: state.tasks.length,
      active: state.tasks.filter(function (item) { return !item.task.completed; }).length,
      completed: state.tasks.filter(function (item) { return item.task.completed; }).length,
    };
    const taskFilters = ['all', 'active', 'completed'].map(function (filter) {
      const label = filter === 'all' ? 'All' : filter === 'active' ? 'Open' : 'Done';
      const description = label + ' tasks, ' + taskCounts[filter];
      return '<button class="' + (state.taskFilter === filter ? 'active' : '') + '" data-action="set-task-filter" data-filter="' + filter + '" aria-label="' + description + '" aria-pressed="' + (state.taskFilter === filter) + '" title="' + description + '">' + taskFilterIcon(filter) + '<span>' + label + '</span><span class="filter-count">' + taskCounts[filter] + '</span></button>';
    }).join('');
    const notesCount = state.sections.length;
    const tasksCount = state.tasks.length;
    const notesPane = '<section class="overview-pane" aria-labelledby="notes-heading"><div class="overview-pane-header"><h2 id="notes-heading" class="overview-pane-heading">Notes (<span data-search-count="notes">' + notesCount + '</span>)</h2><div class="overview-pane-controls"><input class="overview-search" type="search" data-action="search-notes" value="' + escapeHtml(noteSearchQuery) + '" placeholder="Search notes" aria-label="Search current notes" autocomplete="off"></div></div><div class="cards">' + cards + '<div class="empty" data-search-empty="notes" hidden>No notes match your search.</div></div></section>';
    const tasksPane = '<section class="overview-pane" aria-labelledby="tasks-heading"><div class="overview-pane-header"><h2 id="tasks-heading" class="overview-pane-heading">Tasks (<span data-search-count="tasks">' + tasksCount + '</span>)</h2><div class="overview-pane-controls"><input class="overview-search" type="search" data-action="search-tasks" value="' + escapeHtml(taskSearchQuery) + '" placeholder="Search tasks" aria-label="Search current tasks" autocomplete="off"><div class="segmented task-filter-toggle" role="group" aria-label="Task status filter">' + taskFilters + '</div></div></div>' + tasks + '<div class="empty" data-search-empty="tasks" hidden>No tasks match your search.</div></section>';
    const layoutContent = state.layout === 'split'
      ? '<div class="overview-split">' + notesPane + tasksPane + '</div>'
      : '<div class="overview-tabs-row"><div class="segmented overview-tabs" role="tablist" aria-label="Tag overview content"><button class="' + (activeTab === 'notes' ? 'active' : '') + '" data-action="set-tab" data-tab="notes" role="tab" aria-selected="' + (activeTab === 'notes') + '">Notes (<span data-search-count="notes">' + notesCount + '</span>)</button><button class="' + (activeTab === 'tasks' ? 'active' : '') + '" data-action="set-tab" data-tab="tasks" role="tab" aria-selected="' + (activeTab === 'tasks') + '">Tasks (<span data-search-count="tasks">' + tasksCount + '</span>)</button></div></div><div class="overview-tab-panel"' + (activeTab === 'notes' ? '' : ' hidden') + '>' + notesPane + '</div><div class="overview-tab-panel"' + (activeTab === 'tasks' ? '' : ' hidden') + '>' + tasksPane + '</div>';
    const hub = renderHub(isQueryView, filterTags);
    const saveFilterControl = filterTags.length || isQueryView
      ? '<button class="save-filter" data-action="save-filter" aria-label="Save this view" title="Save filter">Save filter</button>'
      : '';
    // The visible text is the accessible name, so the two cannot drift apart.
    const queryToggle = '<button data-action="toggle-query" aria-expanded="' + queryPanelOpen + '" title="Search with a query: combine tags, text, tasks and dates using AND, OR and NOT">' + (queryPanelOpen ? 'Hide advanced search' : 'Advanced search') + '</button>';
    const layoutControls = '<div class="segmented toolbar-toggle-group layout-toggle-group" role="group" aria-label="Content layout"><button class="icon-button toolbar-toggle ' + (state.layout === 'tabs' ? 'active' : '') + '" data-action="set-layout" data-layout="tabs" aria-label="Tabs layout" aria-pressed="' + (state.layout === 'tabs') + '" title="Tabs: switch between Notes and Tasks"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M5 2.5V6"/></svg></button><button class="icon-button toolbar-toggle ' + (state.layout === 'split' ? 'active' : '') + '" data-action="set-layout" data-layout="split" aria-label="Side-by-side layout" aria-pressed="' + (state.layout === 'split') + '" title="Side by side: Notes 60%, Tasks 40%"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M9 2v12"/></svg></button></div>';
    const formatControls = '<div class="segmented toolbar-toggle-group" role="group" aria-label="Content format"><button class="icon-button toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button><button class="icon-button toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5"/></svg></button></div>';
    const viewOptions = '<details class="view-options"><summary aria-label="View options" title="View options"><svg class="toolbar-icon settings-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.0002 8C9.79111 8 8.00024 9.79086 8.00024 12C8.00024 14.2091 9.79111 16 12.0002 16C14.2094 16 16.0002 14.2091 16.0002 12C16.0002 9.79086 14.2094 8 12.0002 8ZM10.0002 12C10.0002 10.8954 10.8957 10 12.0002 10C13.1048 10 14.0002 10.8954 14.0002 12C14.0002 13.1046 13.1048 14 12.0002 14C10.8957 14 10.0002 13.1046 10.0002 12Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.2867 0.5C9.88583 0.5 8.6461 1.46745 8.37171 2.85605L8.29264 3.25622C8.10489 4.20638 7.06195 4.83059 6.04511 4.48813L5.64825 4.35447C4.32246 3.90796 2.83873 4.42968 2.11836 5.63933L1.40492 6.83735C0.67773 8.05846 0.954349 9.60487 2.03927 10.5142L2.35714 10.7806C3.12939 11.4279 3.12939 12.5721 2.35714 13.2194L2.03927 13.4858C0.954349 14.3951 0.67773 15.9415 1.40492 17.1626L2.11833 18.3606C2.83872 19.5703 4.3225 20.092 5.64831 19.6455L6.04506 19.5118C7.06191 19.1693 8.1049 19.7935 8.29264 20.7437L8.37172 21.1439C8.6461 22.5325 9.88584 23.5 11.2867 23.5H12.7136C14.1146 23.5 15.3543 22.5325 15.6287 21.1438L15.7077 20.7438C15.8954 19.7936 16.9384 19.1693 17.9553 19.5118L18.3521 19.6455C19.6779 20.092 21.1617 19.5703 21.8821 18.3606L22.5955 17.1627C23.3227 15.9416 23.046 14.3951 21.9611 13.4858L21.6432 13.2194C20.8709 12.5722 20.8709 11.4278 21.6432 10.7806L21.9611 10.5142C23.046 9.60489 23.3227 8.05845 22.5955 6.83732L21.8821 5.63932C21.1617 4.42968 19.678 3.90795 18.3522 4.35444L17.9552 4.48814C16.9384 4.83059 15.8954 4.20634 15.7077 3.25617L15.6287 2.85616C15.3543 1.46751 14.1146 0.5 12.7136 0.5H11.2867ZM10.3338 3.24375C10.4149 2.83334 10.7983 2.5 11.2867 2.5H12.7136C13.2021 2.5 13.5855 2.83336 13.6666 3.24378L13.7456 3.64379C14.1791 5.83811 16.4909 7.09167 18.5935 6.38353L18.9905 6.24984C19.4495 6.09527 19.9394 6.28595 20.1637 6.66264L20.8771 7.86064C21.0946 8.22587 21.0208 8.69271 20.6764 8.98135L20.3586 9.24773C18.6325 10.6943 18.6325 13.3057 20.3586 14.7523L20.6764 15.0186C21.0208 15.3073 21.0946 15.7741 20.8771 16.1394L20.1637 17.3373C19.9394 17.714 19.4495 17.9047 18.9905 17.7501L18.5936 17.6164C16.4909 16.9082 14.1791 18.1618 13.7456 20.3562L13.6666 20.7562C13.5855 21.1666 13.2021 21.5 12.7136 21.5H11.2867C10.7983 21.5 10.4149 21.1667 10.3338 20.7562L10.2547 20.356C9.82113 18.1617 7.50931 16.9082 5.40665 17.6165L5.0099 17.7501C4.55092 17.9047 4.06104 17.714 3.83671 17.3373L3.1233 16.1393C2.9058 15.7741 2.97959 15.3073 3.32398 15.0186L3.64185 14.7522C5.36782 13.3056 5.36781 10.6944 3.64185 9.24779L3.32398 8.98137C2.97959 8.69273 2.9058 8.2259 3.1233 7.86067L3.83674 6.66266C4.06106 6.28596 4.55093 6.09528 5.0099 6.24986L5.40676 6.38352C7.50938 7.09166 9.82112 5.83819 10.2547 3.64392L10.3338 3.24375Z"/></svg></summary><div class="view-options-menu"><div class="view-options-group"><span>Layout</span>' + layoutControls + '</div><div class="view-options-group"><span>Format</span>' + formatControls + '</div></div></details>';
    const headerControls = '<div class="toolbar" role="group" aria-label="Tag entry view controls"><label>Sort:<select data-action="set-sort" aria-label="Sort tag entries"><option value="alphabetical" ' + (state.sortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option><option value="created" ' + (state.sortMode === 'created' ? 'selected' : '') + '>Newest created</option><option value="updated" ' + (state.sortMode === 'updated' ? 'selected' : '') + '>Recently updated</option><option value="access" ' + (state.sortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select></label>' + viewOptions + '</div>';
    const savedViewName = state.savedViewName
      ? '<div class="saved-view-name" aria-label="Saved view: ' + escapeHtml(state.savedViewName) + '"><span class="saved-view-name-label">Saved view:</span> ' + escapeHtml(state.savedViewName) + '</div>'
      : '';
    const eyebrow = isQueryView || !state.tag
      ? 'DECKARD / SEARCH'
      : 'DECKARD / ' + (state.entity ? 'ENTITY' : 'TAG') + ' OVERVIEW';
    document.getElementById('app').innerHTML = '<header><div><div class="overview-eyebrow"><p class="eyebrow">' + eyebrow + '</p>' + queryToggle + saveFilterControl + '</div>' + savedViewName + '<h1 aria-label="' + escapeHtml(titleAriaLabel) + '">' + titleHtml + '</h1>' + entityMeta + '</div>' + headerControls + '</header>' + renderQueryWorkspace() + hub + layoutContent;
    filterOverviewEntries('notes', noteSearchQuery, state.sections.length);
    filterOverviewEntries('tasks', taskSearchQuery, state.tasks.length);
    if (restoreQueryFocus) {
      restoreQueryFocus = false;
      const input = document.querySelector('[data-action="query-input"]');
      if (input) {
        input.focus();
        const caret = input.value.length;
        input.setSelectionRange(caret, caret);
      }
    }
    if (pendingBuilderFocus) {
      const target = document.querySelector('[data-action="builder-set-value"][data-group-index="' + pendingBuilderFocus.groupIndex + '"][data-row-index="' + pendingBuilderFocus.rowIndex + '"]');
      pendingBuilderFocus = undefined;
      if (target) target.focus();
    }
  }

  // Pressing the mouse on a completion must not move focus out of the field it
  // belongs to. A builder value commits when it loses focus, which re-renders
  // the row and would destroy the completion before its click could land.
  document.addEventListener('mousedown', function (event) {
    if (event.target.closest && event.target.closest('[data-action="query-suggestion"]')) {
      event.preventDefault();
    }
  });
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
    const viewOptions = document.querySelector('.view-options');
    if (viewOptions && viewOptions.open && !event.target.closest('.view-options')) {
      viewOptions.open = false;
    }
    if (suggestionItems.length && !event.target.closest('.query-input-shell')) {
      closeSuggestions();
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
      if (target.dataset.action === 'save-filter') {
        vscode.postMessage({ type: 'saveTagOverviewFilter' });
      }
      if (target.dataset.action === 'create-hub') {
        vscode.postMessage({ type: 'createHubNote' });
      }
      if (target.dataset.action === 'toggle-query') {
        queryPanelOpen = !queryPanelOpen;
        if (queryPanelOpen) restoreQueryFocus = true;
        else closeSuggestions();
        render();
      }
      if (target.dataset.action === 'toggle-builder') {
        builderOpen = !builderOpen;
        render();
      }
      if (target.dataset.action === 'apply-query') {
        closeSuggestions();
        sendQuery(currentQuery());
      }
      if (target.dataset.action === 'clear-query') {
        queryDraft = '';
        closeSuggestions();
        vscode.postMessage({ type: 'clearOverviewQuery' });
      }
      if (target.dataset.action === 'query-suggestion') {
        acceptSuggestion(Number(target.dataset.suggestionIndex));
      }
      if (target.dataset.action === 'builder-add-group') {
        const groups = builderGroups();
        groups.push({ rows: [emptyBuilderRow()] });
        pendingBuilderFocus = { groupIndex: groups.length - 1, rowIndex: 0 };
        applyBuilderGroups(groups);
      }
      if (target.dataset.action === 'builder-add-row') {
        const groups = builderGroups();
        const groupIndex = Number(target.dataset.groupIndex);
        const group = groups[groupIndex];
        if (group) {
          group.rows.push(emptyBuilderRow());
          pendingBuilderFocus = { groupIndex: groupIndex, rowIndex: group.rows.length - 1 };
          applyBuilderGroups(groups);
        }
      }
      if (target.dataset.action === 'builder-remove-group') {
        const groups = builderGroups();
        groups.splice(Number(target.dataset.groupIndex), 1);
        applyBuilderGroups(groups);
      }
      if (target.dataset.action === 'builder-remove-row') {
        const groups = builderGroups();
        const group = groups[Number(target.dataset.groupIndex)];
        if (group) {
          group.rows.splice(Number(target.dataset.rowIndex), 1);
          applyBuilderGroups(groups);
        }
      }
      if (target.dataset.action === 'open-source') vscode.postMessage({ type: 'openSource', filePath: target.dataset.filePath, line: Number(target.dataset.line) });
      if (target.dataset.action === 'open-tag') {
        const message = { type: 'openTag', tagKey: target.dataset.tagKey };
        if (target.dataset.filterTagKey) message.filterTagKey = target.dataset.filterTagKey;
        const filterTagKeys = getFilterTagKeys(target.dataset.filterTagKeys);
        if (filterTagKeys) message.filterTagKeys = filterTagKeys;
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
    const suggestInput = event.target.closest
      ? event.target.closest('[data-suggest-key]')
      : undefined;
    if (suggestInput) {
      const isQueryBar = suggestInput.dataset.suggestKey === 'query';
      if (event.key === 'ArrowDown' && suggestionItems.length) {
        event.preventDefault();
        suggestionIndex = (suggestionIndex + 1) % suggestionItems.length;
        renderSuggestions(suggestInput);
        return;
      }
      if (event.key === 'ArrowUp' && suggestionItems.length) {
        event.preventDefault();
        suggestionIndex = (suggestionIndex - 1 + suggestionItems.length) % suggestionItems.length;
        renderSuggestions(suggestInput);
        return;
      }
      if (event.key === 'Tab' && suggestionItems.length) {
        // Tab is the key that means "complete this", so it takes the first
        // entry when the author has not picked one.
        event.preventDefault();
        acceptSuggestion(suggestionIndex >= 0 ? suggestionIndex : 0);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (suggestionItems.length && suggestionIndex >= 0) {
          acceptSuggestion(suggestionIndex);
          return;
        }
        if (isQueryBar) {
          closeSuggestions();
          sendQuery(suggestInput.value);
        } else {
          closeSuggestions();
          commitBuilderValue(suggestInput);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (suggestionItems.length) {
          closeSuggestions();
          return;
        }
        if (isQueryBar) {
          // Escape with no completions open abandons the edit.
          queryDraft = undefined;
          suggestInput.value = appliedQuery();
        }
        return;
      }
      return;
    }
    if (event.key === 'Escape') {
      const viewOptions = document.querySelector('.view-options');
      if (viewOptions && viewOptions.open) {
        viewOptions.open = false;
        viewOptions.querySelector('summary').focus();
        return;
      }
    }
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
      const filterTagKeys = getFilterTagKeys(relationshipNode.dataset.filterTagKeys);
      if (filterTagKeys) message.filterTagKeys = filterTagKeys;
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
    const builderAction = target.dataset.action;
    if (builderAction === 'builder-set-field' || builderAction === 'builder-set-operator' || builderAction === 'builder-set-value') {
      const groups = builderGroups();
      const group = groups[Number(target.dataset.groupIndex)];
      const row = group && group.rows[Number(target.dataset.rowIndex)];
      if (!row) return;
      if (builderAction === 'builder-set-field') {
        row.field = target.value;
        // Keep the operator valid for the new field.
        const allowed = QUERY_FIELD_OPERATORS[row.field] || ['eq'];
        if (allowed.indexOf(row.operator) < 0) row.operator = allowed[0];
      }
      if (builderAction === 'builder-set-operator') row.operator = target.value;
      if (builderAction === 'builder-set-value') row.value = target.value;
      applyBuilderGroups(groups);
    }
  });
  document.addEventListener('input', function (event) {
    const target = event.target;
    if (target.dataset.action === 'query-input') {
      queryDraft = target.value;
      openSuggestions(target);
      return;
    }
    if (target.dataset.action === 'builder-set-value') {
      openSuggestions(target);
      return;
    }
    if (target.dataset.action !== 'search-notes' && target.dataset.action !== 'search-tasks') return;
    if (target.dataset.action === 'search-notes') {
      noteSearchQuery = target.value;
    } else {
      taskSearchQuery = target.value;
    }
    filterOverviewEntries(
      target.dataset.action === 'search-notes' ? 'notes' : 'tasks',
      target.dataset.action === 'search-notes' ? noteSearchQuery : taskSearchQuery,
      target.dataset.action === 'search-notes' ? state.sections.length : state.tasks.length,
    );
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') {
      state = event.data.data;
      // The host owns the applied query, so a fresh snapshot supersedes any
      // local draft and the bar always shows what the results reflect.
      queryDraft = undefined;
      // The builder's rows survive the echo of a query this builder just
      // sent, and are rebuilt whenever the query changed some other way.
      const appliedText = (state.query && state.query.text) || '';
      if (appliedText !== builderSourceText) {
        builderDraft = undefined;
        builderSourceText = appliedText;
      }
      const advanced = state.query && state.query.isAdvanced;
      if (advanced) queryPanelOpen = true;
      vscode.setState({
        tagKey: state.tag && state.tag.key,
        filterTagKey: state.filterTag && state.filterTag.key,
        filterTagKeys: (state.filterTags || []).map(function (tag) { return tag.key; }),
        query: advanced ? state.query.text : undefined,
      });
      render();
    }
  });

  function getFilterTagKeys(value) {
    if (!value) return undefined;
    try {
      const filterTagKeys = JSON.parse(value);
      return Array.isArray(filterTagKeys) && filterTagKeys.every(function (key) {
        return typeof key === 'string' && key.length > 0;
      }) ? filterTagKeys : undefined;
    } catch (_error) {
      return undefined;
    }
  }
}());
</script>
</body>
</html>`;
}

