import * as vscode from 'vscode';

import { EntryRelatedNotesDiagnostic } from './sidebarNotes';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

export function getRelatedNotesDebugHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
  diagnostic: EntryRelatedNotesDiagnostic,
): string {
  const nonce = createNonce();
  const selectedWeights = new Map(
    diagnostic.tags.map((tag) => [tag.key, tag.weight]),
  );
  const totalSelectedWeight = diagnostic.tags.reduce(
    (total, tag) => total + tag.weight,
    0,
  );
  const selectedWeightCalculation = diagnostic.tags
    .map((tag) => tag.weight.toFixed(2))
    .join(' + ');
  const selectedTags = diagnostic.tags.map((tag) =>
    `<tr><td>${escapeHtml(tag.key)}</td><td>${tag.weight.toFixed(2)}</td><td>${escapeHtml(getTagContextLabel(tag.context))}</td><td>${escapeHtml(tag.source)}</td></tr>`,
  ).join('');
  const diagnosticGuide = `<section class="guide" aria-labelledby="debug-guide-title">
<h2 id="debug-guide-title">How to read this page</h2>
<p class="lead">Start with the <strong>Contribution</strong> and <strong>Reasons</strong> rows in each candidate. The terms below explain the detailed association and text-matching evidence.</p>
<div class="guide-grid">
<div class="guide-card"><h3>Source unit</h3><p>One distinct place where Deckard can observe tags: a tagged heading, tagged line, task, or heading-to-heading relationship. The <strong>Shared source units</strong> value counts how many such places contain both tags; it is not a file count. <strong>Tag appearances</strong> shows selected-tag / candidate-tag / all-source-unit counts.</p></div>
<div class="guide-card"><h3>Raw evidence</h3><p>The starting strength of a tag relationship. Tags written together count as a full co-occurrence; heading relationships contribute a smaller amount based on distance. Repeated observations add more raw evidence. The table labels this starting value <strong>Raw connection</strong>.</p></div>
<div class="guide-card"><h3>Normalized relevance</h3><p>Raw evidence adjusted for confidence and popularity. Repeated support helps, while a relationship involving very common tags is discounted, so generic tags do not overwhelm intentional pairings. The table labels this adjusted value <strong>Adjusted connection</strong>.</p></div>
<div class="guide-card"><h3>BM25 lexical similarity</h3><p>BM25 (also written BM-25) is a search-style text comparison. It looks for meaningful words shared by the selected and candidate entries, gives rarer words more influence, accounts for repeated words and entry length, and caps the result below a direct tag match. The table lists each word's <strong>Text match (BM25)</strong> contribution.</p></div>
</div>
</section>`;
  const candidates = diagnostic.snapshot.notes.map((note, index) => {
    const evidence = note.relevanceEvidence;
    const matchedTagRows = note.matchedTags.map((tag) => {
      const selectedWeight = selectedWeights.get(tag.key) ?? 1;
      return `<tr><td>${escapeHtml(tag.label)}</td><td>${selectedWeight.toFixed(2)}</td><td>2.00</td><td>${(selectedWeight * 2).toFixed(2)}</td></tr>`;
    }).join('');
    const associationRows = (note.associationMatches ?? []).map((match) =>
      `<tr><td>${escapeHtml(match.selectedTag.label)}</td><td>${escapeHtml(match.candidateTag.label)}</td><td>${match.sourceUnitCount}</td><td>${match.selectedTagSourceUnitCount} / ${match.candidateTagSourceUnitCount} / ${match.totalSourceUnitCount}</td><td>${match.associationWeight.toFixed(2)}</td><td>${match.normalizedAssociationWeight.toFixed(2)}</td><td>${match.selectedWeight.toFixed(2)}</td><td>${match.contribution.toFixed(2)}</td></tr>`,
    ).join('');
    const associationCap = evidence
      ? `<details class="calculation"><summary>How association weight is applied</summary><p class="lead">The selected tags provide the scale: <code>${selectedWeightCalculation} = ${totalSelectedWeight.toFixed(2)}</code>. This candidate has <code>${evidence.associationWeight.toFixed(2)}</code> raw association evidence and <code>${evidence.normalizedAssociationWeight.toFixed(2)}</code> adjusted association evidence. Deckard applies diminishing returns, so more indirect evidence still helps but cannot outweigh direct shared tags.</p><p class="source">Calculation: <code>${totalSelectedWeight.toFixed(2)} x (${evidence.normalizedAssociationWeight.toFixed(2)} / (${evidence.normalizedAssociationWeight.toFixed(2)} + ${totalSelectedWeight.toFixed(2)})) = ${evidence.appliedAssociationWeight.toFixed(2)}</code></p></details>`
      : '';
    const weights = evidence
      ? [
          ['Shared tags', evidence.directTagWeight],
          ['Associations', evidence.appliedAssociationWeight],
          ['Direct entry link', evidence.entryLinkWeight],
          ['File link', evidence.fileLinkWeight],
          ['Lexical similarity', evidence.lexicalWeight],
          ['Recency tie-breaker', evidence.recencyWeight],
          ['Specificity adjustment', -evidence.specificityPenalty],
        ].filter(([, value]) => value !== 0)
      : [];
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
  }).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}';">
