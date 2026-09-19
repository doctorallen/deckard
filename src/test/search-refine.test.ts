import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { evaluateQuery } from '../core/query/queryEvaluator';
import {
  canAppendTerm,
  correctQueryText,
  extractTagTerms,
  getTextWords,
  getTopLevelTerms,
  refineQueryText,
} from '../core/query/queryEdit';
import { parseQuery } from '../core/query/queryParser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { PreferencesStore } from '../core/storage/preferences';
import { resolveIndexedTagKey } from '../core/workspace/tagNavigation';
import {
  createQuerySuggestions,
  createSearchPageSnapshot,
} from '../ui/state/dashboardState';
import { buildSearchFacets } from '../ui/state/searchFacets';

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as
      | T
      | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

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

  test('a search of words finds notes by title, file name, body, and tags', async () => {
    const files = [
      parseMarkdown('notes/vault.md', '# Plan\nNothing else.'),
      parseMarkdown('notes/door.md', '# Other\nThe vault door.'),
      parseMarkdown('notes/unrelated.md', '# Third\nUnrelated.'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const store = new PreferencesStore(new MemoryMemento());

    // Written with its field, a text condition is still a search of words.
    const snapshot = createSearchPageSnapshot(index, store.value, 'text ~ "vault"');

    assert.deepStrictEqual(snapshot.sections.map((note) => note.heading).sort(), ['Other', 'Plan']);
    assert.strictEqual(snapshot.query.matchCounts.notes, 2);
    store.dispose();
  });

  test('refines a tag\'s page by its related tags, keeping those every result carries', async () => {
    const files = [
      parseMarkdown(
        'notes/harbor.md',
        [
          '# Harbor #team/harbor #person/sable',
          '# Clinic #person/sable #team/harbor #risk/privacy',
          '# Solo #person/sable',
        ].join('\n'),
      ),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const store = new PreferencesStore(new MemoryMemento());

    const page = createSearchPageSnapshot(index, store.value, '#person/sable');
    const related = page.query.facets.find((facet) => facet.id === 'related');
    assert.ok(related, 'the page offers the tags related to its own');
    assert.deepStrictEqual(
      related.values.map((value) => [value.clause, value.count]),
      [['#team/harbor', 2], ['#risk/privacy', 1]],
    );
    assert.strictEqual(related.values[0].strength, 1);
    for (const value of related.values) {
      assert.ok((value.strength ?? -1) >= 0 && (value.strength ?? 2) <= 1, 'strength is a share of the strongest');
    }
    assert.strictEqual(page.query.facets.some((facet) => facet.id === 'tags'), false);

    const narrowed = createSearchPageSnapshot(
      index,
      store.value,
      '#person/sable #team/harbor',
    );
    const shared = narrowed.query.facets.find((facet) => facet.id === 'related');
    assert.deepStrictEqual(
      shared?.values.map((value) => [value.clause, value.count]),
      [['#risk/privacy', 1]],
    );

    // A search that is more than tags is refined by the tags its results carry.
    const worded = createSearchPageSnapshot(index, store.value, '#person/sable clinic');
    assert.strictEqual(worded.query.facets.some((facet) => facet.id === 'related'), false);
    store.dispose();
  });

  test('offers a closer spelling for a search that found nothing', () => {
    const files = [
      parseMarkdown('notes/vault.md', '# Plan #project/atlas\nThe elevator is stuck.'),
      parseMarkdown('notes/other.md', '# Other\nNothing here.'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const store = new PreferencesStore(new MemoryMemento());
    // Stands in for the full-text cache, which holds the words of the notes.
    const suggestWords = (words: readonly string[]): ReadonlyMap<string, string> =>
      new Map(
        words
          .filter((word) => word === 'elevatr')
          .map((word) => [word, 'elevator']),
      );

    const missed = createSearchPageSnapshot(index, store.value, 'elevatr', {
      suggestWords,
    });
    assert.strictEqual(missed.sections.length, 0);
    assert.strictEqual(missed.suggestion, 'elevator');

    // The correction keeps the rest of the search exactly as it was written.
    const narrowed = createSearchPageSnapshot(
      index,
      store.value,
      '#project/atlas text ~ elevatr',
      { suggestWords },
    );
    assert.strictEqual(narrowed.suggestion, '#project/atlas text ~ elevator');

    store.dispose();
  });

  test('keeps a correction to itself when it would find nothing either', () => {
    const files = [
      parseMarkdown('notes/vault.md', '# Plan #project/atlas\nThe elevator is stuck.'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const store = new PreferencesStore(new MemoryMemento());
    const suggestWords = (words: readonly string[]): ReadonlyMap<string, string> =>
      new Map(
        words
          .filter((word) => word === 'elevatr')
          .map((word) => [word, 'elevator']),
      );

    // The word is in the notes, but in no note that also carries the tag.
    const snapshot = createSearchPageSnapshot(
      index,
      store.value,
      '#risk/vendor text ~ elevatr',
      { suggestWords },
    );
    assert.strictEqual(snapshot.sections.length, 0);
    assert.strictEqual(snapshot.suggestion, undefined);

    // A search that found something is never argued with.
    const found = createSearchPageSnapshot(index, store.value, 'elevator', {
      suggestWords,
    });
    assert.ok(found.sections.length > 0);
    assert.strictEqual(found.suggestion, undefined);

    store.dispose();
  });

  test('corrects only the words a search reads as prose', () => {
    const words = (text: string) => getTextWords(parseQuery(text).node);
    assert.deepStrictEqual(words('elevatr #elevatr in:elevatr'), ['elevatr']);
    assert.deepStrictEqual(words('-text ~ elevatr'), []);
    assert.deepStrictEqual(words('"vendor risk" OR text = plan'), [
      'vendor',
      'risk',
      'plan',
    ]);

    // A tag spelled like the misspelled word is left exactly as it was.
    const corrected = (text: string) =>
      correctQueryText(text, parseQuery(text).node, (word) =>
        word === 'elevatr' ? 'elevator' : undefined,
      );
    assert.strictEqual(
      corrected('#elevatr elevatr'),
      '#elevatr elevator',
    );
    assert.strictEqual(corrected('#elevatr'), undefined);
  });

  test('labels words as the text condition they run', () => {
    const labels = (text: string) =>
      getTopLevelTerms(parseQuery(text)).map((term) => term.label ?? term.text);
    assert.deepStrictEqual(labels('#a asdf -secret'), ['#a', 'text ~ asdf', 'NOT text ~ secret']);
    assert.deepStrictEqual(labels('text ~ written is:open'), ['text ~ written', 'is:open']);
  });

  test('refines a search from the sidebar as the search box would', () => {
    assert.strictEqual(refineQueryText('', '#a', 'and'), '#a');
    assert.strictEqual(refineQueryText('#p', '#a', 'and'), '#p AND #a');
    assert.strictEqual(refineQueryText('#p', '#a', 'exclude'), '#p AND -#a');
    assert.strictEqual(refineQueryText('#p OR #q', '#a', 'and'), '(#p OR #q) AND #a');
    assert.strictEqual(refineQueryText('#p is:open', 'is:done', 'or', 'is:open'), '#p (is:open OR is:done)');
    assert.strictEqual(refineQueryText('#p (is:open OR is:done)', '#x', 'or', 'is:open'), '#p (is:open OR #x OR is:done)');
    assert.strictEqual(refineQueryText('#p', '#a', 'or', 'is:open'), '#p AND #a', 'with nothing to join, it is added');
  });
  test('a suggested tag counts the notes and tasks its search finds', () => {
    const files = [
      parseMarkdown(
        'notes/plan.md',
        '# Plan #project/atlas\nIntro.\n## Details\nMore.\n- [ ] Book the room\n- [ ] Call Ren',
      ),
      parseMarkdown('notes/other.md', '# Other\n- [ ] Ship it #project/atlas'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const atlas = createQuerySuggestions(index).values.tag?.find(
      (suggestion) => suggestion.value === '#project/atlas',
    );
    const results = evaluateQuery(index, parseQuery('tag = #project/atlas').node);

    // The nested Details section and its tasks inherit the heading's tag.
    assert.strictEqual(results.sections.length + results.files.length, 2);
    assert.strictEqual(results.tasks.length, 3);
    assert.strictEqual(atlas?.detail, '2 notes · 3 tasks');
  });
});
