import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { getTypeIndex } from '../domain/types/typeIndex';
import type { DashboardSnapshot, DashboardTypesTab } from '../ui/protocol/dashboard';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createTypesTab, LISTED_NOTE_ROWS, LISTED_TAG_ROWS } from '../ui/state/typesTab';
import { renderPage } from './pages';
import { createPreferences } from './preferenceServices';
import { now, typedWorkspace } from './typedWorkspace';
import { openWebviewPage, shownText, type WebviewPage } from './webviewPage';

const DAY = 24 * 60 * 60 * 1000;
const lines = (...text: string[]): string => text.join('\n');

/** An index of notes, each written `daysAgo` days before `now`: `[content, daysAgo]`, or the content alone for today. */
function workspace(notes: Record<string, string | [string, number]>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, note]) => {
        const [content, daysAgo] = typeof note === 'string' ? [note, 0] : note;
        const at = now - daysAgo * DAY;
        return [filePath, parseMarkdown(filePath, content, { createdAt: at, updatedAt: at }, { typeNote: filePath.startsWith('Types/') })];
      }),
    ),
  );
}

/** A type note: its key, what its rows are, and no fields. */
function typeNote(name: string, rows: string): string {
  return lines('---', `deckard-type: ${name.toLowerCase()}`, `rows: "${rows}"`, '---', `# ${name}`);
}

/** Fourteen projects, each mentioned one day earlier than the one before it, so the oldest two are past what an opened type lists. */
const PROJECTS = ['atlas', 'borealis', 'cinder', 'delta', 'ember', 'fathom', 'garnet', 'harbor', 'indigo', 'juniper', 'kestrel', 'lumen', 'meridian', 'nimbus'];

/** Seven decisions, each written one day earlier than the one before it. */
const DECISIONS = ['Adopt the ledger', 'Buy the scanner', 'Close the annex', 'Defer the audit', 'Extend the pilot', 'Freeze the schema', 'Go to two shifts'];

/**
 * A workspace with more rows than an opened type lists: projects, one with
 * a hub note, and decisions; and hub notes no type covers, of a namespace,
 * of a person, and of a tag with no namespace.
 */
function busyWorkspace(): WorkspaceIndex {
  return workspace({
    'Types/Project.md': typeNote('Project', '#project/*'),
    'Types/Decision.md': lines('---', 'deckard-type: decision', 'rows: notes', '---', '# Decision'),
    'Projects/Atlas.md': [lines('---', 'describes: "#project/atlas"', '---', '# Atlas', 'The ledger migration.'), 30],
    ...Object.fromEntries(PROJECTS.map((name, at) => [`notes/sync-${name}.md`, [`# Sync #project/${name}\nWhere it stands.`, at]] as const)),
    ...Object.fromEntries(DECISIONS.map((title, at) => [`Decisions/${title}.md`, [lines('---', 'type: decision', '---', `# ${title}`), at]] as const)),
    'Vendors/Acme.md': [lines('---', 'describes: "#vendor/acme"', '---', '# Acme', 'Scanners and their service.'), 9],
    'notes/vendors.md': [lines('# Quotes #vendor/acme', 'Asked for one.', '', '# More quotes #vendor/birch #vendor/corvus', 'Asked for two.'), 3],
    'People/Priya Natarajan.md': [lines('---', 'describes: "@priya"', '---', '# Priya Natarajan'), 9],
    'Onboarding.md': [lines('---', 'describes: "#onboarding"', '---', '# Onboarding', 'What a new starter needs.'), 9],
    'notes/first-week.md': [lines('# First week #onboarding', '- [ ] Order a badge'), 2],
  });
}

/** The tab's figures for each type, as one line: its name, rule, rows, tasks, and last mention. */
function figures(tab: DashboardTypesTab): string[] {
  return tab.types.map((type) =>
    [
      type.plural,
      type.rule,
      type.withNote === undefined ? String(type.rows) : `${type.rows} · ${type.withNote} with a note`,
      type.overdue ? `${type.openTasks} · ${type.overdue} overdue` : String(type.openTasks),
      type.lastMentioned?.text ?? '-',
    ].join(' | '),
  );
}

