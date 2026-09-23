import * as assert from 'assert';

import { getSearchPageHtml } from '../ui/webview/searchPageHtml';

/**
 * Drives the overview webview's own script against a stub DOM.
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
    const view = mountTagOverview();
    const state = createState('') as { query: Record<string, unknown> };
    state.query.text = '';
    state.query.builder = { join: 'and', items: [] };
    view.send(state);
    view.click({ action: 'toggle-builder' });
    assert.strictEqual(view.countRows(), 1, 'a row to type in');

    // A group beside the row, joined the other way, and told to match any.
    view.click({ action: 'builder-add-group', path: '' });
    assert.strictEqual(view.countGroups(), 2, 'the root, and one inside it');
    assert.match(view.html(), /<span class="query-builder-and">and<\/span>/, 'the group joins the root with AND');
    view.change({ dataset: { action: 'builder-set-join', path: '1' } }, 'or');

    const row = (path: string) => ({ dataset: { action: 'builder-set-value', pending: 'true', suggestKey: 'p' + path.replace(/\./g, '_'), path } });
    view.key(view.type(row('1.0'), '#a'), 'Enter');
    view.key(view.type(row('1.1'), '#b'), 'Enter');
    view.key(view.type(row('1.2'), '#c'), 'Enter');
    view.key(view.type(row('0'), '#d'), 'Enter');
    view.change({ dataset: { action: 'builder-set-operator', path: '0' } }, 'neq');

    // A search is a round trip through the host, which the stub does not
    // answer, so the query posted is what is checked, not a redraw.
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
    const keys = [...view.html().matchAll(/data-suggest-key="([^"]+)"[^>]*data-path="([^"]+)"/g)]
      .map((match) => [match[1], match[2]]);
    assert.strictEqual(keys.length, 4);
    assert.strictEqual(new Set(keys.map(([key]) => key)).size, 4, 'every row has its own key');
    for (const [key, path] of keys) {
      assert.strictEqual(key, 'p' + path.replace(/\./g, '_'), `the key for ${path}`);
    }
    assert.doesNotMatch(view.html(), /query-builder-readonly/, 'nothing is text');
    assert.match(view.html(), /data-action="builder-toggle-not" data-path="0" aria-pressed="true"/, 'the group is shown as negated');
  });

  test('accepting a completion in a nested group\'s second row leaves its first row alone', () => {
    // Reported: with #person/mara-vale as the first row of a nested OR group,
    // typing "harb" in the group's next row and choosing #team/harbor turned
    // the first row into "tag = undefined".
    const view = mountTagOverview();
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
    // Chosen from the keyboard: the stub's click cannot reach a completion,
    // since it closes the list for any click outside the input's shell.
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
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });

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
    assert.match(view.html(), /data-action="query-input"/);
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
    assert.strictEqual((view.html().match(/class="query-builder-group is-root"/g) ?? []).length, 1);
    assert.strictEqual((view.html().match(/query-builder-item has-group/g) ?? []).length, 2);

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
    const html = view.html();
    assert.strictEqual((html.match(/class="query-chip-group is-negated"/g) ?? []).length, 1);
    assert.match(html, /<span class="query-chip-join" aria-hidden="true">OR<\/span>/);
    assert.match(html, /<span class="query-chip-join" aria-hidden="true">NOT<\/span>/);
    assert.match(html, /<span class="query-chip-join" aria-hidden="true">AND<\/span>/);
    assert.match(html, /query-chip-group-remove" data-action="remove-term" data-without="#a"/);
    assert.match(html, /class="query-chip is-tag is-negated" data-action="remove-term" data-without="#a OR NOT \(#b\)"/);
    assert.strictEqual((html.match(/class="query-chip-remove"/g) ?? []).length, 4, 'a, the group, b, and c');
    // The frame itself removes the group, as a chip's face removes its term.
    assert.match(html, /class="query-chip-group is-negated" role="group" aria-label="NOT \(#b AND -#c\)" data-action="remove-term" data-without="#a"/);

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
    assert.match(view.html(), /data-action="facet"/);

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
    assert.match(view.html(), /data-clause="#team\/harbor"/);
    assert.match(view.html(), /class="tag-weight-rail"/, 'a related tag shows its strength');
    assert.match(view.html(), /related 2 of 3/);

    view.send({ ...(createState('#project/atlas', { facets }) as object), refineInSidebar: true });
    assert.doesNotMatch(view.html(), /data-clause="#team\/harbor"/);
    assert.match(view.html(), /In the Related Notes sidebar\./);
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

  test('keeps the bar in place while a search is typed', () => {
    const view = mountTagOverview();
    view.send(createState('#project/atlas', { origin: '#project/atlas' }));
    const html = view.html();

    // Clear is always drawn, disabled while the box holds only the page's
    // own tag, so nothing appears beside the box when typing starts.
    assert.match(html, /data-action="clear-query" data-query-clears[^>]*disabled/);
    // Builder sits under the box, not beside it.
    assert.ok(
      html.indexOf('data-action="toggle-builder"') > html.indexOf('class="query-status"'),
      'the builder toggle is on the line under the box',
    );

    view.posted.length = 0;
    view.type({ dataset: { action: 'query-input', suggestKey: 'query' } }, 'vendor');
    assert.strictEqual(view.html(), html, 'typing does not redraw the bar');
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

interface MountedView {
  posted: Array<Record<string, unknown>>;
  send: (state: unknown) => void;
  click: (dataset: Record<string, string>, modifiers?: Record<string, boolean>) => void;
  key: (input: Record<string, unknown>, key: string) => void;
  focus: (input: Record<string, unknown>, value: string) => void;
  change: (input: Record<string, unknown>, value: string) => void;
  html: () => string;
  countRows: () => number;
  countGroups: () => number;
  type: (
    input: Record<string, unknown>,
    value: string,
  ) => Record<string, unknown>;
  suggestionsFor: (key: string) => string;
}

/**
 * Evaluates the overview script with the smallest DOM it will accept.
 */
