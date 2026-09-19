// End-to-end: search pages, a tag's overview among them, with the real panel
// host, the real webview script, real messages, and the Related Notes sidebar
// that holds a search's Refine options.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview } = require('./webviewRuntime.js');
const { SearchPanels } = require('../../out/ui/webview/searchPage.js');
const { ActiveSearch } = require('../../out/ui/webview/activeSearch.js');
const { PreferencesStore } = require('../../out/core/storage/preferences.js');
const { SidebarNotesView } = require('../../out/ui/webview/sidebarNotes.js');
const { parseMarkdown } = require('../../out/core/markdown/parser.js');
const { buildWorkspaceIndex } = require('../../out/core/workspace/indexer.js');

function createIndex() {
  const note = (filePath, content) =>
    parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 2 }, {});
  const files = [
    note(
      'notes/2026-09-08.md',
      '## Shutdown telemetry audit #project/atlas @ren-kade\nRen will retain the telemetry feed.\n- [ ] Send the audit summary',
    ),
    note('notes/2026-09-09.md', '## Atlas planning #project/atlas\nSequencing for the milestone.'),
    note('notes/2026-09-11.md', '## Vendor risk #risk/vendor\nDocumented the absent elevator contract.'),
    note('notes/2026-09-12.md', '## Beta kickoff #project/beta\nKickoff notes for beta.'),
    note(
      'notes/atlas.md',
      '---\ndescribes: project/atlas\nowner: "@ren-kade"\n---\n# Atlas\nRetire the old ledger.',
    ),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

function createIndexer(index) {
  const emitter = new vscode.EventEmitter();
  return {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: (uri) => uri.fsPath,
    onDidUpdate: emitter.event,
    // The real indexer corrects a misspelling from the full-text cache.
    // These notes are held in memory, so nothing here is misspelled.
    suggestWords: () => new Map(),
    _emitter: emitter,
  };
}

function createGlobalState() {
  const store = new Map();
  return {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    update: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

/**
 * Opens a page through the real registry and mounts its webview, with the
 * real Related Notes view listening to the same active search.
 */
async function openPanel(open, { sidebarVisible = false } = {}) {
  vscode._test.createdPanels.length = 0;
  vscode.window.activeTextEditor = undefined;
  const index = createIndex();
  const indexer = createIndexer(index);
  const preferences = new PreferencesStore(createGlobalState());
  const activeSearch = new ActiveSearch();
  const panels = new SearchPanels(indexer, preferences, { fsPath: '/ext' }, activeSearch);

  await open(panels);
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  // Replay the state the host already sent before the script was mounted.
  panel._toWebview.forEach((message) => panel._deliver(message));

  const sidebarHost = vscode._test.createWebviewView();
  sidebarHost.visible = sidebarVisible;
  // The sidebar page's messages reach the real host, as they do in VS Code.
  sidebarHost._onWebviewMessage = sidebarHost._fromWebview;
  const sidebarView = new SidebarNotesView(
    indexer,
    preferences,
    activeSearch,
    (tagKey) => panels.show(tagKey),
    '0.0.0-test',
  );
  sidebarView.resolveWebviewView(sidebarHost);
  const sidebarPage = mountWebview(sidebarHost.webview.html, sidebarHost);
  sidebarHost.posted.forEach((message) => sidebarHost._deliver(message));

  /** The state the sidebar last pushed to its own webview. */
  const sidebar = () => {
    const states = sidebarHost.posted.filter((message) => message.type === 'state');
    return states.length ? states[states.length - 1].data : undefined;
  };

  return {
    panels, panel, view, preferences, index, indexer, activeSearch,
    sidebar, sidebarView, sidebarHost, sidebarPage,
  };
}

/** A tag's page, as opening a tag shows it. */
function openOverview(tagKey = '#project/atlas', options) {
  return openPanel((panels) => panels.show(tagKey), options);
}

/** A search page on any search. */
function openSearch(queryText, options) {
  return openPanel((panels) => panels.showQuery(queryText), options);
}

/** The titles of the cards a reader can see, without the tags in them. */
function visibleTitles(view) {
  return view
    .findAll('.card')
    .filter((card) => !card.hidden)
    .map((card) =>
      card.querySelector('.card-title').textContent.replace(/\s*[#@]\S+/g, '').trim(),
    )
    .sort();
}

/** Types a term after the chips and presses Enter. */
function search(view, text) {
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, text);
  view.keydown(bar, 'Enter');
}

/** Opens the builder and returns its last row's value field. */
function openBuilder(view) {
  view.click(view.find('[data-action="toggle-builder"]'));
  const rows = view.findAll('[data-action="builder-set-value"]');
  return rows[rows.length - 1];
}

/** The whole search the box holds: its chips and what is typed after them. */
const box = (view) => view.find('.query-bar-shell').getAttribute('data-query-text');
/** What is typed in the field after the chips. */
const typed = (view) => view.find('[data-action="query-input"]').value;
/** The chips in the box, as their text. */
const chips = (view) =>
  view.findAll('.query-bar-shell .query-chip').map((chip) => chip.getAttribute('title').replace(/^Remove /, ''));
/** Removes every chip, one at a time, as a reader would. */
async function removeChips(view) {
  while (view.find('.query-bar-shell .query-chip')) {
    view.click(view.find('.query-bar-shell .query-chip'));
    await settle();
  }
}
const title = (view) => view.find('h1').textContent.trim();
const settle = (milliseconds = 10) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const tests = [];
const only = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

test('a tag\'s page shows the tag, its entity, and its hub note', async () => {
  const { view, panel } = await openOverview();
  assert.strictEqual(title(view), 'Project: Atlas');
  assert.strictEqual(view.find('.eyebrow').textContent, 'DECKARD / TAG SEARCH');
  assert.ok(view.find('.hub'), 'the hub note leads the page');
  assert.strictEqual(panel.title, 'Project: Atlas');
  assert.strictEqual(box(view), '#project/atlas');
  assert.deepStrictEqual(chips(view), ['#project/atlas'], 'the tag is a chip in the box');
  assert.strictEqual(typed(view), '');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning', 'Shutdown telemetry audit']);
});

test('anything more than the one tag is a search, shown by its box alone', async () => {
  const { view, panel } = await openOverview();
  search(view, '@ren-kade');
  await settle();

  assert.strictEqual(title(view), 'Search');
  assert.strictEqual(view.find('.eyebrow').textContent, 'DECKARD / SEARCH');
  assert.strictEqual(view.find('.hub'), null, 'the hub belongs to the tag alone');
  assert.strictEqual(box(view), '#project/atlas AND @ren-kade', 'a new term joins with AND');
  assert.deepStrictEqual(chips(view), ['#project/atlas', '@ren-kade']);
  assert.strictEqual(typed(view), '', 'the typed term became a chip');
  assert.deepStrictEqual(
    view.findAll('.query-chip[data-action="remove-term"]').map((term) => term.getAttribute('data-without')),
    ['@ren-kade', '#project/atlas'],
    'each chip removes its own term',
  );
  assert.strictEqual(view.find('.query-terms'), null, 'the chips are in the box, not under it');
  // The hub note carries both tags, and only a tag's own page leaves it out.
  assert.deepStrictEqual(visibleTitles(view), ['Atlas', 'Shutdown telemetry audit']);
  assert.match(panel.title, /^Search: #project\/atlas AND @ren-kade/);
  assert.deepStrictEqual(view.state, { query: '#project/atlas AND @ren-kade', origin: '#project/atlas' });
});

test('Clear holds its place, and waits for more than the page\'s own tag', async () => {
  const { view } = await openOverview();
  const clear = () => view.find('[data-action="clear-query"]');
  assert.notStrictEqual(clear().getAttribute('disabled'), null, 'with nothing else, there is nothing to clear');

  view.type(view.find('[data-action="query-input"]'), 'planning');
  assert.strictEqual(clear().disabled, false, 'typing more makes it live');

  view.type(view.find('[data-action="query-input"]'), '');
  assert.strictEqual(clear().disabled, true, 'and back to the tag alone, it waits again');
});

test('Clear returns the page to its own tag, header and all', async () => {
  const { view } = await openOverview();
  search(view, '@ren-kade text ~ telemetry');
  await settle();
  assert.strictEqual(title(view), 'Search');

  view.click(view.find('[data-action="clear-query"]'));
  await settle();

  assert.strictEqual(box(view), '#project/atlas');
  assert.strictEqual(title(view), 'Project: Atlas');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning', 'Shutdown telemetry audit']);
  assert.notStrictEqual(view.find('[data-action="clear-query"]').getAttribute('disabled'), null);
});

test('plain words narrow the whole search as they are typed', async () => {
  const { view } = await openOverview();
  view.posted.length = 0;
  view.type(view.find('[data-action="query-input"]'), 'planning');

  // The page holds one page of the results, so narrowing them is the host's
  // work: hiding rows here would search what is on screen and call the
  // answer a search of the workspace. Sent once the typing pauses.
  assert.deepStrictEqual(view.posted, [], 'a keystroke on its own asks nothing');
  await settle(300);

  assert.deepStrictEqual(view.posted, [
    { type: 'previewSearch', words: ['planning'] },
  ]);
  await settle(300);
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning']);
});

test('opening a search a page already shows reveals that page', async () => {
  const { panels } = await openOverview();
  const count = vscode._test.createdPanels.length;
  await panels.showQuery('tag = #project/atlas');
  await panels.show('project/atlas');
  assert.strictEqual(vscode._test.createdPanels.length, count, 'the same tag, however written');

  await panels.showQuery('#project/atlas is:open');
  assert.strictEqual(vscode._test.createdPanels.length, count + 1, 'another search opens its own tab');
  await panels.showQuery('is:open #project/atlas');
  assert.strictEqual(vscode._test.createdPanels.length, count + 2, 'terms in another order are another search');
});

test('a page keeps its tab while its search is edited, and is found by it', async () => {
  const { view, panels } = await openOverview();
  const count = vscode._test.createdPanels.length;
  await removeChips(view);
  search(view, '#risk/vendor');
  await settle();
  assert.strictEqual(title(view), 'Risk: Vendor');

  await panels.show('#risk/vendor');
  assert.strictEqual(vscode._test.createdPanels.length, count, 'the edited page is the vendor page now');
  await panels.show('#project/atlas');
  assert.strictEqual(vscode._test.createdPanels.length, count + 1, 'and the atlas page is gone from it');
});

test('completing in the search box keeps the rest of the search', async () => {
  const { view } = await openOverview();
  view.type(view.find('[data-action="query-input"]'), 'tag = #project/b');
  view.press(view.find('[data-action="query-suggestion"]'));
  await settle();

  assert.strictEqual(box(view), '#project/atlas AND tag = #project/beta', 'a chosen value is a whole term, and a chip');
  assert.strictEqual(typed(view), '');
});

test('a parse error is reported and the results stay put', async () => {
  const { view } = await openOverview();
  search(view, '(tag = #project/atlas');
  await settle();

  assert.ok(view.find('.query-error'), 'the error should be shown');
  assert.deepStrictEqual(chips(view), ['#project/atlas'], 'the chips keep the search that ran');
  assert.strictEqual(typed(view), '(tag = #project/atlas', 'and the field keeps what was typed');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning', 'Shutdown telemetry audit']);
  assert.strictEqual(title(view), 'Project: Atlas', 'the page is still the tag\'s');
});

test('removing a term keeps the rest of the search as typed', async () => {
  const { view } = await openOverview();
  search(view, 'telemetry is:open');
  await settle();
  assert.deepStrictEqual(chips(view), ['#project/atlas', 'text ~ telemetry', 'is:open'], 'every term is a chip, words as the condition they run');
  const remove = view
    .findAll('[data-action="remove-term"]')
    .find((button) => button.getAttribute('data-without') === '#project/atlas AND telemetry');
  assert.ok(remove, 'each term has its own remove button');

  view.click(remove);
  await settle();

  assert.strictEqual(box(view), '#project/atlas AND telemetry');
  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);
});

test('Refine offers the tag\'s related tags, and a value narrows the page', async () => {
  const { view } = await openOverview();
  const related = view.find('[data-action="facet"][data-facet-id="related"][data-clause="@ren-kade"]');
  assert.ok(related, 'the tag written beside atlas is offered as related');
  assert.ok(related.querySelector('.tag-weight-rail'), 'with how strongly');
  assert.strictEqual(
    view.find('[data-action="facet"][data-facet-id="tags"]'),
    null,
    'a tag page ranks tags by association, not by count',
  );

  view.click(view.find('[data-action="facet"][data-clause="is:open"]'));
  await settle();

  assert.strictEqual(box(view), '#project/atlas AND is:open');
  assert.deepStrictEqual(visibleTitles(view), [], 'is:open keeps only tasks');
});

test('a new builder row starts from its value', async () => {
  const { view } = await openOverview();
  const row = openBuilder(view);
  assert.strictEqual(row.dataset.pending, 'true', 'the builder opens on a new row');

  view.type(row, '@ren');
  view.press(view.find('[data-action="query-suggestion"]'));
  await settle();

  assert.strictEqual(box(view), 'tag = #project/atlas AND tag = @ren-kade');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas', 'Shutdown telemetry audit']);
});

test('the page does not open a second panel while editing', async () => {
  const { view } = await openOverview();
  const before = vscode._test.createdPanels.length;
  view.type(openBuilder(view), '#project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  assert.strictEqual(
    vscode._test.createdPanels.length,
    before,
    'editing a search must not open another page',
  );
});

test('the keyboard can pick a completion in a builder row', async () => {
  const { view } = await openOverview();
  const row = openBuilder(view);
  view.type(row, '#risk/v');
  view.keydown(row, 'ArrowDown');
  view.keydown(row, 'Enter');
  await settle();

  assert.strictEqual(box(view), 'tag = #project/atlas AND tag = #risk/vendor');
});

test('typing a value and leaving the field applies it, and again', async () => {
  const { view } = await openOverview();
  view.type(openBuilder(view), 'text');
  view.press(view.find('[data-action="query-suggestion"]'));

  const value = () => {
    const rows = view.findAll('[data-action="builder-set-value"]');
    return rows[rows.length - 1];
  };
  view.change(value(), 'telemetry');
  await settle();
  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);

  view.change(value(), 'planning');
  await settle();
  assert.strictEqual(value().value, 'planning');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning']);
});

test('an OR search finds notes from either branch', async () => {
  const { view } = await openSearch('text ~ elevator');
  await removeChips(view);
  search(view, 'tag = #risk/vendor OR tag = #project/beta');
  await settle();

  assert.deepStrictEqual(visibleTitles(view), ['Beta kickoff', 'Vendor risk']);
  assert.deepStrictEqual(chips(view), ['tag = #risk/vendor OR tag = #project/beta'], 'an OR search is one chip');
  assert.strictEqual(view.find('.query-chip .query-op').textContent, 'OR');

  // A term added to an OR search is added to all of it.
  search(view, 'kickoff');
  await settle();
  assert.strictEqual(box(view), '(tag = #risk/vendor OR tag = #project/beta) AND kickoff');
  assert.deepStrictEqual(visibleTitles(view), ['Beta kickoff']);
});

test('an empty search page lists every note', async () => {
  const { view, panel } = await openSearch('');
  assert.strictEqual(panel.title, 'Deckard Search');
  assert.strictEqual(visibleTitles(view).length, 5);
  assert.strictEqual(view.find('.query-facets'), null, 'nothing to refine yet');
});

test('a page saved before search pages reopens on its tag, tags, and words', async () => {
  const { panels } = await openOverview();
  const restored = (state) => {
    const panel = vscode._test.createWebviewView();
    return Object.assign(vscode.window.createWebviewPanel('deckard.tagOverview', 'Old', -1, {}), { _state: state, panel });
  };
  const legacy = restored({});
  await panels.restore(legacy, {
    tagKey: '#risk/vendor',
    filterTagKeys: [],
    refinement: '#risk/vendor elevator',
  });
  const view = mountWebview(legacy.webview.html, legacy);
  legacy._toWebview.forEach((message) => legacy._deliver(message));
  assert.strictEqual(box(view), '#risk/vendor elevator');
  assert.deepStrictEqual(view.state, { query: '#risk/vendor elevator', origin: '#risk/vendor' });

  const gone = restored({});
  await panels.restore(gone, { tagKey: '#missing' });
  assert.strictEqual(gone.disposed, true, 'a page for a tag that is gone is not restored');
});

// ---------------------------------------------------------------------------
// The search box as a field of chips.

test('each term is a chip with a remove icon, joined by AND', async () => {
  const { view } = await openSearch('#project/atlas -@ren-kade audit');
  assert.deepStrictEqual(chips(view), ['#project/atlas', '-@ren-kade', 'text ~ audit'], 'a word shows as text ~');
  const [tag, negated, words] = view.findAll('.query-bar-shell .query-chip');
  assert.ok(tag.classList.contains('is-tag'));
  assert.ok(negated.classList.contains('is-negated'));
  assert.ok(!words.classList.contains('is-tag'));
  assert.strictEqual(view.findAll('.query-chip .query-chip-remove').length, 3, 'every chip shows its remove icon');
  assert.deepStrictEqual(
    view.findAll('.query-bar-shell .query-chip-join').map((join) => join.textContent),
    ['AND', 'AND'],
  );
  assert.strictEqual(view.find('[data-action="query-input"]').getAttribute('placeholder'), '', 'no hint beside chips');
});

test('a chosen tag becomes a chip at once, joined with AND', async () => {
  const { view } = await openOverview();
  view.type(view.find('[data-action="query-input"]'), '@re');
  view.press(view.find('[data-action="query-suggestion"]'));
  await settle();
  assert.strictEqual(box(view), '#project/atlas AND @ren-kade');
  assert.deepStrictEqual(chips(view), ['#project/atlas', '@ren-kade']);
  assert.strictEqual(typed(view), '');
});

test('tags typed side by side are joined with AND', async () => {
  const { view } = await openSearch('');
  search(view, '#project/atlas @ren-kade');
  await settle();
  assert.strictEqual(box(view), '#project/atlas AND @ren-kade');
  assert.deepStrictEqual(chips(view), ['#project/atlas', '@ren-kade']);
});

test('Backspace in an empty field removes the last chip, and keeps a typed term', async () => {
  const { view } = await openSearch('#project/atlas AND @ren-kade');
  const bar = () => view.find('[data-action="query-input"]');
  view.keydown(bar(), 'Backspace');
  await settle();
  assert.deepStrictEqual(chips(view), ['#project/atlas']);

  view.type(bar(), 'plan');
  view.keydown(bar(), 'Backspace');
  await settle();
  assert.deepStrictEqual(chips(view), ['#project/atlas'], 'with text in the field, Backspace edits the text');

  view.click(view.find('.query-bar-shell .query-chip'));
  await settle();
  assert.deepStrictEqual(chips(view), []);
  assert.strictEqual(typed(view), 'plan', 'removing a chip keeps what is being typed');
});

test('text not added as a term is let go when the box loses focus', async () => {
  const { view } = await openOverview();
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'half typed');
  assert.strictEqual(box(view), '#project/atlas AND half typed');

  // Moving to the box's own Search button keeps it.
  view.fire('focusout', bar, { relatedTarget: view.find('[data-action="apply-query"]') });
  assert.strictEqual(typed(view), 'half typed');

  view.fire('focusout', bar, { relatedTarget: null });
  assert.strictEqual(typed(view), '');
  assert.strictEqual(box(view), '#project/atlas');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning', 'Shutdown telemetry audit'], 'its words no longer hide anything');
});

test('Clear empties the field as well as the chips', async () => {
  const { view } = await openOverview();
  search(view, '@ren-kade');
  await settle();
  view.type(view.find('[data-action="query-input"]'), 'more');
  view.click(view.find('[data-action="clear-query"]'));
  await settle();
  assert.strictEqual(typed(view), '');
  assert.deepStrictEqual(chips(view), ['#project/atlas']);
});

// ---------------------------------------------------------------------------
// The sidebar's Refine view.

test('with the sidebar open, Refine moves there and the page keeps a line', async () => {
  const { view, sidebar, sidebarPage } = await openOverview('#project/atlas', { sidebarVisible: true });
  const state = sidebar();
  assert.strictEqual(state.state, 'refine');
  assert.strictEqual(state.refine.title, 'Project: Atlas');
  assert.strictEqual(state.refine.page, 'search');

  assert.ok(view.find('.query-facets.is-elsewhere'), 'the page shows a line for Refine');
  assert.strictEqual(view.find('[data-action="facet"]'), null);
  assert.ok(sidebarPage.find('.refine-value [data-action="refine"][data-clause="@ren-kade"]'), 'the sidebar lists the related tag');
  assert.ok(sidebarPage.find('.refine-value .tag-weight-rail'));
  assert.strictEqual(sidebarPage.find('.note-list'), null, 'the page lists the notes, so the sidebar does not');
  assert.strictEqual(sidebarPage.find('.active-file'), null, 'nor the search, which the page shows');
  assert.strictEqual(sidebarPage.find('.refine-heading h2').textContent, 'Refine', 'the view says what it is');
  assert.ok(sidebarPage.find('.refine-heading .refine-hint'), 'with how to use it, before the values');
  assert.strictEqual(sidebarPage.find('.refine-facet .section-label').textContent, 'Tags', 'related tags are listed as Tags');
  assert.strictEqual(sidebarPage.find('[data-action="refine-remove-term"]'), null, 'terms are removed in the search box');
});

test('narrowing from the sidebar edits the page\'s search', async () => {
  const { view, sidebar, sidebarPage } = await openOverview('#project/atlas', { sidebarVisible: true });
  sidebarPage.click(sidebarPage.find('[data-action="refine"][data-clause="@ren-kade"]'));
  await settle();

  assert.strictEqual(box(view), '#project/atlas AND @ren-kade');
  assert.strictEqual(title(view), 'Search', 'the page is a search now');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas', 'Shutdown telemetry audit']);
  assert.strictEqual(sidebar().refine.query.text, '#project/atlas AND @ren-kade');
});

test('a related tag\'s icon opens its page in a new tab', async () => {
  const { view, sidebarPage } = await openOverview('#project/atlas', { sidebarVisible: true });
  const count = vscode._test.createdPanels.length;
  const row = sidebarPage.find('.refine-value [data-clause="@ren-kade"]');
  assert.strictEqual(row.dataset.action, 'refine', 'the row itself adds the tag to the search');
  sidebarPage.click(sidebarPage.find('.refine-value .refine-open-tag[data-tag-key="@ren-kade"]'));
  await settle();
  assert.strictEqual(vscode._test.createdPanels.length, count + 1, 'the tag opens in its own tab');
  assert.strictEqual(vscode._test.createdPanels[count].title, 'Person: Ren Kade');
  assert.strictEqual(box(view), '#project/atlas', 'and this search is left as it was');
});

test('Alt leaves a value out, from the sidebar', async () => {
  const { view, sidebarPage } = await openOverview('#project/atlas', { sidebarVisible: true });
  const value = sidebarPage.find('[data-action="refine"][data-clause="@ren-kade"]');
  sidebarPage.fire('click', value, { altKey: true });
  await settle();
  assert.strictEqual(box(view), '#project/atlas AND -@ren-kade');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning']);
});

test('the sidebar refines only what the page offers', async () => {
  const { view, sidebarHost } = await openOverview('#project/atlas', { sidebarVisible: true });
  sidebarHost._fromWebview({ type: 'refineActiveSearch', facetId: 'related', clause: 'text ~ secret', mode: 'and' });
  await settle();
  assert.strictEqual(box(view), '#project/atlas');
});

test('closing the sidebar brings Refine back to the page', async () => {
  const { view, sidebarHost } = await openOverview('#project/atlas', { sidebarVisible: true });
  assert.ok(view.find('.query-facets.is-elsewhere'));

  sidebarHost._setVisible(false);
  assert.strictEqual(view.find('.query-facets.is-elsewhere'), null);
  assert.ok(view.find('[data-action="facet"][data-clause="@ren-kade"]'));

  sidebarHost._setVisible(true);
  assert.ok(view.find('.query-facets.is-elsewhere'));
});

test('a Markdown editor takes the sidebar back, and the page its Refine', async () => {
  const { view, panel, sidebar } = await openOverview('#project/atlas', { sidebarVisible: true });
  panel.active = false;
  panel._setVisible(true);
  panel.active = false;
  vscode._test.emitters.activeEditor.fire({ document: { uri: vscode.Uri.file('notes/2026-09-09.md') } });
  await settle();

  assert.notStrictEqual(sidebar().state, 'refine');
  assert.strictEqual(view.find('.query-facets.is-elsewhere'), null);
});

// ---------------------------------------------------------------------------

(async () => {
  let pass = 0;
  const failures = [];
  const list = only.length ? only : tests;
  for (const entry of list) {
    try {
      await entry.fn();
      pass += 1;
      console.log('  ok   ' + entry.name);
    } catch (error) {
      failures.push(entry.name + '\n       ' + String(error.message).split('\n').slice(0, 8).join('\n       '));
      console.log('  FAIL ' + entry.name);
    }
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(failures.length ? 1 : 0);
})();
