import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getPageTailCss,
  zenBodyAttribute,
} from './components';
import { helpIcon, notesGraphIcon, taskBoardIcon } from './icons';

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
<style nonce="${nonce}">${getBaseCss()}
.relevance-score, .version { font-family: var(--font-mono); }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding-bottom: 8px; border-bottom: 2px solid var(--line-strong); }
.sidebar-header .eyebrow { flex: 0 0 auto; }
/* The selected entry is context for the list, not the subject of the pane:
   two lines of it, so the related notes start above the fold. */
.active-name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.version { flex: 0 0 auto; color: var(--green); font-size: var(--text-xs); }
.active-file { margin-top: 8px; padding: 7px; border: 2px solid var(--line); border-left: 4px solid var(--amber); background: var(--panel); overflow-wrap: anywhere; }
.graph-selected-node { display: block; width: 100%; color: var(--text); text-align: left; text-transform: none; }
.graph-selected-node:hover, .graph-selected-node:focus-visible { border-color: var(--cyan); border-left-color: var(--amber); background: var(--panel-raised); color: var(--text); }
.active-label, .section-label { color: var(--muted); font-size: var(--text-xs); }
.active-summary { display: grid; gap: 2px; cursor: pointer; list-style: none; }
.active-summary::-webkit-details-marker { display: none; }
.active-summary:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.active-file[open] .active-name { -webkit-line-clamp: 3; }
.sidebar-query { display: block; overflow-wrap: anywhere; color: var(--cyan); font: 11px var(--vscode-editor-font-family, ui-monospace, monospace); }
.active-name { margin-top: 3px; }
.clear-entry-context { margin-top: 7px; min-height: 0; border: 1px solid var(--line); background: transparent; color: var(--muted); padding: 3px 6px; font-size: var(--text-xs); text-transform: none; }
.clear-entry-context:hover, .clear-entry-context:focus-visible { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
/* The toolbar drops under the name when the panel is narrower than both, as
   VS Code lets a sidebar be, rather than reaching past its edge. */
.sidebar-header { flex-wrap: wrap; }
.sidebar-toolbar { display: flex; flex: 0 0 auto; margin-left: auto; justify-content: flex-end; gap: 6px; }
/* Themes slide a row right on hover, which reads well across a wide list and
   badly in a panel this narrow: the row has nowhere to go but out, and the
   panel answers with a scrollbar. The hover keeps its border and ground.
   Written to outweigh the theme sheet, which is laid down after this one. */
body .note:hover { transform: none; }
.icon-button { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 5px; color: var(--text); }
.icon-button svg { width: 16px; height: 16px; display: block; fill: currentColor; }
.icon-button svg.outline-icon { fill: none; stroke: currentColor; }
.related-notes-sort-control { position: relative; display: block; margin-top: 10px; }
select.related-notes-sort { width: 100%; min-height: 30px; margin: 0; border: 2px solid var(--line); background: var(--panel-deep); color: var(--text); padding-left: 29px; font: inherit; }
.related-notes-sort-icon { position: absolute; top: 50%; left: 8px; width: 14px; height: 14px; pointer-events: none; color: currentColor; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; transform: translateY(-50%); }
/* The sort control takes the shared control hover, border and all: its own
   amber border and amber text were both out of step with every other hover,
   and unreadable on a theme whose hover background is light. The icon sits
   over the control, so it follows the same text color. */
select.related-notes-sort:hover ~ .related-notes-sort-icon { color: var(--hover-fg); }
.active-tag-list { display: grid; gap: 3px; margin-top: 8px; }
button:hover { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
button:focus-visible, .note:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.active-name .tag-open { max-width: 100%; min-height: 0; border: 0; background: transparent; color: inherit; padding: 0; text-transform: none; }
.active-name .tag-open:hover, .active-name .tag-open:focus-visible { border-color: transparent; background: transparent; color: var(--cyan-bright); }
.section-label { display: block; margin: 10px 0 6px; padding-left: 6px; border-left: 2px solid var(--amber); }
.note-list { display: grid; gap: 8px; }
.note { position: relative; border: 2px solid var(--line); background: var(--panel); padding: 9px; cursor: pointer; }
.note:hover, .note:focus-within { z-index: 20; border-color: var(--line-strong); }
.note-header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
.note-title { min-width: 0; overflow-wrap: anywhere; }
.note-title .inline-tag { color: var(--text); }
.relevance-score { display: inline-grid; flex: 0 0 auto; place-items: center; min-width: 24px; color: var(--green); }
.relevance-score .tag-weight-rail-segment.filled { background: currentColor; }
.note-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.insert-link { flex: 0 0 auto; min-height: 0; border: 0; background: transparent; padding: 0; color: var(--muted); cursor: pointer; opacity: 0; }
.insert-link svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; display: block; }
.note:hover .insert-link, .note:focus-within .insert-link, .insert-link:focus-visible { opacity: 1; }
.insert-link:hover { color: var(--accent); }
.relevance-wrap { position: relative; flex: 0 0 auto; }
.relevance-tooltip { position: absolute; z-index: 30; top: calc(100% + 7px); right: 0; display: none; width: 220px; border: 2px solid var(--amber); background: var(--panel-raised); color: var(--text); padding: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .45); font-size: 11px; line-height: 1.35; }
.relevance-wrap:hover .relevance-tooltip, .relevance-wrap:focus-within .relevance-tooltip, .relevance-wrap.is-open .relevance-tooltip { display: block; }
.relevance-score { min-height: 0; border: 0; background: transparent; padding: 0; cursor: pointer; }
.relevance-score:hover, .relevance-score:focus-visible { background: transparent; color: var(--amber); }
.relevance-reason { margin-top: 5px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.relevance-tooltip-header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--amber); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.relevance-tooltip ul { margin: 7px 0; padding-left: 16px; }
.relevance-tooltip li + li { margin-top: 3px; }
.relevance-weights { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; border-top: 1px solid var(--line); padding-top: 6px; color: var(--muted); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: var(--text-xs); }
.relevance-weights strong { color: var(--green); font-weight: 600; }
.note .tag-list { margin-top: 7px; }
.note .tag-list button:not(:hover):not(:focus-visible) { color: var(--text); }
.active-file .tag-list button:not(:hover):not(:focus-visible) { color: var(--text); }
.graph-kind { flex: 0 0 auto; border: 1px solid var(--line); padding: 2px 5px; color: var(--muted); font: var(--text-xs) var(--vscode-editor-font-family, ui-monospace, monospace); }
.graph-kind.task { color: var(--amber); }
.graph-kind.tag { color: var(--green); }
.graph-tag-pill { margin-left: 0; color: var(--text); }
/* The active search's Refine options. */
.refine-values { display: grid; gap: 3px; }
.refine-subject { margin: 2px 0 0; color: var(--cyan); font: 11px var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refine-value { display: flex; align-items: stretch; gap: 3px; }
/* A tag as a full-width row, for the note's own tags and the related tags in
   Refine: its rail, its name, and its count. The theme's own .tag-open layout
   is set aside here, and the text matches the other Refine rows rather than a
   tag's smaller size. */
.active-tag-list .tag-open.active-tag-open, .refine-value .tag-open.refine-value-open { width: 100%; display: flex; flex: 1 1 auto; min-width: 0; min-height: 24px; align-items: center; gap: 6px; margin: 0; border: 1px solid var(--line); background: var(--panel); color: var(--text); padding: 4px 8px; font-size: inherit; text-align: left; transform: none; }
.active-tag-list .tag-open.active-tag-open:hover, .active-tag-list .tag-open.active-tag-open:focus-visible, .refine-value .tag-open.refine-value-open:hover, .refine-value .tag-open.refine-value-open:focus-visible { border-color: var(--amber); background: var(--panel-raised); color: var(--text); transform: none; }
.active-tag-open > .tag-label, .refine-value-open > .tag-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The note's own tags are few, so a long one wraps from the left in full. */
.active-tag-open > .tag-label { overflow: visible; white-space: normal; overflow-wrap: anywhere; }
.refine-open-tag { display: inline-grid; flex: 0 0 24px; min-height: 24px; place-items: center; border: 1px solid var(--line); background: var(--panel); color: var(--muted); padding: 2px; }
.refine-open-tag svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.refine-open-tag:hover, .refine-open-tag:focus-visible { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
.refine-count { color: var(--muted); font: var(--text-xs) var(--font-mono); }
.refine-choice { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--text); padding: 4px 8px; text-align: left; text-transform: none; }
.refine-choice:hover, .refine-choice:focus-visible { border-color: var(--amber); color: var(--amber); background: var(--panel-raised); }
.refine-heading { margin-top: 12px; padding: 8px 9px; border: 2px solid var(--line); border-left: 4px solid var(--amber); background: var(--panel); }
.refine-heading h2 { margin: 0; color: var(--amber); font-size: 11px; }
.refine-hint { margin: 6px 0 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.4; }
.heading-path-joiner { color: var(--cyan-bright, #63F2FF); font-weight: 700; }

/* The sidebar is narrow, so it runs tighter than a full-width page. */
body { min-width: 220px; font-size: 12px; }
main { width: 100%; max-width: none; padding: 12px; border-top: 2px solid var(--amber); }
.eyebrow { min-width: 0; flex: 1 1 auto; overflow: hidden; font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.tag-list { display: flex; gap: 5px; margin: 8px 0 0; }
button { min-height: 0; padding: 4px 6px; color: var(--cyan); }
.inline-tag { display: inline-block; min-height: 0; padding: 1px 4px; border-width: 1px; font-size: .85em; }
.source { margin-top: 4px; font-size: var(--text-xs); }
.empty { margin-top: 12px; padding: 14px 10px; line-height: 1.45; }
${getPageTailCss()}
</style>
</head>
<body${zenBodyAttribute()}>
<main id="app"><div class="empty">Loading related notes...</div></main>
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
  console.log('[Deckard Related Notes] Webview script started.');
  let state;

  

  

  

  

  function renderTag(tag, extraClass) {
    return '<button class="' + (extraClass || '') + '" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">' + renderTagLabel(tag.label) + '</button>';
  }

  /**
   * One of the note's tags, drawn as a related tag is in Refine: a full-width
   * row of its weight, its name, and how much a search for it finds.
   */
  function renderActiveTag(tag) {
    const weight = Number(tag.weight);
    const hasWeight = Number.isFinite(weight) && weight > 0;
    const matches = tag.matches || { notes: 0, tasks: 0 };
    const total = matches.notes + matches.tasks;
    const found = matches.notes + ' note' + (matches.notes === 1 ? '' : 's') + ' · ' + matches.tasks + ' task' + (matches.tasks === 1 ? '' : 's');
    const weightText = hasWeight ? 'Related Notes weight ' + weight.toFixed(2) + '. ' : '';
    return '<button type="button" class="tag-open active-tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" title="' + escapeHtml(weightText + found + '. Open its page.') + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview (' + escapeHtml((hasWeight ? 'Related Notes weight ' + weight.toFixed(2) + ', ' : '') + found) + ')">'
      + (hasWeight ? renderWeightRail(getWeightLevel(weight), 'Segmented rail, Related Notes weight ' + weight.toFixed(2)) : '')
      + renderTagLabel(tag.label)
      + '<span class="refine-count">' + total + '</span></button>';
  }

  function renderTags(tags, extraClass) {
    return tags.map(function (tag) {
      return renderTag(tag, extraClass);
    }).join('');
  }

  /**
   * What clicking a value does to the search, named as the query names it,
   * so the three modifiers do not have to be remembered.
   */
  function describeRefineValue(value) {
    const clause = value.clause || '';
    return [
      value.detail ? value.detail : '',
      'Click — AND ' + clause + ': keep only results that match it',
      'Alt-click — AND NOT ' + clause + ': leave those results out',
      'Shift-click — OR ' + clause + ': widen the last value chosen here, so either matches',
    ].filter(Boolean).join('\\n');
  }

  /** One value of a facet: a tag opens, and the row narrows by it. */
  function renderRefineValue(facet, value) {
    const narrow = ' data-facet-id="' + escapeHtml(facet.id) + '" data-clause="' + escapeHtml(value.clause) + '"';
    const help = describeRefineValue(value);
    if (facet.id === 'related' || facet.id === 'tags') {
      const hasStrength = typeof value.strength === 'number';
      const strengthText = hasStrength ? ', related ' + getWeightLevel(value.strength) + ' of 3' : '';
      // The row narrows the search by the tag; the icon beside it opens the
      // tag's own page in a new tab.
      return '<div class="refine-value"><button type="button" class="tag-open refine-value-open" data-action="refine"' + narrow + ' title="' + escapeHtml(help) + '" aria-label="Add ' + escapeHtml(value.label + strengthText) + ' to the search, ' + value.count + '. Enter adds AND, Alt-Enter adds AND NOT, Shift-Enter adds OR.">' + (hasStrength ? renderWeightRail(getWeightLevel(value.strength)) : '') + renderTagLabel(value.label) + '<span class="refine-count">' + value.count + '</span></button>'
        + '<button type="button" class="refine-open-tag" data-action="open-tag" data-tag-key="' + escapeHtml(value.clause) + '" aria-label="Open ' + escapeHtml(value.label) + ' in a new tab" title="Open ' + escapeHtml(value.label) + ' in a new tab"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg></button></div>';
    }
    return '<button type="button" class="refine-choice" data-action="refine"' + narrow + ' aria-label="' + escapeHtml(facet.label + ': ' + value.label + ', ' + value.count) + '" title="' + escapeHtml(help) + '"><span>' + escapeHtml(value.label) + '</span><span class="refine-count">' + value.count + '</span></button>';
  }

  /**
   * The active search page's Refine options, in place of related notes. The
   * page shows its own search, terms, and counts, so the sidebar shows only
   * what could narrow them.
   */
  function renderRefine(refine) {
    const query = refine.query;
    const facets = query.facets || [];
    // Which search these narrow. With two search pages open, nothing said
    // which one a value here would change.
    const subject = refine.title
      ? '<p class="refine-subject" title="' + escapeHtml(refine.title) + '">' + escapeHtml(refine.title) + '</p>'
      : '';
    const heading = '<div class="refine-heading"><h2>Refine</h2>' + subject
      + (facets.length && String(query.text || '').trim()
        ? '<p class="refine-hint">Selecting a value adds it to the search with AND; Alt-click adds it with AND NOT, and Shift-click with OR, widening the value chosen before it. The icon beside a tag opens it in a new tab.</p>'
        : '')
      + '</div>';
    if (!String(query.text || '').trim()) {
      return heading + '<div class="empty">Search on the page to see what its results could be narrowed by.</div>';
    }
    if (!facets.length) return heading + '<div class="empty">Nothing left to narrow by.</div>';
    return heading + facets.map(function (facet) {
      return '<section class="refine-facet" aria-label="' + escapeHtml(facet.label) + '"><span class="section-label">' + escapeHtml(facet.label) + '</span><div class="refine-values">' + facet.values.map(function (value) { return renderRefineValue(facet, value); }).join('') + '</div></section>';
    }).join('');
  }


  /** Shared shell for Related Notes and graph-connected node cards. */
  function renderNoteCard(className, attributes, titleHtml, trailingHtml, sourceHtml, bodyHtml) {
    return '<article class="note ' + className + '" tabindex="0" title="Open this entry. Cmd/Ctrl-click to open it beside the note you are reading." ' + attributes + '><div class="note-header"><h2 class="note-title">' + titleHtml + '</h2>' + trailingHtml + '</div>' + sourceHtml + bodyHtml + '</article>';
  }

  function renderGraphConnections(graph) {
    if (!graph.selectedNode) {
      return '<div class="empty">Select a graph node to inspect its connections.</div>';
    }
    if (!graph.connections.length) {
      return '<div class="empty">This graph node has no direct connections.</div>';
    }
    return '<div class="note-list">' + graph.connections.map(function (connection) {
      const node = connection.node;
      const title = node.kind === 'tag'
        ? '<span class="inline-tag graph-tag-pill">' + renderTagLabel(node.title) + '</span>'
        : escapeHtml(node.title);
      const kind = '<span class="graph-kind ' + node.kind + '">' + escapeHtml(node.kind) + '</span>';
      const source = node.filePath
        ? escapeHtml(formatSourceLocation(node.filePath.split('/').pop() || node.filePath, node.line))
        : 'Tag node';
      const relationships = connection.types.map(function (type) {
        return type.replaceAll('-', ' ');
      }).join(' · ');
      return renderNoteCard(
        'graph-node',
        'data-node-id="' + escapeHtml(node.id) + '"',
        title,
        kind,
        '<div class="source">' + source + '</div>',
        '<div class="source">' + escapeHtml(relationships) + '</div>'
      );
    }).join('') + '</div>';
  }

  function renderSelectedGraphNode(node) {
    const title = node.kind === 'tag'
      ? '<span class="inline-tag graph-tag-pill">' + renderTagLabel(node.title) + '</span>'
      : escapeHtml(node.title);
    return '<button type="button" class="active-file graph-selected-node" data-action="open-selected-graph-node" data-node-id="' + escapeHtml(node.id) + '" aria-label="Open selected ' + escapeHtml(node.kind) + ': ' + escapeHtml(node.title) + '"><span class="active-label">Selected graph node · open</span><span class="active-name">' + title + '</span></button>';
  }

  // A long list is drawn a page at a time; Show more adds the next page. The
  // count starts over whenever the sidebar shows a different list.
  const NOTE_PAGE_SIZE = 50;
  let visibleNoteLimit = NOTE_PAGE_SIZE;
  /** How many of the note's own tags are listed before the rest are folded. */
  const ACTIVE_TAG_PAGE_SIZE = 4;
  let showEveryActiveTag = false;
  /** Whether the selected-entry context is unfolded, kept across redraws. */
  let contextOpen = false;
  let visibleNoteListKey = '';

  function getNoteListKey() {
    return JSON.stringify([
      state.state,
      state.activeFileName,
      state.activeEntryTitle,
      state.relatedNotesSortMode,
    ]);
  }

  /** Render explicit empty states so the sidebar explains why no notes appear. */
  function render() {
    if (!state) return;
    closeTagContextMenu();
    let content;
    if (state.state === 'refine') {
      content = renderRefine(state.refine);
    } else if (state.state === 'graph') {
      content = renderGraphConnections(state.graph);
    } else if (state.state === 'loading') {
      content = '<div class="empty">Indexing this workspace…</div>';
    } else if (state.state === 'notIndexed') {
      content = '<div class="empty">This note is not indexed yet. Save it inside the notes folder to see related entries.</div>';
    } else if (state.state === 'noMarkdown') {
      content = '<div class="empty">Open a Markdown note to see related entries.</div>';
    } else if (state.state === 'noTags') {
      content = '<div class="empty">This note has no tags yet.</div>';
    } else if (state.state === 'noMatches') {
      content = '<div class="empty">No other notes share its tags.</div>';
    } else {
      const noteListKey = getNoteListKey();
      if (noteListKey !== visibleNoteListKey) {
        visibleNoteListKey = noteListKey;
        visibleNoteLimit = NOTE_PAGE_SIZE;
      }
      const shownNotes = state.notes.slice(0, visibleNoteLimit);
      const hiddenNoteCount = state.notes.length - shownNotes.length;
      const showMore = hiddenNoteCount > 0
        ? '<button type="button" class="show-more-notes" data-action="show-more-notes">' + (hiddenNoteCount > NOTE_PAGE_SIZE ? 'Show ' + NOTE_PAGE_SIZE + ' more of ' + hiddenNoteCount : 'Show ' + hiddenNoteCount + ' more') + '</button>'
        : '';
      content = '<div class="note-list">' + shownNotes.map(function (note) {
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
        // A precise-looking percentage from a heuristic ranker invites a
        // reader to build a model of it that two close scores then break.
        // The rail says strong, moderate, or weak; the number is in the
        // breakdown for anyone who wants it.
        const relevanceLevel = getWeightLevel(note.relevanceScore / 100);
        const relevanceWord = relevanceLevel >= 3 ? 'strong' : relevanceLevel === 2 ? 'moderate' : 'weak';
        const relevance = '<span class="relevance-wrap"><button type="button" class="relevance-score" data-action="show-relevance" aria-expanded="false" aria-label="Relevance ' + relevanceWord + ', ' + note.relevanceScore + ' of 100. Show how this was scored." title="Relevance ' + relevanceWord + '. How this note was scored">' + renderWeightRail(relevanceLevel) + '</button><span class="relevance-tooltip" role="tooltip"><span class="relevance-tooltip-header"><strong>Relevance score</strong><strong>' + note.relevanceScore + '%</strong></span><ul>' + relevanceReasons.map(function (reason) { return '<li>' + escapeHtml(reason) + '</li>'; }).join('') + '</ul><div class="relevance-weights">' + weights.map(function (item) { return '<span>' + escapeHtml(item[0]) + '</span><strong>' + Number(item[1]).toFixed(2) + '</strong>'; }).join('') + specificityAdjustment + '</div></span></span>';
        const pathHtml = note.headingPath && note.headingPath.length
          ? note.headingPath.map(function (part) { return escapeHtml(part); }).join('<span class="heading-path-joiner"> &gt; </span>')
          : '';
        // Writing a link to a result is the reason to have found it, and
        // the sidebar sits beside the note being written in. The button
        // stays out of the way until the card is under the pointer.
        const insertLink = '<button type="button" class="insert-link" data-action="insert-link" aria-label="Insert a link to ' + escapeHtml(note.title) + ' at the cursor" title="Write a [[link]] to this entry at the cursor"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.47 2.47 0 0 0-3.5-3.5l-.8.8"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.47 2.47 0 0 0 3.5 3.5l.8-.8"/></svg></button>';
        return renderNoteCard(
          '',
          'data-file-path="' + escapeHtml(note.filePath) + '" data-line="' + note.sourceLine + '"',
          titleHtml,
          '<div class="note-actions">' + insertLink + relevance + '</div>',
          '<div class="source">' + escapeHtml(formatSourceLocation(fileName, note.sourceLine)) + '</div>',
          (pathHtml ? '<div class="source heading-path">' + pathHtml + '</div>' : '') + '<div class="relevance-reason">' + escapeHtml(relevanceReasons[0]) + '</div><div class="tag-list" aria-label="Matching tags">' + tags + '</div>'
        );
      }).join('') + '</div>' + showMore;
    }
    // The note's own tags are context for the list below them, so only the
    // first few are kept on screen; the rest are one press away. A note with
    // a dozen tags used to push every related note out of view.
    const shownActiveTags = showEveryActiveTag
      ? state.activeTags
      : state.activeTags.slice(0, ACTIVE_TAG_PAGE_SIZE);
    const hiddenActiveTagCount = state.activeTags.length - shownActiveTags.length;
    const activeTags = state.activeTags.length
      ? '<div class="active-tag-list" aria-label="Active note tags">' + shownActiveTags.map(renderActiveTag).join('')
        + (hiddenActiveTagCount > 0
          ? '<button type="button" class="clear-entry-context" data-action="show-every-active-tag">Show ' + hiddenActiveTagCount + ' more ' + (hiddenActiveTagCount === 1 ? 'tag' : 'tags') + '</button>'
          : '')
        + '</div>'
      : '';
    const context = state.state === 'refine'
      ? ''
      : state.state === 'graph'
      ? (state.graph.selectedNode
        ? renderSelectedGraphNode(state.graph.selectedNode)
        : '<div class="active-file"><div class="active-label">Notes Graph</div><div class="active-name">Connected nodes</div></div>')
      : (state.activeFileName
        // The entry being ranked from, and its tags, are context: folded by
        // default so the related notes start at the top of a short pane, and
        // the fold is remembered.
        ? '<details class="active-file"' + (contextOpen ? ' open' : '') + '><summary class="active-summary"><span class="active-label">' + (state.activeEntryTitle ? 'Selected note' : 'Current note') + '</span><span class="active-name">' + escapeHtml(state.activeEntryTitle || state.activeFileName) + '</span></summary>'
          + (state.activeEntryTitle ? '<button class="clear-entry-context" data-action="clear-entry-related-notes">Show whole document</button>' : '')
          + activeTags + '</details>'
        : '');
    const relatedNotesSort = state.state !== 'graph' && state.state !== 'refine' && state.relatedNotesSortMode
      ? '<span class="related-notes-sort-control"><select class="related-notes-sort" data-action="set-related-notes-sort" aria-label="Sort related notes"><option value="tags" ' + (state.relatedNotesSortMode === 'tags' ? 'selected' : '') + '>Relevance</option><option value="newest" ' + (state.relatedNotesSortMode === 'newest' ? 'selected' : '') + '>Newest</option><option value="oldest" ' + (state.relatedNotesSortMode === 'oldest' ? 'selected' : '') + '>Oldest</option><option value="access" ' + (state.relatedNotesSortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select><svg class="related-notes-sort-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3v10m-2-8 2-2 2 2m4 8V3m-2 8 2 2 2-2"/></svg></span>'
      : '';
    const sectionLabel = state.state === 'graph'
      ? '<span class="section-label">Connected nodes</span>'
      : state.state === 'refine'
      ? ''
      : relatedNotesSort + (state.state === 'ready' ? '<span class="section-label">Related notes</span>' : '');
    document.getElementById('app').innerHTML = '<div class="sidebar-header"><p class="eyebrow" title="Deckard v${escapedExtensionVersion}">DECKARD</p><div class="sidebar-toolbar" role="toolbar" aria-label="Deckard actions"><button class="icon-button" data-action="open-help" aria-label="Open Help" title="Open Help">${helpIcon}</button><button class="icon-button" data-action="open-dashboard" aria-label="Open Dashboard" title="Open Dashboard"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2h5v5H2zm7 0h5v3H9zm0 5h5v7H9zM2 9h5v5H2z"/></svg></button><button class="icon-button" data-action="open-notes-graph" aria-label="Open Notes Graph" title="Open Notes Graph">${notesGraphIcon}</button><button class="icon-button" data-action="open-task-board" aria-label="Open Task Board" title="Open Task Board">${taskBoardIcon}</button><button class="icon-button" data-action="create-daily-note" aria-label="Create Daily Note" title="Create Daily Note"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h1v2h8V2h1v2h1v10H2V4h1zm0 4v7h10V6zm4 1h1v2h2v1H8v2H7v-2H5V9h2z"/></svg></button></div></div>' + context + sectionLabel + content;
  }

  document.addEventListener('toggle', function (event) {
    if (event.target.classList && event.target.classList.contains('active-file')) {
      contextOpen = event.target.open;
    }
  }, true);
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-action="show-more-notes"]')) {
      const firstNewNote = visibleNoteLimit;
      visibleNoteLimit += NOTE_PAGE_SIZE;
      render();
      // Keyboard readers continue from the first card the button revealed.
      const list = document.querySelector('.note-list');
      const next = list && list.children[firstNewNote];
      if (next && next.focus) next.focus();
      return;
    }
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
      if (target.dataset.action === 'show-every-active-tag') {
        showEveryActiveTag = true;
        render();
        return;
      }
      if (target.dataset.action === 'show-relevance') {
        // Pressing the score opens the panel that hovering shows, so the
        // reasons are reachable without a pointer.
        const wrap = target.closest('.relevance-wrap');
        const open = wrap && !wrap.classList.contains('is-open');
        document.querySelectorAll('.relevance-wrap.is-open').forEach(function (other) {
          other.classList.remove('is-open');
          const button = other.querySelector('[data-action="show-relevance"]');
          if (button) button.setAttribute('aria-expanded', 'false');
        });
        if (wrap && open) {
          wrap.classList.add('is-open');
          target.setAttribute('aria-expanded', 'true');
        }
        return;
      }
      if (target.dataset.action === 'insert-link') {
        const card = target.closest('.note');
        if (card) vscode.postMessage({ type: 'insertLink', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
        return;
      }
      if (target.dataset.action === 'open-tag') {
        vscode.postMessage({ type: 'openTag', tagKey: target.dataset.tagKey });
      }
      if (target.dataset.action === 'refine') {
        vscode.postMessage({
          type: 'refineActiveSearch',
          facetId: target.dataset.facetId,
          clause: target.dataset.clause,
          mode: event.altKey ? 'exclude' : event.shiftKey ? 'or' : 'and',
        });
      }
      if (target.dataset.action === 'open-help') vscode.postMessage({ type: 'openHelp' });
      if (target.dataset.action === 'open-dashboard') vscode.postMessage({ type: 'openDashboard' });
      if (target.dataset.action === 'open-notes-graph') vscode.postMessage({ type: 'openNotesGraph' });
      if (target.dataset.action === 'open-task-board') vscode.postMessage({ type: 'openTaskBoard' });
      if (target.dataset.action === 'open-selected-graph-node') {
        vscode.postMessage({
          type: 'activateNotesGraphNode',
          nodeId: target.dataset.nodeId,
          open: true
        });
      }
      if (target.dataset.action === 'create-daily-note') vscode.postMessage({ type: 'createDailyNote' });
      if (target.dataset.action === 'clear-entry-related-notes') vscode.postMessage({ type: 'clearEntryRelatedNotes' });
      return;
    }
    const graphNode = event.target.closest('.graph-node');
    if (graphNode) {
      vscode.postMessage({
        type: 'activateNotesGraphNode',
        nodeId: graphNode.dataset.nodeId,
        open: event.metaKey || event.ctrlKey
      });
      return;
    }
    const note = event.target.closest('.note');
    // Cmd/Ctrl-click opens the result beside the note it was ranked from,
    // the way a graph node already did.
    if (note) vscode.postMessage({ type: 'openSource', filePath: note.dataset.filePath, line: Number(note.dataset.line), beside: Boolean(event.metaKey || event.ctrlKey) });
  });
  document.addEventListener('pointerover', function (event) {
    const graphNode = event.target.closest('.graph-node');
    if (graphNode && !graphNode.contains(event.relatedTarget)) {
      vscode.postMessage({
        type: 'hoverNotesGraphNode',
        nodeId: graphNode.dataset.nodeId
      });
      return;
    }
    const note = event.target.closest('.note');
    if (!note || note.contains(event.relatedTarget)) return;
  });
  document.addEventListener('pointerout', function (event) {
    const graphNode = event.target.closest('.graph-node');
    if (graphNode && !graphNode.contains(event.relatedTarget)) {
      vscode.postMessage({ type: 'hoverNotesGraphNode' });
      return;
    }
    const note = event.target.closest('.note');
    if (!note || note.contains(event.relatedTarget)) return;
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
    if (event.key === 'Escape') {
      const open = document.querySelector('.relevance-wrap.is-open');
      if (open) {
        open.classList.remove('is-open');
        const button = open.querySelector('[data-action="show-relevance"]');
        if (button) {
          button.setAttribute('aria-expanded', 'false');
          if (button.focus) button.focus();
        }
        return;
      }
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-action]')) return;
    const graphNode = event.target.closest('.graph-node');
    if (graphNode) {
      event.preventDefault();
      vscode.postMessage({
        type: 'activateNotesGraphNode',
        nodeId: graphNode.dataset.nodeId,
        open: event.metaKey || event.ctrlKey
      });
      return;
    }
    const note = event.target.closest('.note');
    if (note) {
      event.preventDefault();
      vscode.postMessage({ type: 'openSource', filePath: note.dataset.filePath, line: Number(note.dataset.line), beside: Boolean(event.metaKey || event.ctrlKey) });
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

