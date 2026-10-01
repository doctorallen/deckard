import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { parseQuery } from '../domain/query/queryParser';
import { createPreferences } from './preferenceServices';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createDeckardStatsSnapshot, createStatsTrends, createTagPairs, createTagUsage } from '../ui/state/dashboardState';
import { listStatsTags } from '../ui/webview/pages/stats/statsController';
import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';

suite('Stats: notes that could not be read', () => {
  const index = () =>
    buildWorkspaceIndex(new Map([['notes/good.md', parseMarkdown('notes/good.md', '# Good #project/atlas')]]));
  const preferences = () =>
    createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never).reader.value;

  test('the snapshot lists each one with what opens it', () => {
    const snapshot = createDeckardStatsSnapshot(index(), preferences(), [
      { filePath: 'notes/bad.md', reason: 'EACCES: permission denied' },
    ], Date.now());
    assert.deepStrictEqual(snapshot.unreadable, [
      { filePath: 'notes/bad.md', reason: 'EACCES: permission denied', open: { type: 'openSource', filePath: 'notes/bad.md', line: 1 } },
    ]);
    assert.deepStrictEqual(createDeckardStatsSnapshot(index(), preferences(), [], Date.now()).unreadable, []);
  });

  test('the page says so where a reader looks, and a row opens the note', () => {
    const page = openWebviewPage(
      renderPage('stats'),
      createDeckardStatsSnapshot(index(), preferences(), [{ filePath: 'notes/bad.md', reason: 'EACCES: permission denied' }], Date.now()),
    );
    try {
      const text = page.document.body.textContent ?? '';
      assert.match(text, /Notes Deckard could not read/);
      assert.match(text, /1 note is in the workspace but not in the index/);
      assert.match(text, /notes\/bad\.md/);
      assert.match(text, /EACCES: permission denied/);
      page.click('[data-list="unreadable"][data-index="0"]');
      assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'notes/bad.md', line: 1 });
    } finally {
      page.dispose();
    }
  });

  test('the page says when the index was refreshed in words, with the time on hover', () => {
    const page = openWebviewPage(renderPage('stats'), { ...createDeckardStatsSnapshot(index(), preferences(), [], Date.now()), updatedAt: Date.now() - 5 * 60 * 1000 });
    try {
      assert.match(page.text('.updated') ?? '', /^Index last refreshed: 5 minutes ago/);
      assert.ok(page.find('.updated span[title]').getAttribute('title')?.includes('2'), 'the exact time is on hover');
    } finally {
      page.dispose();
    }
  });

  test('every tile opens a search Deckard can read', () => {
    const page = openWebviewPage(renderPage('stats'), createDeckardStatsSnapshot(index(), preferences(), [], Date.now()));
    try {
      const queries = page.findAll('[data-query]').map((tile) => tile.getAttribute('data-query') ?? '');
      assert.ok(queries.includes('is:task'), JSON.stringify(queries));
      queries.forEach((query) => {
        const errors = parseQuery(query).diagnostics.filter((d) => d.severity === 'error');
        assert.deepStrictEqual(errors, [], query);
      });
    } finally {
      page.dispose();
    }
  });

  test('the page says nothing when every note was read', () => {
    const page = openWebviewPage(renderPage('stats'), createDeckardStatsSnapshot(index(), preferences(), [], Date.now()));
    try {
      // The page's own script mentions the panel by name, so read the DOM,
      // not the text of everything under body.
      assert.strictEqual(page.findAll('[data-list="unreadable"]').length, 0);
      assert.strictEqual(page.findAll('.view-panel.unreadable').length, 0);
    } finally {
      page.dispose();
    }
  });
});

