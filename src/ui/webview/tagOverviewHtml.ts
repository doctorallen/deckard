import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getQueryEditorCss,
  getQueryEditorScript,
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
${getQueryEditorCss()}
/* The gear sits in the header's top-right corner. The margin keeps a short
   header tall enough to hold it. */
header > .toolbar { margin-top: 36px; }
header > .toolbar .view-options { position: absolute; top: 0; right: 0; }
.overview-title-filter { color: var(--text); }
.overview-title-joiner { color: var(--amber); font-size: .72em; font-weight: 400; }
.overview-tag-link.overview-tag-link {
  min-height: 0;
  margin: 0;
  border: 0;
  border-bottom: 1px solid transparent;
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
.query-summary { color: var(--cyan); font: 12px var(--vscode-editor-font-family, ui-monospace, monospace); overflow-wrap: anywhere; }
.overview-filter-tag { display: inline-flex; align-items: baseline; gap: 5px; }
.title-filter-remove { min-height: 18px; border: 1px solid var(--line-strong); border-radius: 50%; background: transparent; color: var(--text); padding: 0 4px; font-size: 12px; line-height: 16px; vertical-align: middle; }
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
@media (max-width: 700px) { main { padding: 16px; } header { align-items: start; flex-direction: column; } header > .toolbar { width: 100%; margin-top: 0; } .overview-split { grid-template-columns: 1fr; } }
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
${getQueryEditorScript()}
  let state;
  let activeTab = 'notes';
  let relationshipView = 'tree';
  /** Whether the search refines the page's tags, rather than replacing them. */
  function isRefinement() {
    return Boolean(state && state.query && typeof state.query.scope === 'string');
  }
  /** The tag the page is about, as its search box writes it. */
  function ownTag() {
    const focus = state && (state.entity || state.tag);
    return focus ? String(focus.key) : '';
  }
  const editor = createQueryEditor({
    getState: function () { return state && state.query; },
    render: function () { render(); },
    apply: function (text) {
      if (isRefinement()) vscode.postMessage({ type: 'setOverviewRefinement', refinement: text });
      else vscode.postMessage({ type: 'setOverviewQuery', query: text });
    },
    // Clearing returns the page to its own tag: tags added to it, and words
    // typed after them, go, and the tag the page is about stays.
    clear: function () {
      if (isRefinement()) vscode.postMessage({ type: 'setOverviewRefinement', refinement: ownTag() });
      else vscode.postMessage({ type: 'clearOverviewQuery' });
    },
    clearedText: function () { return isRefinement() ? ownTag() : ''; },
    // Plain words hide what they do not match at once; the rest waits for Enter.
    onDraft: function () {
      filterOverviewEntries('notes');
      filterOverviewEntries('tasks');
    },
    placeholder: function () {
      return isRefinement()
        ? 'Narrow these entries: words, #tags, is:open, has:due, updated >= 7d…'
        : 'tag = #project/atlas AND task = open';
    },
    label: 'Search this overview',
    actions: function (hasText) {
      return '<button data-action="save-filter" data-query-needs-text title="Save this search as a view"' + (hasText ? '' : ' disabled') + '>Save</button>';
    },
  });

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

  /**
   * Hide the entries that lack a plain word of the search, so words narrow
   * the page as they are typed, before the search runs.
   */
  function filterOverviewEntries(kind) {
    if (!state) return;
    const words = editor.previewWords(editor.currentText());
    const total = kind === 'notes' ? state.sections.length : state.tasks.length;
    let visibleCount = 0;
    document.querySelectorAll('[data-search-entry="' + kind + '"]').forEach(function (entry) {
      const text = entry.dataset.searchText || '';
      const visible = words.every(function (word) { return text.indexOf(word) >= 0; });
      entry.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    const filtering = words.length > 0 && visibleCount < total;
    document.querySelectorAll('[data-search-count="' + kind + '"]').forEach(function (count) {
      count.textContent = visibleCount + (filtering ? ' / ' + total : '');
    });
    const empty = document.querySelector('[data-search-empty="' + kind + '"]');
    if (empty) empty.hidden = !words.length || visibleCount > 0;
    if (kind === 'tasks') updateTaskFilterCounts(filtering);
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
    // A narrowed page shows only its results, as a filtered one does.
    if (isQueryView || filterTags.length || !state.tag || state.narrowed) return '';
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
    const notesCount = state.sections.length;
    const tasksCount = state.tasks.length;
    const notesPane = '<section class="overview-pane" aria-labelledby="notes-heading"><div class="overview-pane-header"><h2 id="notes-heading" class="overview-pane-heading">Notes (<span data-search-count="notes">' + notesCount + '</span>)</h2></div><div class="cards">' + cards + '<div class="empty" data-search-empty="notes" hidden>No notes match your search.</div></div></section>';
    const tasksPane = '<section class="overview-pane" aria-labelledby="tasks-heading"><div class="overview-pane-header"><h2 id="tasks-heading" class="overview-pane-heading">Tasks (<span data-search-count="tasks">' + tasksCount + '</span>)</h2><div class="overview-pane-controls">' + renderTaskFilterSwitch(state.taskFilter, taskCounts, 'set-task-filter') + '</div></div>' + tasks + '<div class="empty" data-search-empty="tasks" hidden>No tasks match your search.</div></section>';
    const layoutContent = state.layout === 'split'
      ? '<div class="overview-split">' + notesPane + tasksPane + '</div>'
      : renderResultTabs([
        { id: 'notes', label: 'Notes', count: notesCount },
        { id: 'tasks', label: 'Tasks', count: tasksCount },
      ], activeTab, 'Tag overview content') + '<div class="overview-tab-panel"' + (activeTab === 'notes' ? '' : ' hidden') + '>' + notesPane + '</div><div class="overview-tab-panel"' + (activeTab === 'tasks' ? '' : ' hidden') + '>' + tasksPane + '</div>';
    const hub = renderHub(isQueryView, filterTags);
    const layoutControls = '<div class="segmented toolbar-toggle-group layout-toggle-group" role="group" aria-label="Content layout"><button class="icon-button toolbar-toggle ' + (state.layout === 'tabs' ? 'active' : '') + '" data-action="set-layout" data-layout="tabs" aria-label="Tabs layout" aria-pressed="' + (state.layout === 'tabs') + '" title="Tabs: switch between Notes and Tasks"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M5 2.5V6"/></svg></button><button class="icon-button toolbar-toggle ' + (state.layout === 'split' ? 'active' : '') + '" data-action="set-layout" data-layout="split" aria-label="Side-by-side layout" aria-pressed="' + (state.layout === 'split') + '" title="Side by side: Notes 60%, Tasks 40%"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M9 2v12"/></svg></button></div>';
    const formatControls = '<div class="segmented toolbar-toggle-group" role="group" aria-label="Content format"><button class="icon-button toolbar-toggle ' + (state.renderMode === 'markdown' ? 'active' : '') + '" data-action="set-mode" data-mode="markdown" aria-label="Source view" aria-pressed="' + (state.renderMode === 'markdown') + '" title="Source: show the original Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg></button><button class="icon-button toolbar-toggle ' + (state.renderMode === 'html' ? 'active' : '') + '" data-action="set-mode" data-mode="html" aria-label="Rendered view" aria-pressed="' + (state.renderMode === 'html') + '" title="Rendered: show formatted Markdown"><svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5h9v9h-9zM5.5 6.5l-1.5 1.5 1.5 1.5M10.5 6.5 12 8l-1.5 1.5"/></svg></button></div>';
    const viewOptions = renderViewOptions([
      { label: 'Layout', html: layoutControls },
      { label: 'Format', html: formatControls },
    ]);
    const sortControl = '<label class="control-label">Sort:<span class="control-icon"><select data-action="set-sort" aria-label="Sort tag entries">' + '<option value="alphabetical" ' + (state.sortMode === 'alphabetical' ? 'selected' : '') + '>A-Z</option>' + '<option value="created" ' + (state.sortMode === 'created' ? 'selected' : '') + '>Newest created</option>' + '<option value="updated" ' + (state.sortMode === 'updated' ? 'selected' : '') + '>Recently updated</option>' + '<option value="access" ' + (state.sortMode === 'access' ? 'selected' : '') + '>Most accessed</option>' + '</select><svg class="control-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg></span></label>';
    const headerControls = '<div class="toolbar" role="group" aria-label="Tag entry view controls">' + viewOptions + '</div>';
    const savedViewName = state.savedViewName
      ? '<div class="saved-view-name" aria-label="Saved view: ' + escapeHtml(state.savedViewName) + '"><span class="saved-view-name-label">Saved view:</span> ' + escapeHtml(state.savedViewName) + '</div>'
      : '';
    const eyebrow = isQueryView || !state.tag
      ? 'DECKARD / SEARCH'
      : 'DECKARD / ' + (state.entity ? 'ENTITY' : 'TAG') + ' OVERVIEW';
    document.getElementById('app').innerHTML = '<header><div><div class="overview-eyebrow"><p class="eyebrow">' + eyebrow + '</p>' + '</div>' + savedViewName + '<h1 aria-label="' + escapeHtml(titleAriaLabel) + '">' + titleHtml + '</h1>' + entityMeta + '</div>' + headerControls + '</header>' + editor.renderBar(sortControl) + editor.renderFacets() + hub + layoutContent;
    filterOverviewEntries('notes');
    filterOverviewEntries('tasks');
    editor.afterRender();
  }

  installViewOptions();

  document.addEventListener('mousedown', function (event) {
    editor.handleMousedown(event);
  });
  document.addEventListener('focusin', function (event) {
    editor.handleFocusIn(event);
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
    if (editor.handleClick(event)) return;
    const target = event.target.closest('[data-action]');
    if (target) {
      if (target.dataset.action === 'set-mode') vscode.postMessage({ type: 'setRenderMode', mode: target.dataset.mode });
      if (target.dataset.action === 'set-layout') vscode.postMessage({ type: 'setTagOverviewLayout', layout: target.dataset.layout });
      if (target.dataset.action === 'set-task-filter') vscode.postMessage({ type: 'setTaskFilter', filter: target.dataset.filter });
      if (target.dataset.action === 'set-relationship-view') {
        relationshipView = target.dataset.view === 'graph' ? 'graph' : 'tree';
        render();
      }
      if (target.dataset.action === 'set-result-tab') {
        activeTab = target.dataset.tab;
        render();
      }
      if (target.dataset.action === 'save-filter') {
        vscode.postMessage({ type: 'saveTagOverviewFilter' });
      }
      if (target.dataset.action === 'create-hub') {
        vscode.postMessage({ type: 'createHubNote' });
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
    if (editor.handleKeydown(event)) return;
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
    if (editor.handleChange(event)) return;
    const target = event.target;
    if (target.dataset.action === 'set-sort') vscode.postMessage({ type: 'setTagOverviewSort', mode: target.value });
    if (target.dataset.action === 'toggle-task') vscode.postMessage({ type: 'toggleTask', taskId: target.dataset.taskId, completed: target.checked });
  });
  document.addEventListener('input', function (event) {
    editor.handleInput(event);
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') {
      state = event.data.data;
      editor.receive();
      const advanced = state.query && state.query.isAdvanced;
      vscode.setState({
        tagKey: state.tag && state.tag.key,
        filterTagKey: state.filterTag && state.filterTag.key,
        filterTagKeys: (state.filterTags || []).map(function (tag) { return tag.key; }),
        query: advanced ? state.query.text : undefined,
        refinement: isRefinement() && state.query.text ? state.query.text : undefined,
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