function mountTagOverview(): MountedView {
  const html = getSearchPageHtml({ cspSource: 'vscode-webview://deckard' });
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.notStrictEqual(script, '', 'the overview should render a script');

  const app = createStubElement('main');
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const posted: Array<Record<string, unknown>> = [];
  const scope = globalThis as unknown as Record<string, unknown>;
  const saved = {
    document: scope.document,
    window: scope.window,
    NodeFilter: scope.NodeFilter,
    acquireVsCodeApi: scope.acquireVsCodeApi,
  };

  const addListener = (type: string, handler: (event: unknown) => void) => {
    listeners[type] = listeners[type] ?? [];
    listeners[type].push(handler);
  };

  // Elements the script looks up by attribute are kept in one registry so a
  // completion list can be inspected after it renders.
  const registry = new Map<string, ReturnType<typeof createStubElement>>();
  const lookup = (selector: string) => {
    const existing = registry.get(selector);
    if (existing) {
      return existing;
    }
    if (
      selector.startsWith('[data-suggestions=') ||
      selector.startsWith('[data-suggest-key=')
    ) {
      const created = createStubElement('div');
      registry.set(selector, created);
      return created;
    }
    return null;
  };

  const stubs = {
    document: {
      addEventListener: addListener,
      getElementById: (id: string) => (id === 'app' ? app : null),
      querySelector: lookup,
      querySelectorAll: () => [],
      createElement: createStubElement,
      body: createStubElement('body'),
    },
    window: {
      addEventListener: addListener,
      innerWidth: 1200,
      innerHeight: 800,
      scrollX: 0,
      scrollY: 0,
      scrollTo: () => undefined,
    },
    NodeFilter: { SHOW_TEXT: 4 },
    acquireVsCodeApi: () => ({
      postMessage: (message: Record<string, unknown>) => posted.push(message),
      setState: () => undefined,
    }),
  };

  /**
   * The script's handlers reach for these globals long after it is evaluated,
   * so the stubs are installed around every call into it and removed again
   * afterwards rather than left in place for the rest of the suite.
   */
  const withStubs = <T>(run: () => T): T => {
    Object.assign(scope, stubs);
    try {
      return run();
    } finally {
      Object.assign(scope, saved);
    }
  };

  withStubs(() => new Function(script)());

  const dispatch = (type: string, event: unknown): void => {
    withStubs(() => {
      (listeners[type] ?? []).forEach((handler) => handler(event));
    });
  };

  return {
    posted,
    send: (state) => dispatch('message', { data: { type: 'state', data: state } }),
    click: (dataset, modifiers = {}) => {
      const target = Object.assign(createStubElement('button'), { dataset });
      dispatch('click', {
        target: {
          closest: (selector: string) =>
            selector === '[data-action]' ? target : null,
        },
        preventDefault: () => undefined,
        ...modifiers,
      });
    },
    key: (input, key) => {
      const target = Object.assign(input, {
        closest: (selector: string) =>
          selector === '[data-suggest-key]' ? input : null,
      });
      dispatch('keydown', { target, key, preventDefault: () => undefined });
    },
    focus: (input, value) => {
      const target = Object.assign(createStubElement('input'), input, { value });
      registry.set(
        `[data-suggest-key="${String((input.dataset as Record<string, string>).suggestKey)}"]`,
        target,
      );
      dispatch('focusin', { target });
    },
    change: (input, value) => {
      const target = Object.assign(createStubElement('select'), input, { value });
      dispatch('change', { target });
    },
    html: () => app.innerHTML,
    countRows: () => (app.innerHTML.match(/builder-set-value/g) ?? []).length,
    countGroups: () =>
      (app.innerHTML.match(/class="query-builder-group[ "]/g) ?? []).length,
    type: (input: Record<string, unknown>, value: string) => {
      const target = Object.assign(createStubElement('input'), input, { value });
      registry.set(
        `[data-suggest-key="${String((input.dataset as Record<string, string>).suggestKey)}"]`,
        target,
      );
      dispatch('input', { target });
      return target;
    },
    suggestionsFor: (key: string) =>
      registry.get(`[data-suggestions="${key}"]`)?.innerHTML ?? '',
  };
}

function createStubElement(tagName: string): any {
  return {
    tagName,
    dataset: {} as Record<string, string>,
    innerHTML: '',
    hidden: false,
    style: {},
    classList: { contains: () => false, add: () => undefined, remove: () => undefined },
    appendChild: (child: unknown) => child,
    setAttribute: () => undefined,
    getAttribute: () => null,
    focus: () => undefined,
    setSelectionRange: () => undefined,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
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