suite('Stats: what needs attention, first', () => {
  const build = (notes: Record<string, string>) =>
    buildWorkspaceIndex(new Map(Object.entries(notes).map(([filePath, text]) => [filePath, parseMarkdown(filePath, text)])));
  const preferences = (value: Record<string, unknown> = {}) => ({
    ...createPreferences({ get: (_k: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never).reader.value,
    ...value,
  });
  const open = (index: ReturnType<typeof build>, prefs = preferences()) =>
    openWebviewPage(renderPage('stats'), createDeckardStatsSnapshot(index, prefs, [], Date.now()));

  test('leads with Needs attention, each panel counting its rows', () => {
    const page = open(build({
      'notes/a.md': '# A #project/atlas\n\nSee [[Nowhere]].',
      'notes/b.md': '# B #projects/atlas',
    }));
    try {
      const sections = page.findAll('main > section, #app > section').map((section) => section.getAttribute('aria-labelledby') ?? section.getAttribute('aria-label'));
      assert.deepStrictEqual(sections.slice(0, 2), ['attention-heading', 'Index statistics']);
      const headings = page.findAll('.attention h3').map((heading) => heading.textContent?.trim());
      assert.deepStrictEqual(headings.map((heading) => heading?.replace(/Create all$/, '')), [
        'Links that open no note (1)',
        'Tags that look alike (1)',
        'Notes nothing links to (2)',
      ]);
    } finally {
      page.dispose();
    }
  });

  test('says in one line when nothing needs attention', () => {
    const page = open(build({ 'notes/a.md': '# A\n\n[[b]]', 'notes/b.md': '# B\n\n[[a]]' }));
    try {
      assert.strictEqual(
        page.text('.attention-clear'),
        'Nothing needs attention: every note was read, every link opens a note, no two tags look alike, and every note is linked from another.',
      );
      assert.strictEqual(page.findAll('.attention .view-panel').length, 0);
    } finally {
      page.dispose();
    }
  });

  test('shows ten notes nothing links to, then the rest on request', () => {
    const notes: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) {
      notes[`notes/n${String(i).padStart(2, '0')}.md`] = `# Note ${i}`;
    }
    const page = open(build(notes));
    try {
      const shown = () => page.findAll('.orphan-list > li').filter((item) => !item.classList.contains('is-more') || page.find('.orphan-list').classList.contains('show-all')).length;
      assert.strictEqual(shown(), 10);
      assert.strictEqual(page.text('[data-action="show-more-orphans"]'), 'Show 40 more');
      assert.ok(!(page.document.body.textContent ?? '').includes('And 10 more.'), 'the rest is said after the list is open');
      page.click('[data-action="show-more-orphans"]');
      assert.strictEqual(shown(), 50);
      assert.strictEqual(page.findAll('[data-action="show-more-orphans"]').length, 0);
      assert.ok(page.findAll('.attention .empty').some((line) => line.textContent === 'And 10 more.'));
    } finally {
      page.dispose();
    }
  });

  test('every total opens what it counts', () => {
    const page = open(build({ 'notes/a.md': '# A #project/atlas\n\n- [ ] Call\n\nSee [[b]].', 'notes/b.md': '# B #topic' }));
    try {
      const tile = (label: string) => page.findAll('.metric').find((element) => element.querySelector('.metric-label')?.textContent === label) as HTMLElement;
      assert.strictEqual(tile('Files').tagName, 'ARTICLE', 'Files is a plain number');
      tile('Notes').click();
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openSearch', query: 'is:note' });
      tile('Tasks').click();
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openSearch', query: 'is:task' });
      tile('Open tasks').click();
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openSearch', query: 'is:open' });
      tile('Tags').click();
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openTagList', namespaced: false });
      tile('Namespaced tags').click();
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openTagList', namespaced: true });
      tile('Wiki links').click();
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openNotesGraph', onlyWrittenLinks: true });
      assert.strictEqual(tile('Wiki links').getAttribute('aria-label'), 'Wiki links, 1. Open the Notes Graph showing only the links you wrote');
      const before = page.posted.length;
      tile('Unlinked notes').click();
      assert.strictEqual(page.posted.length, before, 'moving to the list posts nothing');
      assert.strictEqual(page.document.activeElement?.id, 'orphans-heading');
    } finally {
      page.dispose();
    }
  });

  test('folds the most viewed lists with nothing in them into one line', () => {
    const index = build({ 'notes/a.md': '# A #project/atlas' });
    const none = open(index);
    try {
      assert.strictEqual(none.findAll('#views-heading ~ .views .view-panel').length, 0);
      assert.strictEqual(none.text('.views-empty'), "Nothing viewed yet. Views are counted when you open a tag's page or a note entry from a search page.");
    } finally {
      none.dispose();
    }
    const some = open(index, preferences({ tagAccessCounts: { '#project/atlas': 3 } }));
    try {
      assert.deepStrictEqual(some.findAll('#views-heading ~ .views h3').map((heading) => heading.textContent), ['Most viewed tags']);
      assert.strictEqual(some.text('.views-empty'), "Nothing viewed yet among canonical tags and note entries. Views are counted when you open a tag's page or a note entry from a search page.");
    } finally {
      some.dispose();
    }
  });

  test('a Tags total offers its tags, most used first', () => {
    const index = build({ 'notes/a.md': '# A #project/atlas #topic\n\n## B #project/atlas' });
    assert.deepStrictEqual(listStatsTags(index, false).map((row) => [row.label, row.description]), [
      ['#project/atlas', '2 entries'],
      ['#topic', '1 entry'],
    ]);
    assert.deepStrictEqual(listStatsTags(index, true).map((row) => row.tagKey), ['#project/atlas']);
  });
});

suite('Stats: twelve weeks under each total', () => {
  const now = new Date(2026, 8, 21, 12).getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const day = (time: number) => {
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const index = () => buildWorkspaceIndex(new Map([
    ['notes/a.md', parseMarkdown('notes/a.md', `# A\n- [ ] open one\n- [x] done one ✅ ${day(now - 10 * DAY)}`, { createdAt: now - 23 * DAY, updatedAt: now - 23 * DAY })],
    ['notes/b.md', parseMarkdown('notes/b.md', '# B\n- [x] done undated', { createdAt: now - 2 * DAY, updatedAt: now - DAY })],
    ['notes/c.md', parseMarkdown('notes/c.md', '# C', { createdAt: now + 3 * DAY, updatedAt: now + 3 * DAY })],
    ['notes/d.md', parseMarkdown('notes/d.md', '# D')],
  ]));
  const preferences = () =>
    createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never).reader.value;

  test('rebuilds each total week by week from the dates notes were written', () => {
    const trends = createStatsTrends(index(), now);
    // A note from three weeks and two days ago counts from three weeks ago;
    // an undated one throughout; one dated ahead counts from now.
    assert.deepStrictEqual(trends.notes, { points: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 4], change: 2 });
    assert.deepStrictEqual(trends.tasks, { points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 3], change: 1 });
    // Done ten days ago by its ✅ date, it was open two weeks and three weeks
    // ago; done with no date, it is open in no past week.
    assert.deepStrictEqual(trends.openTasks, { points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 1, 1], change: 0 });
    const snapshot = createDeckardStatsSnapshot(index(), preferences(), [], now);
    assert.strictEqual(snapshot.trends.notes.points[12], snapshot.sectionCount, 'the last point is the tile');
    assert.strictEqual(snapshot.trends.openTasks.points[12], snapshot.activeTaskCount);
  });

  test('says how each total moved in the last seven days, and draws its line', () => {
    const snapshot = createDeckardStatsSnapshot(index(), preferences(), [], now);
    snapshot.trends.tasks = { points: [...snapshot.trends.tasks.points.slice(0, 11), 4, 3], change: -1 };
    const page = openWebviewPage(renderPage('stats'), snapshot);
    try {
      const tile = (label: string) => page.findAll('.metric').find((element) => element.querySelector('.metric-label')?.textContent === label) as HTMLElement;
      assert.strictEqual(tile('Notes').querySelector('.metric-change')?.textContent, '+2 in the last 7 days');
      assert.strictEqual(tile('Tasks').querySelector('.metric-change')?.textContent, '−1 in the last 7 days');
      assert.strictEqual(tile('Open tasks').querySelector('.metric-change')?.textContent, 'No change in the last 7 days');
      assert.strictEqual(tile('Notes').getAttribute('aria-label'), 'Notes, 4, +2 in the last 7 days. Open a search for every note');
      assert.strictEqual(tile('Files').querySelector('.sparkline'), null, 'Files has no line');
      const line = tile('Notes').querySelector('svg.sparkline');
      assert.strictEqual(line?.getAttribute('aria-hidden'), 'true');
      const titles = [...(line?.querySelectorAll('title') ?? [])].map((title) => title.textContent);
      assert.strictEqual(titles.length, 13);
      assert.strictEqual(titles[0], '12 weeks ago: 1');
      assert.strictEqual(titles[11], '1 week ago: 2');
      assert.strictEqual(titles[12], 'Now: 4');
    } finally {
      page.dispose();
    }
  });
});

