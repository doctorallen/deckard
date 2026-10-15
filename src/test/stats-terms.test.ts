import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { createDeckardStatsSnapshot, listTerms } from '../ui/state/statsState';
import { narrowStatsMessage } from '../ui/webview/pages/stats/messages';
import { createPreferences, MemoryStore } from './preferenceServices';
import { renderPage } from './pages';
import { openWebviewPage } from './webviewPage';

const lines = (...text: string[]): string => text.join('\n');

/** The moment Stats is drawn at: 14 Oct 2026, noon. */
const now = new Date(2026, 9, 14, 12).getTime();

/** UAT used in four entries and never defined, NDF defined inline, SLO by a term note. */
function termIndex() {
  const on = (day: string) => new Date(`${day}T09:00:00`).getTime();
  const notes: Array<[string, string, string]> = [
    ['FX recon kickoff.md', '2026-03-03', lines('# FX recon kickoff', 'Book the NDF (non-deliverable forward) trades in UAT.')],
    ['a.md', '2026-03-04', lines('# Standup', 'NDF fixings in UAT')],
    ['b.md', '2026-03-05', lines('# B', 'NDF desk and UAT again', '## C', 'UAT once more')],
    ['Terms/SLO.md', '2026-03-01', lines('---', 'type: term', 'term: SLO', '---', '# SLO', 'Service level objective.')],
  ];
  return buildWorkspaceIndex(
    new Map(notes.map(([filePath, day, content]) => [filePath, parseMarkdown(filePath, content, { createdAt: on(day), updatedAt: on(day) })])),
  );
}

suite('Stats: terms', () => {
  test('lists the terms used but never defined, and the terms defined, most used first', () => {
    assert.deepStrictEqual(listTerms(termIndex(), now), {
      undefinedTerms: [
        { term: 'UAT', count: 4, detail: 'First used Tue, Mar 3 in FX recon kickoff', open: { type: 'openSearch', query: 'text = UAT' } },
      ],
      undefinedTermCount: 1,
      definedTerms: [
        {
          term: 'NDF',
          count: 3,
          detail: 'non-deliverable forward · defined Tue, Mar 3 in FX recon kickoff',
          open: { type: 'openSource', filePath: 'FX recon kickoff.md', line: 2 },
        },
        { term: 'SLO', count: 1, detail: 'Service level objective · from SLO.md', open: { type: 'openSource', filePath: 'Terms/SLO.md', line: 6 } },
      ],
      definedTermCount: 2,
    });
  });

  test('the page draws both lists; a row opens what it lists, and Define… asks for a term note', () => {
    const preferences = createPreferences(new MemoryStore()).reader.value;
    const page = openWebviewPage(renderPage('stats'), createDeckardStatsSnapshot(termIndex(), preferences, [], now));
    try {
      assert.strictEqual(page.text('#terms-heading'), 'Terms');
      const headings = page.findAll('.terms-panel h3').map((heading) => heading.textContent);
      assert.deepStrictEqual(headings, ['Used but never defined (1)', 'Defined (2)']);
      assert.deepStrictEqual(page.findAll('[data-list="definedTerms"] .label').map((label) => label.textContent), ['NDF', 'SLO']);
      assert.match(page.text('[data-list="undefinedTerms"][data-index="0"]') ?? '', /UAT.*First used Tue, Mar 3 in FX recon kickoff.*4/s);
      page.click('[data-list="undefinedTerms"][data-index="0"]');
      assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: 'text = UAT' });
      page.click('[data-list="definedTerms"][data-index="1"]');
      assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'Terms/SLO.md', line: 6 });
      page.click('[data-action="define-term"][data-index="0"]');
      assert.deepStrictEqual(page.lastPosted('defineTerm'), { type: 'defineTerm', term: 'UAT' });
      assert.strictEqual(page.findAll('[data-list="definedTerms"] [data-action="define-term"]').length, 0, 'a defined term has no Define…');
    } finally {
      page.dispose();
    }
  });

  test('says so when there are no terms', () => {
    const preferences = createPreferences(new MemoryStore()).reader.value;
    const page = openWebviewPage(renderPage('stats'), createDeckardStatsSnapshot(buildWorkspaceIndex(new Map()), preferences, [], now));
    try {
      const text = page.find('[aria-labelledby="terms-heading"]').textContent ?? '';
      assert.match(text, /Every term used in three entries or more has a definition\./);
      assert.match(text, /No term has a definition yet\./);
    } finally {
      page.dispose();
    }
  });

  test('Define… is accepted for a term, and nothing else', () => {
    assert.deepStrictEqual(narrowStatsMessage({ type: 'defineTerm', term: 'RATES-UAT', extra: 1 }), { type: 'defineTerm', term: 'RATES-UAT' });
    for (const term of [undefined, '', 'uat', 'A', 'NOT A TERM', 7]) {
      assert.strictEqual(narrowStatsMessage({ type: 'defineTerm', term }), undefined, JSON.stringify(term));
    }
  });
});