suite('Types tab state', () => {
  test('lists every type by name: what its rows are, how many and how many have a note, its open tasks, and its last mention', () => {
    const tab = createTypesTab(typedWorkspace(), { now });
    assert.deepStrictEqual(figures(tab), [
      'Areas | #area/* | 2 · 0 with a note | 1 · 1 overdue | today · 2026-10-08',
      'Incidents | type: incident · Incidents/ | 2 | 0 | -',
      'People | @* | 3 · 3 with a note | 1 · 1 overdue | today · 2026-10-08',
      'Teams | #team/* | 2 · 2 with a note | 2 · 1 overdue | today · 2026-10-08',
    ]);
    assert.deepStrictEqual(tab.types.map((type) => [type.key, type.name, type.query, type.rowsKind]), [
      ['area', 'Area', 'type = area', 'tags'],
      ['incident', 'Incident', 'type = incident', 'notes'],
      ['person', 'Person', 'type = person', 'tags'],
      ['team', 'Team', 'type = team', 'tags'],
    ]);
    assert.deepStrictEqual(tab.outside, [], 'every hub note is a row of a type');
  });

  test('counts what the type\'s rows page counts: as many rows as its table, and each open task once', () => {
    const index = typedWorkspace();
    const tab = createTypesTab(index, { now });
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      for (const type of tab.types) {
        const page = createSearchPageSnapshot(index, store.reader.value, type.query, { queryContext: createQueryContext(now) });
        assert.strictEqual(type.rows, page.typeRows?.rows.length, `${type.plural}: the rows its page lists`);
      }
    } finally {
      store.repository.dispose();
    }

    // One task under a heading that names two teams is a task of each row, and one task of the type.
    const shared = workspace({
      'Types/Team.md': typeNote('Team', '#team/*'),
      'notes/sync.md': lines('# Sync #team/rates #team/credit', '- [ ] Agree the budget 📅 2020-01-01', '- [x] Book the room', '- [-] Order lunch'),
    });
    const types = getTypeIndex(shared);
    assert.deepStrictEqual(types.rows('team').map((row) => types.computed(row.id, now).openTasks), [1, 1]);
    assert.deepStrictEqual(types.totals('team', now), { openTasks: 1, overdue: 1, lastMentioned: now });
    assert.deepStrictEqual(figures(createTypesTab(shared, { now })), ['Teams | #team/* | 2 · 0 with a note | 1 · 1 overdue | today · 2026-10-08']);
  });

  test('sends a type\'s rows only while the reader has it opened: all of them by name when they are few', () => {
    const index = typedWorkspace();
    assert.ok(createTypesTab(index, { now }).types.every((type) => type.listed === undefined), 'no rows until a type is opened');
    const tab = createTypesTab(index, { now, opened: new Set(['team', 'incident', 'gone']) });
    assert.deepStrictEqual(tab.types.filter((type) => type.listed).map((type) => type.key), ['incident', 'team']);
    assert.deepStrictEqual(tab.types.find((type) => type.key === 'team')?.listed, {
      rows: [{ title: 'Credit', tagKey: '#team/credit' }, { title: 'Rates', tagKey: '#team/rates' }],
      note: '',
    });
    assert.deepStrictEqual(tab.types.find((type) => type.key === 'incident')?.listed, {
      rows: [{ title: 'Feed lag', filePath: 'Incidents/Feed lag.md' }, { title: 'RFQ outage', filePath: 'Incidents/RFQ outage.md' }],
      note: '',
    });
    const areas = createTypesTab(index, { now, opened: new Set(['area']) }).types.find((type) => type.key === 'area')?.listed;
    assert.deepStrictEqual(areas?.rows.map((row) => row.noNote), [true, true], 'a tag with no hub note is muted');
    assert.strictEqual(areas?.note, 'Muted names have no note yet.');
  });

  test('lists the tags mentioned most recently, or the notes written most recently, of a type with many rows', () => {
    const tab = createTypesTab(busyWorkspace(), { now, opened: new Set(['project', 'decision']) });
    const projects = tab.types.find((type) => type.key === 'project');
    assert.strictEqual(projects?.rows, PROJECTS.length);
    assert.strictEqual(projects?.withNote, 1);
    assert.deepStrictEqual(
      projects?.listed?.rows.map((row) => row.tagKey),
      PROJECTS.slice(0, LISTED_TAG_ROWS).map((name) => `#project/${name}`),
      'the latest first, and the two oldest left to the type\'s page',
    );
    assert.deepStrictEqual(projects?.listed?.rows.filter((row) => !row.noNote).map((row) => row.title), ['Atlas']);
    assert.strictEqual(projects?.listed?.note, 'The 12 mentioned most recently. Muted names have no note yet.');

    const decisions = tab.types.find((type) => type.key === 'decision');
    assert.strictEqual(decisions?.rows, DECISIONS.length);
    assert.strictEqual(decisions?.withNote, undefined, 'a row that is a note has one');
    assert.deepStrictEqual(decisions?.listed?.rows.map((row) => row.title), DECISIONS.slice(0, LISTED_NOTE_ROWS));
    assert.strictEqual(decisions?.listed?.note, 'The 5 written most recently.');
  });

  test('lists the hub notes no type covers: a namespace or the people as one line, then each tag with no namespace', () => {
    const tab = createTypesTab(busyWorkspace(), { now });
    assert.deepStrictEqual(tab.outside, [
      { label: 'Vendors', written: '#vendor/*', detail: '3 tags, 1 with a note', query: 'kind = vendor', namespace: 'vendor', canBeType: true },
      { label: 'People', written: '@*', detail: '1 tag, 1 with a note', query: 'kind = person', canBeType: true },
      { label: 'Onboarding', written: '#onboarding', tagKey: '#onboarding', lastMentioned: { at: now - 2 * DAY, text: '2 days ago · 2026-10-06' } },
    ]);
    // A type made of the namespace takes its line away.
    const typed = createTypesTab(
      workspace({
        'Types/Vendor.md': typeNote('Vendor', '#vendor/*'),
        'Vendors/Acme.md': lines('---', 'describes: "#vendor/acme"', '---', '# Acme'),
      }),
      { now },
    );
    assert.deepStrictEqual(typed.outside, []);
    assert.deepStrictEqual(figures(typed), ['Vendors | #vendor/* | 1 · 1 with a note | 0 | -']);
  });

  test('works the figures out once for an index and a day', () => {
    const index = typedWorkspace();
    const first = createTypesTab(index, { now });
    const again = createTypesTab(index, { now: now + 60_000, opened: new Set(['team']) });
    assert.strictEqual(again.types[0], first.types[0], 'the same day reads what it has');
    assert.strictEqual(again.outside, first.outside);
    assert.notStrictEqual(again.types[3], first.types[3], 'an opened type is a copy with its rows');
    assert.strictEqual(first.types[3].listed, undefined, 'and the kept figures gain none');
    const tomorrow = createTypesTab(index, { now: now + DAY });
    assert.deepStrictEqual(tomorrow.types.map((type) => type.lastMentioned?.text), ['yesterday · 2026-10-08', undefined, 'yesterday · 2026-10-08', 'yesterday · 2026-10-08']);
  });
});