suite('Stats: how often tags are used', () => {
  const notes = () => {
    const lines: string[] = [];
    const use = (tag: string, times: number) => {
      for (let i = 0; i < times; i += 1) {
        lines.push(`# ${tag.slice(1)} ${i} ${tag}`);
      }
    };
    use('#once', 1);
    use('#twice', 2);
    use('#four', 4);
    use('#seven', 7);
    use('#thirty', 30);
    use('#project/atlas', 3);
    use('#project/atlass', 1);
    return buildWorkspaceIndex(new Map([['notes/tags.md', parseMarkdown('notes/tags.md', lines.join('\n'))]]));
  };
  const preferences = () =>
    createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never).reader.value;

  test('counts tags in six bands, and lists those used once with their lookalikes', () => {
    const usage = createTagUsage(notes());
    assert.deepStrictEqual(usage.bands.map((band) => [band.label, band.count]), [
      ['Used once', 2],
      ['Used twice', 1],
      ['Used 3–5 times', 2],
      ['Used 6–10 times', 1],
      ['Used 11–25 times', 0],
      ['Used 26 or more times', 1],
    ]);
    assert.deepStrictEqual(usage.usedOnce, [
      { key: '#once', label: '#once' },
      { key: '#project/atlass', label: '#project/atlass', lookalike: { key: '#project/atlas', label: '#project/atlas' } },
    ]);
    assert.strictEqual(usage.usedOnceCount, 2);
  });

  test('each bar says its count and opens its tags; Used once unfolds them to merge', () => {
    const page = openWebviewPage(renderPage('stats'), createDeckardStatsSnapshot(notes(), preferences(), [], Date.now()));
    try {
      const bands = page.findAll('.tag-use-band');
      assert.deepStrictEqual(bands.map((band) => band.textContent), [
        'Used once: 2 tags',
        'Used twice: 1 tag',
        'Used 3–5 times: 2 tags',
        'Used 6–10 times: 1 tag',
        'Used 11–25 times: 0 tags',
        'Used 26 or more times: 1 tag',
      ]);
      assert.strictEqual(bands[4].tagName, 'DIV', 'an empty band is not a button');
      assert.strictEqual((page.find('.tag-use-band[data-band="5"] .tag-use-bar') as HTMLElement).style.height, '50%', 'a bar is as tall as its share of the tallest');

      page.click('[data-band="2"]');
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openTagList', namespaced: false, min: 3, max: 5 });
      page.click('[data-band="5"]');
      assert.deepStrictEqual(page.posted.at(-1), { type: 'openTagList', namespaced: false, min: 26 });

      assert.strictEqual(page.findAll('#used-once-list').length, 0, 'folded to begin with');
      page.click('[data-action="toggle-used-once"]');
      assert.strictEqual(page.find('[data-action="toggle-used-once"]').getAttribute('aria-expanded'), 'true');
      const rows = page.findAll('#used-once-list li');
      assert.strictEqual(rows.length, 2);
      assert.match(rows[1].textContent ?? '', /#project\/atlass.*#project\/atlas/);
      page.click('#used-once-list [data-action="merge-used-once"]');
      assert.deepStrictEqual(page.posted.at(-1), { type: 'mergeTags', sourceKey: '#project/atlass', targetKey: '#project/atlas' });
      page.click('#used-once-list [data-action="merge-used-once-into"]');
      assert.deepStrictEqual(page.posted.at(-1), { type: 'mergeTagInto', sourceKey: '#once' });
    } finally {
      page.dispose();
    }
  });

  test('a band offers the tags used that often', () => {
    const index = notes();
    assert.deepStrictEqual(listStatsTags(index, false, { min: 3, max: 5 }).map((row) => row.label), ['#four', '#project/atlas']);
  });
});

