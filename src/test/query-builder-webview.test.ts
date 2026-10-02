import * as assert from 'assert';

import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';

/**
 * Drives the overview webview's own script in jsdom.
 *
 * The other webview tests assert that a script parses and that its source
 * contains the right markup, which cannot catch a control that renders
 * correctly but does nothing when it is clicked. Running the real script lets
 * a click be followed all the way to the HTML it produces.
 */
suite('Tag overview query builder', () => {
  test('adds a condition row without waiting for the host', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    // The builder opens with the query's own row and an empty one to type in.
    assert.strictEqual(view.countRows(), 2);

    view.posted.length = 0;
    view.click({ action: 'builder-add-row', path: '' });

    assert.strictEqual(
      view.countRows(),
      3,
      'the new row should render immediately',
    );
    // An empty row does not change the query, and a round trip through the
    // host would drop it, so nothing should be posted for it.
    assert.deepStrictEqual(view.posted, []);
  });

  test('adds a group without waiting for the host', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });

    view.click({ action: 'builder-add-group', path: '' });

    assert.strictEqual(view.countGroups(), 2);
  });

  test('builds an OR of tags with a NOT beside it from nothing, without typing the query', () => {
    // What Refine makes with three clicks and an Alt: built here by hand,
    // which the builder could not do while it had only one shape.
    const view = mountTagOverview({ answerQueries: true });
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = '';
    state.query.builder = { join: 'and', items: [] };
    view.send(state);
    view.click({ action: 'toggle-builder' });
    assert.strictEqual(view.countRows(), 1, 'a row to type in');

    // A group beside the row, joined the other way, and told to match any.
    view.click({ action: 'builder-add-group', path: '' });
    assert.strictEqual(view.countGroups(), 2, 'the root, and one inside it');
    assert.ok(view.findAll('span.query-builder-and').some((join) => join.textContent === 'and'), 'the group joins the root with AND');
    view.change({ dataset: { action: 'builder-set-join', path: '1' } }, 'or');

    const row = (path: string) => ({ dataset: { action: 'builder-set-value', pending: 'true', suggestKey: 'p' + path.replace(/\./g, '_'), path } });
    view.key(view.type(row('1.0'), '#a'), 'Enter');
    view.key(view.type(row('1.1'), '#b'), 'Enter');
    view.key(view.type(row('1.2'), '#c'), 'Enter');
    view.key(view.type(row('0'), '#d'), 'Enter');
    view.change({ dataset: { action: 'builder-set-operator', path: '0' } }, 'neq');

    // The mount answers each search with its text alone, not the host's
    // rows for it, so the query posted is what is checked, not a redraw.
    const last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
    assert.strictEqual(last?.query, 'tag != #d AND (tag = #a OR tag = #b OR tag = #c)');
  });

  test('shows a query written by hand as rows, whatever its shape', () => {
    const view = mountTagOverview();
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = 'NOT (tag = #a OR tag = #b) AND task = open';
    state.query.builder = {
      join: 'and',
      items: [
        { join: 'or', negated: true, items: [
          { field: 'tag', operator: 'eq', value: '#a', supported: true, text: 'tag = #a' },
          { field: 'tag', operator: 'eq', value: '#b', supported: true, text: 'tag = #b' },
        ] },
        { field: 'task', operator: 'eq', value: 'open', supported: true, text: 'task = open' },
      ],
    };
    view.send(state);
    view.click({ action: 'toggle-builder' });
    assert.strictEqual(view.countGroups(), 2);
    assert.strictEqual(view.countRows(), 4, 'three rows and the one to type in');
    // Every row's completion list is found by its key, so two rows sharing
    // one would send a completion to the wrong row: that is how a nested
    // group's first row once became "tag = undefined". A key is its path.
    const keys = view.findAll('[data-suggest-key][data-path]')
      .map((row) => [String(row.getAttribute('data-suggest-key')), String(row.getAttribute('data-path'))]);
    assert.strictEqual(keys.length, 4);
    assert.strictEqual(new Set(keys.map(([key]) => key)).size, 4, 'every row has its own key');
    for (const [key, path] of keys) {
      assert.strictEqual(key, 'p' + path.replace(/\./g, '_'), `the key for ${path}`);
    }
    assert.strictEqual(view.findAll('.query-builder-readonly').length, 0, 'nothing is text');
    assert.strictEqual(view.find('[data-action="builder-toggle-not"][data-path="0"]').getAttribute('aria-pressed'), 'true', 'the group is shown as negated');
  });

  test('accepting a completion in a nested group\'s second row leaves its first row alone', () => {
    // Reported: with #person/mara-vale as the first row of a nested OR group,
    // typing "harb" in the group's next row and choosing #team/harbor turned
    // the first row into "tag = undefined".
    const view = mountTagOverview({ answerQueries: true });
    const state = createState('tag = #person/sable-ortiz') as {
      query: { suggestions: { values: { tag: Array<{ value: string; label: string }> } }; builder: unknown; text: string };
    };
    state.query.suggestions.values.tag.push(
      { value: '#person/mara-vale', label: '#person/mara-vale' },
      { value: '#team/harbor', label: '#team/harbor' },
    );
    view.send(state);
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-group', path: '' });
    view.change({ dataset: { action: 'builder-set-join', path: '2' } }, 'or');

    const pending = (path: string) => ({ dataset: { action: 'builder-set-value', pending: 'true', suggestKey: 'p' + path.replace(/\./g, '_'), path } });
    view.key(view.type(pending('2.0'), '#person/mara-vale'), 'Enter');
    const second = view.type(pending('2.1'), 'harb');
    assert.match(view.suggestionsFor('p2_1'), /#team\/harbor/, 'the completion is offered');
    // Chosen from the keyboard, as a reader who is typing would.
    view.key(second, 'ArrowDown');
    view.key(second, 'Enter');

    const last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
    assert.strictEqual(last?.query, 'tag = #person/sable-ortiz AND (tag = #person/mara-vale OR tag = #team/harbor)');
    assert.doesNotMatch(view.html(), /undefined/);
  });

  test('keeps in-progress rows across an unrelated refresh', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', path: '' });

    // An index update re-sends the same query; a half-written row must
    // survive it.
    view.send(createState());

    assert.strictEqual(view.countRows(), 3);
  });

  test('keeps a value being typed in a row across an unrelated refresh', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    const row = { dataset: { action: 'builder-set-value', path: '0' } };
    view.type(row, '#project/atlas-two');

    // An index update re-sends the same query while the value is typed and
    // not yet committed.
    view.send(createState());

    const value = view.find('[data-action="builder-set-value"][data-path="0"]') as HTMLInputElement;
    assert.strictEqual(value.value, '#project/atlas-two');
  });

  test('rebuilds its rows when the query changes elsewhere', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', path: '' });

    view.send(createState('tag = #other'));

    assert.strictEqual(view.countRows(), 1);
  });

  test('completes tag values in a builder row', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });

    view.type(
      {
        dataset: {
          action: 'builder-set-value',
          suggestKey: 'p0',
          field: 'tag',
          path: '0',
        },
      },
      '#proj',
    );

    const rendered = view.suggestionsFor('p0');
    assert.match(rendered, /#project\/atlas/);
    assert.match(rendered, /query-suggestion/);
  });

  test('offers a builder row only the values its field accepts', () => {
    const view = mountTagOverview({ answerQueries: true });
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.change({ dataset: { action: 'builder-set-field', path: '0' } }, 'task');

    view.type(
      {
        dataset: {
          action: 'builder-set-value',
          suggestKey: 'p0',
          field: 'task',
          path: '0',
        },
      },
      'op',
    );

    const rendered = view.suggestionsFor('p0');
    assert.match(rendered, /open/);
    assert.doesNotMatch(rendered, /#project\/atlas/);
  });

  test('completes a value in the query bar once the field is known', () => {
    const view = mountTagOverview();
    view.send(createState());

    view.type(
      { dataset: { action: 'query-input', suggestKey: 'query' } },
      'tag = #proj',
    );

    const rendered = view.suggestionsFor('query');
    assert.match(rendered, /#project\/atlas/);
    // In value position the field name must not be offered again.
    assert.doesNotMatch(rendered, /&gt;tag =&lt;/);
  });

  test('offers field names in the query bar outside a value', () => {
    const view = mountTagOverview();
    view.send(createState());

    view.type(
      { dataset: { action: 'query-input', suggestKey: 'query' } },
      'upd',
    );

    assert.match(view.suggestionsFor('query'), /updated =/);
  });

  test('shows the search box without a toggle', () => {
    const view = mountTagOverview();
    view.send(createState());
    assert.ok(view.find('[data-action="query-input"]'));
    assert.doesNotMatch(view.html(), /toggle-query/);
  });

  test('turns a value typed in a new row into the condition it names', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', path: '' });
    view.posted.length = 0;

    const input = view.type(
      {
        dataset: {
          action: 'builder-set-value',
          suggestKey: 'p1',
          pending: 'true',
          path: '1',
        },
      },
      'open',
    );
    assert.match(view.suggestionsFor('p1'), /is:open/);
    view.key(input, 'Tab');

    assert.deepStrictEqual(view.posted, [
      { type: 'setOverviewQuery', query: 'tag = #project/atlas AND is:open', remember: true },
    ]);
  });

  test('builds a link row from [[Atlas plan]] typed in a new row, and writes its brackets once', () => {
    const view = mountTagOverview({ answerQueries: true });
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = '';
    state.query.builder = { join: 'and', items: [] };
    view.send(state);
    view.click({ action: 'toggle-builder' });
    const row = (path: string) => ({ dataset: { action: 'builder-set-value', pending: 'true', suggestKey: 'p' + path, path } });
    view.key(view.type(row('0'), '[[Atlas plan]]'), 'Enter');
    view.key(view.type(row('1'), '-[[Budget]]'), 'Enter');
    const last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
    assert.strictEqual(last?.query, 'link = [[Atlas plan]] AND link != [[Budget]]');
  });

  test('writes a link row as link = [[…]] whether or not its value has brackets', () => {
    const view = mountTagOverview();
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = 'link = [[Atlas]]';
    state.query.builder = {
      join: 'and',
      items: [{ field: 'link', operator: 'eq', value: 'Atlas', supported: true, text: 'link = [[Atlas]]' }],
    };
    view.send(state);
    view.click({ action: 'toggle-builder' });
    assert.strictEqual(view.findAll('[placeholder="Atlas#Decision"]').length, 1);
    const input = view.type({ dataset: { action: 'builder-set-value', suggestKey: 'p0', field: 'link', path: '0' } }, '[[Atlas plan]]');
    view.key(input, 'Enter');
    const last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
    assert.strictEqual(last?.query, 'link = [[Atlas plan]]');
  });

  test('shows [[Atlas plan]] as one chip with one remove', () => {
    const view = mountTagOverview();
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = '[[Atlas plan]] -[[Budget]]';
    state.query.terms = [
      { text: '[[Atlas plan]]', without: '-[[Budget]]' },
      { text: '-[[Budget]]', without: '[[Atlas plan]]' },
    ];
    view.send(state);
    assert.strictEqual(view.findAll('[class="query-chip-remove"]').length, 2);
    assert.strictEqual(view.find('[data-action="remove-term"][data-without="[[Atlas plan]]"]').getAttribute('class'), 'query-chip is-negated');
  });

  test('completes a note after [[ in the bar and in a new row', () => {
    const view = mountTagOverview();
    const state = createState('') as { query: { text: string; builder: unknown; suggestions: { values: Record<string, unknown> } } };
    state.query.text = '';
    state.query.builder = { join: 'and', items: [] };
    state.query.suggestions.values.link = [
      { value: 'Atlas plan', label: '[[Atlas plan]]', detail: 'Linked from 3 notes' },
      { value: 'Budget', label: '[[Budget]]', detail: 'Linked from 1 note' },
    ];
    view.send(state);

    const bar = view.type({ dataset: { action: 'query-input', suggestKey: 'query' } }, 'is:open [[Atl');
    const rendered = view.suggestionsFor('query');
    assert.match(rendered, /\[\[Atlas plan\]\]/);
    assert.match(rendered, /Linked from 3 notes/);
    assert.doesNotMatch(rendered, /Budget/);
    view.key(bar, 'ArrowDown');
    view.key(bar, 'Enter');
    let last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
    assert.strictEqual(last?.query, 'is:open [[Atlas plan]]');

    view.click({ action: 'toggle-builder' });
    const row = view.type({ dataset: { action: 'builder-set-value', pending: 'true', suggestKey: 'p0', path: '0' } }, '-[[Bud');
    assert.match(view.suggestionsFor('p0'), /-\[\[Budget\]\]/);
    view.key(row, 'ArrowDown');
    view.key(row, 'Enter');
    last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
    assert.strictEqual(last?.query, 'link != [[Budget]]');
  });

  test('removes an empty row with Backspace', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', path: '' });
    assert.strictEqual(view.countRows(), 3);

    const input = view.type(
      {
        dataset: {
          action: 'builder-set-value',
          suggestKey: 'p1',
          pending: 'true',
          path: '1',
        },
      },
      '',
    );
    view.key(input, 'Backspace');

    assert.strictEqual(view.countRows(), 2);
  });

  test('a group emptied of its conditions goes too, and so on upward', () => {
    const view = mountTagOverview();
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = 'tag = #a AND (tag = #b OR (tag = #c AND tag = #d))';
    state.query.builder = {
      join: 'and',
      items: [
        { field: 'tag', operator: 'eq', value: '#a', supported: true, text: 'tag = #a' },
        { join: 'or', items: [
          { field: 'tag', operator: 'eq', value: '#b', supported: true, text: 'tag = #b' },
          { join: 'and', items: [
            { field: 'tag', operator: 'eq', value: '#c', supported: true, text: 'tag = #c' },
            { field: 'tag', operator: 'eq', value: '#d', supported: true, text: 'tag = #d' },
          ] },
        ] },
      ],
    };
    view.send(state);
    view.click({ action: 'toggle-builder' });
    assert.strictEqual(view.countGroups(), 3);
    // The root draws no box of its own; every group inside it does.
    assert.strictEqual(view.findAll('[class="query-builder-group is-root"]').length, 1);
    assert.strictEqual(view.findAll('.query-builder-item.has-group').length, 2);

    // The page keeps its own tree until the host answers with a different
    // search, so the host's echo of each search is sent back before the
    // groups are counted, the way the host would.
    const echo = () => {
      const last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
      view.send(createState((last as { query?: string } | undefined)?.query ?? ''));
      return (last as { query?: string } | undefined)?.query;
    };
    view.click({ action: 'builder-remove-row', path: '1.1.1' });
    assert.strictEqual(echo(), 'tag = #a AND (tag = #b OR tag = #c)');
    assert.strictEqual(view.countGroups(), 3, 'a group with a row left keeps its place');
    view.click({ action: 'builder-remove-row', path: '1.1.0' });
    assert.strictEqual(echo(), 'tag = #a AND tag = #b');
    assert.strictEqual(view.countGroups(), 2, 'the emptied inner group is gone');
    assert.strictEqual(view.countRows(), 3, 'a, b, and the one to type in');

    // Emptying the group above empties nothing else, so only it goes, and
    // the root stays whatever is taken out of it.
    view.click({ action: 'builder-remove-row', path: '1.0' });
    assert.strictEqual(echo(), 'tag = #a');
    assert.strictEqual(view.countGroups(), 1, 'only the root, which stays');
    assert.strictEqual(view.countRows(), 2);
  });

  test('shows a group of the search as chips of its own, each removable', () => {
    const view = mountTagOverview();
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = '#a OR NOT (#b AND -#c)';
    state.query.termsJoin = 'or';
    state.query.terms = [
      { text: '#a', without: 'NOT (#b AND -#c)' },
      {
        text: 'NOT (#b AND -#c)', without: '#a', join: 'and', negated: true,
        items: [
          { text: '#b', without: '#a OR NOT (-#c)' },
          { text: '-#c', without: '#a OR NOT (#b)', negated: true },
        ],
      },
    ];
    view.send(state);
    const groups = view.findAll('[class="query-chip-group is-negated"]');
    assert.strictEqual(groups.length, 1);
    const joins = view.findAll('span[class="query-chip-join"][aria-hidden="true"]').map((join) => join.textContent);
    for (const join of ['OR', 'NOT', 'AND']) {
      assert.ok(joins.includes(join), `the ${join} between terms`);
    }
    assert.ok(view.find('.query-chip-group-remove[data-action="remove-term"][data-without="#a"]'));
    assert.strictEqual(view.find('[data-action="remove-term"][data-without="#a OR NOT (#b)"]').getAttribute('class'), 'query-chip is-tag is-negated');
    assert.strictEqual(view.findAll('[class="query-chip-remove"]').length, 4, 'a, the group, b, and c');
    // The frame itself removes the group, as a chip's face removes its term.
    assert.deepStrictEqual(
      ['role', 'aria-label', 'data-action', 'data-without'].map((name) => groups[0].getAttribute(name)),
      ['group', 'NOT (#b AND -#c)', 'remove-term', '#a'],
    );

    view.click({ action: 'remove-term', without: '#a OR NOT (-#c)' });
    const last = view.posted.filter((message) => message.type === 'setOverviewQuery').pop();
    assert.strictEqual((last as { query?: string } | undefined)?.query, '#a OR NOT (-#c)');
  });

  test('narrows by a facet, or leaves it out with Alt', () => {
    const facets = [
      {
        id: 'status',
        label: 'Tasks',
        values: [{ label: 'Open', count: 2, clause: 'is:open' }],
        applied: [],
      },
    ];
    const view = mountTagOverview();
    view.send(createState('tag = #project/atlas', { facets, canAppend: true }));
    assert.ok(view.findAll('[data-action="facet"]').length > 0);

    view.posted.length = 0;
    view.click({ action: 'facet', clause: 'is:open', facetId: 'status' });
    view.click({ action: 'facet', clause: 'is:open', facetId: 'status' }, { altKey: true });

    assert.deepStrictEqual(view.posted, [
      { type: 'setOverviewQuery', query: 'tag = #project/atlas AND is:open', remember: false },
      { type: 'setOverviewQuery', query: 'tag = #project/atlas AND -is:open', remember: false },
    ]);
  });

  test('allows another value of a facet with Shift', () => {
    const facets = [
      {
        id: 'status',
        label: 'Tasks',
        values: [{ label: 'Done', count: 1, clause: 'is:done' }],
        applied: ['is:open'],
      },
    ];
    const view = mountTagOverview();
    view.send(createState('#project/atlas is:open', { facets, canAppend: true }));

    view.posted.length = 0;
    view.click({ action: 'facet', clause: 'is:done', facetId: 'status' }, { shiftKey: true });

    assert.deepStrictEqual(view.posted, [
      { type: 'setOverviewQuery', query: '#project/atlas (is:open OR is:done)', remember: false },
    ]);
  });

  test('runs the whole search in the box, the page\'s own tag included', () => {
    const view = mountTagOverview();
    view.send(createState('#project/atlas', { origin: '#project/atlas' }));
    view.posted.length = 0;

    const input = view.type(
      { dataset: { action: 'query-input', suggestKey: 'query' } },
      'vendor',
    );
    view.key(input, 'Enter');

    // The chips hold the page's tag; what is typed after them joins by AND.
    assert.deepStrictEqual(view.posted, [
      { type: 'setOverviewQuery', query: '#project/atlas AND vendor', remember: true },
    ]);
  });

  test('shows a line in place of Refine while the sidebar holds it', () => {
    const facets = [
      {
        id: 'related',
        label: 'Tags',
        applied: [],
        values: [{ label: '#team/harbor', count: 3, clause: '#team/harbor', strength: 0.6, detail: 'Written together 3 times' }],
      },
    ];
    const view = mountTagOverview();
    view.send(createState('#project/atlas', { facets }));
    assert.ok(view.findAll('[data-clause="#team/harbor"]').length > 0);
    assert.ok(view.findAll('[class="tag-weight-rail"]').length > 0, 'a related tag shows its strength');
    assert.match(view.html(), /related 2 of 3/);

    // Given the results it is a share of, the chip says so.
    const shared = [{ ...facets[0], values: [{ ...facets[0].values[0], count: 6, total: 13, strength: 6 / 13 }] }];
    view.send(createState('#project/atlas', { facets: shared }));
    assert.match(view.html(), /in 6 of 13 results/);

    view.send({ ...(createState('#project/atlas', { facets }) as object), refineInSidebar: true });
    assert.strictEqual(view.findAll('[data-clause="#team/harbor"]').length, 0);
    assert.match(view.html(), /In the Context sidebar\./);
  });

  test('offers recent searches in an empty search box', () => {
    const view = mountTagOverview();
    view.send(
      createState('', {
        recent: [{ value: '#project/atlas is:open', label: '#project/atlas is:open', detail: 'Recent search' }],
      }),
    );

    view.focus({ dataset: { action: 'query-input', suggestKey: 'query' } }, '');

    assert.match(view.suggestionsFor('query'), /#project\/atlas is:open/);
  });

  test('Tab out of an empty search box moves on, and runs none of its recent searches', () => {
    const view = mountTagOverview();
    view.send(
      createState('', {
        recent: [{ value: '#project/atlas is:open', label: '#project/atlas is:open', detail: 'Recent search' }],
      }),
    );
    // Tabbing into the box focuses it, which offers the recent searches.
    view.focus({ dataset: { action: 'query-input', suggestKey: 'query' } }, '');
    assert.match(view.suggestionsFor('query'), /#project\/atlas is:open/);

    view.posted.length = 0;
    const taken = view.key(view.find('[data-suggest-key="query"]'), 'Tab');

    assert.deepStrictEqual(view.posted, [], 'no search runs');
    assert.strictEqual(taken, false, 'Tab is left to move focus on');
    assert.strictEqual(view.suggestionsFor('query'), '', 'the list closes');
  });

  test('keeps the bar in place while a search is typed', () => {
    const view = mountTagOverview();
    view.send(createState('#project/atlas', { origin: '#project/atlas' }));
    // Clear is always drawn, disabled while the box holds only the page's
    // own tag, so nothing appears beside the box when typing starts.
    const held = view.find('[data-action="clear-query"]');
    assert.ok(held.hasAttribute('data-query-clears'));
    assert.strictEqual(held.getAttribute('aria-disabled'), 'true');
    // Builder sits under the box, not beside it.
    assert.ok(
      view.find('.query-status').contains(view.find('[data-action="toggle-builder"]')),
      'the builder toggle is on the line under the box',
    );

    view.posted.length = 0;
    const box = view.find('[data-suggest-key="query"]');
    const clear = view.find('[data-action="clear-query"]');
    view.type({ dataset: { action: 'query-input', suggestKey: 'query' } }, 'vendor');
    // The shell notes what is typed in an attribute; the elements stay.
    assert.strictEqual(view.find('[data-suggest-key="query"]'), box, 'typing does not redraw the box');
    assert.strictEqual(view.find('[data-action="clear-query"]'), clear, 'or anything beside it');
  });

  test('sends the query when a condition is removed', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });

    view.posted.length = 0;
    view.click({ action: 'builder-remove-row', path: '0' });

    assert.deepStrictEqual(
      view.posted.map((message) => message.type),
      ['setOverviewQuery'],
    );
  });
});

