import * as assert from 'assert';
import { createHash } from 'node:crypto';

import { createPreferences, TestPreferences } from './preferenceServices';
import type { PersistedPreferences, TaskColumnId } from '../domain/model';
import { pinKey } from '../core/storage/preferencesSchema';

/**
 * The persisted preferences format, pinned byte for byte.
 *
 * A blob that sets every field of `PersistedPreferences` to a value other
 * than its default is read through the store and written back, and the JSON
 * each store receives is compared with what 1.23.1 writes. Each legacy shape
 * a migration reads is loaded the same way, and a walk over every mutator
 * pins which store is written, in what order, with what bytes, and which
 * event follows. Everything here is made up: no reader's preferences are in
 * it.
 *
 * The expectations were taken from the store as it was before Phase 3 split
 * it, so a refactor that changes one byte of what is stored fails here.
 * Since Phase 4 the walk drives the repository and its services, as the
 * extension builds them, with the same inputs the facade's methods took.
 */

const PREFERENCES = 'deckard.preferences';
const HANDED_OVER = 'deckard.preferences.workspaceScoped';

/** The keys a workspace keeps, in the order its share is written. */
const WORKSPACE_KEYS = [
  'favoriteTags',
  'favoriteEntities',
  'tagAccessOrder',
  'tagAccessCounts',
  'tagAccessTimes',
  'entityAccessOrder',
  'entityAccessCounts',
  'taskOrder',
  'sectionAccessCounts',
  'sectionAccessTimes',
  'savedFilters',
  'recentQueries',
  'findChoices',
  'recentHeadings',
  'tagFirstSeen',
  'pinnedNotes',
  'dashboardWidgets',
  'dashboardViewState',
] as const;

/** Every key of a normalized blob, in the order it is written. */
const KEY_ORDER = [
  'version',
  'favoriteTags',
  'favoriteEntities',
  'tagSortMode',
  'entitySortMode',
  'tagAccessOrder',
  'tagAccessCounts',
  'entityAccessOrder',
  'entityAccessCounts',
  'taskOrder',
  'taskSortMode',
  'dashboardTaskColumns',
  'dashboardNoteColumns',
  'dashboardTagColumns',
  'dashboardViewState',
  'renderMode',
  'renderModeChosen',
  'tagOverviewSortMode',
  'tagOverviewLayout',
  'searchPageSize',
  'searchPreview',
  'relatedNotesSortMode',
  'hideDailyNotes',
  'relatedNotesPreviewLines',
  'sectionAccessCounts',
  'savedFilters',
  'taskBoardLayout',
  'taskTableColumns',
  'taskTableSort',
  'taskBoardGroup',
  'taskBoardGroupNamespace',
  'tagAccessTimes',
  'sectionAccessTimes',
  'recentQueries',
  'dashboardWidgets',
  'tagFirstSeen',
  'pinnedNotes',
  'findChoices',
  'recentHeadings',
] as const;

type Blob = Record<string, unknown>;

/** One thing a store or the store's events did, in the order it happened. */
type Entry =
  | { kind: 'write'; store: string; key: string; json: string | undefined }
  | { kind: 'change'; json: string }
  | { kind: 'visit' };

/** A key-value store kept as JSON, as VS Code keeps a memento on disk. */
class RecordingStore {
  private readonly values = new Map<string, string>();

  public constructor(
    private readonly name: string,
    private readonly log: Entry[],
    initial: Blob = {},
  ) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, JSON.stringify(value));
    }
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    const json = this.values.get(key);
    return json === undefined ? defaultValue : (JSON.parse(json) as T);
  }

  public async update(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    this.log.push({ kind: 'write', store: this.name, key, json });
    if (json === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, json);
    }
  }

  /** The JSON of every stored key. */
  public dump(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}

/** A blob with its keys in the order a normalized blob has them. */
function inOrder(blob: Blob): Blob {
  const unknown = Object.keys(blob).filter((key) => !(KEY_ORDER as readonly string[]).includes(key));
  assert.deepStrictEqual(unknown, [], 'every expected key is one the store writes');
  return Object.fromEntries(KEY_ORDER.filter((key) => key in blob).map((key) => [key, blob[key]]));
}

/** The workspace's share of a blob, in the order it is written. */
function share(blob: Blob): Blob {
  return Object.fromEntries(
    WORKSPACE_KEYS.filter((key) => blob[key] !== undefined).map((key) => [key, blob[key]]),
  );
}

function digest(json: string | undefined): string {
  return json === undefined ? 'undefined' : createHash('sha256').update(json).digest('hex').slice(0, 16);
}

const DEFAULT_WIDGETS = [
  { id: 'tryNext', kind: 'tryNext', width: 'full' },
  { id: 'search', kind: 'search', width: 'full' },
  { id: 'agenda', kind: 'agenda', width: 'half', count: 5 },
  { id: 'recentNotes', kind: 'recentNotes', width: 'half', count: 5 },
  { id: 'favoriteTags', kind: 'favoriteTags', width: 'half', count: 8 },
  { id: 'savedSearches', kind: 'savedSearches', width: 'half' },
];

/** What an empty store holds, in memory: two keys are present and undefined. */
const DEFAULTS: Blob = {
  version: 1,
  favoriteTags: [],
  favoriteEntities: [],
  tagSortMode: 'alphabetical',
  entitySortMode: 'alphabetical',
  tagAccessOrder: [],
  tagAccessCounts: {},
  entityAccessOrder: [],
  entityAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank',
  dashboardTaskColumns: 1,
  dashboardNoteColumns: 1,
  dashboardTagColumns: 2,
  dashboardViewState: { mode: 'home', tagSearchQuery: '' },
  renderMode: 'html',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  searchPageSize: 30,
  searchPreview: 'lines',
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [],
  taskBoardLayout: 'board',
  taskTableColumns: undefined,
  taskTableSort: undefined,
  taskBoardGroup: 'status',
  tagAccessTimes: {},
  sectionAccessTimes: {},
  recentQueries: [],
  dashboardWidgets: DEFAULT_WIDGETS,
  pinnedNotes: [],
};

/** The defaults with some fields changed, in written order. */
function expected(overrides: Blob): Blob {
  return inOrder({ ...DEFAULTS, ...overrides });
}

/**
 * A blob as 1.23.1 writes it, with every field set to something other than
 * its default and every optional field present.
 */
const FULL: Blob = {
  version: 1,
  favoriteTags: ['#project/atlas', '#risk/vendor'],
  favoriteEntities: ['#person/ren'],
  tagSortMode: 'custom',
  entitySortMode: 'access',
  tagAccessOrder: ['#risk/vendor', '#project/atlas', '#topic/mesh'],
  tagAccessCounts: { '#project/atlas': 7, '#risk/vendor': 2 },
  entityAccessOrder: ['#person/ren', '#person/dax'],
  entityAccessCounts: { '#person/ren': 4, '#person/dax': 0 },
  taskOrder: ['task-k2m9-p4q1', 'task-a7b3-c8d2'],
  taskSortMode: 'updated',
  dashboardTaskColumns: 3,
  dashboardNoteColumns: 2,
  dashboardTagColumns: 4,
  dashboardViewState: { mode: 'browse', tagSearchQuery: 'atl' },
  renderMode: 'markdown',
  renderModeChosen: true,
  tagOverviewSortMode: 'access',
  tagOverviewLayout: 'split',
  searchPageSize: 100,
  searchPreview: 'full',
  relatedNotesSortMode: 'oldest',
  hideDailyNotes: true,
  relatedNotesPreviewLines: 2,
  sectionAccessCounts: { 'section-q1w2-e3r4': 5, 'section-t5y6-u7i8': 1 },
  savedFilters: [
    { id: 'filter-one', name: 'Atlas risks', tagKeys: ['#project/atlas', '#risk/vendor'] },
    { id: 'filter-two', name: 'Open atlas', tagKeys: [], query: 'is:open #project/atlas', page: 'taskBoard' },
    { id: 'filter-three', name: 'Mesh', tagKeys: [], query: '#topic/mesh' },
  ],
  taskBoardLayout: 'table',
  taskTableColumns: ['title', 'due', 'priority', 'assignee'],
  taskTableSort: { column: 'due', direction: 'desc' },
  taskBoardGroup: 'tag',
  taskBoardGroupNamespace: 'project',
  tagAccessTimes: { '#project/atlas': 1_700_000_000_000, '#risk/vendor': 1_690_000_000_000 },
  sectionAccessTimes: { 'section-q1w2-e3r4': 1_700_000_200_000 },
  recentQueries: ['is:open', '#risk/vendor'],
  dashboardWidgets: [
    { id: 'search', kind: 'search', width: 'full' },
    { id: 'tasks-1', kind: 'tasks', width: 'half', count: 7, paged: true, page: 3, query: 'is:open #project/atlas' },
    { id: 'tasks-2', kind: 'tasks', width: 'full', count: 20, query: '' },
    { id: 'agenda', kind: 'agenda', width: 'full', count: 4 },
    { id: 'stale', kind: 'tasks', width: 'half', count: 6, query: 'is:open AND updated < 45d', sort: 'updatedOldest' },
    { id: 'quiet', kind: 'quietPeople', width: 'half', count: 5, days: 120, namespace: 'project', noOpenTasks: true },
    { id: 'saved-1', kind: 'savedQuery', width: 'half', count: 3, filterId: 'filter-two' },
    { id: 'pins', kind: 'pinnedNotes', width: 'half', count: 10, paged: true, page: 1 },
  ],
  tagFirstSeen: { '#project/atlas': 0, '#risk/vendor': 1_699_000_000_000 },
  pinnedNotes: [
    { filePath: 'notes/atlas.md' },
    { filePath: 'notes/relay.md', heading: 'Plan', headingLevel: 2, occurrence: 0 },
  ],
  findChoices: [
    { input: 'atlas', key: 'note:["notes/atlas.md","Atlas",0]', count: 3, at: 1_700_000_100_000 },
    { input: 'vendor', key: 'tag:#risk/vendor', count: 1, at: 1_700_000_050_000 },
    { input: 'relay plan', key: 'task:["notes/relay.md","Book travel"]', count: 2, at: 1_700_000_040_000 },
  ],
  recentHeadings: [
    { filePath: 'notes/atlas.md', heading: 'Decisions', headingLevel: 2, occurrence: 1 },
  ],
};