<style nonce="${nonce}">:root { color-scheme: dark; --bg:#050608; --panel:#121620; --text:#d9e0e4; --muted:#9ba4ae; --line:#334050; --cyan:#00e5ff; --amber:#ffb000; } *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 var(--vscode-font-family,sans-serif)} main{max-width:960px;margin:auto;padding:28px} h1,h2,code{font-family:var(--vscode-editor-font-family,monospace)} h1{margin:0;color:var(--amber)} h2{margin:0 0 6px;color:var(--cyan);font-size:17px} h3{margin:20px 0 8px;color:var(--text);font-size:15px} .lead,.source{color:var(--muted)} article{margin:16px 0;padding:16px;border-left:4px solid var(--cyan);background:var(--panel)} .guide{margin:20px 0;padding:16px;border:1px solid var(--line);background:var(--panel)} .guide h2{margin-top:0} .guide-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px} .guide-card{padding:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 76%,var(--bg))} .guide-card h3{margin:0 0 5px;color:var(--amber);font-size:14px} .guide-card p{margin:0;color:var(--text)} .guide strong{color:var(--amber)} .calculation{margin-top:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 76%,var(--bg))} .calculation summary{padding:8px 10px;color:var(--cyan);cursor:pointer;font-weight:700} .calculation p{margin:0;padding:0 10px 10px} .calculation p + p{padding-top:0} article h2 strong{float:right;color:var(--amber)} table{width:100%;margin-top:10px;border:1px solid var(--line);border-collapse:separate;border-spacing:0;background:color-mix(in srgb,var(--panel) 82%,var(--bg))} th,td{padding:10px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);vertical-align:top} th{color:var(--cyan);font-weight:700;text-align:left;background:color-mix(in srgb,var(--panel) 68%,var(--bg));white-space:nowrap} th small{color:var(--muted);font-size:11px;font-weight:400;text-transform:none} th:last-child,td:last-child{border-right:0} tbody tr:last-child td{border-bottom:0} tbody tr:hover{background:color-mix(in srgb,var(--panel) 75%,var(--cyan))} td:last-child{font-family:var(--vscode-editor-font-family,monospace);color:var(--amber)} @media (max-width: 720px){main{padding:16px}.guide-grid{grid-template-columns:1fr}table{display:block;overflow-x:auto;white-space:nowrap}td,th{padding:8px 10px}} ${getDeckardThemeCss(getDeckardTheme())}</style></head>
<body><main><p class="lead">Deckard / Related Notes diagnostic</p><h1>${escapeHtml(diagnostic.title)}</h1>
<p class="source">${escapeHtml(diagnostic.filePath)} / line ${diagnostic.sourceLine}</p>
<p class="lead">Tags written on the selected entry have full weight (1.00). Explicit tags on parent and child headings provide context at <code>0.5 / depth</code>; tagged child items start at two levels of decay. If a tag appears in more than one place, the strongest weight wins.</p>
${diagnosticGuide}
<h2>Selected tag weights</h2><table><thead><tr><th title="A tag used as context for the selected entry.">Tag</th><th title="The tag's relevance weight. Tags written on the selected entry are 1.00; parent and child heading tags decay by distance, while child items include an additional level.">Weight</th><th title="Whether the tag is written on the selected entry, inherited from parent ancestry, or found in a child heading or child item.">Context</th><th title="The source of this weight and the distance decay formula.">Why</th></tr></thead><tbody>${selectedTags}</tbody></table>
<h2>How candidate tags are evaluated</h2><p class="lead">Candidate tags do not receive a second ancestor-weighting pass. A candidate contributes only tags indexed on that displayed entry; the selected tag's weight determines the shared-tag contribution. The 2.00 direct multiplier is Deckard's base signal for an exact shared tag. Learned associations retain their raw evidence, then normalize it by support and tag prevalence before saturation. Entry-scoped Wiki links are stronger than file-level links; section-scoped BM25-style lexical similarity remains capped below direct tags.</p>
<h2>Ranked candidates</h2>${candidates || '<p class="lead">No related entries found.</p>'}</main></body></html>`;
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function createNonce(): string {
  return Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
      Math.floor(Math.random() * 62),
    ),
  ).join('');
}