/** What names an element: its `data-*` attributes, as a dataset. */
interface ElementDescriptor {
  dataset: Record<string, string>;
}

interface MountedView {
  posted: Array<Record<string, unknown>>;
  find: (selector: string) => Element;
  findAll: (selector: string) => Element[];
  send: (state: unknown) => void;
  click: (dataset: Record<string, string>, modifiers?: Record<string, boolean>) => void;
  /** Presses a key on an element; true when the page took it, so the browser does nothing more with it. */
  key: (input: Element, key: string) => boolean;
  focus: (input: ElementDescriptor, value: string) => void;
  change: (input: ElementDescriptor, value: string) => void;
  html: () => string;
  countRows: () => number;
  countGroups: () => number;
  type: (input: ElementDescriptor, value: string) => Element;
  suggestionsFor: (key: string) => string;
}

/**
 * The selector for the element whose `data-*` attributes are a dataset's,
 * such as `[data-action="builder-set-value"][data-path="1.0"]`.
 */
function datasetSelector(dataset: Record<string, string>): string {
  return Object.entries(dataset)
    .map(([name, value]) => {
      const attribute = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      return `[data-${attribute}="${value.replace(/["\\]/g, '\\$&')}"]`;
    })
    .join('');
}

/**
 * Opens the search page in jsdom and drives it the way a reader would: each
 * action finds the element its data attributes name and raises real events
 * on it, so a control that renders but does nothing fails here.
 *
 * With `answerQueries`, each query the page runs is answered as the host
 * would answer it, for a test that goes on to use what the answer draws.
 * Without it, as for most tests, the host stays silent, so a test sees only
 * what the page does on its own and what it posts.
 */
