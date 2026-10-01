import * as assert from 'assert';
import { createHash } from 'node:crypto';

import { pinKey } from '../core/storage/preferences';
import type { PersistedPreferences, TaskColumnId } from '../core/types';
import { createPreferences, TestPreferences } from './preferenceServices';

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
  { id: 'tasks', kind: 'tasks', width: 'half', count: 5, query: 'is:open' },
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
    { id: 'stale', kind: 'staleTasks', width: 'half', count: 6, days: 45 },
    { id: 'quiet', kind: 'quietPeople', width: 'half', count: 5, days: 120, namespace: 'project', noOpenTasks: true },
    { id: 'saved-1', kind: 'savedQuery', width: 'half', count: 3, filterId: 'filter-two' },
    { id: 'pins', kind: 'pinnedNotes', width: 'half', count: 10, paged: true, page: 1 },
    { id: 'new', kind: 'newTags', width: 'half', count: 5, days: 14 },
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
        ['taskSortMode', ['rank', 'created', 'updated'], 'rank'],
        ['dashboardTaskColumns', [1, 2, 3, 4], 1],
        ['dashboardNoteColumns', [1, 2, 3, 4], 1],
        ['dashboardTagColumns', [1, 2, 3, 4], 2],
        ['tagOverviewSortMode', ['alphabetical', 'created', 'updated', 'access'], 'alphabetical'],
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
            { id: '', kind: 'stats' },
            { id: 'x'.repeat(65), kind: 'stats' },
            { id: 'x'.repeat(64), kind: 'stats', width: 'wide' },
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
            'stats',
          ],
        },
        expected({
          dashboardWidgets: [
            { id: 'search', kind: 'search', width: 'full' },
            { id: 'x'.repeat(64), kind: 'stats', width: 'half' },
            { id: 't1', kind: 'tasks', width: 'half', count: 1, paged: true, page: 1, query: 'is:open' },
            { id: 't2', kind: 'tasks', width: 'half', count: 20, paged: true, page: 10_000, query: '#a' },
            { id: 't3', kind: 'tasks', width: 'half', count: 5, query: 'is:open' },
            { id: 'ag', kind: 'agenda', width: 'half', count: 20 },
            { id: 'st', kind: 'staleTasks', width: 'half', count: 5, days: 1 },
            { id: 'nt', kind: 'newTags', width: 'half', count: 5, days: 365 },
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
          { id: 'stats', kind: 'stats', width: 'full', count: 4 },
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
 */
const WALK: string[] = [
  "toggleFavorite add | global deckard.preferences 80f13a892c00fe09, workspace deckard.preferences 98d66d51a3c8f9ff, change 80f13a892c00fe09 | favoriteTags",
  "toggleFavorite remove | global deckard.preferences 86921c7d4dcc6ef7, workspace deckard.preferences 54b2da95a998b1fb, change 86921c7d4dcc6ef7 | favoriteTags",
  "toggleFavoriteEntity | global deckard.preferences 4a054e3788b52afd, workspace deckard.preferences 213da6cc66921885, change 4a054e3788b52afd | favoriteEntities",
  "toggleFavoriteEntity remove | global deckard.preferences 5eab6a902b67fc4e, workspace deckard.preferences 57d1d10bfb5ad25a, change 5eab6a902b67fc4e | favoriteEntities",
  "setTagSortMode | global deckard.preferences 49c471bff23fb882, workspace deckard.preferences 57d1d10bfb5ad25a, change 49c471bff23fb882 | tagSortMode",
  "setEntitySortMode | global deckard.preferences eee4ab1e793e643d, workspace deckard.preferences 57d1d10bfb5ad25a, change eee4ab1e793e643d | entitySortMode",
  "setTagAccessOrder | global deckard.preferences 0484ee34bf191f67, workspace deckard.preferences d017f05e21988e98, change 0484ee34bf191f67 | tagAccessOrder",
  "setEntityAccessOrder | global deckard.preferences 92d897429ddf3cfe, workspace deckard.preferences 2e0bdd14c876c826, change 92d897429ddf3cfe | entityAccessOrder",
  "setTagAccessOrderAndFavorites | global deckard.preferences 01fbc30c77b359d7, workspace deckard.preferences 1e9974837cc0bee3, change 01fbc30c77b359d7 | favoriteTags tagAccessOrder",
  "recordTagAccess now | global deckard.preferences a1c5292527dc6174, workspace deckard.preferences f1fe6306cb8838e9, change a1c5292527dc6174 | tagAccessCounts tagAccessTimes",
  "recordTagAccess at | global deckard.preferences 682b1dd2999f07a9, workspace deckard.preferences 9a33279bb78cb6f1, change 682b1dd2999f07a9 | tagAccessCounts tagAccessTimes",
  "recordFindChoice new | global deckard.preferences 06dc222e7feb47c2, workspace deckard.preferences 7b13c142e49a9c26, visit | findChoices",
  "recordFindChoice again | global deckard.preferences bf2836ed25429eda, workspace deckard.preferences b8f1d474ae563a43, visit | findChoices",
  "recordFindChoice blank |  | ",
  "recordRecentHeading new | global deckard.preferences a8861f611f0507a0, workspace deckard.preferences 0d4a31339d9df93c, visit | recentHeadings",
  "recordRecentHeading again | global deckard.preferences 0f33982ff990e1c1, workspace deckard.preferences 18562f8b047a96d5, visit | recentHeadings",
  "removeRecentQuery | global deckard.preferences f3e42aa2ea10f67a, workspace deckard.preferences 0ab2d9e9576f19c3, change f3e42aa2ea10f67a | recentQueries",
  "removeRecentQuery absent |  | ",
  "recordRecentQuery | global deckard.preferences 41cb5a0132a6887a, workspace deckard.preferences d9229fc929c51764, change 41cb5a0132a6887a | recentQueries",
  "recordRecentQuery same |  | ",
  "recordRecentQuery blank |  | ",
  "recordEntityAccess | global deckard.preferences 002f11b5a30ec99b, workspace deckard.preferences ee0ab4d378318c03, change 002f11b5a30ec99b | entityAccessCounts",
  "recordEntityAccess new | global deckard.preferences 52568c85d562cea0, workspace deckard.preferences 468ea04469788e88, change 52568c85d562cea0 | entityAccessCounts",
  "replaceTaskInOrder | global deckard.preferences 531b0490b03f8416, workspace deckard.preferences f3286381be8d9f61, change 531b0490b03f8416 | taskOrder",
  "replaceTaskInOrder absent |  | ",
  "replaceTaskInOrder onto a kept id | global deckard.preferences 27b682c7174a029d, workspace deckard.preferences c826f2d768b9dd3f, change 27b682c7174a029d | taskOrder",
  "setTaskOrder | global deckard.preferences faf5de2ae9922129, workspace deckard.preferences a55c7b86b664f081, change faf5de2ae9922129 | taskOrder",
  "setTaskSortMode | global deckard.preferences 83e45511bc306e1d, workspace deckard.preferences a55c7b86b664f081, change 83e45511bc306e1d | taskSortMode",
  "setDashboardColumns tasks | global deckard.preferences 692d824da5eced69, workspace deckard.preferences a55c7b86b664f081, change 692d824da5eced69 | dashboardTaskColumns",
  "setDashboardColumns notes | global deckard.preferences db41ae59e5551389, workspace deckard.preferences a55c7b86b664f081, change db41ae59e5551389 | dashboardNoteColumns",
  "setDashboardColumns tags | global deckard.preferences b23d60359ab7f9ad, workspace deckard.preferences a55c7b86b664f081, change b23d60359ab7f9ad | dashboardTagColumns",
  "setTaskBoardLayout | global deckard.preferences 7b8a58d82e78e8f5, workspace deckard.preferences a55c7b86b664f081, change 7b8a58d82e78e8f5 | taskBoardLayout",
  "setTaskBoardGroup tag | global deckard.preferences 94912803766938fe, workspace deckard.preferences a55c7b86b664f081, change 94912803766938fe | taskBoardGroupNamespace",
  "setTaskBoardGroup priority | global deckard.preferences 9db7ccf789a86e26, workspace deckard.preferences a55c7b86b664f081, change 9db7ccf789a86e26 | taskBoardGroup",
  "setTaskBoardGroup tag kept namespace | global deckard.preferences 94912803766938fe, workspace deckard.preferences a55c7b86b664f081, change 94912803766938fe | taskBoardGroup",
  "setTaskTableColumns | global deckard.preferences bd28a90ed732c86d, workspace deckard.preferences a55c7b86b664f081, change bd28a90ed732c86d | taskTableColumns",
  "setTaskTableColumns title only | global deckard.preferences 3398794512b21464, workspace deckard.preferences a55c7b86b664f081, change 3398794512b21464 | taskTableColumns",
  "setTaskTableSort | global deckard.preferences dc32d4c3f39fee79, workspace deckard.preferences a55c7b86b664f081, change dc32d4c3f39fee79 | taskTableSort",
  "setTaskTableSort none | global deckard.preferences 22ba64114ee0b5b3, workspace deckard.preferences a55c7b86b664f081, change 22ba64114ee0b5b3 | taskTableSort",
  "setDashboardWidgets | global deckard.preferences 814babba2992d36c, workspace deckard.preferences ea8570ca8bc66812, change 814babba2992d36c | dashboardWidgets",
  "addSavedSearchWidget -> \"added\" | global deckard.preferences 949eec2bf35e82f0, workspace deckard.preferences 536799d487ecadb9, change 949eec2bf35e82f0 | dashboardWidgets",
  "addSavedSearchWidget present -> \"present\" |  | ",
  "addSavedSearchWidget missing -> \"missing\" |  | ",
  "resetDashboardWidgets | global deckard.preferences cc01348b9acfe0ce, workspace deckard.preferences 89a9d7972836ab81, change cc01348b9acfe0ce | dashboardWidgets",
  "pinNote | global deckard.preferences 9e40f1aeaf5317a8, workspace deckard.preferences a67318e252c0dc22, change 9e40f1aeaf5317a8 | pinnedNotes",
  "pinNote present |  | ",
  "isPinned -> [true,false] |  | ",
  "unpinNote | global deckard.preferences c7bc7475b8037538, workspace deckard.preferences 5736697a180f2a67, change c7bc7475b8037538 | pinnedNotes",
  "unpinNote absent | global deckard.preferences c7bc7475b8037538, workspace deckard.preferences 5736697a180f2a67, change c7bc7475b8037538 | ",
  "setDashboardMode | global deckard.preferences 69ad45ea3677bdda, workspace deckard.preferences 736220100eb18701, change 69ad45ea3677bdda | dashboardViewState",
  "setDashboardSearch | global deckard.preferences 7fa191f15f48a6c9, workspace deckard.preferences ed3d468ec73be9ce, change 7fa191f15f48a6c9 | dashboardViewState",
  "setRenderMode | global deckard.preferences bb92a596394bfad0, workspace deckard.preferences ed3d468ec73be9ce, change bb92a596394bfad0 | renderMode",
  "setTagOverviewSortMode | global deckard.preferences 10bf1d5cc8e5d399, workspace deckard.preferences ed3d468ec73be9ce, change 10bf1d5cc8e5d399 | tagOverviewSortMode",
  "setSearchPageSize | global deckard.preferences 5797028040cadf36, workspace deckard.preferences ed3d468ec73be9ce, change 5797028040cadf36 | searchPageSize",
  "setSearchPreview | global deckard.preferences 221672079e2cac11, workspace deckard.preferences ed3d468ec73be9ce, change 221672079e2cac11 | searchPreview",
  "setTagOverviewLayout | global deckard.preferences a11e03990e43646b, workspace deckard.preferences ed3d468ec73be9ce, change a11e03990e43646b | tagOverviewLayout",
  "setRelatedNotesSortMode | global deckard.preferences 64963c9917af9c97, workspace deckard.preferences ed3d468ec73be9ce, change 64963c9917af9c97 | relatedNotesSortMode",
  "setHideDailyNotes off | global deckard.preferences 87cb5c279259596d, workspace deckard.preferences ed3d468ec73be9ce, change 87cb5c279259596d | hideDailyNotes",
  "setHideDailyNotes on | global deckard.preferences 64963c9917af9c97, workspace deckard.preferences ed3d468ec73be9ce, change 64963c9917af9c97 | hideDailyNotes",
  "setRelatedNotesPreviewLines 1 | global deckard.preferences 98e59baf178b84dc, workspace deckard.preferences ed3d468ec73be9ce, change 98e59baf178b84dc | relatedNotesPreviewLines",
  "setRelatedNotesPreviewLines 0 | global deckard.preferences 4641675d30f8b9b3, workspace deckard.preferences ed3d468ec73be9ce, change 4641675d30f8b9b3 | relatedNotesPreviewLines",
  "recordSectionAccess | global deckard.preferences 88fa44b80c030515, workspace deckard.preferences fde24ac2342ce670, change 88fa44b80c030515 | sectionAccessCounts sectionAccessTimes",
  "recordSectionAccess quiet | global deckard.preferences 9fcc6952550d3eec, workspace deckard.preferences a93b1ad83231c1fa, visit | sectionAccessCounts sectionAccessTimes",
  "carrySectionAccess | global deckard.preferences 20c21a21340455e0, workspace deckard.preferences 1b69b02325f8f234, visit | sectionAccessCounts sectionAccessTimes",
  "carrySectionAccess nothing |  | ",
  "saveSavedFilter new -> {\"id\":\"filter-mywpj1io-x5b6tc84\",\"name\":\"Mesh pair\",\"tagKeys\":[\"#risk/vendor\",\"#topic/mesh\"]} | global deckard.preferences 5e258e0844c14c19, workspace deckard.preferences 811dfa8c2e7e225f, change 5e258e0844c14c19 | savedFilters",
  "saveSavedFilter replace -> {\"id\":\"filter-one\",\"name\":\"Renamed\",\"tagKeys\":[\"#project/atlas\",\"#risk/vendor\"]} | global deckard.preferences 767d1d4cd723c9dc, workspace deckard.preferences a0e8676eee904487, change 767d1d4cd723c9dc | savedFilters",
  "saveSavedFilter no name |  | ",
  "saveSavedFilter one tag |  | ",
  "saveSavedQueryFilter new -> {\"id\":\"filter-mywpj2ag-aeunise4\",\"name\":\"Mesh open\",\"tagKeys\":[],\"query\":\"is:open #topic/mesh\"} | global deckard.preferences 58fd101586f205ff, workspace deckard.preferences 629e14b82bf823fd, change 58fd101586f205ff | savedFilters",
  "saveSavedQueryFilter replace -> {\"id\":\"filter-two\",\"name\":\"Open atlas again\",\"tagKeys\":[],\"query\":\"is:open #project/atlas\",\"page\":\"taskBoard\"} | global deckard.preferences e12f5f84de96fff9, workspace deckard.preferences 958c61184413c341, change e12f5f84de96fff9 | savedFilters",
  "saveSavedQueryFilter other page -> {\"id\":\"filter-mywpj328-7kvgp70w\",\"name\":\"On search\",\"tagKeys\":[],\"query\":\"is:open #project/atlas\"} | global deckard.preferences 350e80ca3952053b, workspace deckard.preferences 13ff488854ba9bf8, change 350e80ca3952053b | savedFilters",
  "saveSavedQueryFilter blank |  | ",
  "updateSavedFilter -> {\"id\":\"filter-one\",\"name\":\"Renamed again\",\"tagKeys\":[\"#risk/vendor\",\"#topic/mesh\"]} | global deckard.preferences 0cd8b9bd3d47158a, workspace deckard.preferences 7d1f5db50c499910, change 0cd8b9bd3d47158a | savedFilters",
  "updateSavedFilter missing |  | ",
  "updateSavedFilter no id |  | ",
  "updateSavedFilter one tag |  | ",
  "addSavedSearchWidget for removal -> \"added\" | global deckard.preferences f7c7bd8a446d53e7, workspace deckard.preferences 2e0c9e1853663cc9, change f7c7bd8a446d53e7 | dashboardWidgets",
  "setDashboardWidgets tasks query | global deckard.preferences 8199b614e07a850d, workspace deckard.preferences 1269579e92df81a2, change 8199b614e07a850d | dashboardWidgets",
  "replaceTagKey rename | global deckard.preferences 6edce33953d1b3a0, workspace deckard.preferences 8b7c9a91de46b054, change 6edce33953d1b3a0 | favoriteTags tagAccessOrder tagAccessCounts savedFilters tagAccessTimes dashboardWidgets tagFirstSeen",
  "replaceTagKey merge | global deckard.preferences 78faeac66de57239, workspace deckard.preferences e8ab19074059c44d, change 78faeac66de57239 | tagAccessOrder tagAccessCounts savedFilters tagAccessTimes dashboardWidgets",
  "replaceTagKey absent | global deckard.preferences 78faeac66de57239, workspace deckard.preferences e8ab19074059c44d, change 78faeac66de57239 | ",
  "replaceTagKey blank |  | ",
  "replaceTagKey same |  | ",
  "removeSavedFilter | global deckard.preferences 59d7b460dda5bf76, workspace deckard.preferences fe76170c3848cebf, change 59d7b460dda5bf76 | savedFilters dashboardWidgets",
  "removeSavedFilter blank |  | ",
  "both at once -> [null,null] | global deckard.preferences 5b5c7240f0605d7c, workspace deckard.preferences 35b485393807b6e7, change 5b5c7240f0605d7c, global deckard.preferences 673396132543a0b6, workspace deckard.preferences 8990785518c42950, change 673396132543a0b6 | favoriteTags tagAccessCounts tagAccessTimes",
  "prune | global deckard.preferences df8952c6287014fc, workspace deckard.preferences bf208d94c1289b6b, change df8952c6287014fc | entityAccessOrder entityAccessCounts taskOrder sectionAccessCounts sectionAccessTimes tagFirstSeen findChoices recentHeadings",
  "prune again |  | ",
  "prune empty index |  | ",
  "prune tags and tasks only | global deckard.preferences 33a7399172246895, workspace deckard.preferences eae512ab14fa03d6, change 33a7399172246895 | tagAccessOrder tagAccessCounts taskOrder tagAccessTimes tagFirstSeen",
  "findStale -> {\"favoriteTags\":[\"#risk/supplier\",\"#both/at-once\"],\"favoriteEntities\":[\"#person/dax\"],\"pinnedNotes\":[{\"filePath\":\"notes/relay.md\",\"heading\":\"Plan\",\"headingLevel\":2,\"occurrence\":0}],\"savedFilters\":[{\"id\":\"filter-one\",\"name\":\"Renamed again\",\"tagKeys\":[\"#project/atlas\",\"#risk/supplier\"]}]} |  | ",
  "removeStale | global deckard.preferences b1d13216af6b1090, workspace deckard.preferences c40e6a345eafadaf, change b1d13216af6b1090 | favoriteTags favoriteEntities savedFilters pinnedNotes",
  "removeStale nothing |  | ",
  "importPreferences | global deckard.preferences 30e3b9b06703eafd, workspace deckard.preferences 74f28c2de6c982e9, change 30e3b9b06703eafd | favoriteTags favoriteEntities tagSortMode entitySortMode tagAccessOrder tagAccessCounts entityAccessOrder entityAccessCounts taskOrder taskSortMode dashboardTaskColumns dashboardNoteColumns dashboardTagColumns dashboardViewState renderMode tagOverviewSortMode tagOverviewLayout searchPageSize searchPreview relatedNotesSortMode relatedNotesPreviewLines sectionAccessCounts savedFilters taskBoardLayout taskBoardGroupNamespace tagAccessTimes sectionAccessTimes recentQueries dashboardWidgets tagFirstSeen pinnedNotes findChoices taskTableColumns taskTableSort",
];
