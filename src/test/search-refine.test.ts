import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { evaluateQuery } from '../core/query/queryEvaluator';
import {
  canAppendTerm,
  correctQueryText,
  extractTagTerms,
  getTextWords,
  getTopLevelJoin,
  getTopLevelTerms,
  refineQueryText,
} from '../core/query/queryEdit';
import { parseQuery } from '../core/query/queryParser';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import { PreferencesStore } from '../core/storage/preferences';
import { resolveIndexedTagKey } from '../core/workspace/tagNavigation';
import {
  createQuerySuggestions,
  createSearchPageSnapshot,
  tagMentionWord,
} from '../ui/state/dashboardState';
import { buildSearchFacets } from '../ui/state/searchFacets';
import { createQueryContext } from '../core/query/queryContext';

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

  test('lists the branches of a top-level OR, each removable alone', () => {
    const parsed = parseQuery('#a OR #b');
    assert.deepStrictEqual(
      getTopLevelTerms(parsed).map((term) => [term.text, term.without]),
      [
        ['#a', '#b'],
        ['#b', '#a'],
      ],
    );
    assert.strictEqual(getTopLevelJoin(parsed), 'or');
    assert.strictEqual(getTopLevelJoin(parseQuery('#a #b')), 'and');
    // Adding by AND to an OR still has to wrap it.
    assert.strictEqual(canAppendTerm(parsed), false);
    assert.strictEqual(canAppendTerm(parseQuery('#a (#b OR #c)')), true);
  });

  test('lists a group as a term of its own, with its own terms inside', () => {
    const text = 'tag = #project/argent-protocol OR tag = #person/mara-vale OR (tag = #team/harbor AND tag = #person/ivo-chen)';
    const terms = getTopLevelTerms(parseQuery(text));
    assert.deepStrictEqual(
      terms.map((term) => term.text),
      ['tag = #project/argent-protocol', 'tag = #person/mara-vale', '(tag = #team/harbor AND tag = #person/ivo-chen)'],
    );
    assert.strictEqual(terms[0].without, 'tag = #person/mara-vale OR (tag = #team/harbor AND tag = #person/ivo-chen)');
    assert.strictEqual(terms[2].without, 'tag = #project/argent-protocol OR tag = #person/mara-vale');
    const group = terms[2];
    assert.strictEqual(group.join, 'and');
    assert.strictEqual(group.negated, undefined);
    assert.deepStrictEqual(
      group.items?.map((term) => [term.text, term.without]),
      [
        ['tag = #team/harbor', 'tag = #project/argent-protocol OR tag = #person/mara-vale OR (tag = #person/ivo-chen)'],
        ['tag = #person/ivo-chen', 'tag = #project/argent-protocol OR tag = #person/mara-vale OR (tag = #team/harbor)'],
      ],
    );
  });

  test('keeps a group turned around, and marks each NOT', () => {
    const terms = getTopLevelTerms(parseQuery('NOT (#a OR #b) AND -#c'));
    assert.strictEqual(terms.length, 2);
    assert.strictEqual(terms[0].text, 'NOT (#a OR #b)');
    assert.strictEqual(terms[0].negated, true);
    assert.strictEqual(terms[0].join, 'or');
    assert.strictEqual(terms[0].without, '-#c');
    assert.deepStrictEqual(
      terms[0].items?.map((term) => [term.text, term.without, term.negated]),
      [
        ['#a', 'NOT (#b) AND -#c', undefined],
        ['#b', 'NOT (#a) AND -#c', undefined],
      ],
    );
    assert.strictEqual(terms[1].negated, true);
    assert.strictEqual(terms[1].without, 'NOT (#a OR #b)');

    // Groups nest as deep as the search goes, and each level cuts as written.
    const deep = getTopLevelTerms(parseQuery('#a AND (#b OR (#c AND #d))'));
    const inner = deep[1].items?.[1];
    assert.strictEqual(inner?.text, '(#c AND #d)');
    assert.strictEqual(inner?.without, '#a AND (#b)');
    assert.strictEqual(inner?.items?.[0].without, '#a AND (#b OR (#d))');
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
    assert.deepStrictEqual(values('updated'), [['Last 7 days', 1], ['Older', 1]]);
    // Everything is under notes/, so the split is one level down.
    assert.deepStrictEqual(values('folder'), [['notes/work', 4], ['notes/home', 1]]);
    assert.strictEqual(
      facets.find((facet) => facet.id === 'folder')?.values[0].clause,
      'in:notes/work',
    );
  });

  test("names the Updated spans by the days they hold, a week ago in the second", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = new Date(2026, 8, 25, 12).getTime();
    const files = [
      parseMarkdown('notes/today.md', '# Today #project/atlas', { updatedAt: now }),
      parseMarkdown('notes/week.md', '# A week ago #project/atlas', {
        updatedAt: now - 7 * day,
      }),
      parseMarkdown('notes/old.md', '# Old #project/atlas', { updatedAt: now - 45 * day }),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const query = '#project/atlas';
    const results = evaluateQuery(index, parseQuery(query).node);
    const updated = buildSearchFacets(index, results, query, { now })
      .find((facet) => facet.id === 'updated')
      ?.values.map((value) => [value.label, value.count]);
    assert.deepStrictEqual(updated, [
      ['Last 7 days', 1],
      ['1–4 weeks ago', 1],
      ['Older', 1],
    ]);
  });

  test('counts notes by the month they were written', () => {
    // Friday 2026-09-25, noon.
    const now = new Date(2026, 8, 25, 12).getTime();
    const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 9).getTime();
    const note = (name: string, createdAt: number) =>
      parseMarkdown(`notes/${name}.md`, `# ${name} #project/atlas`, { createdAt, updatedAt: now });
    const files = [
      note('this-month', at(2026, 9, 2)),
      note('last-month', at(2026, 8, 30)),
      note('july', at(2026, 7, 1)),
      note('earlier', at(2025, 12, 1)),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const query = '#project/atlas';
    const results = evaluateQuery(index, parseQuery(query).node);
    const created = buildSearchFacets(index, results, query, { now })
      .find((facet) => facet.id === 'created')
      ?.values.map((value) => [value.label, value.clause, value.count]);
    // June has no notes, so it is left out.
    assert.deepStrictEqual(created, [
      ['This month', 'created = this-month', 1],
      ['Last month', 'created = last-month', 1],
      ['July', 'created = 2026-07', 1],
      ['Earlier', 'created < 2026-06', 1],
    ]);
    const january = buildSearchFacets(index, results, query, { now: new Date(2026, 0, 20, 12).getTime() })
      .find((facet) => facet.id === 'created')
      ?.values.map((value) => value.label);
    assert.ok(january?.includes('Last month'), String(january));
    const inDecember = buildSearchFacets(index, results, query, { now: new Date(2026, 1, 20, 12).getTime() })
      .find((facet) => facet.id === 'created')
      ?.values.map((value) => value.label);
    assert.ok(inDecember?.includes('December 2025'), String(inDecember));
  });

  test('narrows by the notes the results link to, leaving out the ones the search names', () => {
    const files = new Map(
      Object.entries({
        'notes/Atlas.md': '# Atlas\nThe plan.\n',
        'notes/Budget.md': '# Budget\nMoney.\n',
        'notes/One.md': '# One #project/x\nSee [[Atlas]] and [[Budget]].\n',
        'notes/Two.md': '# Two #project/x\nSee [[Atlas]].\n',
        'notes/Three.md': '# Three #project/x\nNothing.\n',
      }).map(([path, content]) => [path, parseMarkdown(path, content)]),
    );
    const index = buildWorkspaceIndex(files);
    const query = 'tag = #project/x OR text ~ zzz';
    const facets = buildSearchFacets(index, evaluateQuery(index, parseQuery(query).node), query, { now: Date.now() });
    const links = facets.find((facet) => facet.id === 'links');
    assert.deepStrictEqual(
      links?.values.map((value) => [value.label, value.count, value.clause]),
      [
        ['Atlas', 2, '[[Atlas]]'],
        ['Budget', 1, '[[Budget]]'],
      ],
    );
    const named = '#project/x [[Atlas]]';
    const narrowed = buildSearchFacets(index, evaluateQuery(index, parseQuery(named).node), named, { now: Date.now() })
      .find((facet) => facet.id === 'links');
    assert.deepStrictEqual(narrowed?.applied, ['[[Atlas]]']);
    assert.ok(!narrowed?.values.some((value) => value.label === 'Atlas'));
  });

  test('completes [[ with note names, most linked first, aliases included', () => {
    const files = new Map(
      Object.entries({
        'notes/Atlas plan.md': '---\naliases: [Atlas]\n---\n# Atlas plan\n',
        'notes/Budget.md': '# Budget\n',
        'notes/One.md': '# One\nSee [[Atlas plan]].\n',
        'notes/Two.md': '# Two\nSee [[Atlas]] and [[Budget]].\n',
      }).map(([path, content]) => [path, parseMarkdown(path, content)]),
    );
    const links = createQuerySuggestions(buildWorkspaceIndex(files), [], createQueryContext(Date.now())).values.link ?? [];
    assert.deepStrictEqual(links.slice(0, 3), [
      { value: 'Atlas', label: '[[Atlas]]', detail: 'alias of Atlas plan' },
      { value: 'Atlas plan', label: '[[Atlas plan]]', detail: 'Linked from 2 notes' },
      { value: 'Budget', label: '[[Budget]]', detail: 'Linked from 1 note' },
    ]);
  });

  test('reads a tag\'s name as the word prose would write', () => {
    assert.strictEqual(tagMentionWord('#project/atlas'), 'atlas');
    assert.strictEqual(tagMentionWord('#risk/vendor-risk'), 'vendor risk');
    assert.strictEqual(tagMentionWord('@dana'), 'dana');
    assert.strictEqual(tagMentionWord('#project/q4'), undefined);
    assert.strictEqual(tagMentionWord('#year/2026'), undefined);
  });

  test('does not offer a facet value the query already has', () => {
    const files = [
      parseMarkdown('a.md', '# A\n- [ ] One\n- [x] Two'),
      parseMarkdown('b.md', '# B'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const query = 'is:open';
    const facets = buildSearchFacets(index, { sections: [...index.sections.values()], tasks: [...index.tasks.values()], files: [] }, query, { now: Date.now() }
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
    const snapshot = createSearchPageSnapshot(index, store.value, 'text ~ "vault"', { queryContext: createQueryContext(Date.now()) });

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

    const page = createSearchPageSnapshot(index, store.value, '#person/sable', { queryContext: createQueryContext(Date.now()) });
    const related = page.query.facets.find((facet) => facet.id === 'related');
    assert.ok(related, 'the page offers the tags related to its own');
    assert.deepStrictEqual(
      related.values.map((value) => [value.clause, value.count]),
      [['#team/harbor', 2], ['#risk/privacy', 1]],
    );
    // The rail is part of the whole: the share of the results a tag is on.
    assert.deepStrictEqual(
      related.values.map((value) => [value.strength, value.total]),
      [[2 / 3, 3], [1 / 3, 3]],
    );
    assert.match(related.values[0].detail ?? '', /^In 2 of 3 results\. Written together/);
    assert.strictEqual(page.query.facets.some((facet) => facet.id === 'tags'), false);

    const narrowed = createSearchPageSnapshot(index, store.value, '#person/sable #team/harbor', { queryContext: createQueryContext(Date.now()) }
    );
    const shared = narrowed.query.facets.find((facet) => facet.id === 'related');
    assert.deepStrictEqual(
      shared?.values.map((value) => [value.clause, value.count]),
      [['#risk/privacy', 1]],
    );

    // A search that is more than tags is refined by the tags its results carry.
    const worded = createSearchPageSnapshot(index, store.value, '#person/sable clinic', { queryContext: createQueryContext(Date.now()) });
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

    const missed = createSearchPageSnapshot(index, store.value, 'elevatr', { queryContext: createQueryContext(Date.now()),
      suggestWords,
    });
    assert.strictEqual(missed.sections.length, 0);
    assert.strictEqual(missed.suggestion, 'elevator');

    // The correction keeps the rest of the search exactly as it was written.
    const narrowed = createSearchPageSnapshot(
      index,
      store.value,
      '#project/atlas text ~ elevatr',
      { queryContext: createQueryContext(Date.now()), suggestWords },
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
      { queryContext: createQueryContext(Date.now()), suggestWords },
    );
    assert.strictEqual(snapshot.sections.length, 0);
    assert.strictEqual(snapshot.suggestion, undefined);

    // A search that found something is never argued with.
    const found = createSearchPageSnapshot(index, store.value, 'elevator', { queryContext: createQueryContext(Date.now()),
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

  test('carries one page of a broad search and counts the whole of it', () => {
    const files = Array.from({ length: 25 }, (_, index) =>
      parseMarkdown(
        `notes/note-${index}.md`,
        `# Note ${index} #project/atlas\nProse.\n- [ ] Task ${index} #project/atlas`,
      ),
    );
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const store = new PreferencesStore(new MemoryMemento());

    // A caller that asks not to be paged carries everything, as Home's
    // widgets need, and says so: one page holding the lot.
    const whole = createSearchPageSnapshot(index, store.value, '#project/atlas', { queryContext: createQueryContext(Date.now()),
      paged: false,
    });
    assert.strictEqual(whole.sections.length, 25);
    assert.strictEqual(whole.tasks.length, 25);
    assert.deepStrictEqual(whole.notePaging, {
      page: 1,
      size: 25,
      pageCount: 1,
      total: 25,
    });

    const paged = { ...store.value, searchPageSize: 10 as const };
    const first = createSearchPageSnapshot(index, paged, '#project/atlas', { queryContext: createQueryContext(Date.now()) });
    assert.deepStrictEqual(first.notePaging, {
      page: 1,
      size: 10,
      pageCount: 3,
      total: 25,
    });
    assert.deepStrictEqual(first.sections, whole.sections.slice(0, 10));
    // What the page says it found is what the search found, not what it was
    // sent, so turning a page never changes the answer.
    assert.strictEqual(first.query.matchCounts.notes, 25);
    assert.strictEqual(first.query.matchCounts.tasks, 25);
    assert.deepStrictEqual(first.taskCounts, whole.taskCounts);

    const second = createSearchPageSnapshot(index, paged, '#project/atlas', { queryContext: createQueryContext(Date.now()),
      notePage: 2,
      taskPage: 2,
    });
    assert.deepStrictEqual(second.sections, whole.sections.slice(10, 20));
    assert.deepStrictEqual(second.tasks, whole.tasks.slice(10, 20));
    assert.strictEqual(second.notePaging.page, 2);

    store.dispose();
  });

  test('a draft searches everything the search found, and agrees with Enter', () => {
    const files = [
      parseMarkdown('notes/one.md', '# One #project/atlas\nThe elevator survey.'),
      parseMarkdown('notes/two.md', '# Two #project/atlas\nThe ledger migration.'),
      parseMarkdown('notes/three.md', '# Three #risk/vendor\nThe elevator again.'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const store = new PreferencesStore(new MemoryMemento());

    const drafted = createSearchPageSnapshot(index, store.value, '#project/atlas', { queryContext: createQueryContext(Date.now()),
      previewWords: ['elevator'],
    });
    // The draft narrows the search it is typed into, not the whole workspace.
    assert.deepStrictEqual(
      drafted.sections.map((card) => card.heading),
      ['One #project/atlas'],
    );
    assert.strictEqual(drafted.query.matchCounts.notes, 1);

    // Pressing Enter writes the words into the search. What it then finds is
    // what the draft was already showing.
    const committed = createSearchPageSnapshot(index, store.value, '#project/atlas elevator', { queryContext: createQueryContext(Date.now()) }
    );
    assert.deepStrictEqual(
      committed.sections.map((card) => card.heading),
      drafted.sections.map((card) => card.heading),
    );

    // The box still shows the search that was committed, so a draft never
    // turns into a chip on its own.
    assert.strictEqual(drafted.query.text, '#project/atlas');
    assert.strictEqual(
      drafted.query.terms.map((term) => term.text).join(' '),
      '#project/atlas',
    );

    store.dispose();
  });

  test('puts a page number back inside the pages a search has', () => {
    const files = Array.from({ length: 15 }, (_, index) =>
      parseMarkdown(`notes/note-${index}.md`, `# Note ${index} #project/atlas\nProse.`),
    );
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const store = new PreferencesStore(new MemoryMemento());

    // A note saved elsewhere can shorten a search while its last page is
    // open. The reader should land on the last page there is, not past it.
    const paged = { ...store.value, searchPageSize: 10 as const };
    const past = createSearchPageSnapshot(index, paged, '#project/atlas', { queryContext: createQueryContext(Date.now()),
      notePage: 9,
    });
    assert.strictEqual(past.notePaging.page, 2);
    assert.strictEqual(past.sections.length, 5);

    const before = createSearchPageSnapshot(index, paged, '#project/atlas', { queryContext: createQueryContext(Date.now()),
      notePage: 0,
    });
    assert.strictEqual(before.notePaging.page, 1);

    // A search that found nothing still has a page, so the page has a list
    // to be empty in.
    const none = createSearchPageSnapshot(index, paged, '#project/nothing', { queryContext: createQueryContext(Date.now()) });
    assert.deepStrictEqual(none.notePaging, {
      page: 1,
      size: 10,
      pageCount: 1,
      total: 0,
    });

    store.dispose();
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
    const atlas = createQuerySuggestions(index, [], createQueryContext(Date.now())).values.tag?.find(
      (suggestion) => suggestion.value === '#project/atlas',
    );
    const results = evaluateQuery(index, parseQuery('tag = #project/atlas').node);

    // The nested Details section and its tasks inherit the heading's tag.
    assert.strictEqual(results.sections.length + results.files.length, 2);
    assert.strictEqual(results.tasks.length, 3);
    assert.strictEqual(atlas?.detail, '2 notes · 3 tasks');
  });

  test('a week, a month, or a weekday completes with the days it means', () => {
    const index = buildWorkspaceIndex(new Map());
    // Friday 2026-09-25, noon.
    const values = createQuerySuggestions(index, [], createQueryContext(new Date(2026, 8, 25, 12).getTime())).values;
    const detail = (field: 'due' | 'created', value: string) =>
      values[field]?.find((suggestion) => suggestion.value === value)?.detail;
    assert.strictEqual(detail('due', 'next-week'), 'Sep 27 to Oct 3');
    assert.strictEqual(detail('due', 'this-week'), 'Sep 20 to Sep 26');
    assert.strictEqual(detail('created', 'last-month'), 'August');
    assert.strictEqual(detail('due', 'friday'), 'Fri, Oct 2');
    assert.strictEqual(detail('created', 'friday'), 'Fri, Sep 18');
  });
});