function mountTagOverview(options: { answerQueries?: boolean } = {}): MountedView {
  const page = openWebviewPage(renderPage('searchPage'));
  const { window, document } = page;
  const app = page.find('#app');
  let shown: { query: { text: string } } | undefined;
  const answered = new WeakSet<object>();
  const show = (state: unknown): void => {
    shown = JSON.parse(JSON.stringify(state)) as { query: { text: string } };
    page.send(state);
  };
  /**
   * Answers each query the page ran as the host would, with the state for
   * that query, since the page draws a committed row only once the host has
   * answered. Only the text changes: while it is what the page sent, the
   * page keeps its own draft of the builder rather than the host's.
   */
  const answerHost = (): void => {
    if (!options.answerQueries) {
      return;
    }
    for (const message of page.posted) {
      if (answered.has(message) || message.type !== 'setOverviewQuery' || !shown) {
        continue;
      }
      answered.add(message);
      show({ ...shown, query: { ...shown.query, text: String(message.query) } });
    }
  };
  const element = (dataset: Record<string, string>): HTMLElement => {
    const selector = datasetSelector(dataset);
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) {
      throw new Error(`The page has no ${selector}.`);
    }
    return found;
  };
  const raise = (target: Element, event: Event): boolean => {
    target.dispatchEvent(event);
    answerHost();
    return event.defaultPrevented;
  };
  const fill = (target: HTMLElement, value: string): void => {
    (target as HTMLInputElement).value = value;
  };

  return {
    posted: page.posted as Array<Record<string, unknown>>,
    find: (selector) => page.find(selector),
    findAll: (selector) => page.findAll(selector),
    send: show,
    click: (dataset, modifiers = {}) => {
      raise(element(dataset), new window.MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
    },
    key: (input, key) =>
      raise(input, new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })),
    focus: (input, value) => {
      const target = element(input.dataset);
      fill(target, value);
      target.focus();
    },
    change: (input, value) => {
      const target = element(input.dataset);
      fill(target, value);
      raise(target, new window.Event('change', { bubbles: true }));
    },
    html: () => app.innerHTML,
    countRows: () => app.querySelectorAll('[data-action="builder-set-value"]').length,
    countGroups: () => app.querySelectorAll('.query-builder-group').length,
    type: (input, value) => {
      const target = element(input.dataset);
      target.focus();
      fill(target, value);
      raise(target, new window.Event('input', { bubbles: true }));
      return target;
    },
    suggestionsFor: (key) =>
      document.querySelector(`[data-suggestions="${key}"]`)?.innerHTML ?? '',
  };
}