suite('Stats: tags written together', () => {
  const index = () => buildWorkspaceIndex(new Map([
    ['notes/a.md', parseMarkdown('notes/a.md', [
      '# Atlas #project/atlas #design',
      '## Review #vendor',
      '- [ ] Call #design',
      '# Relay #project/relay #vendor',
      '# Both #project/atlas #vendor',
      '# Alone #design',
    ].join('\n'))],
  ]));
  const preferences = () =>
    createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never).reader.value;

  test('counts the entries carrying each two of the most-used tags', () => {
    const { tags, pairs } = createTagPairs(index(), 12);
    const at = (a: string, b: string) => {
      const left = tags.findIndex((tag) => tag[0] === a);
      const right = tags.findIndex((tag) => tag[0] === b);
      return pairs[Math.min(left, right)][Math.max(left, right)];
    };
    // Atlas carries both; Review and the task under it inherit Atlas's tags.
    assert.strictEqual(at('#project/atlas', '#design'), 3);
    assert.strictEqual(at('#project/atlas', '#vendor'), 3, 'Review, its task, and Both');
    assert.strictEqual(at('#design', '#vendor'), 2, 'Review and its task');
    assert.strictEqual(at('#project/relay', '#design'), 0);
    assert.strictEqual(createTagPairs(index(), 2).tags.length, 2, 'only the most-used');
  });

  test('a cell opens the search for both, and the pairs can be read as a list', () => {
    const page = openWebviewPage(renderPage('stats'), createDeckardStatsSnapshot(index(), preferences(), [], Date.now()));
    try {
      const cells = page.findAll('.pair-grid .pair-cell');
      assert.ok(cells.length > 0);
      assert.strictEqual(page.findAll('.pair-grid .pair-cell[tabindex="0"]').length, 1, 'one tab stop');
      const first = cells[0] as HTMLElement;
      first.click();
      const posted = page.posted.at(-1) as { type: string; query: string };
      assert.strictEqual(posted.type, 'openSearch');
      assert.match(posted.query, /^#\S+ #\S+$/);
      assert.match(first.getAttribute('aria-label') ?? '', / and .*: \d+ (entry|entries)\. Open a search for both$/);

      first.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      assert.strictEqual(page.document.activeElement?.classList.contains('pair-cell'), true, 'arrows move between cells');

      const toggle = page.find('[data-action="toggle-pairs-table"]');
      assert.strictEqual(toggle.getAttribute('aria-pressed'), 'false');
      page.click('[data-action="toggle-pairs-table"]');
      assert.ok(page.find('.tag-pairs').classList.contains('as-table'));
      const counts = page.findAll('.pair-list .count').map((count) => Number(count.textContent));
      assert.deepStrictEqual(counts, [...counts].sort((a, b) => b - a), 'most written together first');
      assert.strictEqual(counts[0], 3);
    } finally {
      page.dispose();
    }
  });
});
