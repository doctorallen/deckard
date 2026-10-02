import * as vscode from 'vscode';

import { createNonce } from './components';
import { buildPageShell } from './host/pageShell';
import { escapeHtml } from '../../shared/html';
import { getDeckardTheme } from './themes';
import { isZenModeEnabled } from './zenMode';
import { type DeckardTheme } from './themeNames';
import { EntryRelatedNotesDiagnostic } from './pages/sidebarNotes/sidebarNotesController';

/** What each term on the page means, shown above the candidates. */
const DIAGNOSTIC_GUIDE = `<section class="guide" aria-labelledby="debug-guide-title">
<h2 id="debug-guide-title">How to read this page</h2>
<p class="lead">Start with the <strong>Contribution</strong> and <strong>Reasons</strong> rows in each candidate. The terms below explain the detailed association and text-matching evidence.</p>
<div class="guide-grid">
<div class="guide-card"><h3>Source unit</h3><p>One distinct place where Deckard can observe tags: a tagged heading, tagged line, task, or heading-to-heading relationship. The <strong>Shared source units</strong> value counts how many such places contain both tags; it is not a file count. <strong>Tag appearances</strong> shows selected-tag / candidate-tag / all-source-unit counts.</p></div>
<div class="guide-card"><h3>Raw evidence</h3><p>The starting strength of a tag relationship. Tags written together count as a full co-occurrence; heading relationships contribute a smaller amount based on distance. Repeated observations add more raw evidence. The table labels this starting value <strong>Raw connection</strong>.</p></div>
<div class="guide-card"><h3>Normalized relevance</h3><p>Raw evidence adjusted for confidence and popularity. Repeated support helps, while a relationship involving very common tags is discounted, so generic tags do not overwhelm intentional pairings. The table labels this adjusted value <strong>Adjusted connection</strong>.</p></div>
<div class="guide-card"><h3>BM25 lexical similarity</h3><p>BM25 (also written BM-25) is a search-style text comparison. It looks for meaningful words shared by the selected and candidate entries, gives rarer words more influence, accounts for repeated words and entry length, and caps the result below a direct tag match. The table lists each word's <strong>Text match (BM25)</strong> contribution.</p></div>
</div>
</section>`;

/**
 * The Related Notes diagnostic page: why each candidate ranked where it did
 * for the selected entry, with every weight written out, so a ranking can be
 * checked by hand.
 */
export function getRelatedNotesDebugHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  /** The extension's folder, which the page's style sheet is under. */
  extensionUri: vscode.Uri,
  diagnostic: EntryRelatedNotesDiagnostic,
  /** The theme its host read, preview and all; the configured one without. */
  theme?: DeckardTheme,
): string {
  const selectedTags = diagnostic.tags.map((tag) =>
    `<tr><td>${escapeHtml(tag.key)}</td><td>${tag.weight.toFixed(2)}</td><td>${escapeHtml(getTagContextLabel(tag.context))}</td><td>${escapeHtml(tag.source)}</td></tr>`,
  ).join('');
  const scale = readSelectedScale(diagnostic);
  const candidates = diagnostic.snapshot.notes.map((note, index) => renderCandidate(note, index, scale)).join('');
  return buildPageShell({
    webview,
    extensionUri,
    page: 'relatedNotesDebug',
    nonce: createNonce(),
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    // The page runs no script, so its policy names none.
    csp: { scripts: false },
    body: `<main><p class="lead">Deckard / Related Notes diagnostic</p><h1>${escapeHtml(diagnostic.title)}</h1>
<p class="source">${escapeHtml(diagnostic.filePath)} / line ${diagnostic.sourceLine}</p>
<p class="lead">Tags written on the selected entry have full weight (1.00). Explicit tags on parent and child headings provide context at <code>0.5 / depth</code>; tagged child items start at two levels of decay. If a tag appears in more than one place, the strongest weight wins.</p>
${DIAGNOSTIC_GUIDE}
<h2>Selected tag weights</h2><table><thead><tr><th title="A tag used as context for the selected entry.">Tag</th><th title="The tag's relevance weight. Tags written on the selected entry are 1.00; parent and child heading tags decay by distance, while child items include an additional level.">Weight</th><th title="Whether the tag is written on the selected entry, inherited from parent ancestry, or found in a child heading or child item.">Context</th><th title="The source of this weight and the distance decay formula.">Why</th></tr></thead><tbody>${selectedTags}</tbody></table>
<h2>How candidate tags are evaluated</h2><p class="lead">Candidate tags do not receive a second ancestor-weighting pass. A candidate contributes only tags indexed on that displayed entry; the selected tag's weight determines the shared-tag contribution. The 2.00 direct multiplier is Deckard's base signal for an exact shared tag. Learned associations retain their raw evidence, then normalize it by support and tag prevalence before saturation. Entry-scoped Wiki links are stronger than file-level links; section-scoped BM25-style lexical similarity remains capped below direct tags.</p>
<h2>Ranked candidates</h2>${candidates || '<p class="lead">No related entries found.</p>'}</main>`,
  });
}

