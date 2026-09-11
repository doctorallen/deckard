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
    `<tr><td>${escapeHtml(tag.key)}</td><td>${tag.weight.toFixed(2)}</td><td>${escapeHtml(tag.source)}</td></tr>`,
  ).join('');
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
      ? `<p class="lead">The selected-tag saturation scale is <code>${selectedWeightCalculation} = ${totalSelectedWeight.toFixed(2)}</code>. Raw association paths total <code>${evidence.associationWeight.toFixed(2)}</code>; support/prevalence-normalized paths total <code>${evidence.normalizedAssociationWeight.toFixed(2)}</code>. Deckard uses <code>${totalSelectedWeight.toFixed(2)} x (${evidence.normalizedAssociationWeight.toFixed(2)} / (${evidence.normalizedAssociationWeight.toFixed(2)} + ${totalSelectedWeight.toFixed(2)})) = ${evidence.appliedAssociationWeight.toFixed(2)}</code>. Stronger association evidence continues to raise the score, but with diminishing returns toward the selected-tag total, so indirect links cannot outweigh direct matches.</p>`
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
  ? `<table><thead><tr><th title="A tag written on this candidate entry that exactly matches a selected tag.">Candidate tag</th><th title="The selected tag's direct or ancestor-context weight.">Selected weight</th><th title="The fixed strength applied to an exact shared tag.">Direct multiplier</th><th title="Selected weight multiplied by the direct-match multiplier.">Contribution</th></tr></thead><tbody>${matchedTagRows}</tbody></table>`
  : '<p class="lead">No direct tag match; this result is connected by other evidence.</p>'}
<h3>Association paths</h3>${associationRows
  ? `<table><thead><tr><th>Selected tag</th><th>Candidate tag</th><th title="Distinct headings, tagged lines, tasks, or heading relationships that support this edge.">Support</th><th title="Selected / candidate / total atomic source units.">Tag source units</th><th title="Unchanged co-occurrence and heading-proximity evidence.">Raw evidence</th><th title="Raw evidence reduced when either tag is prevalent and increased with repeated support.">Normalized relevance</th><th>Selected weight</th><th>Contribution</th></tr></thead><tbody>${associationRows}</tbody></table>`
  : '<p class="lead">No tag-association evidence.</p>'}
${associationCap}
<h3>Lexical evidence</h3>${evidence?.lexicalTerms.length ? `<table><thead><tr><th>Shared term</th><th>BM25-style contribution</th></tr></thead><tbody>${evidence.lexicalTerms.map((term) => `<tr><td>${escapeHtml(term.term)}</td><td>${term.contribution.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '<p class="lead">No section-scoped lexical evidence.</p>'}
<p><b>Reasons:</b> ${escapeHtml(note.reasons?.join(' | ') || 'None')}</p>
<table><tbody>${weights.map(([label, value]) => `<tr><td>${escapeHtml(String(label))}</td><td>${Number(value).toFixed(2)}</td></tr>`).join('')}</tbody></table></article>`;
  }).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}';">
<style nonce="${nonce}">:root { color-scheme: dark; --bg:#050608; --panel:#121620; --text:#d9e0e4; --muted:#9ba4ae; --line:#334050; --cyan:#00e5ff; --amber:#ffb000; } *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 var(--vscode-font-family,sans-serif)} main{max-width:960px;margin:auto;padding:28px} h1,h2,code{font-family:var(--vscode-editor-font-family,monospace)} h1{margin:0;color:var(--amber)} h2{margin:0 0 6px;color:var(--cyan);font-size:17px} h3{margin:20px 0 8px;color:var(--text);font-size:15px} .lead,.source{color:var(--muted)} article{margin:16px 0;padding:16px;border-left:4px solid var(--cyan);background:var(--panel)} strong{float:right;color:var(--amber)} table{width:100%;margin-top:10px;border:1px solid var(--line);border-collapse:separate;border-spacing:0;background:color-mix(in srgb,var(--panel) 82%,var(--bg))} th,td{padding:10px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);vertical-align:top} th{color:var(--cyan);font-weight:700;text-align:left;background:color-mix(in srgb,var(--panel) 68%,var(--bg));white-space:nowrap} th:last-child,td:last-child{border-right:0} tbody tr:last-child td{border-bottom:0} tbody tr:hover{background:color-mix(in srgb,var(--panel) 75%,var(--cyan))} td:last-child{font-family:var(--vscode-editor-font-family,monospace);color:var(--amber)} ${getDeckardThemeCss(getDeckardTheme())}</style></head>
<body><main><p class="lead">Deckard / Related Notes diagnostic</p><h1>${escapeHtml(diagnostic.title)}</h1>
<p class="source">${escapeHtml(diagnostic.filePath)} / line ${diagnostic.sourceLine}</p>
<p class="lead">Tags written on the selected entry have full weight (1.00). Explicit tags on ancestor headings provide context at <code>0.5 / ancestor depth</code>; if a tag appears in both places, the stronger selected-entry weight wins.</p>
<h2>Selected tag weights</h2><table><thead><tr><th title="A tag used as context for the selected entry.">Tag</th><th title="The tag's relevance weight. Tags written on the selected entry are 1.00; ancestor tags decay by depth.">Weight</th><th title="The source of this weight and, for ancestor tags, the decay formula.">Why</th></tr></thead><tbody>${selectedTags}</tbody></table>
<h2>How candidate tags are evaluated</h2><p class="lead">Candidate tags do not receive a second ancestor-weighting pass. A candidate contributes only tags indexed on that displayed entry; the selected tag's weight determines the shared-tag contribution. The 2.00 direct multiplier is Deckard's base signal for an exact shared tag. Learned associations retain their raw evidence, then normalize it by support and tag prevalence before saturation. Entry-scoped Wiki links are stronger than file-level links; section-scoped BM25-style lexical similarity remains capped below direct tags.</p>
<h2>Ranked candidates</h2>${candidates || '<p class="lead">No related entries found.</p>'}</main></body></html>`;
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