/**
 * The machine-wide copy another workspace left: FULL's presentation, with
 * that workspace's content under the workspace keys.
 */
const ELSEWHERE: Blob = {
  ...FULL,
  favoriteTags: ['#elsewhere/one'],
  taskOrder: ['task-zz11-zz22'],
  pinnedNotes: ['elsewhere.md'],
  dashboardWidgets: [],
  dashboardViewState: { mode: 'home', tagSearchQuery: 'elsewhere' },
};

/** Loads a blob with no folder open: the machine-wide store alone. */
function loadAlone(blob: unknown): { store: TestPreferences; global: RecordingStore; log: Entry[] } {
  const log: Entry[] = [];
  const global = new RecordingStore('global', log, blob === undefined ? {} : { [PREFERENCES]: blob });
  return { store: watched(createPreferences(global), log), global, log };
}

/** The store, with its two events logged beside the writes. */
function watched(store: TestPreferences, log: Entry[]): TestPreferences {
  store.reader.onDidChange((value) => log.push({ kind: 'change', json: JSON.stringify(value) }));
  store.reader.onDidRecordVisit(() => log.push({ kind: 'visit' }));
  return store;
}

/** Writes what the store holds without changing it, and returns the JSON the machine-wide store received. */
async function writeBack(store: TestPreferences, log: Entry[]): Promise<string | undefined> {
  log.length = 0;
  await store.display.setSearchPageSize(store.reader.value.searchPageSize);
  const write = log.find((entry) => entry.kind === 'write' && entry.store === 'global');
  assert.ok(write && write.kind === 'write' && write.key === PREFERENCES);
  return write.json;
}

/**
 * Asserts what a blob normalizes to, in memory and in the bytes written
 * back: the same, except where a second normalization drops what the first
 * left empty.
 */
async function assertReadsAs(blob: unknown, want: Blob, written: Blob = want): Promise<void> {
  const { store, log } = loadAlone(blob);
  assert.deepStrictEqual(store.reader.value, want);
  assert.deepStrictEqual(Object.keys(store.reader.value), Object.keys(want), 'keys in written order');
  assert.strictEqual(await writeBack(store, log), JSON.stringify(written));
}