function getTagContextLabel(
  context: EntryRelatedNotesDiagnostic['tags'][number]['context'],
): string {
  switch (context) {
    case 'selected':
      return 'Selected entry';
    case 'parent':
      return 'Parent ancestry';
    case 'child':
      return 'Child heading';
    case 'childItem':
      return 'Child item';
  }
}

/** A diagnostic's candidate entry, as the ranking explained it. */
type DiagnosticNote = EntryRelatedNotesDiagnostic['snapshot']['notes'][number];

/** The evidence a candidate was ranked on, when the ranking kept it. */
type DiagnosticEvidence = NonNullable<DiagnosticNote['relevanceEvidence']>;

/** The selected entry's tag weights, which scale every candidate's contributions. */
interface SelectedScale {
  /** Each selected tag's weight, by key. */
  weights: Map<string, number>;
  /** The weights summed: the scale associations saturate against. */
  total: number;
  /** The sum written out, as the page shows it. */
  calculation: string;
}

/** Reads the selected tags' weights once, for every candidate's tables. */
function readSelectedScale(diagnostic: EntryRelatedNotesDiagnostic): SelectedScale {
  const weights = new Map(
    diagnostic.tags.map((tag) => [tag.key, tag.weight]),
  );
  const total = diagnostic.tags.reduce(
    (sum, tag) => sum + tag.weight,
    0,
  );
  const calculation = diagnostic.tags
    .map((tag) => tag.weight.toFixed(2))
    .join(' + ');
  return { weights, total, calculation };
}

