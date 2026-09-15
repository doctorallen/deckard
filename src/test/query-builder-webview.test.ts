import * as assert from 'assert';

import { getTagOverviewHtml } from '../ui/webview/tagOverviewHtml';

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
    assert.strictEqual(view.countRows(), 1);

    view.posted.length = 0;
    view.click({ action: 'builder-add-row', groupIndex: '0' });

    assert.strictEqual(
      view.countRows(),
      2,
      'the new row should render immediately',
    );
    // An empty row does not change the query, and a round trip through the
    // host would drop it, so nothing should be posted for it.
    assert.deepStrictEqual(view.posted, []);
  });

  test('adds an OR group without waiting for the host', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });

    view.click({ action: 'builder-add-group' });

    assert.strictEqual(view.countGroups(), 2);
  });

  test('keeps in-progress rows across an unrelated refresh', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', groupIndex: '0' });

    // An index update re-sends the same query; a half-written row must
    // survive it.
    view.send(createState());

    assert.strictEqual(view.countRows(), 2);
  });

  test('rebuilds its rows when the query changes elsewhere', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', groupIndex: '0' });

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
          suggestKey: 'g0r0',
          field: 'tag',
          groupIndex: '0',
          rowIndex: '0',
        },
      },
      '#proj',
    );

    const rendered = view.suggestionsFor('g0r0');
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
          suggestKey: 'g0r0',
          field: 'task',
          groupIndex: '0',
          rowIndex: '0',
        },
      },
      'op',
    );

    const rendered = view.suggestionsFor('g0r0');
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
    view.click({ action: 'builder-add-row', groupIndex: '0' });
    view.posted.length = 0;

    const input = view.type(
      {
        dataset: {
          action: 'builder-set-value',
          suggestKey: 'g0r1',
          pending: 'true',
          groupIndex: '0',
          rowIndex: '1',
        },
      },
      'open',
    );
    assert.match(view.suggestionsFor('g0r1'), /is:open/);
    view.key(input, 'Tab');

    assert.deepStrictEqual(view.posted, [
      { type: 'setOverviewQuery', query: 'tag = #project/atlas AND is:open' },
    ]);
  });

  test('removes an empty row with Backspace', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', groupIndex: '0' });
    assert.strictEqual(view.countRows(), 2);

    const input = view.type(
      {
        dataset: {
          action: 'builder-set-value',
          suggestKey: 'g0r1',
          pending: 'true',
          groupIndex: '0',
          rowIndex: '1',
        },
      },
      '',
    );
    view.key(input, 'Backspace');

    assert.strictEqual(view.countRows(), 1);
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
      { type: 'setOverviewQuery', query: 'tag = #project/atlas is:open' },
      { type: 'setOverviewQuery', query: 'tag = #project/atlas -is:open' },
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
      { type: 'setOverviewQuery', query: '#project/atlas (is:open OR is:done)' },
    ]);
  });

  test('refines a tag overview rather than replacing its tags', () => {
    const view = mountTagOverview();
    view.send(createState('', { scope: 'tag = #project/atlas' }));
    view.posted.length = 0;

    const input = view.type(
      { dataset: { action: 'query-input', suggestKey: 'query' } },
      'vendor',
    );
    view.key(input, 'Enter');

    assert.deepStrictEqual(view.posted, [
      { type: 'setOverviewRefinement', refinement: 'vendor' },
    ]);
  });

  test('offers recent searches in an empty search box', () => {
    const view = mountTagOverview();
    view.send(
      createState('', {
        scope: 'tag = #project/atlas',
        recent: [{ value: '#project/atlas is:open', label: '#project/atlas is:open', detail: 'Recent search' }],
      }),
    );

    view.focus({ dataset: { action: 'query-input', suggestKey: 'query' } }, '');

    assert.match(view.suggestionsFor('query'), /#project\/atlas is:open/);
  });

  test('keeps the bar in place while a search is typed', () => {
    const view = mountTagOverview();
    view.send(createState('', { scope: 'tag = #project/atlas' }));
    const html = view.html();

    // Clear is always drawn, disabled while the box is empty, so nothing
    // appears beside the box when typing starts.
    assert.match(html, /data-action="clear-query" data-query-needs-text[^>]*disabled/);
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
    view.click({ action: 'builder-remove-row', groupIndex: '0', rowIndex: '0' });

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
  const html = getTagOverviewHtml({ cspSource: 'vscode-webview://deckard' });
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
    window: { addEventListener: addListener, innerWidth: 1200, innerHeight: 800 },
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
    html: () => app.innerHTML,
    countRows: () => (app.innerHTML.match(/builder-set-value/g) ?? []).length,
    countGroups: () =>
      (app.innerHTML.match(/class="query-builder-group"/g) ?? []).length,
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
    scope?: string;
    facets?: unknown[];
    canAppend?: boolean;
    recent?: Array<{ value: string; label: string; detail?: string }>;
  } = {},
): unknown {
  const value = (extras.scope ?? queryText).replace(/^tag = /, '').split(' ')[0];
  return {
    tag: {
      key: value,
      label: value,
      sectionIds: [],
      taskIds: [],
      filePaths: [],
      count: 1,
      isFavorite: false,
    },
    filterTags: [],
    sections: [],
    tasks: [],
    taskCounts: { all: 0, active: 0, completed: 0 },
    taskFilter: 'active',
    renderMode: 'markdown',
    sortMode: 'alphabetical',
    layout: 'tabs',
    tagTitleDisplayMode: 'inline',
    associatedTags: [],
    sharedAssociatedTags: [],
    query: {
      text: queryText,
      ...(extras.scope !== undefined ? { scope: extras.scope } : {}),
      terms: [],
      canAppend: extras.canAppend ?? true,
      facets: extras.facets ?? [],
      isAdvanced: false,
      isBuildable: true,
      diagnostics: [],
      groups: [
        {
          rows: [
            {
              field: 'tag',
              operator: 'eq',
              value,
              supported: true,
              text: queryText,
            },
          ],
        },
      ],
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
