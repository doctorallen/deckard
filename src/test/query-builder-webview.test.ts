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
    view.click({ action: 'toggle-query' });
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
    view.click({ action: 'toggle-query' });
    view.click({ action: 'toggle-builder' });

    view.click({ action: 'builder-add-group' });

    assert.strictEqual(view.countGroups(), 2);
  });

  test('keeps in-progress rows across an unrelated refresh', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-query' });
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
    view.click({ action: 'toggle-query' });
    view.click({ action: 'toggle-builder' });
    view.click({ action: 'builder-add-row', groupIndex: '0' });

    view.send(createState('tag = #other'));

    assert.strictEqual(view.countRows(), 1);
  });

  test('completes tag values in a builder row', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-query' });
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
    view.click({ action: 'toggle-query' });
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
    view.click({ action: 'toggle-query' });

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
    view.click({ action: 'toggle-query' });

    view.type(
      { dataset: { action: 'query-input', suggestKey: 'query' } },
      'upd',
    );

    assert.match(view.suggestionsFor('query'), /updated =/);
  });

  test('sends the query when a condition is removed', () => {
    const view = mountTagOverview();
    view.send(createState());
    view.click({ action: 'toggle-query' });
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
  click: (dataset: Record<string, string>) => void;
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
    click: (dataset) => {
      const target = Object.assign(createStubElement('button'), { dataset });
      dispatch('click', {
        target: {
          closest: (selector: string) =>
            selector === '[data-action]' ? target : null,
        },
        preventDefault: () => undefined,
      });
    },
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
function createState(queryText = 'tag = #project/atlas'): unknown {
  const value = queryText.replace(/^tag = /, '');
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
      },
      matchCounts: { notes: 0, tasks: 0 },
    },
  };
}