/** One ranked candidate's article: its tag matches, association paths, lexical evidence, and weights. */
function renderCandidate(note: DiagnosticNote, index: number, scale: SelectedScale): string {
  const evidence = note.relevanceEvidence;
  const matchedTagRows = note.matchedTags.map((tag) => {
    const selectedWeight = scale.weights.get(tag.key) ?? 1;
    return `<tr><td>${escapeHtml(tag.label)}</td><td>${selectedWeight.toFixed(2)}</td><td>2.00</td><td>${(selectedWeight * 2).toFixed(2)}</td></tr>`;
  }).join('');
  const associationRows = (note.associationMatches ?? []).map((match) =>
    `<tr><td>${escapeHtml(match.selectedTag.label)}</td><td>${escapeHtml(match.candidateTag.label)}</td><td>${match.sourceUnitCount}</td><td>${match.selectedTagSourceUnitCount} / ${match.candidateTagSourceUnitCount} / ${match.totalSourceUnitCount}</td><td>${match.associationWeight.toFixed(2)}</td><td>${match.normalizedAssociationWeight.toFixed(2)}</td><td>${match.selectedWeight.toFixed(2)}</td><td>${match.contribution.toFixed(2)}</td></tr>`,
  ).join('');
  const associationCap = evidence ? renderAssociationCap(evidence, scale) : '';
  const weights = evidence ? candidateWeights(evidence) : [];
  return `<article><h2>${index + 1}. ${escapeHtml(note.title)} <strong>${note.relevanceScore}%</strong></h2>
<p class="source">${escapeHtml(note.filePath)} / line ${note.sourceLine}${note.dailyDate ? ` / daily note ${escapeHtml(note.dailyDate)}` : ''}</p>
${note.headingPath.length ? `<p class="source">Heading path: ${escapeHtml(note.headingPath.join(' > '))}</p>` : ''}
<h3>Matched tags</h3>${matchedTagRows
  ? `<table><thead><tr><th title="A tag written on this candidate entry that exactly matches a selected tag.">Candidate tag</th><th title="The selected tag's direct, parent-ancestry, child-heading, or child-item weight.">Selected weight</th><th title="The fixed strength applied to an exact shared tag.">Direct multiplier</th><th title="Selected weight multiplied by the direct-match multiplier.">Contribution</th></tr></thead><tbody>${matchedTagRows}</tbody></table>`
  : '<p class="lead">No direct tag match; this result is connected by other evidence.</p>'}
<h3>Association paths</h3>${associationRows
  ? `<table><thead><tr><th>Selected tag</th><th>Candidate tag</th><th title="The number of distinct source units where both tags were observed.">Shared source units</th><th title="Selected tag / candidate tag / all source-unit counts.">Tag appearances<br><small>selected / candidate / all</small></th><th title="The starting co-occurrence and heading-proximity strength before adjustments.">Raw connection</th><th title="Raw connection adjusted for support and tag popularity.">Adjusted connection</th><th>Selected weight</th><th>Contribution</th></tr></thead><tbody>${associationRows}</tbody></table>`
  : '<p class="lead">No tag-association evidence.</p>'}
${associationCap}
<h3>Lexical evidence</h3>${evidence?.lexicalTerms.length ? `<table><thead><tr><th>Shared term</th><th title="BM25 is a search-ranking formula that weights distinctive shared words more than common words.">Text match (BM25)</th></tr></thead><tbody>${evidence.lexicalTerms.map((term) => `<tr><td>${escapeHtml(term.term)}</td><td>${term.contribution.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '<p class="lead">No section-scoped lexical evidence.</p>'}
<p><b>Reasons:</b> ${escapeHtml(note.reasons?.join(' | ') || 'None')}</p>
<table><tbody>${weights.map(([label, value]) => `<tr><td>${escapeHtml(String(label))}</td><td>${Number(value).toFixed(2)}</td></tr>`).join('')}</tbody></table></article>`;
}

/** How the association evidence was saturated against the selected tags' scale, as a worked calculation. */
function renderAssociationCap(evidence: DiagnosticEvidence, scale: SelectedScale): string {
  return `<details class="calculation"><summary>How association weight is applied</summary><p class="lead">The selected tags provide the scale: <code>${scale.calculation} = ${scale.total.toFixed(2)}</code>. This candidate has <code>${evidence.associationWeight.toFixed(2)}</code> raw association evidence and <code>${evidence.normalizedAssociationWeight.toFixed(2)}</code> adjusted association evidence. Deckard applies diminishing returns, so more indirect evidence still helps but cannot outweigh direct shared tags.</p><p class="source">Calculation: <code>${scale.total.toFixed(2)} x (${evidence.normalizedAssociationWeight.toFixed(2)} / (${evidence.normalizedAssociationWeight.toFixed(2)} + ${scale.total.toFixed(2)})) = ${evidence.appliedAssociationWeight.toFixed(2)}</code></p></details>`;
}

/** The weights a candidate's score is the sum of, leaving out those that are zero. */
function candidateWeights(evidence: DiagnosticEvidence): (string | number)[][] {
  return [
    ['Shared tags', evidence.directTagWeight],
    ['Associations', evidence.appliedAssociationWeight],
    ['Direct entry link', evidence.entryLinkWeight],
    ['File link', evidence.fileLinkWeight],
    ['Lexical similarity', evidence.lexicalWeight],
    ['Recency tie-breaker', evidence.recencyWeight],
    ['Specificity adjustment', -evidence.specificityPenalty],
  ].filter(([, value]) => value !== 0);
}
