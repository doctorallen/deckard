import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences } from './preferenceServices';
import { SearchStore } from '../core/storage/searchStore';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  buildQuickFindResults,
  findChoiceKey,
  fuzzyScore,
  QuickFindResults,
} from '../ui/state/quickFindState';
import { findDailyNoteRow, isNoteName, toPickItems } from '../ui/commands/quickFind';
import { formatCapture } from '../ui/commands/capture';
import { parseDatePhrase } from '../domain/markdown/dates';
import { createQueryContext } from '../domain/query/queryContext';
import { keyLabel } from '../ui/commands/quickFindKeys';
import { createQuerySuggestions } from '../ui/state/querySuggestions';
import { PersistedPreferences, WorkspaceIndex } from '../domain/model';

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

/**
 * Runs Quick Find over real parsed notes and a real in-memory text index, so
 * the ranking is checked against what the extension would actually do.
 */
function createFinder(notes: Record<string, string>) {
  const files = Object.entries(notes).map(([filePath, content]) =>
    parseMarkdown(filePath, content, { updatedAt: 1 }),
  );
  const index: WorkspaceIndex = buildWorkspaceIndex(
    new Map(files.map((file) => [file.filePath, file])),
  );
  const store = new SearchStore(undefined);
  store.replace(files);
  const conditions = createQuerySuggestions(index, [], createQueryContext(Date.now())).conditions;
  return {
    index,
    find: (
      input: string,
      preferences: PersistedPreferences = createPreferences(new MemoryMemento()).reader.value,
    ): QuickFindResults =>
      buildQuickFindResults({
        index,
        preferences,
        input,
        searchText: (text) => store.searchEntries(text, { limit: 200 }),
        queryContext: createQueryContext(Date.now()),
        conditions,
        formatCapture: (text) => formatCapture(text, Date.now()),
      }),
    dispose: () => store.dispose(),
  };
}

