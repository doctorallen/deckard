import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { evaluateQuery } from '../core/query/queryEvaluator';
import {
  canAppendTerm,
  extractTagTerms,
  getTopLevelTerms,
} from '../core/query/queryEdit';
import { parseQuery } from '../core/query/queryParser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { resolveIndexedTagKey } from '../core/workspace/tagNavigation';
import { buildSearchFacets } from '../ui/state/searchFacets';

suite('Refining a search', () => {
  test('lists the terms of a query as they were written', () => {
    const terms = getTopLevelTerms(parseQuery('vendor #atlas is:open'));
    assert.deepStrictEqual(
      terms.map((term) => term.text),
      ['vendor', '#atlas', 'is:open'],
    );
    assert.strictEqual(terms[1].without, 'vendor is:open');
  });

  test('removes a term together with the AND or NOT that went with it', () => {
    const explicit = getTopLevelTerms(parseQuery('tag = #a AND -is:done AND text ~ plan'));
    assert.deepStrictEqual(
      explicit.map((term) => term.text),
      ['tag = #a', '-is:done', 'text ~ plan'],
    );
    assert.strictEqual(explicit[1].without, 'tag = #a AND text ~ plan');
    assert.strictEqual(explicit[0].without, '-is:done AND text ~ plan');

    const negated = getTopLevelTerms(parseQuery('NOT has:due vendor'));
    assert.deepStrictEqual(
      negated.map((term) => [term.text, term.without]),
      [
        ['NOT has:due', 'vendor'],
        ['vendor', 'NOT has:due'],
      ],
    );
  });

  test('offers no terms for a query whose top level is an OR', () => {
    const parsed = parseQuery('#a OR #b');
    assert.deepStrictEqual(getTopLevelTerms(parsed), []);
    assert.strictEqual(canAppendTerm(parsed), false);
    assert.strictEqual(canAppendTerm(parseQuery('#a (#b OR #c)')), true);
  });

  test('lifts whole tags out of a refinement and keeps the rest as typed', () => {
    const known = new Map([
      ['#project/atlas', '#project/atlas'],
      ['@ren', '@ren'],
    ]);
    const resolve = (tagKey: string) => resolveIndexedTagKey(known, tagKey);

    assert.deepStrictEqual(extractTagTerms('#project/atlas vendor @ren', resolve), {
      tagKeys: ['#project/atlas', '@ren'],
      rest: 'vendor',
    });
    assert.deepStrictEqual(extractTagTerms('tag = @ren AND text ~ plan', resolve), {
      tagKeys: ['@ren'],
      rest: 'text ~ plan',
    });
    // A tag the index does not know, a negated tag, and an OR all stay.
    assert.deepStrictEqual(extractTagTerms('#unknown -#project/atlas', resolve), {
      tagKeys: [],
      rest: '#unknown -#project/atlas',
    });
    assert.deepStrictEqual(extractTagTerms('@ren OR vendor', resolve), {
      tagKeys: [],
      rest: '@ren OR vendor',
    });
  });

  test('counts facets over results, leaving out values that would not narrow them', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = new Date(2026, 8, 14, 12).getTime();
    const files = [
      parseMarkdown(
        'notes/work/atlas.md',
        `# Atlas #project/atlas\n- [ ] Overdue task #project/atlas 📅 2026-09-10\n- [ ] Soon #urgent 📅 2026-09-16\n- [x] Done task`,
        { updatedAt: now - day },
      ),
      parseMarkdown('notes/home/garden.md', '# Garden #project/atlas #home', {
        updatedAt: now - 60 * day,
      }),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const query = '#project/atlas';
    const results = evaluateQuery(index, parseQuery(query).node);
    const facets = buildSearchFacets(index, results, query, { now });
    const values = (id: string) =>
      facets.find((facet) => facet.id === id)?.values.map((value) => [value.label, value.count]);

    // Tasks under the tagged heading inherit its tag, so all three match.
    assert.deepStrictEqual(values('status'), [['Open', 2], ['Done', 1]]);
    assert.deepStrictEqual(values('due'), [['Overdue', 1], ['Next 7 days', 1], ['No date', 1]]);
    // The tag the query names is not offered again.
    assert.deepStrictEqual(values('tags'), [['#home', 1], ['#urgent', 1]]);
    assert.deepStrictEqual(values('updated'), [['This week', 1], ['Older', 1]]);
    // Everything is under notes/, so the split is one level down.
    assert.deepStrictEqual(values('folder'), [['notes/work', 4], ['notes/home', 1]]);
    assert.strictEqual(
      facets.find((facet) => facet.id === 'folder')?.values[0].clause,
      'in:notes/work',
    );
  });

  test('does not offer a facet value the query already has', () => {
    const files = [
      parseMarkdown('a.md', '# A\n- [ ] One\n- [x] Two'),
      parseMarkdown('b.md', '# B'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const query = 'is:open';
    const facets = buildSearchFacets(
      index,
      { sections: [...index.sections.values()], tasks: [...index.tasks.values()], files: [] },
      query,
    );
    const status = facets.find((facet) => facet.id === 'status');
    assert.deepStrictEqual(status?.values.map((value) => value.clause), ['is:done']);
  });
});