/**
 * Builds the smallest overview snapshot the script will render.
 */
function createState(
  queryText = 'tag = #project/atlas',
  extras: {
    origin?: string;
    facets?: unknown[];
    canAppend?: boolean;
    recent?: Array<{ value: string; label: string; detail?: string }>;
  } = {},
): unknown {
  const value = queryText.replace(/^tag = /, '').split(' ')[0];
  return {
    originQuery: extras.origin ?? '',
    noteColumns: 1,
    taskColumns: 1,
    tag: {
      key: value,
      label: value,
      sectionIds: [],
      taskIds: [],
      filePaths: [],
      count: 1,
      isFavorite: false,
    },
    sections: [],
    tasks: [],
    taskCounts: { all: 0, active: 0, completed: 0 },
    renderMode: 'markdown',
    preview: 'lines',
    sortMode: 'alphabetical',
    layout: 'tabs',
    tagTitleDisplayMode: 'inline',
    query: {
      text: queryText,
      terms: [],
      canAppend: extras.canAppend ?? true,
      facets: extras.facets ?? [],
      isAdvanced: false,
      diagnostics: [],
      builder: {
        join: 'and',
        items: [
          {
            field: 'tag',
            operator: 'eq',
            value,
            supported: true,
            text: queryText,
          },
        ],
      },
      tags: [],
      suggestions: {
        fields: [
          { value: 'tag', label: 'tag' },
          { value: 'task', label: 'task' },
          { value: 'updated', label: 'updated' },
        ],
        aliases: { tag: 'tag', task: 'task', updated: 'updated' },
        values: {
          tag: [{ value: '#project/atlas', label: '#project/atlas' }],
          task: [
            { value: 'open', label: 'open' },
            { value: 'done', label: 'done' },
          ],
        },
        conditions: [
          { value: 'is:open', label: 'is:open', detail: 'Open tasks' },
          { value: 'is:done', label: 'is:done', detail: 'Completed tasks' },
        ],
        recent: extras.recent ?? [],
      },
      matchCounts: { notes: 0, tasks: 0 },
    },
  };
}