suite('Quick Find', () => {
  test('lists a note titled with the words above one that only mentions them', () => {
    const finder = createFinder({
      'a.md': '# Weekly review\nThe vendor sent the elevator quote.',
      'b.md': '# Vendor contract\nSigned today.',
    });
    try {
      const results = finder.find('vendor');
      assert.deepStrictEqual(
        results.notes.map((note) => note.label),
        ['Vendor contract', 'Weekly review'],
      );
      assert.strictEqual(results.notes[0].line, 1);
    } finally {
      finder.dispose();
    }
  });

  test('finds a title from its initials and abbreviations', () => {
    const finder = createFinder({
      'a.md': '# Vendor contract\nSigned today.',
      'b.md': '# Harbor schedule\nDocking windows.',
    });
    try {
      assert.deepStrictEqual(
        finder.find('vcon').notes.map((note) => note.label),
        ['Vendor contract'],
      );
    } finally {
      finder.dispose();
    }
  });

  test('narrows with tags and shorthands exactly as a query does', () => {
    const finder = createFinder({
      'atlas.md': '# Atlas #project/atlas\n- [ ] Send the manifest\n- [x] Book the dock',
      'harbor.md': '# Harbor\n- [ ] Send the roster',
    });
    try {
      const results = finder.find('#project/atlas is:open');
      assert.deepStrictEqual(results.tasks.map((task) => task.label), ['Send the manifest']);
      assert.deepStrictEqual(results.notes, []);
    } finally {
      finder.dispose();
    }
  });

  test('completes a tag while it is typed, and does not narrow to nothing', () => {
    const finder = createFinder({
      'atlas.md': '# Atlas #project/atlas\nPlanning.',
    });
    try {
      const results = finder.find('planning #proj');
      assert.strictEqual(results.tags[0]?.tagKey, '#project/atlas');
      assert.strictEqual(results.tags[0]?.completion, 'planning #project/atlas ');
      // The words before the unfinished tag still find their notes.
      assert.deepStrictEqual(results.notes.map((note) => note.label), ['Atlas']);
    } finally {
      finder.dispose();
    }
  });

  test('finds a tag from its last segment', () => {
    const finder = createFinder({
      'atlas.md': '# Planning #project/atlas',
    });
    try {
      assert.strictEqual(finder.find('atlas').tags[0]?.tagKey, '#project/atlas');
    } finally {
      finder.dispose();
    }
  });

  test('offers a condition for a value typed without its field', () => {
    const finder = createFinder({ 'a.md': '# A\n- [ ] Task' });
    try {
      const conditions = finder.find('overd').conditions;
      assert.strictEqual(conditions[0]?.label, 'is:overdue');
      assert.strictEqual(conditions[0]?.completion, 'is:overdue ');
    } finally {
      finder.dispose();
    }
  });

  test('keeps the results of the finished words while the last one is typed', () => {
    const finder = createFinder({
      'a.md': '# Plan\n- [ ] Send the manifest',
    });
    try {
      const results = finder.find('manifest is:ov');
      assert.strictEqual(results.message, undefined);
      assert.deepStrictEqual(results.tasks.map((task) => task.label), ['Send the manifest']);
      assert.strictEqual(results.conditions[0]?.label, 'is:overdue');
    } finally {
      finder.dispose();
    }
  });

  test('suggests a correction for a misspelled word', () => {
    const finder = createFinder({ 'a.md': '# Plan\nThe manifest is ready.' });
    try {
      assert.strictEqual(finder.find('manifst ').suggestion, 'manifest ');
    } finally {
      finder.dispose();
    }
  });

  test('opens on recent searches, favorite and recently opened tags', async () => {
    const finder = createFinder({
      'atlas.md': '# Atlas #project/atlas',
      'harbor.md': '# Harbor #project/harbor',
    });
    const store = createPreferences(new MemoryMemento());
    try {
      await store.savedSearches.recordRecentQuery('#project/atlas is:open');
      await store.usage.recordTagAccess('#project/harbor');
      const results = finder.find('', store.reader.value);
      assert.deepStrictEqual(results.recent.map((item) => item.query), [
        '#project/atlas is:open',
      ]);
      assert.deepStrictEqual(results.tags.map((item) => item.tagKey), ['#project/harbor']);
    } finally {
      finder.dispose();
    }
  });

  test('with nothing typed, lists pinned notes first, then the five opened last', async () => {
    const finder = createFinder({
      'atlas.md': '# Atlas\n## Next\nWork.',
      'harbor.md': '# Harbor',
      ...Object.fromEntries(Array.from({ length: 7 }, (_, n) => [`n${n}.md`, `# Note ${n}`])),
    });
    const store = createPreferences(new MemoryMemento());
    try {
      const idOf = (heading: string) =>
        [...finder.index.sections.values()].find((section) => section.heading === heading)!.id;
      await store.pins.pinNote({ filePath: 'atlas.md', heading: 'Next', headingLevel: 2, occurrence: 0 });
      await store.pins.pinNote({ filePath: 'harbor.md', heading: 'Gone', headingLevel: 1, occurrence: 0 });
      await store.usage.recordSectionAccess(idOf('Next'), 100);
      for (let n = 0; n < 7; n += 1) {
        await store.usage.recordSectionAccess(idOf(`Note ${n}`), 200 + n);
      }
      for (let n = 0; n < 7; n += 1) {
        await store.savedSearches.recordRecentQuery(`search ${n}`);
      }
      const results = finder.find('', store.reader.value);
      assert.deepStrictEqual(
        results.pinned?.map((item) => [item.label, item.description, item.detail]),
        [
          ['Next', 'Pinned · atlas.md', undefined],
          ['Gone', 'Pinned · harbor.md', 'heading not found'],
        ],
      );
      assert.deepStrictEqual(results.notes.map((item) => item.label), ['Note 6', 'Note 5', 'Note 4', 'Note 3', 'Note 2']);
      assert.strictEqual(results.recent.length, 5);
      const labels = toPickItems(results, '')
        .filter((item) => item.kind === vscode.QuickPickItemKind.Separator)
        .map((item) => item.label);
      assert.deepStrictEqual(labels, ['Pinned', 'Recently opened', 'Recent searches']);
      assert.ok(toPickItems(results, '').some((item) => item.label === '$(pinned) Next'));
    } finally {
      finder.dispose();
    }
  });

  test('lists answers from the types first, under Answer, each with its value\'s icon and no Tab completion', () => {
    const results: QuickFindResults = {
      answers: [
        { kind: 'tag', answer: 'person', label: 'Dana Whitfield', description: '@dana · Person', detail: 'Rates › lead', tagKey: '@dana' },
        { kind: 'tag', answer: 'value', label: '#rates-desk', description: 'channel of Rates', detail: 'Rates › channel', tagKey: '#team/rates' },
        { kind: 'note', answer: 'note', label: 'RFQ outage', detail: 'Dana › owner of', filePath: 'Incidents/RFQ outage.md', line: 1 },
      ],
      tags: [{ kind: 'tag', label: '#team/rates', description: 'Team · lead Dana Whitfield · 2 notes · 1 task', tagKey: '#team/rates', completion: '#team/rates ' }],
      conditions: [],
      recent: [],
      savedViews: [],
      notes: [],
      tasks: [],
      totals: { notes: 0, tasks: 0 },
    };
    const items = toPickItems(results, 'rates lead');
    assert.deepStrictEqual(
      items.filter((item) => item.kind === vscode.QuickPickItemKind.Separator).map((item) => item.label),
      ['Answer', 'Tags'],
    );
    assert.deepStrictEqual(items.slice(1, 4).map((item) => [item.label, item.detail, item.buttons?.length]), [
      ['$(person) Dana Whitfield', 'Rates › lead', undefined],
      ['$(symbol-field) #rates-desk', 'Rates › channel', undefined],
      ['$(note) RFQ outage', 'Dana › owner of', 2],
    ]);
    assert.strictEqual(items[5].label, '$(tag) #team/rates');
    assert.strictEqual(toPickItems({ ...results, answers: undefined }, 'rates lead')[0].label, 'Tags');
  });

  test('writes a key the way VS Code writes it on each platform', () => {
    assert.strictEqual(keyLabel('cmd+enter', 'darwin'), '⌘Enter');
    assert.strictEqual(keyLabel('alt+enter', 'darwin'), '⌥Enter');
    assert.strictEqual(keyLabel('cmd+.', 'darwin'), '⌘.');
    assert.strictEqual(keyLabel('cmd+enter', 'linux'), 'Ctrl+Enter');
    assert.strictEqual(keyLabel('alt+enter', 'win32'), 'Alt+Enter');
    assert.strictEqual(keyLabel('cmd+.', 'win32'), 'Ctrl+.');
  });

  test('learns the result chosen for what was typed, and never ranks it above an exact title', async () => {
    const finder = createFinder({
      'contract.md': '# Vendor contract\nThe terms.',
      'misc.md': '# Misc\nA vendor visited; vendor notes.',
      'vendors.md': '# Vendors\nList.',
    });
    const store = createPreferences(new MemoryMemento());
    try {
      const misc = finder.find('vend', store.reader.value).notes.find((item) => item.label === 'Misc')!;
      const key = findChoiceKey(finder.index, misc)!;
      assert.ok(key.startsWith('note:'));
      const before = finder.find('vend', store.reader.value).notes.map((item) => item.label);
      assert.notStrictEqual(before[0], 'Misc');
      for (let n = 0; n < 3; n += 1) {
        await store.usage.recordFindChoice('Vend', key, Date.now());
      }
      for (const typed of ['vend', 'ven']) {
        const labels = finder.find(typed, store.reader.value).notes.map((item) => item.label);
        assert.strictEqual(labels[0], 'Misc', typed);
      }
      // What was typed is exactly a title: that title still leads.
      await store.usage.recordFindChoice('vendors', key, Date.now());
      assert.strictEqual(finder.find('vendors', store.reader.value).notes[0].label, 'Vendors');
      // An old choice weighs less than a fresh one.
      const old = createPreferences(new MemoryMemento());
      await old.usage.recordFindChoice('vend', key, Date.now() - 400 * 24 * 60 * 60 * 1000);
      assert.notStrictEqual(finder.find('vend', old.reader.value).notes[0].label, 'Misc');
      old.repository.dispose();
    } finally {
      finder.dispose();
      store.repository.dispose();
    }
  });

  test('offers to capture what it could not find, when the words read as something to do', () => {
    const finder = createFinder({
      'atlas.md': '# Atlas #project/atlas\nThe budget is due.',
      'ren.md': '# Ren\nRen likes coffee.',
    });
    try {
      const friday = parseDatePhrase('friday', Date.now(), { direction: 'future' })?.date;
      const none = finder.find('Call Ren friday p2');
      assert.strictEqual(none.capture?.text, 'Call Ren friday p2');
      assert.strictEqual(none.capture?.line, `- [ ] Call Ren ⏫ 📅 ${friday}`);
      assert.ok(toPickItems(none, 'Call Ren friday p2').some((item) => item.label === '$(inbox) Add “Call Ren friday p2” to today’s note'));
      assert.ok(finder.find('#project/atlas budget meeting').capture, 'a tag among the words');
      assert.strictEqual(finder.find('is:overdue zebra').capture, undefined, 'not a search with a condition');
      assert.strictEqual(finder.find('budget').capture, undefined, 'not when a note has every word');
    } finally {
      finder.dispose();
    }
  });

  test('scores characters that start words and follow each other highest', () => {
    const initials = fuzzyScore('vc', 'vendor contract') ?? 0;
    const scattered = fuzzyScore('vc', 'every cocoa') ?? 0;
    assert.ok(initials > scattered);
    assert.strictEqual(fuzzyScore('xyz', 'vendor contract'), undefined);
  });

  test('offers to create a note only for words that read as a name', () => {
    assert.strictEqual(isNoteName('Vendor contract'), true);
    assert.strictEqual(isNoteName('#project/atlas'), false);
    assert.strictEqual(isNoteName('is:open'), false);
    assert.strictEqual(isNoteName('atlas OR harbor'), false);
    assert.strictEqual(isNoteName('"exact words"'), false);
  });

  test('a day typed opens that day\'s note, in place of creating a note by its name', () => {
    // Friday 2026-09-25, noon.
    const now = new Date(2026, 8, 25, 12).getTime();
    const empty: QuickFindResults = createFinder({}).find('friday');
    const row = findDailyNoteRow('friday', now);
    assert.deepStrictEqual(row, {
      date: '2026-10-02',
      label: '$(calendar) Open daily note for Fri, Oct 2',
      description: '2026-10-02 · in 7 days',
    });
    const items = toPickItems(empty, 'friday', row);
    assert.strictEqual(items[0].label, '$(calendar) Open daily note for Fri, Oct 2');
    assert.ok(!items.some((item) => item.label.includes('Create note')), 'no note called friday');
    assert.strictEqual(findDailyNoteRow('Atlas plan', now), undefined);
    assert.strictEqual(findDailyNoteRow('fri', now), undefined, 'a short weekday is searched as a word');
    assert.strictEqual(findDailyNoteRow('#project/atlas', now), undefined);
  });
});
