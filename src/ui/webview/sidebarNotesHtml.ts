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
h2, .eyebrow, .source, .relevance-score, .version { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
h2 { margin: 0; color: var(--cyan); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding-bottom: 8px; border-bottom: 2px solid var(--line-strong); }
.eyebrow { min-width: 0; flex: 1 1 auto; margin: 0; overflow: hidden; color: var(--amber); font-size: 10px; letter-spacing: .15em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.version { flex: 0 0 auto; color: var(--green); font-size: 10px; }
.active-file { margin-top: 12px; padding: 9px; border: 2px solid var(--line); border-left: 4px solid var(--amber); background: var(--panel); overflow-wrap: anywhere; }
.active-label, .section-label { color: var(--muted); font-size: 10px; text-transform: uppercase; }
.active-name { margin-top: 3px; }
.clear-entry-context { margin-top: 7px; min-height: 0; border: 1px solid var(--line); background: transparent; color: var(--muted); padding: 3px 6px; font-size: 10px; text-transform: none; }
.clear-entry-context:hover, .clear-entry-context:focus-visible { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
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
.note { position: relative; border: 2px solid var(--line); background: var(--panel); padding: 9px; cursor: pointer; }
.note:hover, .note:focus-within { z-index: 20; border-color: var(--line-strong); }
.note-header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
.note-title { min-width: 0; overflow-wrap: anywhere; }
.inline-tag { display: inline-block; margin-left: 5px; padding: 1px 5px; border-width: 1px; color: var(--cyan); font-size: .85em; vertical-align: 1px; }
.relevance-score { flex: 0 0 auto; color: var(--green); font-size: 10px; }
.relevance-wrap { position: relative; flex: 0 0 auto; }
.relevance-tooltip { position: absolute; z-index: 30; top: calc(100% + 7px); right: 0; display: none; width: 220px; border: 2px solid var(--amber); background: var(--panel-raised); color: var(--text); padding: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .45); font-size: 11px; line-height: 1.35; }
.relevance-wrap:hover .relevance-tooltip, .relevance-wrap:focus-within .relevance-tooltip { display: block; }
.relevance-tooltip-header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--amber); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.relevance-tooltip ul { margin: 7px 0; padding-left: 16px; }
.relevance-tooltip li + li { margin-top: 3px; }
.relevance-weights { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; border-top: 1px solid var(--line); padding-top: 6px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 10px; }
.relevance-weights strong { color: var(--green); font-weight: 600; }
.source { margin-top: 4px; color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.note .tag-list { margin-top: 7px; }
.note .tag-list button { color: var(--text); }
.sidebar-relationships { margin-top: 8px; overflow: visible; border: 2px solid var(--line); background: var(--panel-deep); }
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
.sidebar-relationship-count, .sidebar-association-score { color: var(--muted); font: 10px var(--vscode-editor-font-family, ui-monospace, monospace); }
.sidebar-association-score { flex: 0 0 auto; color: var(--green); }
.sidebar-association-meta { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.sidebar-relationship-namespace { border-top: 1px solid var(--line); margin: 3px 0 0 10px; }
.sidebar-relationship-namespace > summary { padding: 5px 8px 5px 10px; border-left: 3px solid var(--cyan); background: var(--panel-deep); color: var(--cyan); font-size: 10px; font-weight: 650; letter-spacing: .06em; }
.sidebar-relationship-namespace > summary:hover, .sidebar-relationship-namespace > summary:focus-visible { background: var(--panel-raised); color: var(--cyan-bright); }
.sidebar-relationship-items { display: grid; gap: 3px; margin: 0 8px 5px; padding: 3px 0 0; }
.sidebar-associated-tag { display: flex; align-items: stretch; gap: 3px; }
.sidebar-relationship-items .tag-open { width: 100%; min-width: 0; overflow: visible; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-add-filter { flex: 0 0 27px; min-height: 27px; border: 1px solid var(--line); background: var(--panel); color: var(--green); padding: 2px; font-size: 16px; line-height: 1; }
.sidebar-add-filter:hover, .sidebar-add-filter:focus-visible { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
.sidebar-relationships .tag-open.relationship-tag {
  position: relative;
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
  z-index: 10;
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
.sidebar-association-score-wrap { position: relative; }
.sidebar-association-score-wrap:hover .sidebar-association-tooltip,
.sidebar-association-score-wrap:focus-within .sidebar-association-tooltip { display: block; }
.sidebar-association-tooltip { position: absolute; z-index: 30; top: calc(100% + 6px); right: 0; display: none; width: 210px; border: 2px solid var(--amber); background: var(--panel-raised); color: var(--text); padding: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .45); font-size: 11px; line-height: 1.35; pointer-events: none; }
.sidebar-association-tooltip-header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--amber); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.sidebar-association-tooltip p { margin: 6px 0; }
.sidebar-association-tooltip-weights { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; border-top: 1px solid var(--line); padding-top: 6px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 10px; }
.sidebar-association-tooltip-weights strong { color: var(--green); font-weight: 600; }
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
  console.log('[Deckard Related Notes] Webview script started.');
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
  function renderSidebarRelationshipTag(tag, count, weight, normalizedWeight, coOccurrenceCount, headingRelationshipCount, direction, overviewTagKey, detail) {
    const countHtml = Number(count) > 1
      ? '<span class="sidebar-relationship-count">x' + escapeHtml(count) + '</span>'
      : '';
    const directWeight = Number(coOccurrenceCount);
    const headingWeight = Math.max(0, Number(weight) - directWeight);
    const percentage = Math.round(Number(normalizedWeight) * 100);
    const scoreHtml = '<span class="sidebar-association-score-wrap"><span class="sidebar-association-score" aria-label="Association strength ' + percentage + ' percent">' + percentage + '%</span><span class="sidebar-association-tooltip" role="tooltip"><span class="sidebar-association-tooltip-header"><strong>Association strength</strong><strong>' + percentage + '%</strong></span><p>' + escapeHtml(detail) + '</p><div class="sidebar-association-tooltip-weights"><span>Raw direct weight</span><strong>' + directWeight.toFixed(2) + '</strong><span>Raw heading weight</span><strong>' + headingWeight.toFixed(2) + '</strong><span>Total weight</span><strong>' + Number(weight).toFixed(2) + '</strong><span>Normalized relevance</span><strong>' + Number(normalizedWeight).toFixed(2) + '</strong></div></span></span>';
    const label = direction === 'parent'
      ? 'Open parent tag '
      : direction === 'child'
        ? 'Open child tag '
        : 'Open associated tag ';
    const overviewAttribute = overviewTagKey
      ? ' data-overview-tag-key="' + escapeHtml(overviewTagKey) + '"'
      : '';
    return '<div class="sidebar-associated-tag"><button class="tag-open relationship-tag" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="' + escapeHtml(label + tag.label) + '"><span>' + escapeHtml(tag.label) + '</span><span class="sidebar-association-meta">' + scoreHtml + countHtml + '</span></button><button class="sidebar-add-filter" data-action="add-overview-filter" data-add-tag-key="' + escapeHtml(tag.key) + '"' + overviewAttribute + ' aria-label="Add ' + escapeHtml(tag.label) + ' to this overview filter" title="Add ' + escapeHtml(tag.label) + ' to filter">+</button></div>';
  }

  /** Render every association in one strength-sorted list. */
  function renderSidebarAssociations(relationships, overviewTagKey) {
    return relationships.slice().sort(function (left, right) {
      return right.normalizedWeight - left.normalizedWeight || right.weight - left.weight || left.associatedTag.label.localeCompare(right.associatedTag.label, undefined, { sensitivity: 'base' });
    }).map(function (relationship) {
      const detail = relationship.coOccurrenceCount
        ? 'Written together ' + relationship.coOccurrenceCount + ' time' + (relationship.coOccurrenceCount === 1 ? '' : 's') + (relationship.headingRelationshipCount ? '; heading context ' + relationship.headingRelationshipCount + ' time' + (relationship.headingRelationshipCount === 1 ? '' : 's') : '')
        : 'Heading context ' + relationship.headingRelationshipCount + ' time' + (relationship.headingRelationshipCount === 1 ? '' : 's');
      return renderSidebarRelationshipTag(relationship.associatedTag, relationship.count, relationship.weight, relationship.normalizedWeight, relationship.coOccurrenceCount, relationship.headingRelationshipCount, 'associated', overviewTagKey, detail);
    }).join('');
  }

  /** Render a narrow, nested relationship tree when a tag overview is active. */
  function renderSidebarRelationships(snapshot) {
    const relationships = snapshot.tagOverviewRelationships;
    if (!relationships) return '';
    const filterTagKeys = snapshot.tagOverviewFilters || (snapshot.tagOverviewFilter ? [snapshot.tagOverviewFilter.key] : []);
    const associations = filterTagKeys.length
      ? relationships.sharedAssociatedTags || []
      : relationships.associatedTags || [];
    if (!associations.length) return '';
    return '<section class="sidebar-relationships" aria-label="Tag associations"><details class="sidebar-relationship-branch"><summary><span>Associated tags</span><span class="sidebar-relationship-count">' + associations.length + '</span></summary><div class="sidebar-relationship-items sidebar-association-items">' + renderSidebarAssociations(associations, snapshot.tagOverview.key) + '</div></details></section>';
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
    const tagOverviewFilters = state.tagOverviewFilters || (state.tagOverviewFilter ? [state.tagOverviewFilter] : []);
    let content;
    if (state.state === 'noMarkdown') {
      content = '<div class="empty">Open a Markdown note to see related entries.</div>';
    } else if (state.state === 'noTags') {
      content = '<div class="empty">This note has no tags yet.</div>';
    } else if (state.state === 'noMatches') {
      content = state.tagOverview
        ? '<div class="empty">' + (tagOverviewFilters.length ? 'No notes currently carry all selected tags.' : 'No notes currently carry this tag.') + '</div>'
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
        const relevanceReasons = note.reasons && note.reasons.length
          ? note.reasons
          : ['Related note'];
        const evidence = note.relevanceEvidence || {
          directTagWeight: 0,
          associationWeight: note.associationWeight || 0,
          normalizedAssociationWeight: note.associationWeight || 0,
          appliedAssociationWeight: note.associationWeight || 0,
          entryLinkWeight: 0,
          fileLinkWeight: 0,
          lexicalWeight: 0,
          recencyWeight: 0,
          specificityPenalty: 0,
          lexicalTerms: [],
        };
        const weights = [
          ['Shared-tag weight', evidence.directTagWeight],
          ['Association weight', evidence.appliedAssociationWeight],
          ['Direct entry-link weight', evidence.entryLinkWeight],
          ['File-link weight', evidence.fileLinkWeight],
          ['Lexical weight', evidence.lexicalWeight],
          ['Recency tie-breaker', evidence.recencyWeight],
        ].filter(function (item) { return item[1] > 0; });
        const specificityAdjustment = evidence.specificityPenalty > 0
          ? '<span>Specificity adjustment</span><strong>-' + Math.round(evidence.specificityPenalty * 100) + ' pts</strong>'
          : '';
        const relevance = state.tagOverview
          ? ''
          : '<span class="relevance-wrap"><span class="relevance-score" aria-label="Relevance score ' + note.relevanceScore + ' percent">' + note.relevanceScore + '%</span><span class="relevance-tooltip" role="tooltip"><span class="relevance-tooltip-header"><strong>Relevance score</strong><strong>' + note.relevanceScore + '%</strong></span><ul>' + relevanceReasons.map(function (reason) { return '<li>' + escapeHtml(reason) + '</li>'; }).join('') + '</ul><div class="relevance-weights">' + weights.map(function (item) { return '<span>' + escapeHtml(item[0]) + '</span><strong>' + Number(item[1]).toFixed(2) + '</strong>'; }).join('') + specificityAdjustment + '</div></span></span>';
        const path = note.headingPath && note.headingPath.length
          ? note.headingPath.join(' > ')
          : '';
        const context = (note.dailyDate ? 'Daily note ' + note.dailyDate : '') + (note.dailyDate && path ? ' / ' : '') + path;
        return '<article class="note" tabindex="0" data-file-path="' + escapeHtml(note.filePath) + '" data-line="' + note.sourceLine + '"><div class="note-header"><h2 class="note-title">' + titleHtml + '</h2>' + relevance + '</div><div class="source">' + escapeHtml(fileName) + ' / line ' + note.sourceLine + '</div>' + (context ? '<div class="source">' + escapeHtml(context) + '</div>' : '') + '<div class="tag-list" aria-label="Matching tags">' + tags + '</div></article>';
      }).join('') + '</div>';
    }
    const activeTags = state.activeTags.length ? '<div class="tag-list" aria-label="Active note tags">' + renderTags(state.activeTags, 'active-tag') + '</div>' : '';
    const context = state.tagOverview
      ? '<div class="active-file"><div class="active-label">Tag overview</div><div class="active-name">' + (state.tagOverviewFilter
        ? [state.tagOverview].concat(tagOverviewFilters).map(function (tag) { return renderTag(tag, 'active-filter-tag'); }).join('<span class="active-filter-joiner"> AND </span>')
        : renderTag(state.tagOverview, 'active-filter-tag')) + '</div></div>'
      : (state.activeFileName ? '<div class="active-file"><div class="active-label">' + (state.activeEntryTitle ? 'Selected note' : 'Current note') + '</div><div class="active-name">' + escapeHtml(state.activeEntryTitle || state.activeFileName) + '</div>' + (state.activeEntryTitle ? '<button class="clear-entry-context" data-action="clear-entry-related-notes">Show whole document</button>' : '') + activeTags + '</div>' : '');
    const relatedNotesSort = !state.tagOverview && state.relatedNotesSortMode
      ? '<span class="related-notes-sort-control"><select class="related-notes-sort" data-action="set-related-notes-sort" aria-label="Sort related notes"><option value="tags" ' + (state.relatedNotesSortMode === 'tags' ? 'selected' : '') + '>Relevance</option><option value="newest" ' + (state.relatedNotesSortMode === 'newest' ? 'selected' : '') + '>Newest</option><option value="oldest" ' + (state.relatedNotesSortMode === 'oldest' ? 'selected' : '') + '>Oldest</option><option value="access" ' + (state.relatedNotesSortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select><svg class="related-notes-sort-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg></span>'
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
        const message = { type: 'openTag', tagKey: target.dataset.overviewTagKey || target.dataset.tagKey };
        if (target.dataset.filterTagKey) message.filterTagKey = target.dataset.filterTagKey;
        if (target.dataset.filterTagKeys) {
          try {
            const filterTagKeys = JSON.parse(target.dataset.filterTagKeys);
            if (Array.isArray(filterTagKeys) && filterTagKeys.every(function (key) { return typeof key === 'string'; })) message.filterTagKeys = filterTagKeys;
          } catch (_error) {}
        }
        vscode.postMessage(message);
      }
      if (target.dataset.action === 'add-overview-filter') {
        const filterTagKeys = (state.tagOverviewFilters || []).map(
          function (tag) { return tag.key; },
        );
        if (
          target.dataset.overviewTagKey &&
          target.dataset.addTagKey &&
          Array.isArray(filterTagKeys) &&
          filterTagKeys.every(function (key) { return typeof key === 'string'; })
        ) {
          vscode.postMessage({
            type: 'openTag',
            tagKey: target.dataset.overviewTagKey,
            filterTagKeys: filterTagKeys.concat([target.dataset.addTagKey]),
          });
        }
      }
      if (target.dataset.action === 'open-help') vscode.postMessage({ type: 'openHelp' });
      if (target.dataset.action === 'open-dashboard') vscode.postMessage({ type: 'openDashboard' });
      if (target.dataset.action === 'create-daily-note') vscode.postMessage({ type: 'createDailyNote' });
      if (target.dataset.action === 'clear-entry-related-notes') vscode.postMessage({ type: 'clearEntryRelatedNotes' });
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
    if (event.data && event.data.type === 'state') {
      console.log('[Deckard Related Notes] Received state:', event.data.data.state);
      state = event.data.data;
      render();
    }
  });
  console.log('[Deckard Related Notes] Requesting initial state.');
  vscode.postMessage({ type: 'ready' });
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