suite('Types tab behavior', () => {
  const pages: WebviewPage[] = [];
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  /** What the host sends for an index while a tab is shown: the types only on the Types tab, with the opened types' rows. */
  function snapshotOf(index: WorkspaceIndex, mode: 'home' | 'browse' | 'types' = 'types', opened: string[] = []): DashboardSnapshot {
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      const preferences = { ...store.reader.value, dashboardViewState: { mode, tagSearchQuery: '' } };
      return {
        ...createDashboardSnapshot({ index, preferences, queryContext: createQueryContext(now) }),
        ...(mode === 'types' ? { types: createTypesTab(index, { now, opened: new Set(opened) }) } : {}),
      };
    } finally {
      store.repository.dispose();
    }
  }

  /** The Dashboard drawing an index on a tab. */
  function open(index: WorkspaceIndex, mode: 'home' | 'browse' | 'types' = 'types', opened: string[] = []): WebviewPage {
    const page = openWebviewPage(renderPage('dashboard'), snapshotOf(index, mode, opened));
    pages.push(page);
    return page;
  }

  /** The tab chosen, by its mode. */
  const chosen = (page: WebviewPage) => page.find('[role="tab"][aria-selected="true"]').getAttribute('data-dashboard-mode');

  /** Presses a key on the tab chosen. */
  const press = (page: WebviewPage, key: string) =>
    page.find('[role="tab"][aria-selected="true"]').dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  /** Each type's row as drawn, cell by cell. */
  const drawn = (page: WebviewPage) => page.findAll('.types-row').map((row) => [...row.querySelectorAll('td')].map((cell) => shownText(cell)).join(' | '));

  /** The types in the order drawn, by name. */
  const names = (page: WebviewPage) => page.findAll('.types-row .result-title').map((name) => name.textContent);

  test('Types is the third tab, after Home and Tags, and the arrow keys go round all three', () => {
    const page = open(typedWorkspace(), 'home');
    assert.deepStrictEqual(page.findAll('.dashboard-tabs [role="tab"]').map((tab) => tab.textContent?.trim()), ['Home', 'Tags', 'Types']);
    assert.strictEqual(page.find('#types-tab').getAttribute('aria-controls'), 'types-panel');
    assert.strictEqual(page.find('#types-panel').hasAttribute('hidden'), true);

    page.click('[data-dashboard-mode="types"]');
    assert.deepStrictEqual(page.lastPosted('setDashboardMode'), { type: 'setDashboardMode', mode: 'types' });
    assert.strictEqual(chosen(page), 'types');
    assert.strictEqual(page.find('#types-panel').hasAttribute('hidden'), false);
    assert.deepStrictEqual(page.findAll('.dashboard-tabs [role="tab"]').map((tab) => tab.getAttribute('tabindex')), ['-1', '-1', '0'], 'one tab stop, on the tab shown');

    press(page, 'ArrowRight');
    assert.strictEqual(chosen(page), 'home', 'Right from the last tab is the first');
    press(page, 'ArrowLeft');
    assert.strictEqual(chosen(page), 'types', 'and Left from the first is the last');
    press(page, 'ArrowLeft');
    assert.strictEqual(chosen(page), 'browse');
    press(page, 'End');
    assert.strictEqual(chosen(page), 'types');
    press(page, 'Home');
    assert.strictEqual(chosen(page), 'home');
    assert.deepStrictEqual(
      page.posted.filter((message) => message.type === 'setDashboardMode').map((message) => message.mode),
      ['types', 'home', 'types', 'browse', 'types', 'home'],
    );
  });

  test('says it is loading until the host sends the types, and reopens on Types after a reload', () => {
    const page = open(typedWorkspace(), 'home');
    page.click('[data-dashboard-mode="types"]');
    assert.match(shownText(page.find('#types-panel')), /Loading types…/);
    assert.strictEqual(page.findAll('.types-row').length, 0);
    assert.strictEqual((page.savedState() as { dashboardMode: string }).dashboardMode, 'types');
    page.send(snapshotOf(typedWorkspace()));
    assert.strictEqual(page.findAll('.types-row').length, 4);

    // What VS Code kept for the page opens it on Types before the host says so.
    const kept = snapshotOf(typedWorkspace(), 'home') as Partial<DashboardSnapshot>;
    delete kept.viewState;
    const reloaded = openWebviewPage(renderPage('dashboard'), kept, { savedState: page.savedState() });
    pages.push(reloaded);
    assert.strictEqual(chosen(reloaded), 'types');
  });

  test('draws every type as a row of one table, under its count and what a type is', () => {
    const page = open(typedWorkspace());
    assert.strictEqual(shownText(page.find('#types-heading')), 'Types 4');
    assert.strictEqual(page.text('.types-help'), 'Each type is a table of one kind of thing in your notes. Select a type to open its rows.');
    assert.deepStrictEqual(page.findAll('.types-table thead th').map((heading) => shownText(heading)), ['Type ▲', 'Its rows are', 'Rows', 'Open tasks', 'Last mentioned', '']);
    assert.strictEqual(page.find('.types-table thead th:last-child .visually-hidden').textContent, 'Add a row', 'the last column is named for a screen reader');
    assert.deepStrictEqual(drawn(page), [
      '▸Areas | #area/* | 2 · 0 with a note | 1 · 1 overdue | today · 2026-10-08 | Add area…',
      '▸Incidents | type: incident · Incidents/ | 2 | 0 |  | Add incident…',
      '▸People | @* | 3 · 3 with a note | 1 · 1 overdue | today · 2026-10-08 | Add person…',
      '▸Teams | #team/* | 2 · 2 with a note | 2 · 1 overdue | today · 2026-10-08 | Add team…',
    ]);
    assert.strictEqual(page.findAll('.types-row .due-date.overdue').length, 3, 'overdue is marked as a type\'s page marks it');
    assert.strictEqual(page.findAll('.types-outside').length, 0, 'no second list with nothing outside a type');
    assert.strictEqual(page.findAll('.tag-row, .home-widget').length, 0, 'and neither other tab is drawn');
  });

  test('a type\'s name, or its row, opens its rows page', () => {
    const page = open(typedWorkspace());
    (page.findAll('.types-row .result-title')[3] as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: 'type = team' });
    (page.findAll('.types-row')[1].querySelector('td:nth-child(3)') as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: 'type = incident' });
    assert.strictEqual(page.posted.filter((message) => message.type === 'openSearch').length, 2, 'once each');
  });

  test('a heading sorts by its column, again the other way, and a type with nothing there stays last', () => {
    const page = open(typedWorkspace());
    const sort = (column: string) => page.click(`[data-action="sort-types"][data-value="${column}"]`);
    const posted = page.posted.map((message) => message.type);
    assert.deepStrictEqual(names(page), ['Areas', 'Incidents', 'People', 'Teams']);
    sort('name');
    assert.deepStrictEqual(names(page), ['Teams', 'People', 'Incidents', 'Areas']);
    assert.strictEqual(page.find('th[data-column="name"]').getAttribute('aria-sort'), 'descending');
    sort('rows');
    assert.deepStrictEqual(names(page), ['Areas', 'Incidents', 'Teams', 'People'], 'fewest first, ties by name');
    assert.strictEqual(page.find('th[data-column="rows"]').getAttribute('aria-sort'), 'ascending');
    assert.strictEqual(page.find('th[data-column="name"]').hasAttribute('aria-sort'), false);
    sort('rows');
    assert.deepStrictEqual(names(page), ['People', 'Areas', 'Incidents', 'Teams']);
    sort('open-tasks');
    assert.deepStrictEqual(names(page), ['Incidents', 'Areas', 'People', 'Teams']);
    sort('last-mentioned');
    assert.deepStrictEqual(names(page), ['Areas', 'People', 'Teams', 'Incidents'], 'never mentioned is last');
    sort('last-mentioned');
    assert.deepStrictEqual(names(page), ['Areas', 'People', 'Teams', 'Incidents'], 'either way');
    sort('rule');
    assert.deepStrictEqual(names(page), ['People', 'Areas', 'Teams', 'Incidents'], 'by what its rows are, as text');
    assert.deepStrictEqual(page.posted.map((message) => message.type), posted, 'sorting is the page\'s own');
  });

  test('the arrow before a type lists its rows in place, once the host has sent them', () => {
    const index = busyWorkspace();
    const page = open(index);
    const toggle = () => page.find('.types-toggle[data-type-key="project"]');
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(toggle().getAttribute('aria-label'), 'List projects');

    page.click('.types-toggle[data-type-key="project"]');
    assert.deepStrictEqual(page.lastPosted('setOpenTypes'), { type: 'setOpenTypes', typeKeys: ['project'] });
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true');
    assert.strictEqual(toggle().getAttribute('aria-controls'), 'type-rows-project');
    assert.strictEqual(toggle().getAttribute('aria-label'), 'Hide projects');
    assert.match(shownText(page.find('#type-rows-project')), /Loading projects…/);

    page.send(snapshotOf(index, 'types', ['project']));
    const listed = page.findAll('#type-rows-project .types-listed-rows li');
    assert.strictEqual(listed.length, LISTED_TAG_ROWS);
    assert.deepStrictEqual(listed.slice(0, 3).map((row) => row.textContent), ['Atlas', 'Borealis', 'Cinder']);
    assert.deepStrictEqual(
      page.findAll('#type-rows-project .types-listed-rows .is-muted').length,
      LISTED_TAG_ROWS - 1,
      'every project but the one with a note is muted',
    );
    assert.strictEqual(page.text('#type-rows-project .types-listed-foot button'), 'Open all 14 projects');
    assert.strictEqual(page.text('#type-rows-project .types-listed-note'), 'The 12 mentioned most recently. Muted names have no note yet.');

    page.click('#type-rows-project [data-tag-key="#project/borealis"]');
    assert.deepStrictEqual(page.lastPosted('openTag'), { type: 'openTag', tagKey: '#project/borealis' });
    page.click('#type-rows-project .types-listed-foot [data-action="open-search"]');
    assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: 'type = project' });

    page.click('.types-toggle[data-type-key="decision"]');
    assert.deepStrictEqual(page.lastPosted('setOpenTypes'), { type: 'setOpenTypes', typeKeys: ['project', 'decision'] });
    page.send(snapshotOf(index, 'types', ['project', 'decision']));
    page.click('#type-rows-decision [data-action="open-note"]');
    assert.deepStrictEqual(page.lastPosted('openNote'), { type: 'openNote', filePath: 'Decisions/Adopt the ledger.md' });
    assert.strictEqual(page.text('#type-rows-decision .types-listed-foot button'), 'Open all 7 decisions');
    assert.strictEqual(page.text('#type-rows-decision .types-listed-note'), 'The 5 written most recently.');

    page.click('.types-toggle[data-type-key="project"]');
    assert.deepStrictEqual(page.lastPosted('setOpenTypes'), { type: 'setOpenTypes', typeKeys: ['decision'] });
    assert.strictEqual(page.findAll('#type-rows-project').length, 0);
    assert.strictEqual(page.findAll('#type-rows-decision').length, 1, 'the other stays open');
  });

  test('Add … starts a row of its type, and New type… a type', () => {
    const page = open(typedWorkspace());
    const add = page.find('.types-row[data-type-key="person"] [data-action="add-type-row"]');
    assert.strictEqual(add.textContent, 'Add person…');
    assert.ok(add.hasAttribute('data-reveal'), 'shown while its row is pointed at or holds focus');
    (add as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('addTypeRow'), { type: 'addTypeRow', typeKey: 'person' });
    assert.strictEqual(page.lastPosted('openSearch'), undefined, 'and does not open the type');
    page.click('#types-panel .section-heading [data-action="new-type"]');
    assert.deepStrictEqual(page.lastPosted('newType'), { type: 'newType' });
  });

  test('with no type yet, says what a type is and offers both ways to make one', () => {
    const page = open(workspace({ 'notes/sync.md': '# Sync #team/rates\nWhere it stands.' }));
    assert.strictEqual(page.findAll('.types-table, #types-heading').length, 0);
    const empty = shownText(page.find('.types-empty'));
    assert.match(empty, /No types yet\./);
    assert.match(empty, /A type makes a table of one kind of thing in your notes, such as your teams or your projects\./);
    assert.deepStrictEqual(page.findAll('.types-empty button').map((button) => button.textContent), ['Create type from tags…', 'New type…']);
    page.click('.types-empty [data-action="create-type-from-tags"]');
    assert.deepStrictEqual(page.lastPosted('createTypeFromTags'), { type: 'createTypeFromTags' });
    page.click('.types-empty [data-action="new-type"]');
    assert.deepStrictEqual(page.lastPosted('newType'), { type: 'newType' });
  });

  test('lists the hub notes outside a type under the table: a namespace opens its search and can be made a type, a tag opens its page', () => {
    const page = open(busyWorkspace());
    assert.strictEqual(shownText(page.find('#types-outside-heading')), 'Hub notes outside a type 3');
    assert.deepStrictEqual(page.findAll('.types-outside-row').map((row) => [...row.children].map((part) => part.textContent).join(' | ')), [
      'Vendors | #vendor/* | · 3 tags, 1 with a note | Create type from tags…',
      'People | @* | · 1 tag, 1 with a note | Create type from tags…',
      'Onboarding | #onboarding | 2 days ago · 2026-10-06',
    ]);
    const [vendors, people, onboarding] = page.findAll('.types-outside-row');
    (vendors.querySelector('.result-title') as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: 'kind = vendor' });
    (vendors.querySelector('[data-action="create-type-from-tags"]') as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('createTypeFromTags'), { type: 'createTypeFromTags', namespace: 'vendor' });
    (people.querySelector('[data-action="create-type-from-tags"]') as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('createTypeFromTags'), { type: 'createTypeFromTags' }, 'the people are chosen in the command');
    (onboarding.querySelector('.result-title') as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('openTag'), { type: 'openTag', tagKey: '#onboarding' });
  });
});