suite('Preferences round trip', () => {
  test('a full blob, split across two stores, reads as written and writes the same bytes back', async () => {
    const log: Entry[] = [];
    const global = new RecordingStore('global', log, { [PREFERENCES]: ELSEWHERE, [HANDED_OVER]: true });
    const workspace = new RecordingStore('workspace', log, { [PREFERENCES]: share(FULL) });
    const store = watched(createPreferences(global, workspace), log);
    await store.repository.initialize();
    assert.strictEqual(log.length, 0, 'a workspace with its own blob is not seeded');

    assert.deepStrictEqual(store.reader.value, FULL);
    assert.deepStrictEqual(Object.keys(store.reader.value), KEY_ORDER.slice(), 'every key, in written order');

    await store.display.setSearchPageSize(100);
    assert.deepStrictEqual(log.map((entry) => (entry.kind === 'write' ? `${entry.store} ${entry.key}` : entry.kind)), [
      `global ${PREFERENCES}`,
      `workspace ${PREFERENCES}`,
      'change',
    ]);
    assert.deepStrictEqual(global.dump(), {
      [PREFERENCES]: JSON.stringify(FULL),
      [HANDED_OVER]: 'true',
    });
    assert.deepStrictEqual(workspace.dump(), { [PREFERENCES]: JSON.stringify(share(FULL)) });
    assert.strictEqual((log[2] as { json: string }).json, JSON.stringify(FULL), 'the change carries the blob');
  });

  test('a full blob with no folder open reads and writes the machine-wide store alone', async () => {
    const { store, global, log } = loadAlone(FULL);
    await store.repository.initialize();
    assert.strictEqual(log.length, 0);
    assert.deepStrictEqual(store.reader.value, FULL);
    assert.strictEqual(await writeBack(store, log), JSON.stringify(FULL));
    assert.deepStrictEqual(global.dump(), { [PREFERENCES]: JSON.stringify(FULL) });
    assert.deepStrictEqual(log.map((entry) => entry.kind), ['write', 'change'], 'no handover flag without a workspace');
  });

  test('nothing stored reads as the defaults', async () => {
    await assertReadsAs(undefined, expected({}));
    await assertReadsAs(null, expected({}));
    await assertReadsAs('not a blob', expected({}));
  });

  suite('migrations', () => {
    test('the first workspace after 1.19 adopts the machine-wide content, and the next starts clean', async () => {
      const log: Entry[] = [];
      // 1.18 kept everything machine-wide.
      const global = new RecordingStore('global', log, { [PREFERENCES]: FULL });
      const first = watched(createPreferences(global, new RecordingStore('workspace', log)), log);
      assert.deepStrictEqual(first.reader.value, FULL, 'the seed is read at once');
      await first.repository.initialize();
      assert.deepStrictEqual(
        log.map((entry) => (entry.kind === 'write' ? `${entry.store} ${entry.key} ${entry.json}` : entry.kind)),
        [
          `global ${PREFERENCES} ${JSON.stringify(FULL)}`,
          `workspace ${PREFERENCES} ${JSON.stringify(share(FULL))}`,
          `global ${HANDED_OVER} true`,
        ],
        'the handover writes the blob, the share, then the flag, and fires nothing',
      );
      await first.repository.initialize();
      assert.strictEqual(log.length, 3, 'once');

      log.length = 0;
      const second = watched(createPreferences(global, new RecordingStore('workspace', log)), log);
      await second.repository.initialize();
      assert.strictEqual(log.length, 0);
      const presentation = Object.fromEntries(
        Object.entries(FULL).filter(([key]) => !(WORKSPACE_KEYS as readonly string[]).includes(key)),
      );
      assert.deepStrictEqual(second.reader.value, expected(presentation));
    });

    test('a workspace with no blob is not seeded once the handover is recorded, even with no flag read before', async () => {
      const log: Entry[] = [];
      const global = new RecordingStore('global', log, { [PREFERENCES]: FULL, [HANDED_OVER]: false });
      const store = watched(createPreferences(global, new RecordingStore('workspace', log, { [PREFERENCES]: {} })), log);
      await store.repository.initialize();
      assert.strictEqual(log.length, 0, 'an empty blob of its own is still its own');
      assert.deepStrictEqual(store.reader.value.favoriteTags, []);
      assert.strictEqual(store.reader.value.tagSortMode, 'custom');
    });

    test('Source is kept only when it was chosen since Rendered became the default', async () => {
      await assertReadsAs({ renderMode: 'markdown' }, expected({}));
      await assertReadsAs({ renderMode: 'markdown', renderModeChosen: false }, expected({}));
      await assertReadsAs({ renderMode: 'markdown', renderModeChosen: 'yes' }, expected({}));
      await assertReadsAs({ renderMode: 'html', renderModeChosen: true }, expected({ renderModeChosen: true }));
      await assertReadsAs(
        { renderMode: 'markdown', renderModeChosen: true },
        expected({ renderMode: 'markdown', renderModeChosen: true }),
      );
    });

    test('a Dashboard left on a removed tab opens on Home, and the old view-state fields are dropped', async () => {
      await assertReadsAs(
        {
          dashboardViewState: {
            mode: 'tasks',
            tagSearchQuery: 'atl',
            taskSearchQuery: 'open',
            noteSearchQuery: 'relay',
            selectedTagKeys: ['#project/atlas'],
          },
        },
        expected({ dashboardViewState: { mode: 'home', tagSearchQuery: 'atl' } }),
      );
      await assertReadsAs({ dashboardViewState: { mode: 'notes' } }, expected({}));
      await assertReadsAs({ dashboardViewState: { mode: 'browse', tagSearchQuery: 7 } }, expected({
        dashboardViewState: { mode: 'browse', tagSearchQuery: '' },
      }));
      await assertReadsAs({ dashboardViewState: 'browse' }, expected({}));
    });

    test('retired and unknown keys are dropped, and the version is always 1', async () => {
      await assertReadsAs(
        {
          version: 7,
          dashboardTaskLayout: 'board',
          dashboardNoteSortMode: 'updated',
          dashboardTaskSortMode: 'created',
          somethingFromTheFuture: { nested: true },
          favoriteTags: ['#kept'],
        },
        expected({ favoriteTags: ['#kept'] }),
      );
    });

    test('a blob from before Home had widgets gets the defaults, and an empty Home stays empty', async () => {
      await assertReadsAs({ favoriteTags: ['#a'] }, expected({ favoriteTags: ['#a'] }));
      await assertReadsAs({ dashboardWidgets: 'none' }, expected({}));
      await assertReadsAs({ dashboardWidgets: [] }, expected({ dashboardWidgets: [] }));
    });

    test('a pin written as a path reads as a pin on the whole note', async () => {
      await assertReadsAs(
        {
          pinnedNotes: ['notes/a.md', { filePath: 'notes/b.md', heading: 'B' }, 'notes/a.md', '', 42, null],
          recentHeadings: ['notes/c.md', { filePath: 'notes/c.md' }],
        },
        expected({
          pinnedNotes: [{ filePath: 'notes/a.md' }, { filePath: 'notes/b.md', heading: 'B' }],
          recentHeadings: [{ filePath: 'notes/c.md' }],
        }),
      );
    });

    test('ids from before 1.23 are carried to the ids now when the index is first pruned', async () => {
      const { store, log } = loadAlone({
        taskOrder: ['task-aaa1', 'task-bbb2', 'task-gone9', 'task-ccc3-ddd4'],
        sectionAccessCounts: { 'section-eee5': 4, 'section-fff6-ggg7': 1, 'section-eee5-hhh8': 2 },
        sectionAccessTimes: { 'section-eee5': 1_000, 'section-fff6-ggg7': 2_000 },
        tagFirstSeen: { '#t': 5 },
      });
      log.length = 0;
      await store.maintenance.pruneKeys(
        {
          tags: ['#t'],
          tasks: ['task-bbb2-y2', 'task-aaa1-x1', 'task-ccc3-ddd4', 'task-aaa1-x9'],
          sections: ['section-eee5-hhh8', 'section-fff6-ggg7', 'section-eee5-zzz9'],
          entities: [],
          files: ['n.md'],
        },
        9_000,
      );
      const want = expected({
        taskOrder: ['task-aaa1-x1', 'task-bbb2-y2', 'task-ccc3-ddd4'],
        sectionAccessCounts: { 'section-eee5-hhh8': 2, 'section-fff6-ggg7': 1 },
        sectionAccessTimes: { 'section-eee5-hhh8': 1_000, 'section-fff6-ggg7': 2_000 },
        tagFirstSeen: { '#t': 5 },
      });
      assert.deepStrictEqual(store.reader.value, want);
      assert.deepStrictEqual(
        log.map((entry) => (entry.kind === 'write' ? `${entry.store} ${entry.json}` : entry.kind)),
        [`global ${JSON.stringify(want)}`, 'change'],
      );
    });

    test('a blob with no first-seen times marks every indexed tag as known before times were kept', async () => {
      const { store, log } = loadAlone({ tagAccessCounts: { '#a': 1, '#gone': 3 } });
      assert.strictEqual('tagFirstSeen' in store.reader.value, false, 'left out until the first index');
      await store.maintenance.pruneKeys({ tags: ['#a', '#b'], tasks: [] }, 9_000);
      assert.deepStrictEqual(store.reader.value, expected({ tagAccessCounts: { '#a': 1 }, tagFirstSeen: { '#a': 0, '#b': 0 } }));
      await store.maintenance.pruneKeys({ tags: ['#a', '#b', '#c'], tasks: [] }, 9_500);
      assert.deepStrictEqual(store.reader.value.tagFirstSeen, { '#a': 0, '#b': 0, '#c': 9_500 });
      assert.strictEqual(await writeBack(store, log), JSON.stringify(store.reader.value));
    });

    test('saved filters with no name, too few tags, or a repeated id or view are dropped', async () => {
      await assertReadsAs(
        {
          savedFilters: [
            { id: 'a', name: ' Pair ', tagKeys: [' #b ', '#a', '#a', '', 3] },
            { id: 'b', name: 'Same pair', tagKeys: ['#a', '#b'] },
            { id: 'a', name: 'Same id', tagKeys: ['#c', '#d'] },
            { id: 'c', name: '', tagKeys: ['#c', '#d'] },
            { id: 'd', name: 'One tag', tagKeys: ['#c'] },
            { id: ' ', name: 'Blank id', tagKeys: ['#c', '#d'] },
            { id: 'e', name: 'Query', tagKeys: ['#x'], query: ' is:open ', page: 'taskBoard' },
            { id: 'f', name: 'Same query', tagKeys: [], query: 'is:open', page: 'taskBoard' },
            { id: 'g', name: 'Same query on search', tagKeys: [], query: 'is:open', page: 'search' },
            { id: 'h', name: 'Blank query', tagKeys: [], query: '  ' },
            { id: 'i', name: 'Tags with a page', tagKeys: ['#e', '#f'], page: 'taskBoard' },
            { id: 7, name: 'Number id', tagKeys: ['#g', '#h'] },
            null,
            'filter',
          ],
        },
        expected({
          savedFilters: [
            { id: 'a', name: 'Pair', tagKeys: ['#a', '#b'] },
            { id: 'e', name: 'Query', tagKeys: ['#x'], query: 'is:open', page: 'taskBoard' },
            { id: 'g', name: 'Same query on search', tagKeys: [], query: 'is:open' },
            { id: 'i', name: 'Tags with a page', tagKeys: ['#e', '#f'] },
          ],
        }),
      );
    });
  });

  suite('normalization', () => {
    test('every value an enum field accepts is kept, and anything else falls back', async () => {
      const fields: Array<[string, readonly unknown[], unknown]> = [
        ['tagSortMode', ['alphabetical', 'count', 'access', 'custom'], 'alphabetical'],
        ['entitySortMode', ['alphabetical', 'count', 'access', 'custom'], 'alphabetical'],
        ['taskSortMode', ['rank', 'created', 'createdOldest', 'updated', 'updatedOldest', 'alphabetical', 'alphabeticalReverse'], 'rank'],
        ['dashboardTaskColumns', [1, 2, 3, 4], 1],
        ['dashboardNoteColumns', [1, 2, 3, 4], 1],
        ['dashboardTagColumns', [1, 2, 3, 4], 2],
        ['tagOverviewSortMode', ['alphabetical', 'alphabeticalReverse', 'created', 'createdOldest', 'updated', 'updatedOldest', 'access'], 'alphabetical'],
        ['tagOverviewLayout', ['tabs', 'split'], 'tabs'],
        ['searchPageSize', [10, 30, 50, 100, 200], 30],
        ['searchPreview', ['none', 'lines', 'full'], 'lines'],
        ['relatedNotesSortMode', ['newest', 'oldest', 'tags', 'access'], 'tags'],
        ['taskBoardLayout', ['list', 'board', 'table'], 'board'],
        ['taskBoardGroup', ['status', 'priority', 'due', 'assignee'], 'status'],
      ];
      const junk = ['', 'Custom', 'count ', 0, 5, 2.5, '2', null, true, [], {}, NaN];
      for (const [field, allowed, fallback] of fields) {
        for (const value of allowed) {
          await assertReadsAs({ [field]: value }, expected({ [field]: value }));
        }
        for (const value of junk) {
          await assertReadsAs({ [field]: value }, expected({ [field]: fallback }));
        }
      }
    });

    test('a board grouped by tag holds only with a namespace, which is kept lowercased', async () => {
      await assertReadsAs({ taskBoardGroup: 'tag' }, expected({}));
      await assertReadsAs({ taskBoardGroup: 'tag', taskBoardGroupNamespace: '9lives' }, expected({}));
      await assertReadsAs(
        { taskBoardGroup: 'tag', taskBoardGroupNamespace: 'Project' },
        expected({ taskBoardGroup: 'tag', taskBoardGroupNamespace: 'project' }),
      );
      await assertReadsAs(
        { taskBoardGroup: 'due', taskBoardGroupNamespace: 'Ctx_1-a' },
        expected({ taskBoardGroup: 'due', taskBoardGroupNamespace: 'ctx_1-a' }),
      );
    });

    test('the flags and optional numbers are kept only in the shapes they are written in', async () => {
      await assertReadsAs({ hideDailyNotes: 'true', relatedNotesPreviewLines: 1 }, expected({}));
      await assertReadsAs({ hideDailyNotes: false, relatedNotesPreviewLines: 3 }, expected({}));
      await assertReadsAs({ relatedNotesPreviewLines: 0 }, expected({ relatedNotesPreviewLines: 0 }));
    });

    test('saved filters that are not a list read as none', async () => {
      for (const savedFilters of ['filter-one', 1, true, { 0: { id: 'filter-one', name: 'One', tagKeys: ['#a'] } }, null]) {
        await assertReadsAs({ savedFilters }, expected({}));
      }
    });

    test('lists keep unique non-empty strings, in order', async () => {
      const list = ['#b', '#a', '#b', '', 4, null, '#c'];
      await assertReadsAs(
        { favoriteTags: list, favoriteEntities: list, tagAccessOrder: list, entityAccessOrder: list, taskOrder: list },
        expected({
          favoriteTags: ['#b', '#a', '#c'],
          favoriteEntities: ['#b', '#a', '#c'],
          tagAccessOrder: ['#b', '#a', '#c'],
          entityAccessOrder: ['#b', '#a', '#c'],
          taskOrder: ['#b', '#a', '#c'],
        }),
      );
      await assertReadsAs({ favoriteTags: '#a', taskOrder: { 0: 'x' } }, expected({}));
    });

    test('counts keep whole numbers from zero, access times positive ones, and first-seen times any from zero', async () => {
      const values = { a: 3, b: 0, c: -1, d: 2.5, e: Infinity, f: NaN, g: '4', '': 5, h: 1_700_000_000_000.5, i: null };
      await assertReadsAs(
        {
          tagAccessCounts: values,
          entityAccessCounts: values,
          sectionAccessCounts: values,
          tagAccessTimes: values,
          sectionAccessTimes: values,
          tagFirstSeen: values,
        },
        expected({
          tagAccessCounts: { a: 3, b: 0 },
          entityAccessCounts: { a: 3, b: 0 },
          sectionAccessCounts: { a: 3, b: 0 },
          tagAccessTimes: { a: 3, d: 2.5, h: 1_700_000_000_000.5 },
          sectionAccessTimes: { a: 3, d: 2.5, h: 1_700_000_000_000.5 },
          tagFirstSeen: { a: 3, b: 0, d: 2.5, h: 1_700_000_000_000.5 },
        }),
      );
      await assertReadsAs(
        { tagAccessCounts: [2, 3], tagAccessTimes: [5], sectionAccessTimes: 'x', tagFirstSeen: null, sectionAccessCounts: 7 },
        expected({ tagAccessCounts: { 0: 2, 1: 3 }, tagAccessTimes: { 0: 5 } }),
      );
      await assertReadsAs({ tagFirstSeen: [] }, expected({ tagFirstSeen: {} }));
    });

    test('recent searches are trimmed, unique, and at most twenty', async () => {
      const many = Array.from({ length: 25 }, (_, index) => `query ${index}`);
      await assertReadsAs(
        { recentQueries: [' is:open ', 'is:open', '', 3, '#a', ...many] },
        expected({ recentQueries: ['is:open', '#a', ...many.slice(0, 18)] }),
      );
      await assertReadsAs({ recentQueries: 'is:open' }, expected({}));
    });

    test('Find choices keep complete entries, newest first, and an empty list is left out', async () => {
      await assertReadsAs(
        {
          findChoices: [
            { input: 'old', key: 'tag:#a', count: 1, at: 10, extra: true },
            { input: 'new', key: 'tag:#b', count: 2.5, at: 30 },
            { input: '', key: 'tag:#c', count: 1, at: 40 },
            { input: 'zero', key: 'tag:#d', count: 0, at: 50 },
            { input: 'nan', key: 'tag:#e', count: 1, at: NaN },
            { input: 'nokey', count: 1, at: 60 },
            { input: 'mid', key: 'tag:#f', count: 1, at: 20 },
            'choice',
          ],
        },
        expected({
          findChoices: [
            { input: 'new', key: 'tag:#b', count: 2.5, at: 30 },
            { input: 'mid', key: 'tag:#f', count: 1, at: 20 },
            { input: 'old', key: 'tag:#a', count: 1, at: 10 },
          ],
        }),
      );
      await assertReadsAs({ findChoices: [], recentHeadings: [] }, expected({}));
      // Read once, a list of nothing usable is kept empty; written, it is left out.
      await assertReadsAs({ findChoices: ['junk'] }, expected({ findChoices: [] }), expected({}));
      await assertReadsAs({ recentHeadings: [3] }, expected({ recentHeadings: [] }), expected({}));
      const choices = Array.from({ length: 205 }, (_, index) => ({ input: `q${index}`, key: `tag:#t${index}`, count: 1, at: index }));
      const { store } = loadAlone({ findChoices: choices });
      assert.strictEqual(store.reader.value.findChoices?.length, 200);
      assert.strictEqual(store.reader.value.findChoices?.[0].at, 204);
    });

    test('pins keep a note, a named heading, a whole level, and an occurrence from zero, fifty at most', async () => {
      await assertReadsAs(
        {
          pinnedNotes: [
            { filePath: 'a.md', heading: '', headingLevel: 1.5, occurrence: -1, extra: 1 },
            { filePath: 'a.md', heading: '', occurrence: 0 },
            { filePath: 'b.md', heading: 'H', headingLevel: 3, occurrence: 2 },
            { filePath: 'b.md', heading: 'H', headingLevel: 2, occurrence: 2 },
            { filePath: 'b.md', heading: 'H', occurrence: 1.5 },
            { filePath: '', heading: 'H' },
            { heading: 'H' },
            { filePath: 3 },
          ],
          recentHeadings: Array.from({ length: 7 }, (_, index) => ({ filePath: `r${index}.md` })),
        },
        expected({
          pinnedNotes: [
            { filePath: 'a.md' },
            { filePath: 'b.md', heading: 'H', headingLevel: 3, occurrence: 2 },
            { filePath: 'b.md', heading: 'H' },
          ],
          recentHeadings: Array.from({ length: 5 }, (_, index) => ({ filePath: `r${index}.md` })),
        }),
      );
      const many = Array.from({ length: 55 }, (_, index) => `n${index}.md`);
      const { store } = loadAlone({ pinnedNotes: many });
      assert.deepStrictEqual(store.reader.value.pinnedNotes, many.slice(0, 50).map((filePath) => ({ filePath })));
    });

    test('Home keeps only widgets it can draw, with options in their bounds', async () => {
      await assertReadsAs(
        {
          dashboardWidgets: [
            { id: ' search ', kind: 'search', width: 'full', count: 3, paged: true, query: 'x', days: 2 },
            { id: 'search-2', kind: 'search', width: 'full' },
            { id: 'nope', kind: 'weather', width: 'full' },
            { id: '', kind: 'savedSearches' },
            { id: 'x'.repeat(65), kind: 'savedSearches' },
            { id: 'x'.repeat(64), kind: 'savedSearches', width: 'wide' },
            { id: 'search', kind: 'topTags' },
            { id: 't1', kind: 'tasks', count: 0, paged: true, page: 0, query: `${'q'.repeat(2001)}` },
            { id: 't2', kind: 'tasks', count: 99, paged: true, page: 20_000, query: '  #a  ' },
            { id: 't3', kind: 'tasks', count: 3.5, paged: 'yes', page: 2, query: 5 },
            { id: 'ag', kind: 'agenda', count: 30, paged: true, page: 2 },
            { id: 'st', kind: 'staleTasks', days: 0 },
            { id: 'nt', kind: 'newTags', days: 999 },
            { id: 'qp', kind: 'quietPeople', days: 2.5, namespace: ' Team ', noOpenTasks: 'true' },
            { id: 'sq0', kind: 'savedQuery', filterId: '' },
            { id: 'sq1', kind: 'savedQuery', filterId: 'f1', paged: true },
            { id: 'sq2', kind: 'savedQuery', filterId: 'f2', count: 2 },
            { id: 'sq0', kind: 'recentNotes' },
            null,
            'savedSearches',
          ],
        },
        expected({
          dashboardWidgets: [
            { id: 'search', kind: 'search', width: 'full' },
            { id: 'x'.repeat(64), kind: 'savedSearches', width: 'half' },
            { id: 't1', kind: 'tasks', width: 'half', count: 1, paged: true, page: 1, query: 'is:open' },
            { id: 't2', kind: 'tasks', width: 'half', count: 20, paged: true, page: 10_000, query: '#a' },
            { id: 't3', kind: 'tasks', width: 'half', count: 5, query: 'is:open' },
            { id: 'ag', kind: 'agenda', width: 'half', count: 20 },
            { id: 'st', kind: 'tasks', width: 'half', count: 5, query: 'is:open AND updated < 1d', sort: 'updatedOldest' },
            { id: 'qp', kind: 'quietPeople', width: 'half', count: 5, days: 90, namespace: 'team' },
            { id: 'sq1', kind: 'savedQuery', width: 'half', count: 5, filterId: 'f1' },
            { id: 'sq2', kind: 'savedQuery', width: 'half', count: 2, filterId: 'f2' },
            { id: 'sq0', kind: 'recentNotes', width: 'half', count: 5 },
          ],
        }),
      );
      const namespaces = ['person', 'PERSON', '9x', 'a b', 'n'.repeat(65), 'ok'];
      await assertReadsAs(
        { dashboardWidgets: namespaces.map((namespace, index) => ({ id: `q${index}`, kind: 'quietPeople', namespace, noOpenTasks: true })) },
        expected({
          dashboardWidgets: [{ id: 'q0', kind: 'quietPeople', width: 'half', count: 5, days: 90, noOpenTasks: true }],
        }),
      );
      const many = Array.from({ length: 35 }, (_, index) => ({ id: `w${index}`, kind: 'tasks' }));
      const { store } = loadAlone({ dashboardWidgets: many });
      assert.strictEqual(store.reader.value.dashboardWidgets.length, 30);
    });

    test('the table layout keeps known columns with the title first, and a sort by a known column', async () => {
      await assertReadsAs(
        { taskTableColumns: ['due', 'bogus', 'title', 'due', 'priority'], taskTableSort: { column: 'priority', direction: 'up' } },
        expected({ taskTableColumns: ['title', 'due', 'priority'], taskTableSort: { column: 'priority', direction: 'asc' } }),
      );
      await assertReadsAs({ taskTableColumns: ['title', 'nope'], taskTableSort: { column: 'nope' } }, expected({}));
      await assertReadsAs({ taskTableColumns: 'due', taskTableSort: 'due' }, expected({}));
      await assertReadsAs(
        { taskTableColumns: ['id'], taskTableSort: { column: 'id', direction: 'desc', extra: 1 } },
        expected({ taskTableColumns: ['title', 'id'], taskTableSort: { column: 'id', direction: 'desc' } }),
      );
    });

    test('an import is normalized as a read is, and written whole', async () => {
      const { store, log } = loadAlone(undefined);
      await store.maintenance.importPreferences({ ...ELSEWHERE, renderModeChosen: undefined } as unknown as PersistedPreferences);
      const want = inOrder({
        ...FULL,
        renderMode: 'html',
        renderModeChosen: undefined,
        favoriteTags: ['#elsewhere/one'],
        taskOrder: ['task-zz11-zz22'],
        pinnedNotes: [{ filePath: 'elsewhere.md' }],
        dashboardWidgets: [],
        dashboardViewState: { mode: 'home', tagSearchQuery: 'elsewhere' },
      });
      delete want.renderModeChosen;
      assert.deepStrictEqual(store.reader.value, want);
      assert.deepStrictEqual(
        log.map((entry) => (entry.kind === 'write' ? entry.json : entry.kind)),
        [JSON.stringify(want), 'change'],
      );
    });
  });

  suite('every mutator', () => {
    const realNow = Date.now;
    const realRandom = Math.random;

    setup(() => {
      let clock = 1_800_000_000_000;
      Date.now = () => (clock += 1_000);
      let seed = 7;
      Math.random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
    });

    teardown(() => {
      Date.now = realNow;
      Math.random = realRandom;
    });

    test('writes the same stores, in the same order, with the same bytes, and fires the same events', async () => {
      const log: Entry[] = [];
      const global = new RecordingStore('global', log, { [PREFERENCES]: ELSEWHERE, [HANDED_OVER]: true });
      const workspace = new RecordingStore('workspace', log, { [PREFERENCES]: share(FULL) });
      const store = watched(createPreferences(global, workspace), log);
      let previous = JSON.parse(JSON.stringify(FULL)) as Blob;
      const steps: string[] = [];
      const step = async (name: string, run: () => unknown): Promise<void> => {
        log.length = 0;
        const returned = await run();
        const lines = log.map((entry) => {
          if (entry.kind === 'write') {
            return `${entry.store} ${entry.key} ${digest(entry.json)}`;
          }
          return entry.kind === 'change' ? `change ${digest(entry.json)}` : 'visit';
        });
        const now = JSON.parse(global.dump()[PREFERENCES]) as Blob;
        const keys = [...new Set([...Object.keys(previous), ...Object.keys(now)])];
        const changed = keys.filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(now[key]));
        previous = now;
        const value = returned === undefined ? '' : ` -> ${JSON.stringify(returned)}`;
        steps.push(`${name}${value} | ${lines.join(', ')} | ${changed.join(' ')}`);
      };

      await step('toggleFavorite add', () => store.favorites.toggleFavorite('#topic/mesh'));
      await step('toggleFavorite remove', () => store.favorites.toggleFavorite('#project/atlas'));
      await step('toggleFavoriteEntity', () => store.favorites.toggleFavoriteEntity('#person/dax'));
      await step('toggleFavoriteEntity remove', () => store.favorites.toggleFavoriteEntity('#person/ren'));
      await step('setTagSortMode', () => store.display.setTagSortMode('count'));
      await step('setEntitySortMode', () => store.display.setEntitySortMode('custom'));
      await step('setTagAccessOrder', () => store.favorites.setTagAccessOrder(['#topic/mesh', '#topic/mesh', '#risk/vendor']));
      await step('setEntityAccessOrder', () => store.favorites.setEntityAccessOrder(['#person/dax', '#person/ren', '#person/dax']));
      await step('setTagAccessOrderAndFavorites', () =>
        store.favorites.setTagAccessOrderAndFavorites(['#risk/vendor', '#topic/mesh'], ['#risk/vendor', '#risk/vendor']));
      await step('recordTagAccess now', () => store.usage.recordTagAccess('#topic/mesh'));
      await step('recordTagAccess at', () => store.usage.recordTagAccess('#project/atlas', 1_750_000_000_000));
      await step('recordFindChoice new', () => store.usage.recordFindChoice('  Atlas   Plan ', 'note:["notes/atlas.md","Plan",0]'));
      await step('recordFindChoice again', () =>
        store.usage.recordFindChoice('ATLAS', 'note:["notes/atlas.md","Atlas",0]', 1_800_000_000_500));
      await step('recordFindChoice blank', () => store.usage.recordFindChoice('   ', 'tag:#a'));
      await step('recordRecentHeading new', () =>
        store.usage.recordRecentHeading({ filePath: 'notes/relay.md', heading: 'Plan', headingLevel: 2 }));
      await step('recordRecentHeading again', () =>
        store.usage.recordRecentHeading({ filePath: 'notes/atlas.md', heading: 'Decisions', headingLevel: 2, occurrence: 1 }));
      await step('removeRecentQuery', () => store.savedSearches.removeRecentQuery(' is:open '));
      await step('removeRecentQuery absent', () => store.savedSearches.removeRecentQuery('not there'));
      await step('recordRecentQuery', () => store.savedSearches.recordRecentQuery('  #topic/mesh  '));
      await step('recordRecentQuery same', () => store.savedSearches.recordRecentQuery('#topic/mesh'));
      await step('recordRecentQuery blank', () => store.savedSearches.recordRecentQuery('   '));
      await step('recordEntityAccess', () => store.usage.recordEntityAccess('#person/dax'));
      await step('recordEntityAccess new', () => store.usage.recordEntityAccess('#org/lantern'));
      await step('replaceTaskInOrder', () => store.taskLayout.replaceTaskInOrder('task-a7b3-c8d2', 'task-a7b3-zz99'));
      await step('replaceTaskInOrder absent', () => store.taskLayout.replaceTaskInOrder('task-missing', 'task-x'));
      await step('replaceTaskInOrder onto a kept id', () => store.taskLayout.replaceTaskInOrder('task-k2m9-p4q1', 'task-a7b3-zz99'));
      await step('setTaskOrder', () => store.taskLayout.setTaskOrder(['task-1', 'task-2', 'task-1', 'task-3']));
      await step('setTaskSortMode', () => store.taskLayout.setTaskSortMode('created'));
      await step('setDashboardColumns tasks', () => store.display.setDashboardColumns('tasks', 2));
      await step('setDashboardColumns notes', () => store.display.setDashboardColumns('notes', 4));
      await step('setDashboardColumns tags', () => store.display.setDashboardColumns('tags', 1));
      await step('setTaskBoardLayout', () => store.taskLayout.setTaskBoardLayout('list'));
      await step('setTaskBoardGroup tag', () => store.taskLayout.setTaskBoardGroup('tag', 'Context'));
      await step('setTaskBoardGroup priority', () => store.taskLayout.setTaskBoardGroup('priority', 'ignored'));
      await step('setTaskBoardGroup tag kept namespace', () => store.taskLayout.setTaskBoardGroup('tag'));
      await step('setTaskTableColumns', () =>
        store.taskLayout.setTaskTableColumns(['due', 'title', 'bogus' as TaskColumnId, 'due', 'status']));
      await step('setTaskTableColumns title only', () => store.taskLayout.setTaskTableColumns(['title']));
      await step('setTaskTableSort', () => store.taskLayout.setTaskTableSort({ column: 'priority', direction: 'asc' }));
      await step('setTaskTableSort none', () => store.taskLayout.setTaskTableSort(undefined));
      await step('setDashboardWidgets', () =>
        store.homeWidgets.setDashboardWidgets([
          ...store.reader.value.dashboardWidgets,
          { id: 'stats', kind: 'tasks', width: 'full', count: 4 },
          { id: 'search', kind: 'topTags', width: 'half' },
        ]));
      await step('addSavedSearchWidget', () => store.homeWidgets.addSavedSearchWidget('filter-one'));
      await step('addSavedSearchWidget present', () => store.homeWidgets.addSavedSearchWidget('filter-one'));
      await step('addSavedSearchWidget missing', () => store.homeWidgets.addSavedSearchWidget('nope'));
      await step('resetDashboardWidgets', () => store.homeWidgets.resetDashboardWidgets());
      await step('pinNote', () => store.pins.pinNote({ filePath: 'notes/mesh.md', heading: 'Mesh', headingLevel: 1 }));
      await step('pinNote present', () => store.pins.pinNote({ filePath: 'notes/atlas.md' }));
      await step('isPinned', () => [store.pins.isPinned(pinKey({ filePath: 'notes/mesh.md', heading: 'Mesh' })), store.pins.isPinned('nope')]);
      await step('unpinNote', () => store.pins.unpinNote(pinKey({ filePath: 'notes/atlas.md' })));
      await step('unpinNote absent', () => store.pins.unpinNote('nope'));
      await step('setDashboardMode', () => store.homeWidgets.setDashboardMode('home'));
      await step('setDashboardSearch', () => store.homeWidgets.setDashboardSearch('tags', 'mesh'));
      await step('setRenderMode', () => store.display.setRenderMode('html'));
      await step('setTagOverviewSortMode', () => store.display.setTagOverviewSortMode('created'));
      await step('setSearchPageSize', () => store.display.setSearchPageSize(10));
      await step('setSearchPreview', () => store.display.setSearchPreview('none'));
      await step('setTagOverviewLayout', () => store.display.setTagOverviewLayout('tabs'));
      await step('setRelatedNotesSortMode', () => store.display.setRelatedNotesSortMode('newest'));
      await step('setHideDailyNotes off', () => store.display.setHideDailyNotes(false));
      await step('setHideDailyNotes on', () => store.display.setHideDailyNotes(true));
      await step('setRelatedNotesPreviewLines 1', () => store.display.setRelatedNotesPreviewLines(1));
      await step('setRelatedNotesPreviewLines 0', () => store.display.setRelatedNotesPreviewLines(0));
      await step('recordSectionAccess', () => store.usage.recordSectionAccess('section-q1w2-e3r4'));
      await step('recordSectionAccess quiet', () =>
        store.usage.recordSectionAccess('section-new1-new2', 1_800_000_000_900, { quiet: true }));
      await step('carrySectionAccess', () =>
        store.usage.carrySectionAccess(
          new Map([
            ['section-q1w2-e3r4', 'section-q1w2-moved'],
            ['section-t5y6-u7i8', 'section-new1-new2'],
            ['section-none', 'section-x'],
            ['section-new1-new2', 'section-new1-new2'],
          ]),
        ));
      await step('carrySectionAccess nothing', () => store.usage.carrySectionAccess(new Map([['section-none', 'section-y']])));
      await step('saveSavedFilter new', () => store.savedSearches.saveSavedFilter('  Mesh pair ', ['#topic/mesh', '#risk/vendor']));
      await step('saveSavedFilter replace', () => store.savedSearches.saveSavedFilter('Renamed', ['#risk/vendor', '#project/atlas']));
      await step('saveSavedFilter no name', () => store.savedSearches.saveSavedFilter(' ', ['#a', '#b']));
      await step('saveSavedFilter one tag', () => store.savedSearches.saveSavedFilter('One', ['#a', ' #a ']));
      await step('saveSavedQueryFilter new', () => store.savedSearches.saveSavedQueryFilter('Mesh open', ' is:open #topic/mesh '));
      await step('saveSavedQueryFilter replace', () =>
        store.savedSearches.saveSavedQueryFilter('Open atlas again', 'is:open #project/atlas', 'taskBoard'));
      await step('saveSavedQueryFilter other page', () => store.savedSearches.saveSavedQueryFilter('On search', 'is:open #project/atlas'));
      await step('saveSavedQueryFilter blank', () => store.savedSearches.saveSavedQueryFilter('Blank', '  '));
      await step('updateSavedFilter', () => store.savedSearches.updateSavedFilter('filter-one', 'Renamed again', ['#topic/mesh', '#risk/vendor']));
      await step('updateSavedFilter missing', () => store.savedSearches.updateSavedFilter('missing', 'Name', ['#a', '#b']));
      await step('updateSavedFilter no id', () => store.savedSearches.updateSavedFilter('', 'Name', ['#a', '#b']));
      await step('updateSavedFilter one tag', () => store.savedSearches.updateSavedFilter('filter-one', 'Name', ['#a']));
      await step('addSavedSearchWidget for removal', () => store.homeWidgets.addSavedSearchWidget('filter-three'));
      await step('setDashboardWidgets tasks query', () =>
        store.homeWidgets.setDashboardWidgets([
          ...store.reader.value.dashboardWidgets,
          { id: 'mesh-tasks', kind: 'tasks', width: 'half', count: 5, query: '#topic/mesh and (#risk/vendor or -#risk/vendor) #risk/vendors' },
        ]));
      await step('replaceTagKey rename', () => store.tagRenames.replaceTagKey('#risk/vendor', '#risk/supplier'));
      await step('replaceTagKey merge', () => store.tagRenames.replaceTagKey('#topic/mesh', '#project/atlas'));
      await step('replaceTagKey absent', () => store.tagRenames.replaceTagKey('#never/seen', '#also/never'));
      await step('replaceTagKey blank', () => store.tagRenames.replaceTagKey('', '#x'));
      await step('replaceTagKey same', () => store.tagRenames.replaceTagKey('#project/atlas', '#project/atlas'));
      await step('removeSavedFilter', () => store.savedSearches.removeSavedFilter('filter-three'));
      await step('removeSavedFilter blank', () => store.savedSearches.removeSavedFilter(''));
      await step('both at once', () =>
        Promise.all([store.favorites.toggleFavorite('#both/at-once'), store.usage.recordTagAccess('#both/at-once', 1_800_000_111_000)]));
      await step('prune', () =>
        store.maintenance.pruneKeys(
          {
            tags: ['#project/atlas', '#risk/supplier', '#both/at-once'],
            tasks: ['task-1', 'task-3'],
            sections: ['section-q1w2-moved'],
            entities: ['#person/dax'],
            files: ['notes/atlas.md', 'notes/mesh.md'],
          },
          1_800_000_222_000,
        ));
      await step('prune again', () =>
        store.maintenance.pruneKeys(
          {
            tags: ['#project/atlas', '#risk/supplier', '#both/at-once'],
            tasks: ['task-1', 'task-3'],
            sections: ['section-q1w2-moved'],
            entities: ['#person/dax'],
            files: ['notes/atlas.md', 'notes/mesh.md'],
          },
          1_800_000_333_000,
        ));
      await step('prune empty index', () => store.maintenance.pruneKeys({ tags: [], tasks: [], sections: [], entities: [], files: [] }));
      await step('prune tags and tasks only', () => store.maintenance.pruneKeys({ tags: ['#project/atlas', '#new/tag'], tasks: ['task-1'] }));
      await step('findStale', () => store.maintenance.findStale(['#project/atlas'], [], ['notes/mesh.md']));
      await step('removeStale', () => store.maintenance.removeStale(store.maintenance.findStale(['#project/atlas'], [], ['notes/mesh.md'])));
      await step('removeStale nothing', () =>
        store.maintenance.removeStale({ favoriteTags: [], favoriteEntities: [], pinnedNotes: [], savedFilters: [] }));
      await step('importPreferences', () => store.maintenance.importPreferences(FULL as unknown as PersistedPreferences));

      assert.deepStrictEqual(steps, WALK);
      assert.deepStrictEqual(store.reader.value, FULL);
      assert.deepStrictEqual(global.dump(), { [PREFERENCES]: JSON.stringify(FULL), [HANDED_OVER]: 'true' });
      assert.deepStrictEqual(workspace.dump(), { [PREFERENCES]: JSON.stringify(share(FULL)) });
    });
  });
});

