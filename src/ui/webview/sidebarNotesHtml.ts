import * as vscode from 'vscode';

import {
  createNonce,
  getComponentScript,
  loadingHtml,
} from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import {
  chevronRightIcon,
  ICON_PATHS,
  linkIcon,
  openInNewIcon,
  strokeIcon,
} from './icons';
import { getCalendarDayScript } from './calendarDay';
import { type DeckardTheme, getDeckardTheme } from './themes';

/**
 * Builds the compact Related Notes webview from host-provided snapshots.
 *
 * Keeping the view state-driven lets the host choose between active-note and
 * active-tag contexts while this document remains a simple navigation surface.
 *
 * The page no longer shows the extension's version. The parameter stays until
 * the view takes an options object (19-refactor.md, Phase 5), so its callers
 * and the harnesses that pin them do not change before then.
 */
export function getSidebarNotesHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri,
  _extensionVersion: string,
  /** The theme its host read, preview and all; the configured one without. */
  theme?: DeckardTheme,
): string {
  const nonce = createNonce();

  return buildPageShell({
    webview,
    extensionUri,
    page: 'sidebarNotes',
    title: 'Deckard Context',
    nonce,
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    body: `
${loadingHtml('Loading related notes…', 'data-sidebar')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript(theme)}
${getCalendarDayScript()}
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
    return '<button type="button" class="tag-open active-tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" data-tip="' + escapeHtml(weightText + found + '. Open its page.') + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview (' + escapeHtml((hasWeight ? 'Related Notes weight ' + weight.toFixed(2) + ', ' : '') + found) + ')">'
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
      const strengthText = !hasStrength
        ? ''
        : typeof value.total === 'number'
          ? ', in ' + value.count + ' of ' + value.total + ' results'
          : ', related ' + getWeightLevel(value.strength) + ' of 3';
      // The row narrows the search by the tag; the icon beside it opens the
      // tag's own page in a new tab.
      return '<div class="refine-value"><button type="button" class="tag-open refine-value-open" data-action="refine"' + narrow + ' data-tip="' + escapeHtml(help) + '" aria-label="Add ' + escapeHtml(value.label + strengthText) + ' to the search, ' + value.count + '. Enter adds AND, Alt-Enter adds AND NOT, Shift-Enter adds OR.">' + (hasStrength ? renderWeightRail(getWeightLevel(value.strength)) : '') + renderTagLabel(value.label) + '<span class="refine-count">' + value.count + '</span></button>'
        + '<button type="button" class="refine-open-tag" data-action="open-tag" data-tag-key="' + escapeHtml(value.clause) + '" aria-label="Open ' + escapeHtml(value.label) + ' in a new tab" data-tip="Open ' + escapeHtml(value.label) + ' in a new tab">${openInNewIcon}</button></div>';
    }
    return '<button type="button" class="refine-choice" data-action="refine"' + narrow + ' aria-label="' + escapeHtml(facet.label + ': ' + value.label + ', ' + value.count) + '" data-tip="' + escapeHtml(help) + '"><span>' + escapeHtml(value.label) + '</span><span class="refine-count">' + value.count + '</span></button>';
  }

  /**
   * The active search page's Refine options, in place of related notes. The
   * page shows its own search, terms, and counts, so the sidebar shows only
   * what could narrow them.
   */
  /** Refine facets opened past their first five, for this session. */
  const expandedRefine = new Set();

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
      const shown = facetValuesShown(facet, expandedRefine, 'refine-more');
      return '<section class="refine-facet" aria-label="' + escapeHtml(facet.label) + '"><span class="section-label">' + escapeHtml(facet.label) + '</span><div class="refine-values">' + shown.values.map(function (value) { return renderRefineValue(facet, value); }).join('') + shown.more + '</div></section>';
    }).join('');
  }


  /** Shared shell for Related Notes and graph-connected node cards. */
  function renderNoteCard(className, attributes, titleHtml, trailingHtml, sourceHtml, bodyHtml) {
    return '<article class="note ' + className + '" tabindex="0" data-tip="Open this entry. Cmd/Ctrl-click to open it beside the note you are reading." ' + attributes + '><div class="note-header"><h2 class="note-title">' + titleHtml + '</h2>' + trailingHtml + '</div>' + sourceHtml + bodyHtml + '</article>';
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
      // kind-note, not note: a bare note or task class is a card's, and gave
      // the badge a card's edge and hover.
      const kind = '<span class="graph-kind kind-' + node.kind + '">' + escapeHtml(node.kind) + '</span>';
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
      state.hideDailyNotes,
      Boolean(state.similar),
    ]);
  }

  /** How many lines of each excerpt to show: 0, 1, or 2. */
  function previewLines() {
    return state.previewLines === 0 || state.previewLines === 2 ? state.previewLines : 1;
  }

  /** Render explicit empty states so the sidebar explains why no notes appear. */
  /** Which of the Links groups are open, kept across redraws. */
  const linksOpen = { linked: true, mentions: false };
  /** The link rows unfolded onto their section, by file and line. */
  const openLinkSections = new Set();

  /**
   * What points at the note: the notes that link to it, each with its lines
   * under their headings, and the notes that name it without a link, each of
   * which can be made one here or all at once.
   */
  function renderLinks(links) {
    if (!links || (!links.linkedFromCount && !links.mentionCount)) return '';
    const row = function (entry, extra, withTitle) {
      const path = entry.headingPath && entry.headingPath.length ? '<span class="link-path">' + escapeHtml(entry.headingPath.join(' › ')) + '</span>' : '';
      const key = entry.filePath + ':' + entry.line;
      const expanded = entry.sectionText && openLinkSections.has(key);
      const expander = entry.sectionText
        ? '<button type="button" class="link-expand" data-action="toggle-link-section" data-section-key="' + escapeHtml(key) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '" aria-label="Show the rest of this section" data-tip="Show the rest of this section">${chevronRightIcon}</button>'
        : '';
      return '<li class="link-row"><div class="link-line"><button type="button" class="link-open" data-action="open-link" data-file-path="' + escapeHtml(entry.filePath) + '" data-line="' + entry.line + '" data-tip="Open this line. Cmd/Ctrl-click to open it beside the note.">' + (withTitle ? '<span class="link-note">' + escapeHtml(entry.title) + '</span>' : '') + path + '<span class="link-context">' + escapeHtml(entry.text) + '</span></button>' + (extra || '') + expander + '</div>'
        + (expanded ? '<p class="link-section">' + escapeHtml(entry.sectionText) + '</p>' : '')
        + '</li>';
    };
    const more = function (shown, count) {
      return count > shown ? '<p class="links-more">' + (count - shown) + ' more not listed</p>' : '';
    };
    const groups = links.linkedFromNotes || [];
    const shownLines = groups.reduce(function (total, group) { return total + group.entries.length; }, 0);
    const searchTip = 'Search for every entry that links here, so Refine, Bulk edit, Save, and Export work on them';
    const foot = links.linkedFromCount > shownLines
      ? '<p class="links-more">' + (links.linkedFromCount - shownLines) + ' more not listed. <button type="button" class="links-search" data-action="open-links-search" data-tip="' + searchTip + '">Open all as a search</button></p>'
      : '<p class="links-more"><button type="button" class="links-search" data-action="open-links-search" data-tip="' + searchTip + '">Open as search</button></p>';
    const hidden = links.hiddenDailyNoteCount || 0;
    const hiding = hidden
      ? '<p class="links-more links-hiding">Hiding ' + hidden + ' daily ' + (hidden === 1 ? 'note' : 'notes') + '. <button type="button" class="links-search" data-action="show-daily-notes">Show them</button></p>'
      : '';
    const linked = links.linkedFromCount
      ? '<details class="links-group" data-links-group="linked"' + (linksOpen.linked ? ' open' : '') + '><summary>Linked from <span class="links-count">' + (links.linkedFromNoteCount || groups.length) + '</span></summary>'
        + groups.map(function (group) {
          const first = group.entries[0];
          const meta = [group.updatedLabel, group.linkCount > 1 ? group.linkCount + ' links' : '', group.parked ? 'Parked' : ''].filter(Boolean).join(' · ');
          return '<section class="link-group" aria-label="' + escapeHtml(group.title) + '"><div class="link-group-head"><button type="button" class="link-group-open" data-action="open-link" data-file-path="' + escapeHtml(group.filePath) + '" data-line="' + (first ? first.line : 1) + '" data-tip="Open ' + escapeHtml(group.title) + ' at its first link here">' + escapeHtml(group.title) + '</button>' + (meta ? '<span class="link-group-meta">' + escapeHtml(meta) + '</span>' : '') + '</div>'
            + '<ul class="link-list">' + group.entries.map(function (entry) { return row(entry); }).join('') + '</ul></section>';
        }).join('') + foot + hiding + '</details>'
      : '';
    const mentions = links.mentionCount
      ? '<details class="links-group" data-links-group="mentions"' + (linksOpen.mentions ? ' open' : '') + '><summary>Mentioned without a link <span class="links-count">' + links.mentionCount + '</span></summary>'
        + '<button type="button" class="link-all" data-action="link-all-mentions" data-tip="Make every mention a [[link]], as one change Undo Last Change takes back">Link all</button><ul class="link-list">'
        + links.mentions.map(function (entry) {
          return row(entry, '<button type="button" class="link-one" data-action="link-mention" data-file-path="' + escapeHtml(entry.filePath) + '" data-line="' + entry.line + '" data-start-column="' + entry.startColumn + '" aria-label="Link this mention of ' + escapeHtml(entry.name) + ' in ' + escapeHtml(entry.title) + '" data-tip="Make this mention a [[link]]">Link</button>', true);
        }).join('') + '</ul>' + more(links.mentions.length, links.mentionCount) + '</details>'
      : '';
    return '<section class="note-links" aria-label="Links to this note">' + linked + mentions + '</section>';
  }

  /** One ranked result: its title, score, where it is, excerpt, and why. */
  function renderRankedNote(note) {
    const title = note.title || note.fileName || note.filePath;
    const titleHtml = state.tagTitleDisplayMode === 'inline'
      ? renderInlineTitle(title, note.titleTags)
      : escapeHtml(title);
    const fileName = note.fileName || note.filePath;
    const tags = state.tagTitleDisplayMode === 'separate'
      ? renderTags(note.matchedTags, 'matched-tag')
      : '';
    // The tags drawn as chips on the card: the matched tags under the
    // title when tags are shown apart from it, or the title's own when
    // they are shown inline. A reason that only lists tags the chips
    // already name, "Shared: …" or "Associated: …", said them twice;
    // it goes, and the line moves on to the next reason, or to nothing.
    const chipLabels = (tags ? note.matchedTags || [] : note.titleTags || []).map(function (tag) { return tag.label; });
    const namesOnlyChips = function (reason) {
      const match = /^(Shared|Associated): (.+)$/.exec(reason);
      if (!match) return false;
      const listed = match[2].split(', ');
      return listed.length > 0 && listed.every(function (label) { return chipLabels.indexOf(label) >= 0; });
    };
    const dropped = (note.reasons || []).filter(namesOnlyChips);
    const reasons = (note.reasons || []).filter(function (reason) { return !namesOnlyChips(reason); });
    const relevanceReasons = reasons.length
      ? reasons
      : dropped.length ? [] : ['Related note'];
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
    const relevance = '<span class="relevance-wrap"><button type="button" class="relevance-score" data-action="show-relevance" aria-expanded="false" aria-label="Relevance ' + relevanceWord + ', ' + note.relevanceScore + ' of 100. Show how this was scored.">' + renderWeightRail(relevanceLevel) + '</button><span class="relevance-tooltip popover is-tip" role="tooltip"><span class="relevance-tooltip-header"><strong>Relevance score</strong><strong>' + note.relevanceScore + '%</strong></span><ul>' + relevanceReasons.map(function (reason) { return '<li>' + escapeHtml(reason) + '</li>'; }).join('') + '</ul><div class="relevance-weights">' + weights.map(function (item) { return '<span>' + escapeHtml(item[0]) + '</span><strong>' + Number(item[1]).toFixed(2) + '</strong>'; }).join('') + specificityAdjustment + '</div></span></span>';
    const pathHtml = renderHeadingPath(note.headingPath, fileName, note.title);
    // Writing a link to a result is the reason to have found it, and
    // the sidebar sits beside the note being written in. The button
    // stays out of the way until the card is under the pointer.
    const insertLink = '<button type="button" class="insert-link" data-action="insert-link" aria-label="Insert a link to ' + escapeHtml(note.title) + ' at the cursor" data-tip="Write a [[link]] to this entry at the cursor">${linkIcon}</button>';
    // The words the card shares with the note, marked in its excerpt.
    const terms = (evidence.lexicalTerms || []).slice(0, 5).map(function (term) { return term.term; });
    const excerpt = note.excerpt && previewLines() > 0
      ? '<p class="note-excerpt">' + escapeHtml(note.excerpt) + '</p>'
      : '';
    return renderNoteCard(
      '',
      'data-file-path="' + escapeHtml(note.filePath) + '" data-line="' + note.sourceLine + '"' + (terms.length ? ' data-terms="' + escapeHtml(terms.join(' ')) + '"' : ''),
      titleHtml,
      '<div class="note-actions">' + insertLink + relevance + '</div>',
      '<div class="source">' + escapeHtml(formatSourceLocation(fileName, note.sourceLine)) + '</div>',
      (pathHtml ? '<div class="source heading-path">' + pathHtml + '</div>' : '') + excerpt + (relevanceReasons.length ? '<div class="relevance-reason">' + escapeHtml(relevanceReasons[0]) + '</div>' : '') + '<div class="tag-list" aria-label="Matching tags">' + tags + '</div>'
    );
  }

  /** Why an untagged note's list is empty, or the similar entries in its place. */
  function renderNoTags() {
    if (!state.similar) return '<div class="empty">This note has no tags yet.</div>';
    if (!state.similar.notes.length && !state.similar.tags.length) {
      return '<div class="empty">This note has no tags yet, and no other entry shares enough of its wording to suggest any.</div>';
    }
    return renderSimilar(state.similar);
  }

  /**
   * For a note with no tags: the tags entries worded like it use, first,
   * since tagging it is the way out of guessing, then those entries,
   * each marked weak and kept apart from the related notes.
   */
  function renderSimilar(similar) {
    if (!similar || (!similar.notes.length && !similar.tags.length)) return '';
    const tags = similar.tags.length
      ? '<section class="suggested-tags" aria-label="Tags used by similar notes"><span class="section-label">Tags used by similar notes</span>'
        + similar.tags.map(function (tag) {
          const tip = 'On ' + tag.entryCount + ' of the similar entries below. Add writes it on the heading or line where the cursor is.';
          return '<div class="suggested-tag"><button type="button" class="tag-open active-tag-open" data-action="open-tag" data-tag-key="' + escapeHtml(tag.key) + '" data-tip="' + escapeHtml(tip) + '">' + renderTagLabel(tag.label) + '<span class="refine-count">' + tag.entryCount + '</span></button>'
            + '<button type="button" class="suggested-tag-add" data-action="add-suggested-tag" data-suggested-tag="' + escapeHtml(tag.key) + '" aria-label="Add ' + escapeHtml(tag.label) + ' to this note" data-tip="Write ' + escapeHtml(tag.label) + ' on the heading or line where the cursor is">Add</button></div>';
        }).join('') + '</section>'
      : '';
    const notes = similar.notes.length
      ? '<section class="similar-wording" aria-label="Similar wording (no tags yet)"><span class="section-label">Similar wording (no tags yet)</span><p class="similar-hint">These share words with this note, not tags or links.</p><div class="note-list">' + similar.notes.map(renderRankedNote).join('') + '</div></section>'
      : '';
    return tags + notes;
  }

  /** Home's widgets to add, each one a click, and Reset. */
  function renderCustomizeHome(widgets) {
    const rows = widgets.map(function (widget) {
      return '<li><button type="button" class="home-widget-choice" data-action="home-add-widget" data-value="' + escapeHtml(widget.value) + '"' + (widget.description ? ' data-tip="' + escapeHtml(widget.description) + '"' : '') + '><span class="home-widget-choice-label">+ ' + escapeHtml(widget.label) + '</span>' + (widget.description ? '<span class="home-widget-choice-detail">' + escapeHtml(widget.description) + '</span>' : '') + '</button></li>';
    }).join('');
    return '<span class="section-label">Add a widget</span>'
      + (rows ? '<ul class="home-widget-choices">' + rows + '</ul>' : '<div class="empty">Every widget is on Home.</div>')
      + '<button type="button" class="home-reset-widgets" data-action="home-reset-widgets" data-tip="Put back the widgets Home started with">Reset widgets…</button>';
  }

  function render() {
    if (!state) return;
    closeTagContextMenu();
    let content;
    if (state.state === 'customizeHome') {
      content = renderCustomizeHome(state.homeWidgets || []);
    } else if (state.state === 'calendarDay') {
      content = renderCalendarDayPanel(state.calendarDay);
    } else if (state.state === 'refine') {
      content = renderRefine(state.refine);
    } else if (state.state === 'graph') {
      content = renderGraphConnections(state.graph);
    } else if (state.state === 'loading') {
      content = renderLoading(describeIndexing(state.progress), true);
    } else if (state.state === 'notIndexed') {
      content = '<div class="empty">This note is not indexed yet. Save it inside the notes folder to see related entries.</div>';
    } else if (state.state === 'noMarkdown') {
      content = '<div class="empty">Open a Markdown note to see related entries.</div>';
    } else if (state.state === 'noTags') {
      content = renderNoTags();
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
      content = '<div class="note-list">' + shownNotes.map(renderRankedNote).join('') + '</div>' + showMore + renderSimilar(state.similar);
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
      : state.state === 'customizeHome'
      ? '<div class="active-file"><div class="active-label">Home</div><div class="active-name">Customize</div></div>'
      : state.state === 'calendarDay'
      ? '<div class="active-file"><div class="active-label">Calendar</div><div class="active-name">The chosen day</div></div>'
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
    const relatedNotesSort = state.state !== 'graph' && state.state !== 'refine' && state.state !== 'calendarDay' && state.state !== 'customizeHome' && state.relatedNotesSortMode
      ? '<div class="related-notes-controls"><span class="related-notes-sort-control"><select class="related-notes-sort" data-action="set-related-notes-sort" aria-label="Sort related notes"><option value="tags" ' + (state.relatedNotesSortMode === 'tags' ? 'selected' : '') + '>Relevance</option><option value="newest" ' + (state.relatedNotesSortMode === 'newest' ? 'selected' : '') + '>Newest</option><option value="oldest" ' + (state.relatedNotesSortMode === 'oldest' ? 'selected' : '') + '>Oldest</option><option value="access" ' + (state.relatedNotesSortMode === 'access' ? 'selected' : '') + '>Most accessed</option></select>${strokeIcon(ICON_PATHS.sort, 'related-notes-sort-icon')}</span>'
        + renderViewOptions([
          { label: 'Preview', html: renderViewOptionChoices('set-preview-lines', [[0, 'None', 'No preview'], [1, '1 line', 'One line'], [2, '2 lines', 'Two lines']], previewLines(), 'Preview lines') },
          { label: 'Daily notes', html: renderViewOptionChoices('set-hide-daily', [['show', 'Show', 'Show daily notes'], ['hide', 'Hide', 'Hide daily, weekly, and monthly notes, which link to everything written that day']], state.hideDailyNotes ? 'hide' : 'show', 'Daily notes') },
        ]) + '</div>'
      : '';
    const sectionLabel = state.state === 'graph'
      ? '<span class="section-label">Connected nodes</span>'
      : state.state === 'refine' || state.state === 'calendarDay' || state.state === 'customizeHome'
      ? ''
      : relatedNotesSort + (state.state === 'ready' ? '<span class="section-label">Related notes</span>' : '');
    // The page's shortcuts are the view's own title-bar actions, as every
    // other sidebar view's are; the page starts with what it is about.
    const links = state.state === 'graph' || state.state === 'refine' || state.state === 'calendarDay' || state.state === 'customizeHome' ? '' : renderLinks(state.links);
    const app = document.getElementById('app');
    app.dataset.previewLines = String(previewLines());
    app.innerHTML = context + sectionLabel + content + links;
    // The shared words, marked where each excerpt says them.
    app.querySelectorAll('.note[data-terms]').forEach(function (card) {
      const excerpt = card.querySelector('.note-excerpt');
      if (excerpt) markWords(excerpt, card.dataset.terms.split(' '), { wordStart: true });
    });
  }

  installViewOptions();
  // The calendar page's chosen day, drawn here while the page is in front:
  // what is done in it goes to the page's host, through this one.
  installCalendarDayPanel(function (message) {
    vscode.postMessage({ type: 'calendarDay', message: message });
  }, function () { renderKeepingPlace(render); });
  document.addEventListener('click', function (event) {
    const add = event.target.closest('[data-action="home-add-widget"]');
    if (add) {
      vscode.postMessage({ type: 'homeAddWidget', value: add.dataset.value });
      return;
    }
    if (event.target.closest('[data-action="home-reset-widgets"]')) vscode.postMessage({ type: 'homeResetWidgets' });
  });
  document.addEventListener('toggle', function (event) {
    if (event.target.classList && event.target.classList.contains('active-file')) {
      contextOpen = event.target.open;
    }
    if (event.target.dataset && event.target.dataset.linksGroup) {
      linksOpen[event.target.dataset.linksGroup] = event.target.open;
    }
  }, true);
  document.addEventListener('click', function (event) {
    const link = event.target.closest('[data-action="open-link"]');
    if (link) {
      vscode.postMessage({ type: 'openSource', filePath: link.dataset.filePath, line: Number(link.dataset.line), beside: Boolean(event.metaKey || event.ctrlKey) });
      return;
    }
    const one = event.target.closest('[data-action="link-mention"]');
    if (one) {
      vscode.postMessage({ type: 'linkMention', filePath: one.dataset.filePath, line: Number(one.dataset.line), startColumn: Number(one.dataset.startColumn) });
      return;
    }
    const expand = event.target.closest('[data-action="toggle-link-section"]');
    if (expand) {
      const key = expand.dataset.sectionKey;
      if (openLinkSections.has(key)) openLinkSections.delete(key);
      else openLinkSections.add(key);
      render();
      const again = Array.prototype.find.call(document.querySelectorAll('[data-action="toggle-link-section"]'), function (button) { return button.dataset.sectionKey === key; });
      if (again && again.focus) again.focus();
      return;
    }
    if (event.target.closest('[data-action="show-daily-notes"]')) {
      vscode.postMessage({ type: 'setHideDailyNotes', hide: false });
      return;
    }
    const hideDaily = event.target.closest('[data-action="set-hide-daily"]');
    if (hideDaily) {
      vscode.postMessage({ type: 'setHideDailyNotes', hide: hideDaily.dataset.value === 'hide' });
      return;
    }
    const add = event.target.closest('[data-action="add-suggested-tag"]');
    if (add) {
      vscode.postMessage({ type: 'addSuggestedTag', tagKey: add.dataset.suggestedTag });
      return;
    }
    const preview = event.target.closest('[data-action="set-preview-lines"]');
    if (preview) {
      vscode.postMessage({ type: 'setRelatedNotesPreviewLines', lines: Number(preview.dataset.value) });
      return;
    }
    if (event.target.closest('[data-action="open-links-search"]')) {
      vscode.postMessage({ type: 'openLinksSearch' });
      return;
    }
    if (event.target.closest('[data-action="link-all-mentions"]')) vscode.postMessage({ type: 'linkAllMentions' });
  });
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
      if ((contextAction.dataset.contextAction === 'park-tag' || contextAction.dataset.contextAction === 'unpark-tag') && tagKey) {
        vscode.postMessage({ type: contextAction.dataset.contextAction === 'park-tag' ? 'parkTag' : 'unparkTag', tagKey: tagKey });
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
      if (target.dataset.action === 'facet-more') {
        const id = target.dataset.facetId;
        if (expandedRefine.has(id)) expandedRefine.delete(id);
        else expandedRefine.add(id);
        renderKeepingPlace(render);
        return;
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
      setParkedTags(state.parkedTags);
      renderKeepingPlace(render);
    }
  });
  console.log('[Deckard Related Notes] Requesting initial state.');
  vscode.postMessage({ type: 'ready' });
}());
</script>
`,
  });
}