/**
 * What each step of the walk wrote, taken from the store before Phase 3:
 * the step, what it returned, each write as store, key, and a digest of its
 * JSON, each event, and the top-level keys the machine-wide blob changed.
 * The digests from resetDashboardWidgets on were taken again when Home's
 * starting widgets changed, since every blob after the reset holds them,
 * and those before it when Stale tasks became a Tasks widget and New tags
 * left, since every blob before the reset holds the full blob's widgets.
 */
const WALK: string[] = [
  "toggleFavorite add | global deckard.preferences cdc94219e0ec6369, workspace deckard.preferences aa28ea4ab020a066, change cdc94219e0ec6369 | favoriteTags",
  "toggleFavorite remove | global deckard.preferences c1e13bb2be2c220b, workspace deckard.preferences b5238d5e78c81c70, change c1e13bb2be2c220b | favoriteTags",
  "toggleFavoriteEntity | global deckard.preferences d8c440a5f9221ecb, workspace deckard.preferences 82f0543cd6734cb8, change d8c440a5f9221ecb | favoriteEntities",
  "toggleFavoriteEntity remove | global deckard.preferences 23b7c91d1ea790d1, workspace deckard.preferences cd29214f6ad86779, change 23b7c91d1ea790d1 | favoriteEntities",
  "setTagSortMode | global deckard.preferences 6ae3635ff5a04085, workspace deckard.preferences cd29214f6ad86779, change 6ae3635ff5a04085 | tagSortMode",
  "setEntitySortMode | global deckard.preferences 51d67f9b24219810, workspace deckard.preferences cd29214f6ad86779, change 51d67f9b24219810 | entitySortMode",
  "setTagAccessOrder | global deckard.preferences b792f9de91b45cf0, workspace deckard.preferences 7bcca375492c29d1, change b792f9de91b45cf0 | tagAccessOrder",
  "setEntityAccessOrder | global deckard.preferences b5f29220a73c30a1, workspace deckard.preferences 48c2395c7af50633, change b5f29220a73c30a1 | entityAccessOrder",
  "setTagAccessOrderAndFavorites | global deckard.preferences d2009e85168de436, workspace deckard.preferences d98dae93d75cd466, change d2009e85168de436 | favoriteTags tagAccessOrder",
  "recordTagAccess now | global deckard.preferences d9b13db0c6ed2081, workspace deckard.preferences 6f9a62b8882544f4, change d9b13db0c6ed2081 | tagAccessCounts tagAccessTimes",
  "recordTagAccess at | global deckard.preferences 2873c4a6e90f5cab, workspace deckard.preferences 8c098ac0d04618ce, change 2873c4a6e90f5cab | tagAccessCounts tagAccessTimes",
  "recordFindChoice new | global deckard.preferences b6c5a7f10d465dfb, workspace deckard.preferences d139fac9afd8dc48, visit | findChoices",
  "recordFindChoice again | global deckard.preferences 8cc0e9da267b33b3, workspace deckard.preferences 9d43f86107ff64d8, visit | findChoices",
  "recordFindChoice blank |  | ",
  "recordRecentHeading new | global deckard.preferences ba84bbc0197f6867, workspace deckard.preferences 03bf7d03023e5558, visit | recentHeadings",
  "recordRecentHeading again | global deckard.preferences 3ea476c2fc0554f1, workspace deckard.preferences dbb568212f8d96b1, visit | recentHeadings",
  "removeRecentQuery | global deckard.preferences b890f72a7fc53e84, workspace deckard.preferences 292071b859a182b7, change b890f72a7fc53e84 | recentQueries",
  "removeRecentQuery absent |  | ",
  "recordRecentQuery | global deckard.preferences 4d721f37a860935e, workspace deckard.preferences 2d94fdeab9d7706c, change 4d721f37a860935e | recentQueries",
  "recordRecentQuery same |  | ",
  "recordRecentQuery blank |  | ",
  "recordEntityAccess | global deckard.preferences 35a742959709ccff, workspace deckard.preferences 26a9a7a0a5f213c7, change 35a742959709ccff | entityAccessCounts",
  "recordEntityAccess new | global deckard.preferences 3a38a8e9d12e1f9f, workspace deckard.preferences 9985f17990848177, change 3a38a8e9d12e1f9f | entityAccessCounts",
  "replaceTaskInOrder | global deckard.preferences 2b3414c14a3b3ae1, workspace deckard.preferences 63ab4e481d8a84f2, change 2b3414c14a3b3ae1 | taskOrder",
  "replaceTaskInOrder absent |  | ",
  "replaceTaskInOrder onto a kept id | global deckard.preferences 57eeb7a342dab232, workspace deckard.preferences 6f899ba53b9e6329, change 57eeb7a342dab232 | taskOrder",
  "setTaskOrder | global deckard.preferences 2734249fcd91f398, workspace deckard.preferences 4d7ea4b6a19489d5, change 2734249fcd91f398 | taskOrder",
  "setTaskSortMode | global deckard.preferences 56fc0c874c8ccf73, workspace deckard.preferences 4d7ea4b6a19489d5, change 56fc0c874c8ccf73 | taskSortMode",
  "setDashboardColumns tasks | global deckard.preferences 02a9ab6ec1661e18, workspace deckard.preferences 4d7ea4b6a19489d5, change 02a9ab6ec1661e18 | dashboardTaskColumns",
  "setDashboardColumns notes | global deckard.preferences a24ab48210820102, workspace deckard.preferences 4d7ea4b6a19489d5, change a24ab48210820102 | dashboardNoteColumns",
  "setDashboardColumns tags | global deckard.preferences cf429918e93856e6, workspace deckard.preferences 4d7ea4b6a19489d5, change cf429918e93856e6 | dashboardTagColumns",
  "setTaskBoardLayout | global deckard.preferences fa71af7816a346ea, workspace deckard.preferences 4d7ea4b6a19489d5, change fa71af7816a346ea | taskBoardLayout",
  "setTaskBoardGroup tag | global deckard.preferences 0b7625f95af56765, workspace deckard.preferences 4d7ea4b6a19489d5, change 0b7625f95af56765 | taskBoardGroupNamespace",
  "setTaskBoardGroup priority | global deckard.preferences cdbce365ed77ab11, workspace deckard.preferences 4d7ea4b6a19489d5, change cdbce365ed77ab11 | taskBoardGroup",
  "setTaskBoardGroup tag kept namespace | global deckard.preferences 0b7625f95af56765, workspace deckard.preferences 4d7ea4b6a19489d5, change 0b7625f95af56765 | taskBoardGroup",
  "setTaskTableColumns | global deckard.preferences dc98081ceedf2065, workspace deckard.preferences 4d7ea4b6a19489d5, change dc98081ceedf2065 | taskTableColumns",
  "setTaskTableColumns title only | global deckard.preferences 6fb32b46c9232876, workspace deckard.preferences 4d7ea4b6a19489d5, change 6fb32b46c9232876 | taskTableColumns",
  "setTaskTableSort | global deckard.preferences 2eec4e82eb75cd98, workspace deckard.preferences 4d7ea4b6a19489d5, change 2eec4e82eb75cd98 | taskTableSort",
  "setTaskTableSort none | global deckard.preferences 6e3dfcc76f63769c, workspace deckard.preferences 4d7ea4b6a19489d5, change 6e3dfcc76f63769c | taskTableSort",
  "setDashboardWidgets | global deckard.preferences b333253a2c36b355, workspace deckard.preferences fdaf7a106224d4da, change b333253a2c36b355 | dashboardWidgets",
  "addSavedSearchWidget -> \"added\" | global deckard.preferences 8436480de1b82d45, workspace deckard.preferences b2719b00fb6c58fd, change 8436480de1b82d45 | dashboardWidgets",
  "addSavedSearchWidget present -> \"present\" |  | ",
  "addSavedSearchWidget missing -> \"missing\" |  | ",
  "resetDashboardWidgets | global deckard.preferences 6c8bb36caefc7c11, workspace deckard.preferences 1567384f4c58a793, change 6c8bb36caefc7c11 | dashboardWidgets",
  "pinNote | global deckard.preferences 35eb6fcf6df73b28, workspace deckard.preferences 9650ad0c186e82e6, change 35eb6fcf6df73b28 | pinnedNotes",
  "pinNote present |  | ",
  "isPinned -> [true,false] |  | ",
  "unpinNote | global deckard.preferences 05e56cd4715816f0, workspace deckard.preferences 16529f99f66d8e98, change 05e56cd4715816f0 | pinnedNotes",
  "unpinNote absent | global deckard.preferences 05e56cd4715816f0, workspace deckard.preferences 16529f99f66d8e98, change 05e56cd4715816f0 | ",
  "setDashboardMode | global deckard.preferences ed96806b999e156f, workspace deckard.preferences 1e6e2515cd0af118, change ed96806b999e156f | dashboardViewState",
  "setDashboardSearch | global deckard.preferences b5258d7712004e3d, workspace deckard.preferences f7e9979af9f528b9, change b5258d7712004e3d | dashboardViewState",
  "setRenderMode | global deckard.preferences 3269f098cb5e94c8, workspace deckard.preferences f7e9979af9f528b9, change 3269f098cb5e94c8 | renderMode",
  "setTagOverviewSortMode | global deckard.preferences 369647c61566d114, workspace deckard.preferences f7e9979af9f528b9, change 369647c61566d114 | tagOverviewSortMode",
  "setSearchPageSize | global deckard.preferences cd63146c4f9dd0c6, workspace deckard.preferences f7e9979af9f528b9, change cd63146c4f9dd0c6 | searchPageSize",
  "setSearchPreview | global deckard.preferences a5a0dec37d4702c4, workspace deckard.preferences f7e9979af9f528b9, change a5a0dec37d4702c4 | searchPreview",
  "setTagOverviewLayout | global deckard.preferences 580ec162de3a989a, workspace deckard.preferences f7e9979af9f528b9, change 580ec162de3a989a | tagOverviewLayout",
  "setRelatedNotesSortMode | global deckard.preferences 170ff5cc7c36e6a5, workspace deckard.preferences f7e9979af9f528b9, change 170ff5cc7c36e6a5 | relatedNotesSortMode",
  "setHideDailyNotes off | global deckard.preferences 25af32427ac88092, workspace deckard.preferences f7e9979af9f528b9, change 25af32427ac88092 | hideDailyNotes",
  "setHideDailyNotes on | global deckard.preferences 170ff5cc7c36e6a5, workspace deckard.preferences f7e9979af9f528b9, change 170ff5cc7c36e6a5 | hideDailyNotes",
  "setRelatedNotesPreviewLines 1 | global deckard.preferences 79e91eebd807862f, workspace deckard.preferences f7e9979af9f528b9, change 79e91eebd807862f | relatedNotesPreviewLines",
  "setRelatedNotesPreviewLines 0 | global deckard.preferences 93fc31c1237b6cad, workspace deckard.preferences f7e9979af9f528b9, change 93fc31c1237b6cad | relatedNotesPreviewLines",
  "recordSectionAccess | global deckard.preferences c56f6ab9e9898a45, workspace deckard.preferences d844fb457cc874b7, change c56f6ab9e9898a45 | sectionAccessCounts sectionAccessTimes",
  "recordSectionAccess quiet | global deckard.preferences adcb23d443dd5424, workspace deckard.preferences 0a731a9e9f806398, visit | sectionAccessCounts sectionAccessTimes",
  "carrySectionAccess | global deckard.preferences f561e6ff76b4c326, workspace deckard.preferences 31573b423eda6c3d, visit | sectionAccessCounts sectionAccessTimes",
  "carrySectionAccess nothing |  | ",
  "saveSavedFilter new -> {\"id\":\"filter-mywpj1io-x5b6tc84\",\"name\":\"Mesh pair\",\"tagKeys\":[\"#risk/vendor\",\"#topic/mesh\"]} | global deckard.preferences 42b63a7b4489226a, workspace deckard.preferences 11fbab3926b41ca0, change 42b63a7b4489226a | savedFilters",
  "saveSavedFilter replace -> {\"id\":\"filter-one\",\"name\":\"Renamed\",\"tagKeys\":[\"#project/atlas\",\"#risk/vendor\"]} | global deckard.preferences 66c08520f56a161a, workspace deckard.preferences f8706a7761f5b1e9, change 66c08520f56a161a | savedFilters",
  "saveSavedFilter no name |  | ",
  "saveSavedFilter one tag |  | ",
  "saveSavedQueryFilter new -> {\"id\":\"filter-mywpj2ag-aeunise4\",\"name\":\"Mesh open\",\"tagKeys\":[],\"query\":\"is:open #topic/mesh\"} | global deckard.preferences 06dd04383e0adb3e, workspace deckard.preferences d7aee230f195c0fc, change 06dd04383e0adb3e | savedFilters",
  "saveSavedQueryFilter replace -> {\"id\":\"filter-two\",\"name\":\"Open atlas again\",\"tagKeys\":[],\"query\":\"is:open #project/atlas\",\"page\":\"taskBoard\"} | global deckard.preferences 5d72d4849541d9a7, workspace deckard.preferences 79da81f4dae74a37, change 5d72d4849541d9a7 | savedFilters",
  "saveSavedQueryFilter other page -> {\"id\":\"filter-mywpj328-7kvgp70w\",\"name\":\"On search\",\"tagKeys\":[],\"query\":\"is:open #project/atlas\"} | global deckard.preferences b85e8caf1621c841, workspace deckard.preferences 10925aff22ae5152, change b85e8caf1621c841 | savedFilters",
  "saveSavedQueryFilter blank |  | ",
  "updateSavedFilter -> {\"id\":\"filter-one\",\"name\":\"Renamed again\",\"tagKeys\":[\"#risk/vendor\",\"#topic/mesh\"]} | global deckard.preferences f5b988d649450ab6, workspace deckard.preferences 4571c5c23bb31017, change f5b988d649450ab6 | savedFilters",
  "updateSavedFilter missing |  | ",
  "updateSavedFilter no id |  | ",
  "updateSavedFilter one tag |  | ",
  "addSavedSearchWidget for removal -> \"added\" | global deckard.preferences 36d332ea34260ec2, workspace deckard.preferences 02f77ab99836d505, change 36d332ea34260ec2 | dashboardWidgets",
  "setDashboardWidgets tasks query | global deckard.preferences 668389168eeeedca, workspace deckard.preferences ae193a03fa43e3c0, change 668389168eeeedca | dashboardWidgets",
  "replaceTagKey rename | global deckard.preferences 99e70aa3310c1389, workspace deckard.preferences 744c87be26bfb7d1, change 99e70aa3310c1389 | favoriteTags tagAccessOrder tagAccessCounts savedFilters tagAccessTimes dashboardWidgets tagFirstSeen",
  "replaceTagKey merge | global deckard.preferences 2b65baa0789af96a, workspace deckard.preferences 514ef9e2d83ddf57, change 2b65baa0789af96a | tagAccessOrder tagAccessCounts savedFilters tagAccessTimes dashboardWidgets",
  "replaceTagKey absent | global deckard.preferences 2b65baa0789af96a, workspace deckard.preferences 514ef9e2d83ddf57, change 2b65baa0789af96a | ",
  "replaceTagKey blank |  | ",
  "replaceTagKey same |  | ",
  "removeSavedFilter | global deckard.preferences 9fec9b620806793c, workspace deckard.preferences fa109f8b264586c5, change 9fec9b620806793c | savedFilters dashboardWidgets",
  "removeSavedFilter blank |  | ",
  "both at once -> [null,null] | global deckard.preferences 0c7cd3161e283faa, workspace deckard.preferences 05b370195b78b8db, change 0c7cd3161e283faa, global deckard.preferences 9e8c2fdc7009150f, workspace deckard.preferences 61bc2b99b1bd42e7, change 9e8c2fdc7009150f | favoriteTags tagAccessCounts tagAccessTimes",
  "prune | global deckard.preferences 7421eaa3c28b0b33, workspace deckard.preferences 7a449c39e7643763, change 7421eaa3c28b0b33 | entityAccessOrder entityAccessCounts taskOrder sectionAccessCounts sectionAccessTimes tagFirstSeen findChoices recentHeadings",
  "prune again |  | ",
  "prune empty index |  | ",
  "prune tags and tasks only | global deckard.preferences 4f2b69b698cfbacb, workspace deckard.preferences e8cf5f7967f2142b, change 4f2b69b698cfbacb | tagAccessOrder tagAccessCounts taskOrder tagAccessTimes tagFirstSeen",
  "findStale -> {\"favoriteTags\":[\"#risk/supplier\",\"#both/at-once\"],\"favoriteEntities\":[\"#person/dax\"],\"pinnedNotes\":[{\"filePath\":\"notes/relay.md\",\"heading\":\"Plan\",\"headingLevel\":2,\"occurrence\":0}],\"savedFilters\":[{\"id\":\"filter-one\",\"name\":\"Renamed again\",\"tagKeys\":[\"#project/atlas\",\"#risk/supplier\"]}]} |  | ",
  "removeStale | global deckard.preferences 5ebbb7a8c22f1283, workspace deckard.preferences 8edb3c80d0f7e125, change 5ebbb7a8c22f1283 | favoriteTags favoriteEntities savedFilters pinnedNotes",
  "removeStale nothing |  | ",
  "importPreferences | global deckard.preferences ef5cac29aa3e058b, workspace deckard.preferences 778d9d466c64d87a, change ef5cac29aa3e058b | favoriteTags favoriteEntities tagSortMode entitySortMode tagAccessOrder tagAccessCounts entityAccessOrder entityAccessCounts taskOrder taskSortMode dashboardTaskColumns dashboardNoteColumns dashboardTagColumns dashboardViewState renderMode tagOverviewSortMode tagOverviewLayout searchPageSize searchPreview relatedNotesSortMode relatedNotesPreviewLines sectionAccessCounts savedFilters taskBoardLayout taskBoardGroupNamespace tagAccessTimes sectionAccessTimes recentQueries dashboardWidgets tagFirstSeen pinnedNotes findChoices taskTableColumns taskTableSort",
];
